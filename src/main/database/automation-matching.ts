/** Conservative visible-text normalization: no fuzzy, recipient-only or prefix matching. */
export function normalizedText(value: string): string {
  return value.normalize('NFC').replace(/[\u200B\uFEFF]/g, '').replace(/\s+/gu, ' ').trim();
}
function recipient(value: string): string {
  const address = value.match(/^[^<>]*<([^<>]+)>\s*$/)?.[1] ?? value;
  return address.trim().toLowerCase();
}
export function sentMatchKeys(to: string, subject: string, body: string, signature = ''): string[] {
  const text = normalizedText(body);
  if (!text) return [];
  const sign = normalizedText(signature);
  const bodies = [text];
  // Only strip the actual configured signature, not arbitrary trailing paragraphs.
  if (sign && text.endsWith(` ${sign}`)) bodies.push(text.slice(0, -(sign.length + 1)).trim());
  return bodies.filter(Boolean).map(value => JSON.stringify([
    recipient(to), normalizedText(subject || '(no subject)').toLowerCase() || '(no subject)', value,
  ]));
}
