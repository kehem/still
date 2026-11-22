import { expect, it } from 'vitest';
import { decodeFollowUpDraftText, emptyFollowUpImport, normalizeFollowUpImport } from './followup-import';
it('decodes single-escaped draft cells, not only double-escaped fixtures', () => {
  expect(decodeFollowUpDraftText(String.raw`Original \u2014 Subject`)).toBe('Original — Subject');
  expect(decodeFollowUpDraftText(String.raw`Hello\n\nRegards`)).toBe('Hello\n\nRegards');
  expect(decodeFollowUpDraftText(String.raw`Hello\r\nRegards`)).toBe('Hello\nRegards');
});
it('retains compatibility with double escapes and ordinary Unicode/multiline text', () => {
  expect(decodeFollowUpDraftText(String.raw`Hello\\nRegards \\u2014 Team`)).toBe('Hello\nRegards — Team');
  expect(decodeFollowUpDraftText('Hello\nবাংলা — Team')).toBe('Hello\nবাংলা — Team');
});
it('repairs already saved parsed rows without touching source bytes or custom text', () => {
  const value = { ...emptyFollowUpImport(), sourceBase64: 'b3JpZ2luYWw=', customBodies: [String.raw`Keep \n as typed`, '', ''], rows: [{ row: 2, email: 'person@example.com', account: '', conversationId: 'thread', subject: String.raw`Original \u2014 Subject`, messages: [String.raw`First\nbody`, 'Second', 'Third'], subjects: [String.raw`Re: Original \u2014 Subject`] }] };
  const normalized = normalizeFollowUpImport(value);
  expect(normalized.rows[0].subject).toBe('Original — Subject');
  expect(normalized.rows[0].messages[0]).toBe('First\nbody');
  expect(normalized.sourceBase64).toBe(value.sourceBase64);
  expect(normalized.customBodies).toEqual(value.customBodies);
  expect(value.rows[0].subject).toContain('\\u2014');
});
