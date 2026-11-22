import { vi } from 'vitest';
import { emptyAutomation, type AutomationSnapshot, type AutomationWorkspace } from '../../../shared/automation';
export function automationTestAPI() {
  let snapshot: AutomationSnapshot = { workspace: emptyAutomation(), sentToday: 0, attemptedToday: 0, sentTotal: 0, lastAttemptAt: 0 };
  const copy = () => structuredClone(snapshot);
  const api = {
    checkEmailRecipients: vi.fn(async (addresses: string[]) => Object.fromEntries(addresses.map(a => [a, { status: 'valid', detail: 'MX and SMTP passed' }]))),
    getEmailProviders: vi.fn(async (domains: string[]) => Object.fromEntries(domains.map(d => [d, 'Unknown']))),
    getAutomation: vi.fn(async () => copy()),
    saveAutomation: vi.fn(async (workspace: AutomationWorkspace) => { snapshot.workspace = structuredClone(workspace); return copy(); }),
    importAutomationFile: vi.fn(async (input: { name: string; base64: string; table: string[][] }) => {
      snapshot.workspace = { ...snapshot.workspace, fileName: input.name, table: input.table, columns: [0, 1, 2], rows: [] }; return copy();
    }),
    sendAutomationRow: vi.fn(async (id: string, _verificationId?: string) => {
      const row = snapshot.workspace.rows.find(r => r.id === id)!;
      row.status = 'sent'; row.selected = false; row.sentAt = new Date().toISOString();
      snapshot.sentTotal++; snapshot.sentToday++; snapshot.attemptedToday++; snapshot.lastAttemptAt = Date.now();
      return copy();
    }),
  };
  return { api, seed: (patch: Partial<AutomationWorkspace>) => { snapshot.workspace = { ...snapshot.workspace, ...structuredClone(patch) }; }, get: copy };
}
