export type QueueRow = { id: string; to: string; subject: string; body: string; selected: boolean; status: 'pending' | 'sending' | 'sent' | 'failed'; error?: string };
export function validRow(row: QueueRow): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(row.to) && row.to.length <= 254 && row.subject.length <= 1000 && row.body.trim().length > 0 && row.body.length <= 500000;
}
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
export function limitsValid(daily: number, seconds: number): boolean {
  return Number.isInteger(daily) && daily >= 1 && daily <= 10000 && Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400;
}
