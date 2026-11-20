import { expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import { enableAutomationFollowUp } from './automation-followup';
const schedules = [
  { id: 'seed', name: 'Default', stages: [3, 7, 15], isDefault: true, createdAt: '', updatedAt: '' },
  { id: 'chosen', name: 'My schedule', stages: [2, 5, 10], isDefault: false, createdAt: '', updatedAt: '' },
];
function services() {
  return { settings: { getAll: () => ({ ...DEFAULT_SETTINGS, defaultScheduleId: 'chosen', maxStages: 2, useWorkingDays: true, weekendBehavior: 'skip' as const, reminderTime: '10:30', followUpEnabledByDefault: false }) },
    schedules: { list: () => schedules }, followups: { create: vi.fn(() => ({ sequence: { id: 'tracking' } })) } } as unknown as Parameters<typeof enableAutomationFollowUp>[0];
}
it('automatically tracks every automation send with the selected default and preferences', () => {
  const s = services();
  enableAutomationFollowUp(s, 'first'); enableAutomationFollowUp(s, 'second');
  expect(s.followups.create).toHaveBeenCalledTimes(2);
  expect(s.followups.create).toHaveBeenLastCalledWith('second', {
    stages: [2, 5], scheduleId: 'chosen', useWorkingDays: true, reminderTime: '10:30',
  });
});
it('falls back to the seeded default when the chosen schedule was removed', () => {
  const s = services(); s.settings.getAll = () => ({ ...DEFAULT_SETTINGS, defaultScheduleId: 'removed' });
  enableAutomationFollowUp(s, 'c');
  expect(s.followups.create).toHaveBeenCalledWith('c', expect.objectContaining({ scheduleId: 'seed', stages: [3, 7, 15] }));
});
it('reports a failed follow-up setup rather than pretending tracking started', () => {
  const s = services(); s.followups.create = vi.fn(() => null);
  expect(() => enableAutomationFollowUp(s, 'c')).toThrow('could not be enabled');
  s.schedules.list = () => [];
  expect(() => enableAutomationFollowUp(s, 'c')).toThrow('No follow-up schedule');
});
