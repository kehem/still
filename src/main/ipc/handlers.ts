import { app, ipcMain } from 'electron';
import type { DatabaseService } from '../database/db';
import {
  AccountRepository,
  DraftRepository,
  FollowUpRepository,
  MessageRepository,
  NotificationRepository,
  ScheduleRepository,
  SettingsRepository,
} from '../database/repositories';
import { CredentialStore } from '../security/credentials';
import type { ReminderOptions } from '../../shared/notifications/reminder-engine';
import {
  createFollowUpSchema,
  followUpStatusSchema,
  idSchema,
  messageListOptionsSchema,
  newAccountSchema,
  notificationLimitSchema,
  parseOrThrow,
  saveDraftSchema,
  scheduleInputSchema,
  schedulePatchSchema,
  settingsPatchSchema,
  updateAccountSchema,
} from '../security/ipc-validation';

/**
 * Quiet hours, batching and repeat behaviour, read from the user's settings.
 * Exported because the main process uses the same options when it delivers
 * desktop notifications, so the two can never disagree.
 */
export function reminderOptionsFor(settingsRepo: SettingsRepository): ReminderOptions {
  const settings = settingsRepo.getAll();
  return {
    quietHours: {
      enabled: settings.quietHoursEnabled,
      start: settings.quietHoursStart,
      end: settings.quietHoursEnd,
    },
    frequency: settings.notificationFrequency,
    reminderTime: settings.reminderTime,
    overdueRepeatHours: settings.overdueReminderRepeatHours,
  };
}

export interface AppServices {
  db: DatabaseService;
  settings: SettingsRepository;
  accounts: AccountRepository;
  schedules: ScheduleRepository;
  messages: MessageRepository;
  followups: FollowUpRepository;
  notifications: NotificationRepository;
  drafts: DraftRepository;
  credentials: CredentialStore;
}

/**
 * Registers all IPC handlers. Every handler validates its input with zod
 * before touching the database (spec §3).
 */
