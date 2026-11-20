// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyAutomation, type AutomationWorkspace } from '../../../shared/automation';
const { getAutomation, saveAutomation } = vi.hoisted(() => ({ getAutomation: vi.fn(), saveAutomation: vi.fn() }));
vi.mock('../../services/api', () => ({ getAPI: () => ({ getAutomation, saveAutomation }) }));
import { loadAutomation } from './storage';
beforeEach(() => {
  localStorage.clear(); getAutomation.mockReset().mockResolvedValue({ workspace: emptyAutomation() });
  saveAutomation.mockReset().mockImplementation(async (workspace: AutomationWorkspace) => ({ workspace }));
});
it('migrates legacy rows and settings only after persistence acknowledges', async () => {
  localStorage.setItem('still:automation:v1', JSON.stringify([{ id: 'r', to: 'r@example.com', subject: 'Hello', body: 'Body', selected: true, status: 'sending' }]));
  localStorage.setItem('still:automation:config', JSON.stringify({ account: 'a', daily: 12, seconds: 45 }));
  const result = await loadAutomation();
  expect(result.workspace).toMatchObject({ accountId: 'a', daily: 12, seconds: 45 });
  expect(result.workspace.rows[0].status).toBe('failed');
  expect(localStorage.getItem('still:automation:v1')).toBeNull();
});
it('keeps the legacy backup if SQLite migration fails', async () => {
  localStorage.setItem('still:automation:v1', '[{"id":"r","status":"sent"}]');
  saveAutomation.mockRejectedValue(new Error('Cannot persist'));
  await loadAutomation();
  expect(localStorage.getItem('still:automation:v1')).not.toBeNull();
});
