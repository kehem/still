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
