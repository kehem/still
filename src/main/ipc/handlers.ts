import { recipientCanSend } from '../../shared/recipient-check';
import { FollowUpImportRepository } from '../database/followup-import';
import { RecipientChecker } from '../email/recipient-check';
import { EmailProviderLookup } from '../email/providers';
import { enableAutomationFollowUp } from '../email/automation-followup';
import { AutomationRepository } from '../database/automation';
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
import { EmailService } from '../email/email-service';
import type { ReminderOptions } from '../../shared/notifications/reminder-engine';
import {
  emailProviderDomainsSchema,
  automationWorkspaceSchema,
  automationImportSchema,
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
  sendEmailSchema,
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
  const followUpImport = new FollowUpImportRepository(s.db);
  ipcMain.handle('followups:import:get', () => followUpImport.get());
  ipcMain.handle('followups:import:save', (_event, input: unknown) => followUpImport.save(input));
  const recipients = new RecipientChecker();
  ipcMain.handle('email:check-recipients', async (_event, input: unknown) => {
    if (!Array.isArray(input) || input.length > 20 || input.some(a => typeof a !== 'string' || a.length > 254)) throw new Error('Invalid recipient check batch');
    const result: Record<string, import('../../shared/types').RecipientCheck> = {};
    for (const address of input as string[]) result[address] = await recipients.check(address);
    return result;
  });
  const emailProviders = new EmailProviderLookup();
  ipcMain.handle('email:providers', (_event, input: unknown) =>
    emailProviders.get(parseOrThrow(emailProviderDomainsSchema, input)));

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

  ipcMain.handle('conversations:trash', (_event, id: unknown) => {
    s.messages.setConversationTrashed(parseOrThrow(idSchema, id), true);
  });
  ipcMain.handle('conversations:restore', (_event, id: unknown) => {
    s.messages.setConversationTrashed(parseOrThrow(idSchema, id), false);
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

  const emailService = new EmailService(s.db, s.accounts, s.credentials);
  const automation = new AutomationRepository(s.db);
  automation.recover();
  let automationSending = false;
  ipcMain.handle('automation:get', () => automation.snapshot());
  ipcMain.handle('automation:save', (_event, input: unknown) => {
    if (automationSending) throw new Error('Wait for the current send to finish');
    return automation.save(parseOrThrow(automationWorkspaceSchema, input));
  });
  ipcMain.handle('automation:import', (_event, input: unknown) => {
    if (automationSending) throw new Error('Wait for the current send to finish');
    const file = parseOrThrow(automationImportSchema, input);
    return automation.importFile(file.name, file.base64, file.table);
  });
  ipcMain.handle('automation:send', async (_event, input: unknown) => {
    const id = parseOrThrow(idSchema, input);
    if (automationSending) throw new Error('An automation email is already sending');
    automationSending = true;
    try {
      const row = automation.snapshot().workspace.rows.find(row => row.id === id);
      if (!row || !recipientCanSend(await recipients.check(row.to))) throw new Error('Recipient has not passed MX and SMTP checks. Refresh recipient checks before sending.');
      const claimed = automation.claim(id);
      let result;
      try {
        result = await emailService.sendEmail({ accountId: claimed.workspace.accountId,
          to: [claimed.row.to], subject: claimed.row.subject, bodyText: claimed.row.body });
      } catch (error) {
        return automation.finish(claimed.deliveryId, id, { error: error instanceof Error ? error.message : String(error) });
      }
      let warning: string | undefined;
      try {
        enableAutomationFollowUp(s, result.conversationId);
      } catch {
        warning = 'Mail sent, but follow-up could not be enabled. Enable it from Sent. Do not resend.';
      }
      return automation.finish(claimed.deliveryId, id, { ...result, warning });
    } finally { automationSending = false; }
  });

  ipcMain.handle('email:send', async (_event, input: unknown) => {
    const data = parseOrThrow(sendEmailSchema, input);
    const result = await emailService.sendEmail(data);
    if (data.conversationId) {
      try { s.followups.recordFollowUpSent(result.conversationId, result.messageId, result.sentAt, s.settings.getAll()); }
      catch { return { ...result, warning: 'Message sent, but the follow-up schedule could not advance. Do not resend; review it in Follow-ups.' }; }
    }
    return result;
  });

  ipcMain.handle('email:sync', () => emailService.syncAllAccounts());

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dbPath: s.db.dbPath,
    userDataPath: app.getPath('userData'),
    isPackaged: app.isPackaged,
  }));
}
