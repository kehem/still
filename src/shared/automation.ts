export interface AutomationRow {
  id: string;
  to: string;
  subject: string;
  body: string;
  selected: boolean;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  error?: string;
  sentAt?: string;
  conversationId?: string;
  followUpActive?: boolean;
}
export interface AutomationWorkspace {
  fileName: string;
  table: string[][];
  columns: number[];
  rows: AutomationRow[];
  accountId: string;
  daily: number;
  seconds: number;
  followUp: boolean;
}
export interface AutomationSnapshot {
  workspace: AutomationWorkspace;
  sentToday: number;
  attemptedToday: number;
  sentTotal: number;
  lastAttemptAt: number;
}
export const emptyAutomation = (): AutomationWorkspace => ({
  fileName: '', table: [], columns: [0, 1, 2], rows: [], accountId: '', daily: 50, seconds: 30, followUp: false,
});
export function validAutomationRow(row: AutomationRow): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(row.to) && row.to.length <= 254 && row.subject.length <= 1000 && row.body.trim().length > 0 && row.body.length <= 500000;
}
export function automationDay(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
