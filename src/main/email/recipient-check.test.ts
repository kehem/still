import { expect, it, vi } from 'vitest';
import type { Resolver } from 'node:dns/promises';
import { publicMailIP, RecipientChecker } from './recipient-check';
function setup(mx = [{ exchange: 'mx.example.com', priority: 0 }]) {
  const dns = { resolveMx: vi.fn().mockResolvedValue(mx), resolve4: vi.fn().mockResolvedValue(['8.8.8.8']) };
  const probe = vi.fn().mockResolvedValue({ status: 'valid', detail: 'Accepted' });
  return { dns, probe, checker: new RecipientChecker(dns as unknown as Resolver, probe) };
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
it('rejects missing or null MX without SMTP', async () => {
  for (const records of [[], [{ exchange: '', priority: 0 }]]) {
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
