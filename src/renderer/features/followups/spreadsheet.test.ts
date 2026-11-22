import { expect, it } from 'vitest';
import type { FollowUpListItem } from '../../../shared/types';
import { followUpExport, HEADERS, matchFollowUp, parseFollowUpTable, safeCSVCell } from './spreadsheet';
const item = { recipient: 'person@example.com', account: { email: 'me@example.com' }, conversation: { id: 'thread' }, subject: 'Proposal', status: 'scheduled', nextDueAt: '2026-11-20', currentStage: 1 } as FollowUpListItem;
it('exports conversation identity and all three editable template columns', () => {
  const table = followUpExport([item]);
  expect(table[0]).toEqual(HEADERS);
  table[1][4] = 'First\nmultiline message'; table[1][5] = 'Second'; table[1][6] = 'Third';
  const rows = parseFollowUpTable(table);
  expect(rows[0].messages).toEqual(['First\nmultiline message', 'Second', 'Third']);
  expect(matchFollowUp(rows[0], [item]).item).toBe(item);
});
it('requires email, accepts recipients without body columns and rejects duplicate headers', () => {
  expect(() => parseFollowUpTable([['Message']])).toThrow('Required column: Email or Business Email');
  expect(parseFollowUpTable([['Email'], ['person@example.com']])[0].messages).toEqual(['', '', '']);
  expect(() => parseFollowUpTable([[...HEADERS, 'Email']])).toThrow('Duplicate');
});
it('rejects ambiguous, unknown, invalid and terminal matches without guessing', () => {
  const row = parseFollowUpTable([HEADERS, ['person@example.com', '', '', '', 'One', 'Two', 'Three']])[0];
  expect(matchFollowUp(row, [item, { ...item, conversation: { ...item.conversation, id: 'other' } }]).error).toContain('Ambiguous');
  expect(matchFollowUp({ ...row, conversationId: 'missing' }, [item]).error).toContain('No matching');
  expect(matchFollowUp({ ...row, email: 'invalid' }, [item]).error).toContain('Invalid');
  expect(matchFollowUp(row, [{ ...item, status: 'replied' }]).error).toContain('completed');
});
it('enforces row/cell limits and ignores blank lines', () => {
  expect(parseFollowUpTable([HEADERS, ['', '', '']])).toEqual([]);
  expect(() => parseFollowUpTable([HEADERS, ['person@example.com', '', '', '', 'a'.repeat(50001)]])).toThrow('50,000');
  expect(() => parseFollowUpTable(Array(5002).fill([]))).toThrow('5,000');
});
it('escapes formula-like CSV values without changing ordinary text', () => {
  for (const value of ['=SUM(A1)', '+cmd', '-1', '@SUM(A1)', '\t=1', '  =1']) expect(safeCSVCell(value)).toBe(`'${value}`);
  expect(safeCSVCell('Hello')).toBe('Hello');
});
it('supports the five-stage business-email draft layout without importing initial mail as follow-up', () => {
  const headers = ['Company Name', 'Business Email', 'Email Verification Status', 'Official Website', 'Company Category', 'Draft Status', 'Original Subject', 'Initial Email', ...Array.from({ length: 5 }, (_, n) => [`Follow-up ${n + 1} Subject`, `Follow-up ${n + 1} Message`]).flat()];
  const row = ['Example Agency', 'person@example.com', 'Published on website', 'https://example.com', 'Agency', 'Review before use', 'Proposal', 'Not a follow-up', ...Array.from({ length: 5 }, (_, n) => [`Re: Proposal ${n + 1}`, `Message ${n + 1}\\n\\nRegards\\u2014Team`]).flat()];
  const parsed = parseFollowUpTable([headers, row])[0];
  expect(parsed.email).toBe('person@example.com');
  expect(parsed.company).toBe('Example Agency');
  expect(parsed.messages).toHaveLength(5);
  expect(parsed.messages[4]).toBe('Message 5\n\nRegards—Team');
  expect(parsed.subjects?.[4]).toBe('Re: Proposal 5');
  expect(matchFollowUp(parsed, [item]).item).toBe(item);
  expect(parsed.messages).not.toContain('Not a follow-up');
});
it('rejects conflicting aliases and multiline imported subjects', () => {
  expect(() => parseFollowUpTable([['Email', 'Business Email']])).toThrow('Ambiguous');
  expect(() => parseFollowUpTable([['Email', 'Follow-up 1', 'Follow-up 1 Message']])).toThrow('Ambiguous');
  expect(() => parseFollowUpTable([['Business Email', 'Follow-up 1 Subject'], ['person@example.com', 'Subject\\nBcc: other@example.com']])).toThrow('single line');
});
it('matches reply-prefix, case and whitespace differences without confusing different subjects', () => {
  const row = parseFollowUpTable([['Business Email', 'Original Subject'], ['person@example.com', 'Proposal']])[0];
  expect(matchFollowUp(row, [{ ...item, subject: ' Re: RE:  PROPOSAL ' }]).item).toBeTruthy();
  expect(matchFollowUp({ ...row, subject: 'Different proposal' }, [item]).item).toBeUndefined();
});
it('uses explicit conversation identity even when its subject has changed', () => {
  const row = parseFollowUpTable([HEADERS, ['person@example.com', '', 'thread', 'Original proposal', 'One', 'Two', 'Three']])[0];
  expect(matchFollowUp(row, [{ ...item, subject: 'Updated proposal' }]).item).toBeTruthy();
});
it('uses the active tracking sequence without losing older terminal history', () => {
  const row = parseFollowUpTable([['Email'], ['person@example.com']])[0];
  expect(matchFollowUp(row, [{ ...item, status: 'cancelled' }, item]).item).toBe(item);
});
it('matches single-escaped original subjects from real draft-sheet exports to Unicode sent subjects', () => {
  const rows = parseFollowUpTable([['Business Email', 'Original Subject', 'Follow-up 1 Message'], ['person@example.com', String.raw`Proposal \u2014 Example`, String.raw`Hello\n\nFirst follow-up`]]);
  expect(rows[0].subject).toBe('Proposal — Example');
  expect(rows[0].messages[0]).toBe('Hello\n\nFirst follow-up');
  expect(matchFollowUp(rows[0], [{ ...item, subject: 'Proposal — Example' }]).item).toBeTruthy();
});
