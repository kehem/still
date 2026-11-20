import type { FollowUpRepository, ScheduleRepository, SettingsRepository } from '../database/repositories';

type FollowUpServices = {
  settings: Pick<SettingsRepository, 'getAll'>;
  schedules: Pick<ScheduleRepository, 'list'>;
  followups: Pick<FollowUpRepository, 'create'>;
};

/** Every successful Automation send uses the current user-selected default schedule. */
export function enableAutomationFollowUp(services: FollowUpServices, conversationId: string) {
  const settings = services.settings.getAll();
  const schedules = services.schedules.list();
  const schedule = schedules.find(x => x.id === settings.defaultScheduleId)
    ?? schedules.find(x => x.isDefault) ?? schedules[0];
  if (!schedule) throw new Error('No follow-up schedule available');
  const tracked = services.followups.create(conversationId, {
    stages: schedule.stages.slice(0, Math.max(1, settings.maxStages)),
    scheduleId: schedule.id,
    useWorkingDays: settings.useWorkingDays && settings.weekendBehavior === 'skip',
    reminderTime: settings.reminderTime,
  });
  if (!tracked) throw new Error('Follow-up could not be enabled');
  return tracked;
}
