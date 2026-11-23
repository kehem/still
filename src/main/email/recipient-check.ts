import { recipientCanSend } from '../../shared/recipient-check';
import { randomUUID } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { BlockList, createConnection, isIPv4 } from 'node:net';
import { emailDomain, knownEmailProvider } from '../../shared/email-providers';
import { isMicrosoftMx } from './providers';
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
    socket.on('close', () => finish('unknown', 'SMTP connection closed before verification completed'));
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
          else if ([550, 551, 553].includes(code) && !/5\.7\.\d/.test(line) && /5\.1\.(?:[123]|10)(?:\s|$)|user unknown|no such (?:user|mailbox)|(?:mailbox|recipient).*(?:not found|does not exist)/i.test(line)) finish('invalid', 'SMTP reports recipient mailbox does not exist');
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
/**
 * Persistent record of completed checks: once an address has been checked and
 * saved, later sessions treat it as already checked instead of re-probing.
 */
export interface RecipientCheckStore {
  load(address: string): Pick<RecipientCheck, 'status' | 'detail'> | undefined;
  save(address: string, result: Pick<RecipientCheck, 'status' | 'detail'>): void;
}

/**
 * Microsoft-hosted mail accepts every recipient at SMTP and rejects unknown
 * mailboxes only after DATA, which this checker never sends. An inconclusive
 * probe there is an unverified mailbox, not a failed check.
 */
const MICROSOFT_UNVERIFIED_DETAIL = 'Microsoft-hosted mail: the server accepts recipients without confirming individual mailboxes to external checks. This specific mailbox is unverified; sending is allowed but may bounce.';

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
  constructor(private dns = new Resolver({ timeout: 1500, tries: 1 }), private probe = probeRecipient, private store?: RecipientCheckStore) {}
  /** Sending is authorized only by an approval the user was shown this session. */
  private approve(address: string, result: RecipientCheck): RecipientCheck {
    if (!recipientCanSend(result)) return result;
    const verificationId = randomUUID();
    this.approvals.set(verificationId, { address });
    return { ...result, verificationId };
  }
  private microsoftKnown(domain: string): boolean {
    if (knownEmailProvider(domain) === 'Outlook') return true;
    const records = this.mxCache.get(domain)?.records;
    return Boolean(records && isMicrosoftMx(records.map(record => record.exchange)));
  }
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
    if (!force) {
      // A completed check saved earlier means this email is already checked.
      const saved = this.store?.load(address);
      if (saved) {
        const result = this.approve(address, saved);
        this.cache.set(address, result);
        return result;
      }
    }
    const task = (async () => {
      let result: RecipientCheck = { status: 'unknown', detail: 'Recipient check unavailable' };
      let rejected: RecipientCheck | undefined;
      let attempts = 0;
      for (; attempts < 3; attempts++) {
        try { result = await this.lookup(address, domain); }
        catch { result = { status: 'unknown', detail: 'Recipient check unavailable' }; }
        if (recipientCanSend(result)) break;
        if (result.status === 'invalid') rejected = result;
        // Retry failed DNS/MX checks with a fresh response, not a cached failure.
        this.mxCache.delete(domain);
      }
      if (!recipientCanSend(result)) {
        result = !rejected && this.microsoftKnown(domain)
          // Microsoft never confirms mailboxes to external checks; inconclusive is not failed.
          ? { status: 'catch_all', attempts: attempts + 1, detail: MICROSOFT_UNVERIFIED_DETAIL }
          : { status: 'invalid', attempts: 3, detail: `Not valid for sending after 3 failed checks. ${(rejected ?? result).detail}. This may be a verification failure, not proof the mailbox does not exist. Use Recheck to try again.` };
      } else {
        result = this.approve(address, { ...result, attempts: attempts + 1 });
      }
      this.cache.set(address, result);
      // Persist only the outcome; approval IDs and attempt counts are session state.
      this.store?.save(address, { status: result.status, detail: result.detail });
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
        try {
          records = await this.dns.resolveMx(domain);
        } catch (error) {
          // No MX data is not NXDOMAIN: SMTP permits an implicit MX at the domain itself.
          if ((error as NodeJS.ErrnoException).code !== 'ENODATA') throw error;
          records = [];
        }
        if (!records.length) records = [{ exchange: domain, priority: 0 }];
        records.sort((a, b) => a.priority - b.priority);
        if (this.mxCache.size >= 2000) this.mxCache.delete(this.mxCache.keys().next().value!);
        this.mxCache.set(domain, { records, expires: Date.now() + 300000 });
      }
      const nullRecords = records.filter(r => r.exchange === '' || r.exchange === '.');
      if (nullRecords.length === records.length && records.length === 1 && nullRecords[0].priority === 0) return { status: 'invalid', detail: 'Domain publishes Null MX: it does not accept email' };
      // Ignore stray null entries in a mixed, misconfigured set rather than hiding working MX hosts.
      const hosts = records.filter(r => r.exchange !== '' && r.exchange !== '.');
      if (!hosts.length) return { status: 'unknown', detail: 'Domain publishes a malformed MX configuration' };
      const microsoftHosted = isMicrosoftMx(hosts.map(record => record.exchange));
      let lastDetail = 'MX found; SMTP check unavailable or inconclusive';
      for (const record of hosts.slice(0, 3)) {
        if (Date.now() >= deadline) break;
        let ips: string[];
        try { ips = await this.dns.resolve4(record.exchange); } catch { continue; }
        // One failed address must not conceal other working addresses for the same MX.
        for (const ip of [...new Set(ips)].filter(publicMailIP).slice(0, 3)) {
          if (Date.now() >= deadline) break;
          try {
            const result = await this.probe(ip, address, Math.max(1, Math.min(5000, deadline - Date.now())));
            if (result.status !== 'unknown') return result;
            lastDetail = result.detail;
          } catch { lastDetail = 'SMTP server unavailable or port 25 blocked'; }
        }
      }
      // Microsoft-hosted mail cannot be verified or refuted by external SMTP probes:
      // unresolvable MX addresses or inconclusive probes must not fail the check.
      if (microsoftHosted) return { status: 'catch_all', detail: MICROSOFT_UNVERIFIED_DETAIL };
      return { status: 'unknown', detail: lastDetail };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOTFOUND' || code === 'ENODATA'
        ? { status: 'invalid', detail: 'No receiving mail server found' }
        : { status: 'unknown', detail: 'DNS check unavailable; try again later' };
    }
  }
}
