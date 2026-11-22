import { expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import { readSheet } from 'read-excel-file/node';
import { HEADERS, parseFollowUpTable } from './spreadsheet';
it('round-trips real Excel data, preserving multiline, Unicode and formula-like strings', async () => {
  const table = [HEADERS, ['person@example.com', 'me@example.com', 'thread', '=Subject', 'First\nsecond line', 'বাংলা', '=not a formula']];
  const buffer = await writeXlsxFile(table.map(row => row.map(value => ({ type: String, value })))).toBuffer();
  const sheet = await readSheet(buffer);
  const rows = parseFollowUpTable(sheet.map(row => row.map(cell => cell == null ? '' : String(cell))));
  expect(rows[0].subject).toBe('=Subject');
  expect(rows[0].messages).toEqual(['First\nsecond line', 'বাংলা', '=not a formula']);
});
