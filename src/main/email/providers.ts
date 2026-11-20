import { Resolver } from 'node:dns/promises';
import { knownEmailProvider, emailDomain } from '../../shared/email-providers';

export function providerFromMx(exchanges: string[]): string {
  const hosts = exchanges.map(host => host.toLowerCase().replace(/\.$/, ''));
  const has = (suffix: string) => hosts.some(host => host === suffix || host.endsWith(`.${suffix}`));
  // Gateways do not reliably reveal the actual mailbox provider behind them.
  if (has('pphosted.com') || has('ppe-hosted.com')) return 'Proofpoint (mail gateway)';
  if (has('mimecast.com')) return 'Mimecast (mail gateway)';
  if (has('messagelabs.com')) return 'Broadcom (mail gateway)';
  if (has('google.com') || has('googlemail.com')) return 'Google Workspace';
  if (has('mail.protection.outlook.com') || has('olc.protection.outlook.com')) return 'Microsoft 365 / Outlook';
  if (['zoho.com', 'zoho.eu', 'zoho.in', 'zoho.com.au', 'zoho.jp', 'zohomail.com'].some(has)) return 'Zoho Mail';
  if (has('protonmail.ch')) return 'Proton Mail';
  if (has('messagingengine.com')) return 'Fastmail';
  if (has('emailsrvr.com')) return 'Rackspace Email';
  if (has('mx.icloud.com')) return 'iCloud Mail';
  if (has('yahoodns.net')) return 'Yahoo Mail';
  if (has('secureserver.net')) return 'GoDaddy';
  if (has('privateemail.com')) return 'Namecheap Private Email';
  return 'Unknown';
}

type Lookup = (domain: string) => Promise<{ exchange: string; priority: number }[]>;
/** Domain-only DNS, bounded concurrency and cache; never connect to an MX host. */
export class EmailProviderLookup {
  private cache = new Map<string, { provider: string; expires: number }>();
  private inFlight = new Map<string, Promise<string>>();
  constructor(private readonly lookup: Lookup = domain => new Resolver({ timeout: 2500, tries: 1 }).resolveMx(domain)) {}
  private async one(domain: string): Promise<string> {
    const known = knownEmailProvider(domain);
    if (known) return known;
    const cached = this.cache.get(domain);
    if (cached && cached.expires > Date.now()) return cached.provider;
    const pending = this.inFlight.get(domain);
    if (pending) return pending;
    const request = (async () => {
      let provider = 'Unknown';
      try { provider = providerFromMx((await this.lookup(domain)).map(record => record.exchange)); } catch { /* Offline, timeout, or absent MX: don't guess. */ }
      if (this.cache.size >= 2000) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(domain, { provider, expires: Date.now() + (provider === 'Unknown' ? 60000 : 3600000) });
      return provider;
    })();
    this.inFlight.set(domain, request);
    try { return await request; } finally { this.inFlight.delete(domain); }
  }
  async get(domains: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(domains.map(d => d.toLowerCase()))];
    if (unique.length > 100 || unique.some(d => emailDomain(`lookup@${d}`) !== d)) throw new Error('Invalid email provider domains');
    const result: Record<string, string> = {};
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
      while (next < unique.length) { const domain = unique[next++]; result[domain] = await this.one(domain); }
    }));
    return result;
  }
}
