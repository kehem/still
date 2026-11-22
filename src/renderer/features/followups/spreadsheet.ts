import type { ImportedFollowUp } from '../../../shared/followup-import';
export type { ImportedFollowUp } from '../../../shared/followup-import';
import type { FollowUpListItem } from '../../../shared/types';

export const HEADERS = ['Email', 'Account', 'Conversation ID', 'Subject', 'Follow-up 1', 'Follow-up 2', 'Follow-up 3', 'Status', 'Next due', 'Current stage'];
/** Draft-sheet layout; original Email / Follow-up N imports remain supported. */
export const DRAFT_HEADERS = ['Company Name', 'Business Email', 'Email Verification Status', 'Official Website', 'Company Category', 'Draft Status', 'Original Subject', 'Initial Email',
  ...Array.from({ length: 5 }, (_, n) => [`Follow-up ${n + 1} Subject`, `Follow-up ${n + 1} Message`]).flat()];

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '');
export function parseFollowUpTable(table: string[][]): ImportedFollowUp[] {
  if (table.length > 5001) throw new Error('Maximum 5,000 rows per file.');
  const headers = (table[0] || []).map(normalize);
  const column = (...names: string[]) => {
    const found = names.map(name => headers.indexOf(name)).filter(index => index >= 0);
    if (found.length > 1) throw new Error(`Ambiguous columns: ${names.join(' / ')}`);
    return found[0] ?? -1;
  };
  const columns = [column('email', 'businessemail'), column('account'), column('conversationid'), column('subject', 'originalsubject')];
  if (columns[0] < 0) throw new Error('Required column: Email or Business Email. Message columns are optional when writing your own body.');
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate column headers are not allowed.');
  const stages = headers.map(header => /^followup([1-9]|10)(?:message|subject)?$/.exec(header)).filter(Boolean).map(match => Number(match![1]));
  const count = Math.max(3, ...stages);
  const messageColumns = Array.from({ length: count }, (_, n) => column(`followup${n + 1}`, `followup${n + 1}message`));
  const subjectColumns = Array.from({ length: count }, (_, n) => column(`followup${n + 1}subject`));
  const companyColumn = column('companyname'); const verificationColumn = column('emailverificationstatus');
  // Some exported draft sheets store literal escaped line breaks/Unicode.
  // Interpret those sequences only in message/subject fields, never identifiers.
  const draftText = (text: string) => text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\r\\n|\\n/g, '\n').replace(/\\r/g, '\n');
  return table.slice(1).map((cells, index) => {
    const cell = (c: number) => c < 0 ? '' : String(cells[c] ?? '');
    const values = [...columns, ...messageColumns, ...subjectColumns, companyColumn, verificationColumn].map(cell);
    if (values.some(v => v.length > 50000)) throw new Error(`Row ${index + 2}: a cell exceeds 50,000 characters.`);
    const originalSubject = draftText(cell(columns[3])).trim();
    const subjects = subjectColumns.map(c => draftText(cell(c)).trim());
    if ([originalSubject, ...subjects].some(value => value.length > 1000 || /[\r\n]/.test(value))) throw new Error(`Row ${index + 2}: subjects must be a single line of at most 1,000 characters.`);
    return { row: index + 2, email: cell(columns[0]).trim(), account: cell(columns[1]).trim(), conversationId: cell(columns[2]).trim(), subject: originalSubject,
      messages: messageColumns.map(c => draftText(cell(c))), subjects, company: cell(companyColumn).trim(), verification: cell(verificationColumn).trim() };
  }).filter(r => [r.email, r.account, r.conversationId, r.subject, ...r.messages].some(v => v.trim()));
}
export function matchFollowUp(row: ImportedFollowUp, items: FollowUpListItem[]): { item?: FollowUpListItem; error?: string } {
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(row.email)) return { error: 'Invalid email address' };
  const matches = items.filter(item => item.recipient.toLowerCase() === row.email.toLowerCase()
    && (!row.account || item.account.email.toLowerCase() === row.account.toLowerCase())
    && (!row.conversationId || item.conversation.id === row.conversationId)
    && (!row.subject || item.subject === row.subject));
  if (!matches.length) return { error: 'No matching tracked conversation. Enable follow-up from Sent first.' };
  if (matches.length > 1) return { error: 'Ambiguous match. Include Account and Conversation ID from an export.' };
  if (['completed', 'replied', 'cancelled'].includes(matches[0].status)) return { error: 'Conversation is completed, replied, or cancelled' };
  return { item: matches[0] };
}
export function followUpExport(items: FollowUpListItem[]): string[][] {
  return [HEADERS, ...items.map(i => [i.recipient, i.account.email, i.conversation.id, i.subject, '', '', '', i.status, i.nextDueAt || '', String(i.currentStage + 1)])];
}
/** CSV spreadsheet applications can interpret untrusted strings as formulas. */
export const safeCSVCell = (value: string) => /^[\s]*[=+@\-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
