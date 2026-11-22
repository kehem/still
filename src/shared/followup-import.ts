export interface ImportedFollowUp {
  row: number; email: string; account: string; conversationId: string; subject: string;
  messages: string[]; subjects?: string[]; company?: string; verification?: string;
}
export interface FollowUpImportWorkspace {
  fileName: string;
  sourceBase64: string;
  rows: ImportedFollowUp[];
  stage: number;
  selectedRows: number[];
  rowStages: Record<string, number>;
  bodySource: 'spreadsheet' | 'custom';
  customBodies: string[];
}
export const emptyFollowUpImport = (): FollowUpImportWorkspace => ({ fileName: '', sourceBase64: '', rows: [], stage: 0, selectedRows: [], rowStages: {}, bodySource: 'spreadsheet', customBodies: ['', '', ''] });

/** Accept single-escaped spreadsheet text and older double-escaped exports. */
export function decodeFollowUpDraftText(text: string): string {
  return text.replace(/\\{1,2}u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\{1,2}r\\{1,2}n|\\{1,2}n/g, '\n').replace(/\\{1,2}r/g, '\n');
}
/** Normalize existing saved documents too; preserve source bytes and custom text. */
export function normalizeFollowUpImport(workspace: FollowUpImportWorkspace): FollowUpImportWorkspace {
  return { ...workspace, rows: workspace.rows.map(row => ({ ...row,
    subject: decodeFollowUpDraftText(row.subject),
    messages: row.messages.map(decodeFollowUpDraftText),
    subjects: row.subjects?.map(decodeFollowUpDraftText),
  })) };
}
