import type { FollowUpListItem } from '../../../shared/types';

export const HEADERS = ['Email', 'Account', 'Conversation ID', 'Subject', 'Follow-up 1', 'Follow-up 2', 'Follow-up 3', 'Status', 'Next due', 'Current stage'];
export interface ImportedFollowUp { row: number; email: string; account: string; conversationId: string; subject: string; messages: string[] }
const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '');
export function parseFollowUpTable(table: string[][]): ImportedFollowUp[] {
  if (table.length > 5001) throw new Error('Maximum 5,000 rows per file.');
  const headers = (table[0] || []).map(normalize);
  const columns = ['email', 'account', 'conversationid', 'subject', 'followup1', 'followup2', 'followup3'].map(h => headers.indexOf(h));
  if (columns[0] < 0 || columns.slice(4).some(c => c < 0)) throw new Error('Required columns: Email, Follow-up 1, Follow-up 2, Follow-up 3. Download a template first.');
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate column headers are not allowed.');
  return table.slice(1).map((cells, index) => {
    const values = columns.map(c => c < 0 ? '' : String(cells[c] ?? ''));
    if (values.some(v => v.length > 50000)) throw new Error(`Row ${index + 2}: a cell exceeds 50,000 characters.`);
    return { row: index + 2, email: values[0].trim(), account: values[1].trim(), conversationId: values[2].trim(), subject: values[3].trim(), messages: values.slice(4) };
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
