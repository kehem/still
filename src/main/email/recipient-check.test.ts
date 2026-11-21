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
  expect(probe).toHaveBeenCalledWith('8.8.8.8', 'person@example.com');
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
  expect((await checker.check('a@example.com')).status).toBe('unknown');
  expect(probe).not.toHaveBeenCalled();
});
it('does not treat temporary DNS failure or inconclusive SMTP as valid', async () => {
  const { checker, dns, probe } = setup();
  dns.resolveMx.mockRejectedValueOnce({ code: 'ETIMEOUT' });
  expect((await checker.check('a@example.com')).status).toBe('unknown');
  probe.mockResolvedValue({ status: 'unknown', detail: 'Greylisted' });
  expect((await checker.check('b@example.com')).status).toBe('unknown');
});
