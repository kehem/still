/** Only domains are needed for provider lookup, never the mailbox name or message. */
export function emailDomain(address: string): string | null {
  const match = address.trim().match(/^[^\s@,;]+@([^\s@,;]+)$/);
  if (!match) return null;
  const domain = match[1].toLowerCase();
  if (domain.length > 253 || !domain.includes('.') || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return domain;
}
export function knownEmailProvider(domain: string): string | null {
  const providers: Record<string, string> = {
    'gmail.com': 'Gmail', 'googlemail.com': 'Gmail',
    'outlook.com': 'Outlook', 'hotmail.com': 'Outlook', 'live.com': 'Outlook', 'msn.com': 'Outlook',
    'icloud.com': 'iCloud Mail', 'me.com': 'iCloud Mail', 'mac.com': 'iCloud Mail',
    'yahoo.com': 'Yahoo Mail', 'yahoo.co.uk': 'Yahoo Mail', 'ymail.com': 'Yahoo Mail', 'rocketmail.com': 'Yahoo Mail',
    'aol.com': 'AOL Mail', 'proton.me': 'Proton Mail', 'protonmail.com': 'Proton Mail', 'pm.me': 'Proton Mail',
    'fastmail.com': 'Fastmail', 'hey.com': 'HEY', 'gmx.com': 'GMX', 'gmx.de': 'GMX',
  };
  return providers[domain.toLowerCase()] ?? null;
}
