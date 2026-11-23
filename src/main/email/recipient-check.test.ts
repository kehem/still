import { expect, it, vi } from 'vitest';
import type { Resolver } from 'node:dns/promises';
import { publicMailIP, RecipientChecker, type RecipientCheckStore } from './recipient-check';
import type { RecipientCheck } from '../../shared/types';
function setup(mx = [{ exchange: 'mx.example.com', priority: 0 }], store?: RecipientCheckStore) {
  const dns = { resolveMx: vi.fn().mockResolvedValue(mx), resolve4: vi.fn().mockResolvedValue(['8.8.8.8']) };
  const probe = vi.fn().mockResolvedValue({ status: 'valid', detail: 'Accepted' });
  return { dns, probe, checker: new RecipientChecker(dns as unknown as Resolver, probe, store) };
}
function memoryStore(seed: [string, Pick<RecipientCheck, 'status' | 'detail'>][] = []) {
  const saved = new Map<string, Pick<RecipientCheck, 'status' | 'detail'>>(seed);
  const store: RecipientCheckStore = {
    load: address => saved.get(address),
    save: (address, result) => void saved.set(address, { ...result }),
  };
  return { saved, store };
}
it('requires MX and SMTP acceptance and caches checks per recipient', async () => {
  const { checker, dns, probe } = setup();
  expect((await checker.check('person@example.com')).status).toBe('valid');
  await checker.check('person@example.com');
  expect(dns.resolveMx).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledWith('8.8.8.8', 'person@example.com', expect.any(Number));
});
it('rejects malformed addresses without DNS or SMTP', async () => {
  const { checker, dns } = setup();
  for (const address of ['bad', 'a\r\nRCPT TO:x@example.com', '<a>@example.com']) expect((await checker.check(address)).status).toBe('invalid');
  expect(dns.resolveMx).not.toHaveBeenCalled();
});
it('rejects explicit null MX without SMTP', async () => {
  for (const records of [[{ exchange: '.', priority: 0 }], [{ exchange: '', priority: 0 }]]) {
    const { checker, probe } = setup(records);
    expect((await checker.check('a@example.com')).status).toBe('invalid');
    expect(probe).not.toHaveBeenCalled();
  }
});
it('never connects to local, private, metadata, or reserved addresses', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.1.1', '192.168.0.1', '0.0.0.0', '224.0.0.1', '::1']) expect(publicMailIP(ip)).toBe(false);
  const { checker, dns, probe } = setup(); dns.resolve4.mockResolvedValue(['127.0.0.1']);
  expect((await checker.check('a@example.com')).status).toBe('invalid');
  expect(probe).not.toHaveBeenCalled();
});
it('does not treat temporary DNS failure or inconclusive SMTP as valid', async () => {
  const { checker, dns, probe } = setup();
  dns.resolveMx.mockRejectedValue({ code: 'ETIMEOUT' });
  expect((await checker.check('a@example.com')).status).toBe('invalid');
  probe.mockResolvedValue({ status: 'unknown', detail: 'Greylisted' });
  expect((await checker.check('b@example.com')).status).toBe('invalid');
});
it('reuses domain MX results for different recipients without skipping SMTP recipient checks', async () => {
  const { checker, dns, probe } = setup();
  await checker.check('first@example.com'); await checker.check('second@example.com');
  expect(dns.resolveMx).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledTimes(2);
});
it('tries a backup MX when the primary cannot be resolved', async () => {
  const { checker, dns, probe } = setup([{ exchange: 'first.example.com', priority: 1 }, { exchange: 'second.example.com', priority: 2 }]);
  dns.resolve4.mockRejectedValueOnce({ code: 'ENOTFOUND' });
  expect((await checker.check('a@example.com')).status).toBe('valid');
  expect(probe).toHaveBeenCalledTimes(1);
});
it('authorizes the displayed acceptance without another DNS/SMTP check and binds it to the recipient', async () => {
  const { checker, dns, probe } = setup();
  const result = await checker.check('person@example.com');
  expect(result.verificationId).toBeTruthy();
  expect(result.expiresAt).toBeUndefined();
  probe.mockResolvedValue({ status: 'unknown', detail: 'Network changed' });
  expect(() => checker.requireApproval('person@example.com', result.verificationId)).not.toThrow();
  expect(() => checker.requireApproval('other@example.com', result.verificationId)).toThrow('unavailable or changed');
  expect(() => checker.requireApproval('person@example.com', 'invented')).toThrow('unavailable or changed');
  expect(() => checker.requireApproval('person@example.com', undefined)).toThrow('unavailable or changed');
  expect(dns.resolveMx).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledTimes(1);
});
it('keeps successful approvals for the app session without periodic rechecks', async () => {
  vi.useFakeTimers();
  try {
    const { checker, probe } = setup();
    const result = await checker.check('person@example.com');
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    expect(() => checker.requireApproval('person@example.com', result.verificationId)).not.toThrow();
    expect(await checker.check('person@example.com')).toEqual(result);
    expect(probe).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
it('issues no sending approval for an unaccepted unknown recipient', async () => {
  const { checker, probe } = setup();
  probe.mockResolvedValue({ status: 'unknown', detail: 'Timed out' });
  const result = await checker.check('person@example.com');
  expect(result.verificationId).toBeUndefined();
  expect(() => checker.requireApproval('person@example.com', result.verificationId)).toThrow();
});
it('stops after three failures, remembers the result, and retries only with explicit Recheck', async () => {
  const { checker, probe } = setup();
  probe.mockResolvedValue({ status: 'unknown', detail: 'SMTP timeout' });
  const failed = await checker.check('person@example.com');
  expect(failed.status).toBe('invalid'); expect(failed.attempts).toBe(3);
  expect(failed.detail).toContain('verification failure');
  expect(probe).toHaveBeenCalledTimes(3);
  await checker.check('person@example.com'); expect(probe).toHaveBeenCalledTimes(3);
  probe.mockResolvedValue({ status: 'valid', detail: 'Accepted' });
  const retried = await checker.check('person@example.com', true);
  expect(retried.status).toBe('valid'); expect(retried.attempts).toBe(1);
  expect(probe).toHaveBeenCalledTimes(4);
});
it('stops retrying immediately after a successful second attempt', async () => {
  const { checker, probe } = setup();
  probe.mockResolvedValueOnce({ status: 'unknown', detail: 'Temporary failure' });
  const result = await checker.check('person@example.com');
  expect(result.status).toBe('valid'); expect(result.attempts).toBe(2);
  expect(probe).toHaveBeenCalledTimes(2);
});
it('manual Recheck revokes the old approval if new checks fail', async () => {
  const { checker, probe } = setup();
  const accepted = await checker.check('person@example.com');
  probe.mockResolvedValue({ status: 'invalid', detail: 'Mailbox rejected' });
  await checker.check('person@example.com', true);
  expect(() => checker.requireApproval('person@example.com', accepted.verificationId)).toThrow('unavailable or changed');
});
it('uses implicit MX when DNS has no MX data but the domain accepts SMTP', async () => {
  for (const missing of ['empty', 'ENODATA']) {
    const { checker, dns, probe } = setup([]);
    if (missing === 'ENODATA') dns.resolveMx.mockRejectedValue({ code: 'ENODATA' });
    expect((await checker.check('person@example.com')).status).toBe('valid');
    expect(dns.resolve4).toHaveBeenCalledWith('example.com');
    expect(probe).toHaveBeenCalledTimes(1);
  }
});
it('does not use implicit MX after NXDOMAIN or temporary MX lookup failures', async () => {
  for (const code of ['ENOTFOUND', 'ETIMEOUT', 'ESERVFAIL']) {
    const { checker, dns, probe } = setup();
    dns.resolveMx.mockRejectedValue({ code });
    expect((await checker.check('person@example.com')).status).toBe('invalid');
    expect(dns.resolve4).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  }
});
it('tries another public address on the same MX after a connection failure', async () => {
  const { checker, dns, probe } = setup();
  dns.resolve4.mockResolvedValue(['127.0.0.1', '8.8.8.8', '8.8.8.8', '1.1.1.1']);
  probe.mockResolvedValueOnce({ status: 'unknown', detail: 'Connection refused' });
  expect((await checker.check('person@example.com')).status).toBe('valid');
  expect(probe.mock.calls.map(call => call[0])).toEqual(['8.8.8.8', '1.1.1.1']);
});
it('continues to a backup MX after a probe throws', async () => {
  const { checker, probe } = setup([{ exchange: 'first.example.com', priority: 0 }, { exchange: 'backup.example.com', priority: 10 }]);
  probe.mockRejectedValueOnce(new Error('Connection failed'));
  expect((await checker.check('person@example.com')).status).toBe('valid');
  expect(probe).toHaveBeenCalledTimes(2);
});
it('ignores a stray null entry when a real MX is also published', async () => {
  const { checker, dns } = setup([{ exchange: '.', priority: 0 }, { exchange: 'mx.example.com', priority: 10 }]);
  expect((await checker.check('person@example.com')).status).toBe('valid');
  expect(dns.resolve4).toHaveBeenCalledWith('mx.example.com');
  expect(dns.resolve4).not.toHaveBeenCalledWith('.');
});
it('retains the SMTP failure reason after the three-attempt limit', async () => {
  const { checker, probe } = setup();
  probe.mockResolvedValue({ status: 'unknown', detail: 'SMTP server unavailable or port 25 blocked' });
  expect((await checker.check('person@example.com')).detail).toContain('port 25 blocked');
});

// ─── Microsoft-hosted mail ───────────────────────────────────────────────────

it('treats Microsoft-hosted mail as unverified but sendable when SMTP checks are inconclusive', async () => {
  const { checker, probe } = setup([{ exchange: 'contoso-com.mail.protection.outlook.com', priority: 0 }]);
  probe.mockResolvedValue({ status: 'unknown', detail: '421 4.7.0 throttled' });
  const result = await checker.check('person@contoso.com');
  expect(result.status).toBe('catch_all');
  expect(result.detail).toContain('Microsoft');
  expect(result.verificationId).toBeTruthy();
  expect(probe).toHaveBeenCalledTimes(1); // no repeated retries against Microsoft
});
it('keeps definitive Microsoft recipient rejections invalid', async () => {
  const { checker, probe } = setup([{ exchange: 'contoso-com.mail.protection.outlook.com', priority: 0 }]);
  probe.mockResolvedValue({ status: 'invalid', detail: 'SMTP reports recipient mailbox does not exist' });
  const result = await checker.check('person@contoso.com');
  expect(result.status).toBe('invalid');
  expect(result.verificationId).toBeUndefined();
});
it('passes Microsoft-hosted mail even when the MX host has no resolvable address', async () => {
  const { checker, dns, probe } = setup([{ exchange: 'outlook-com.olc.protection.outlook.com', priority: 5 }]);
  dns.resolve4.mockRejectedValue({ code: 'ESERVFAIL' });
  const result = await checker.check('person@outlook.com');
  expect(result.status).toBe('catch_all');
  expect(result.detail).toContain('Microsoft');
  expect(probe).not.toHaveBeenCalled();
});
it('reports Microsoft consumer domains as sendable even when DNS lookups fail entirely', async () => {
  const { checker, dns, probe } = setup();
  dns.resolveMx.mockRejectedValue({ code: 'ETIMEOUT' });
  const result = await checker.check('person@hotmail.com');
  expect(result.status).toBe('catch_all');
  expect(result.detail).toContain('Microsoft');
  expect(probe).not.toHaveBeenCalled();
});
it('does not rewrite definitive rejections for Microsoft consumer domains', async () => {
  const { checker, probe } = setup([{ exchange: '.', priority: 0 }]);
  const result = await checker.check('person@hotmail.com');
  expect(result.status).toBe('invalid');
  expect(result.verificationId).toBeUndefined();
  expect(probe).not.toHaveBeenCalled();
});

// ─── Saved checks (database persistence) ─────────────────────────────────────

it('saves every completed check and treats a saved result as already checked', async () => {
  const { saved, store } = memoryStore();
  const { checker } = setup(undefined, store);
  const first = await checker.check('person@example.com');
  expect(first.status).toBe('valid');
  expect(saved.get('person@example.com')).toEqual({ status: 'valid', detail: 'Accepted' });
  // A new session over the same store: already checked, no DNS or SMTP.
  const dns = { resolveMx: vi.fn(), resolve4: vi.fn() };
  const probe = vi.fn();
  const second = await new RecipientChecker(dns as unknown as Resolver, probe, store).check('person@example.com');
  expect(second).toMatchObject({ status: 'valid', detail: 'Accepted' });
  expect(dns.resolveMx).not.toHaveBeenCalled();
  expect(probe).not.toHaveBeenCalled();
});
it('binds a fresh sending approval to an already checked result and keeps it stable', async () => {
  const { store } = memoryStore([['person@example.com', { status: 'catch_all', detail: 'Unverified mailbox' }]]);
  const { checker, probe } = setup(undefined, store);
  const result = await checker.check('person@example.com');
  expect(result.verificationId).toBeTruthy();
  expect(() => checker.requireApproval('person@example.com', result.verificationId)).not.toThrow();
  expect(() => checker.requireApproval('other@example.com', result.verificationId)).toThrow('unavailable or changed');
  expect((await checker.check('person@example.com')).verificationId).toBe(result.verificationId);
  expect(probe).not.toHaveBeenCalled();
});
it('remembers failed checks in the store and re-checks only with Recheck', async () => {
  const { saved, store } = memoryStore();
  const { checker, probe } = setup(undefined, store);
  probe.mockResolvedValue({ status: 'unknown', detail: 'SMTP timeout' });
  const failed = await checker.check('person@example.com');
  expect(failed.status).toBe('invalid');
  expect(probe).toHaveBeenCalledTimes(3);
  // A new session: the failed check is already saved, so nothing is re-probed.
  const dns = { resolveMx: vi.fn(), resolve4: vi.fn() };
  const retryProbe = vi.fn();
  const fresh = new RecipientChecker(dns as unknown as Resolver, retryProbe, store);
  const loaded = await fresh.check('person@example.com');
  expect(loaded.status).toBe('invalid');
  expect(loaded.verificationId).toBeUndefined();
  expect(retryProbe).not.toHaveBeenCalled();
  // Explicit Recheck replaces the saved result.
  retryProbe.mockResolvedValue({ status: 'valid', detail: 'Accepted' });
  (dns.resolveMx as ReturnType<typeof vi.fn>).mockResolvedValue([{ exchange: 'mx.example.com', priority: 0 }]);
  (dns.resolve4 as ReturnType<typeof vi.fn>).mockResolvedValue(['8.8.8.8']);
  const rechecked = await fresh.check('person@example.com', true);
  expect(rechecked.status).toBe('valid');
  expect(retryProbe).toHaveBeenCalled();
  expect(saved.get('person@example.com')).toEqual({ status: 'valid', detail: 'Accepted' });
});
