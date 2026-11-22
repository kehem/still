import { recipientCanSend } from '../../shared/recipient-check';
import { randomUUID } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { BlockList, createConnection, isIPv4 } from 'node:net';
import { emailDomain } from '../../shared/email-providers';
import type { RecipientCheck } from '../../shared/types';

const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(ip, prefix);
export const publicMailIP = (ip: string) => isIPv4(ip) && !blocked.check(ip);

/** No DATA, authentication, or message content. Connect only to a pinned public IPv4 address. */
export function probeRecipient(ip: string, address: string, timeoutMs = 5000): Promise<RecipientCheck> {
  return new Promise(resolve => {
    let heloFallback = false;
    let recipientAccepted = false;
    const acceptedDetail = 'MX found; SMTP accepted recipient. Catch-all status could not be confirmed; delivery is not guaranteed.';
    let finished = false, buffer = '', bytes = 0, step = 0;
    const socket = createConnection({ host: ip, port: 25 });
    const finish = (status: RecipientCheck['status'], detail: string) => {
      if (finished) return; finished = true; clearTimeout(timer); socket.destroy();
      // Once the real RCPT has been accepted, an inconclusive optional probe must not undo that evidence.
      resolve(recipientAccepted && status === 'unknown' ? { status: 'valid', detail: acceptedDetail } : { status, detail });
    };
    const timer = setTimeout(() => finish('unknown', 'SMTP check timed out'), timeoutMs);
    socket.on('error', () => finish('unknown', 'SMTP server unavailable or port 25 blocked'));
    socket.on('end', () => finish('unknown', 'SMTP server closed the check'));
    socket.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 32768) { finish('unknown', 'Unexpected SMTP response'); return; }
      buffer += chunk.toString('utf8');
      while (buffer.includes('\n') && !finished) {
        const end = buffer.indexOf('\n'); const line = buffer.slice(0, end).trimEnd(); buffer = buffer.slice(end + 1);
        if (!/^\d{3} /.test(line)) continue; // Wait for the final line of a multiline reply.
        const code = Number(line.slice(0, 3));
        if (step === 3) {
          if (code === 250 || code === 251) {
            recipientAccepted = true; step = 4;
            // A random RCPT in the same transaction identifies likely accept-all domains.
            // No message is sent to either address: DATA is never issued.
            socket.write(`RCPT TO:<still-check-${randomUUID()}@${address.slice(address.lastIndexOf('@') + 1)}>\r\n`);
          }
          else if ([550, 551, 553].includes(code) && /5\.1\.[123]|user unknown|no such (?:user|mailbox)|mailbox.*(?:not found|does not exist)/i.test(line)) finish('invalid', 'SMTP reports recipient mailbox does not exist');
          else finish('unknown', 'SMTP recipient check inconclusive');
          return;
        }
        if (step === 4) {
          if (code === 250 || code === 251) finish('catch_all', 'Likely catch-all domain: SMTP accepted a random test address. This specific mailbox is unverified; sending is allowed but may bounce.');
          else finish('valid', acceptedDetail);
          return;
        }
        if (step === 1 && [500, 502, 504].includes(code) && !heloFallback) {
          heloFallback = true; socket.write('HELO still.invalid\r\n'); continue;
        }
        if (code !== (step === 0 ? 220 : 250)) { finish('unknown', 'SMTP server declined verification'); return; }
        socket.write(['EHLO still.invalid\r\n', 'MAIL FROM:<>\r\n', `RCPT TO:<${address}>\r\n`][step++]);
      }
    });
  });
}
export class RecipientChecker {
  private approvals = new Map<string, { address: string }>();
  requireApproval(address: string, verificationId: unknown): void {
    const approval = typeof verificationId === 'string' ? this.approvals.get(verificationId) : undefined;
    if (!approval || approval.address !== address) {
      throw new Error('Recipient verification unavailable or changed. Refresh recipient checks before sending. No email was sent.');
    }
  }
  private cache = new Map<string, RecipientCheck>();
  private mxCache = new Map<string, { records: { exchange: string; priority: number }[]; expires: number }>();
  private pending = new Map<string, Promise<RecipientCheck>>();
  constructor(private dns = new Resolver({ timeout: 1500, tries: 1 }), private probe = probeRecipient) {}
  async check(address: string, force = false): Promise<RecipientCheck> {
    const domain = emailDomain(address);
    const local = address.slice(0, address.lastIndexOf('@'));
    if (!domain || !local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || address.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@/.test(address)) return { status: 'invalid', detail: 'Invalid email address' };
    const pending = this.pending.get(address); if (pending) return pending;
    const cached = this.cache.get(address);
    if (cached && !force) return cached;
    if (cached?.verificationId) this.approvals.delete(cached.verificationId);
    if (force) { this.cache.delete(address); this.mxCache.delete(domain); }
    if (!this.cache.has(address) && this.cache.size + this.pending.size >= 10000) throw new Error('Recipient check session limit reached. Restart the app to check more addresses.');
    const task = (async () => {
      let result: RecipientCheck = { status: 'unknown', detail: 'Recipient check unavailable' };
      let attempts = 0;
      for (; attempts < 3; attempts++) {
        try { result = await this.lookup(address, domain); }
        catch { result = { status: 'unknown', detail: 'Recipient check unavailable' }; }
        if (recipientCanSend(result)) break;
        // Retry failed DNS/MX checks with a fresh response, not a cached failure.
        this.mxCache.delete(domain);
      }
      if (!recipientCanSend(result)) {
        result = { status: 'invalid', attempts: 3, detail: `Not valid for sending after 3 failed checks. ${result.detail}. This may be a verification failure, not proof the mailbox does not exist. Use Recheck to try again.` };
      } else {
        const verificationId = randomUUID();
        this.approvals.set(verificationId, { address });
        result = { ...result, attempts: attempts + 1, verificationId };
      }
      this.cache.set(address, result);
      return result;
    })();
    this.pending.set(address, task);
    try { return await task; } finally { this.pending.delete(address); }
  }
  private async lookup(address: string, domain: string): Promise<RecipientCheck> {
    try {
      const deadline = Date.now() + 12000;
      const cachedMx = this.mxCache.get(domain);
      let records = cachedMx && cachedMx.expires > Date.now() ? cachedMx.records : undefined;
      if (!records) {
        records = (await this.dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority);
        if (this.mxCache.size >= 2000) this.mxCache.delete(this.mxCache.keys().next().value!);
        this.mxCache.set(domain, { records, expires: Date.now() + 300000 });
      }
      if (!records.length || records.some(r => r.exchange === '' || r.exchange === '.')) return { status: 'invalid', detail: 'Domain has no receiving MX server' };
      for (const record of records.slice(0, 3)) {
        if (Date.now() >= deadline) break;
        let ips: string[];
        try { ips = await this.dns.resolve4(record.exchange); } catch { continue; }
        const ip = ips.find(publicMailIP);
        if (!ip) continue;
        const result = await this.probe(ip, address, Math.max(1, Math.min(5000, deadline - Date.now())));
        if (result.status !== 'unknown') return result;
      }
      return { status: 'unknown', detail: 'MX found; SMTP check unavailable or inconclusive' };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOTFOUND' || code === 'ENODATA'
        ? { status: 'invalid', detail: 'No receiving mail server found' }
        : { status: 'unknown', detail: 'DNS check unavailable; try again later' };
    }
  }
}
