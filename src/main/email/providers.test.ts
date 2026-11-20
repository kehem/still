import { expect, it, vi } from 'vitest';
import { EmailProviderLookup, providerFromMx } from './providers';
import { emailDomain, knownEmailProvider } from '../../shared/email-providers';
it('identifies well-known public providers without DNS', async () => {
  const dns = vi.fn();
  const service = new EmailProviderLookup(dns);
  expect(await service.get(['gmail.com', 'outlook.com', 'proton.me'])).toEqual({ 'gmail.com': 'Gmail', 'outlook.com': 'Outlook', 'proton.me': 'Proton Mail' });
  expect(dns).not.toHaveBeenCalled();
  expect(emailDomain('Person@Example.COM')).toBe('example.com');
  expect(emailDomain('not an email')).toBeNull();
  expect(knownEmailProvider('company.co.uk')).toBeNull();
});
it('classifies custom-domain MX providers and does not trust lookalike suffixes', () => {
  expect(providerFromMx(['ASPMX.L.GOOGLE.COM.'])).toBe('Google Workspace');
  expect(providerFromMx(['company.mail.protection.outlook.com'])).toBe('Microsoft 365 / Outlook');
  expect(providerFromMx(['mx.zoho.eu'])).toBe('Zoho Mail');
  expect(providerFromMx(['mail.protonmail.ch'])).toBe('Proton Mail');
  expect(providerFromMx(['mx.google.com.attacker.example'])).toBe('Unknown');
  expect(providerFromMx(['mx.custom-host.example'])).toBe('Unknown');
  expect(providerFromMx(['mx.pphosted.com'])).toBe('Proofpoint (mail gateway)');
});
it('caches DNS by domain, including simultaneous requests, without sending mailbox details', async () => {
  const dns = vi.fn(async () => [{ exchange: 'aspmx.l.google.com', priority: 10 }]);
  const service = new EmailProviderLookup(dns);
  await Promise.all([service.get(['example.com']), service.get(['example.com'])]);
  expect(await service.get(['EXAMPLE.COM'])).toEqual({ 'example.com': 'Google Workspace' });
  expect(dns).toHaveBeenCalledTimes(1);
  expect(dns).toHaveBeenCalledWith('example.com');
});
it('reports unavailable DNS as Unknown and validates input domains', async () => {
  const service = new EmailProviderLookup(vi.fn().mockRejectedValue(new Error('Offline')));
  expect(await service.get(['example.com'])).toEqual({ 'example.com': 'Unknown' });
  await expect(service.get(['https://example.com'])).rejects.toThrow('Invalid');
  await expect(service.get(['recipient@example.com'])).rejects.toThrow('Invalid');
  await expect(service.get(['bad..example'])).rejects.toThrow('Invalid');
});
it('limits concurrent DNS work', async () => {
  let active = 0; let max = 0;
  const service = new EmailProviderLookup(async () => {
    active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return [];
  });
  await service.get(Array.from({ length: 12 }, (_, i) => `company${i}.example`));
  expect(max).toBe(4);
});
