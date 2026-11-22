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
it('requires template columns and rejects duplicate headers', () => {
  expect(() => parseFollowUpTable([['Email', 'Message']])).toThrow('Required columns');
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