export function registerIpcHandlers(s: AppServices): void {
  ipcMain.handle('settings:get', () => s.settings.getAll());

  ipcMain.handle('settings:update', (_event, patch: unknown) =>
    s.settings.update(parseOrThrow(settingsPatchSchema, patch)),
  );

  ipcMain.handle('accounts:list', () => s.accounts.list());

  ipcMain.handle('accounts:add', (_event, input: unknown) => {
    const data = parseOrThrow(newAccountSchema, input);
    const account = s.accounts.create(data);
    if (data.password) {
      s.credentials.set(account.id, 'password', data.password);
    }
    return account;
  });

  ipcMain.handle('accounts:update', (_event, id: unknown, patch: unknown) => {
    const accountId = parseOrThrow(idSchema, id);
    const data = parseOrThrow(updateAccountSchema, patch);
    if (data.password) {
      s.credentials.set(accountId, 'password', data.password);
    }
    const { password: _password, ...rest } = data;
    return s.accounts.update(accountId, rest);
  });

  ipcMain.handle('accounts:remove', (_event, id: unknown) => {
    s.accounts.remove(parseOrThrow(idSchema, id));
  });

  ipcMain.handle('schedules:list', () => s.schedules.list());

  ipcMain.handle('schedules:create', (_event, input: unknown) =>
    s.schedules.create(parseOrThrow(scheduleInputSchema, input)),
  );

  ipcMain.handle('schedules:update', (_event, id: unknown, patch: unknown) =>
    s.schedules.update(
      parseOrThrow(idSchema, id),
      parseOrThrow(schedulePatchSchema, patch),
    ),
  );

  ipcMain.handle('schedules:remove', (_event, id: unknown) => {
    s.schedules.remove(parseOrThrow(idSchema, id));
  });

  ipcMain.handle('messages:list', (_event, options: unknown) =>
    s.messages.list(parseOrThrow(messageListOptionsSchema, options ?? {})),
  );

  ipcMain.handle('conversations:get', (_event, id: unknown) =>
    s.messages.getConversation(parseOrThrow(idSchema, id)),
  );

  ipcMain.handle('conversations:markRead', (_event, id: unknown) => {
    s.messages.markConversationRead(parseOrThrow(idSchema, id));
  });

  ipcMain.handle('followups:list', () => s.followups.list());

  ipcMain.handle('followups:create', (_event, input: unknown) => {
    const data = parseOrThrow(createFollowUpSchema, input);
    const settings = s.settings.getAll();

    // Resolve the schedule: explicit choice → user default → the seeded default.
    const schedules = s.schedules.list();
    const schedule =
      schedules.find((x) => x.id === data.scheduleId) ??
      schedules.find((x) => x.id === settings.defaultScheduleId) ??
      schedules.find((x) => x.isDefault) ??
      schedules[0];
    if (!schedule) return null;

    // A custom first interval replaces stage 0; later stages are unchanged.
    let stages = [...schedule.stages];
    if (typeof data.intervalDays === 'number') stages[0] = data.intervalDays;
    const maxStages = Math.max(1, settings.maxStages);
    stages = stages.slice(0, maxStages);

    return s.followups.create(data.conversationId, {
      stages,
      scheduleId: schedule.id,
      // Weekend behaviour decides whether working-day maths applies at all.
      useWorkingDays: settings.useWorkingDays && settings.weekendBehavior === 'skip',
      reminderTime: settings.reminderTime,
    });
  });

  ipcMain.handle('followups:disable', (_event, conversationId: unknown) => {
    const id = parseOrThrow(idSchema, conversationId);
    s.followups.disable(id);
    // Tracking is off, so its reminders must go too — otherwise the bell keeps
    // offering a reminder for a conversation the user stopped tracking.
    s.notifications.removeForConversation(id);
  });

  ipcMain.handle(
    'followups:setSchedule',
    (_event, sequenceId: unknown, scheduleId: unknown) => {
      const settings = s.settings.getAll();
      const id = parseOrThrow(idSchema, sequenceId);
      const updated = s.followups.setSchedule(id, parseOrThrow(idSchema, scheduleId), {
        useWorkingDays: settings.useWorkingDays && settings.weekendBehavior === 'skip',
        reminderTime: settings.reminderTime,
      });
      // The due time just moved, so any reminder not yet shown is dropped and
      // re-derived from the new schedule on the next scan.
      if (updated) s.notifications.removePendingForSequence(id);
      return updated;
    },
  );

  ipcMain.handle(
    'followups:updateStatus',
    (_event, id: unknown, status: unknown, snoozeDays?: unknown) => {
      const sequenceId = parseOrThrow(idSchema, id);
      const nextStatus = parseOrThrow(followUpStatusSchema, status);
      const days =
        typeof snoozeDays === 'number' && Number.isFinite(snoozeDays)
          ? Math.min(Math.max(Math.round(snoozeDays), 1), 90)
          : undefined;
      s.followups.updateStatus(sequenceId, nextStatus, days);
    },
  );

  // ─── Reminders ───────────────────────────────────────────────────────────
  // Every one of these derives state from stored timestamps. There is no
  // in-memory timer that a restart could lose.

  ipcMain.handle('notifications:scan', () =>
    s.notifications.scan(new Date(), reminderOptionsFor(s.settings)),
  );

  ipcMain.handle('notifications:list', (_event, limit: unknown) =>
    s.notifications.list(parseOrThrow(notificationLimitSchema, limit) ?? 50),
  );

  ipcMain.handle('notifications:unreadCount', () => s.notifications.unreadCount());

  ipcMain.handle('notifications:markRead', (_event, id: unknown) => {
    s.notifications.markRead(parseOrThrow(idSchema, id));
  });

  ipcMain.handle('notifications:markAllRead', () => s.notifications.markAllRead());

  ipcMain.handle('notifications:dismiss', (_event, id: unknown) => {
    s.notifications.remove(parseOrThrow(idSchema, id));
  });

  ipcMain.handle('drafts:list', () => s.drafts.list());

  ipcMain.handle('drafts:save', (_event, input: unknown) =>
    // Fully validated: bounded addresses, subject and body lengths, and unknown
    // keys stripped. The repository still applies its own defaults.
    s.drafts.save(parseOrThrow(saveDraftSchema, input)),
  );

  ipcMain.handle('drafts:remove', (_event, id: unknown) => {
    s.drafts.remove(parseOrThrow(idSchema, id));
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dbPath: s.db.dbPath,
    userDataPath: app.getPath('userData'),
    isPackaged: app.isPackaged,
  }));
}
