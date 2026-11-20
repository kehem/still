export { validAutomationRow as validRow, automationDay as localDay } from '../../../shared/automation';
export type { AutomationRow as QueueRow } from '../../../shared/automation';
export function limitsValid(daily: number, seconds: number): boolean {
  return Number.isInteger(daily) && daily >= 1 && daily <= 10000 && Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400;
}
