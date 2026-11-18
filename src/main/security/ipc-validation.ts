import { z } from 'zod';import {
  MAX_FOLLOWUP_INTERVAL_DAYS,
  MIN_FOLLOWUP_INTERVAL_DAYS,
} from '../../shared/constants';


/**
 * Every IPC request is validated against these schemas before it reaches
 * the database layer (spec §3: "Validate all IPC requests").
 */

export const settingsPatchSchema = z
  .object({
    language: z.string().max(16),
    startupBehavior: z.enum(['restore', 'inbox']),
    defaultOpeningPage: z.enum(['all-inbox', 'last-used']),
    defaultInboxId: z.string().max(128),
    rememberLastInbox: z.boolean(),
    defaultSendingAccountId: z.string().max(128).nullable(),
    dateFormat: z.enum(['auto', 'short', 'long']),
    timeFormat: z.enum(['auto', '12h', '24h']),
    confirmBeforeDelete: z.boolean(),
    confirmBeforeSend: z.boolean(),
    theme: z.enum(['light', 'dark', 'system']),
    fontSize: z.enum(['small', 'medium', 'large']),
    density: z.enum(['comfortable', 'compact']),
    sidebarVisible: z.boolean(),
    accentColor: z.string().max(16),
    messageListLayout: z.enum(['detailed', 'compact']),
    readingPaneLayout: z.enum(['single', 'split']),
    unifiedInboxEnabled: z.boolean(),
    groupByAccount: z.boolean(),
    sortOrder: z.enum(['newest', 'oldest']),
    showPreview: z.boolean(),
    markAsReadOnOpen: z.boolean(),
    refreshIntervalMinutes: z.number().int().min(0).max(1440),
    conversationGrouping: z.boolean(),
    followUpEnabledByDefault: z.boolean(),
    defaultScheduleId: z.string().max(128).nullable(),
    maxStages: z.number().int().min(1).max(20),
    reminderTime: z.string().regex(/^\d{2}:\d{2}$/),
    useWorkingDays: z.boolean(),
    weekendBehavior: z.enum(['skip', 'include']),
    autoCompleteOnReply: z.boolean(),
    autoReplyHandling: z.enum(['ignore', 'complete']),
    snoozeDefaultDays: z.number().int().min(1).max(90),
    overdueReminderRepeatHours: z.number().int().min(0).max(168),
    desktopNotifications: z.boolean(),
    followUpNotifications: z.boolean(),
    quietHoursEnabled: z.boolean(),
    quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
    quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
    notificationSound: z.boolean(),
    notificationFrequency: z.enum(['immediate', 'hourly', 'daily']),
    defaultSignature: z.string().max(10000),
    richTextEnabled: z.boolean(),
    replyBehavior: z.enum(['reply', 'reply-all']),
    ccOnReplyAll: z.boolean(),
    appLockEnabled: z.boolean(),
    databaseEncryption: z.boolean(),
    blockRemoteImages: z.boolean(),
    externalContent: z.enum(['blocked', 'ask', 'allowed']),
    aiEnabled: z.boolean(),
    aiProvider: z.string().max(64).nullable(),
    dataRetentionDays: z.number().int().min(0).max(3650),
    syncOnStartup: z.boolean(),
    attachmentStoragePath: z.string().max(1024).nullable(),
  })
  .partial();

export const newAccountSchema = z.object({
  provider: z.enum(['google', 'microsoft', 'imap']),
  displayName: z.string().min(1).max(120),
  email: z.string().email().max(254),
  color: z.string().max(16).nullable().optional(),
  imapHost: z.string().max(255).nullable().optional(),
  imapPort: z.number().int().min(1).max(65535).nullable().optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpSecure: z.boolean().optional(),
  username: z.string().max(254).nullable().optional(),
  password: z.string().max(512).nullable().optional(),
});

export const updateAccountSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  email: z.string().email().max(254).optional(),
  color: z.string().max(16).nullable().optional(),
  imapHost: z.string().max(255).nullable().optional(),
  imapPort: z.number().int().min(1).max(65535).nullable().optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpSecure: z.boolean().optional(),
  username: z.string().max(254).nullable().optional(),
  password: z.string().max(512).nullable().optional(),
  syncEnabled: z.boolean().optional(),
  isDefaultSender: z.boolean().optional(),
  authStatus: z.enum(['connected', 'expired', 'error']).optional(),
});

export const scheduleInputSchema = z.object({
  name: z.string().min(1).max(80),
  stages: z.array(z.number().int().min(1).max(365)).min(1).max(20),
});

export const schedulePatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  stages: z.array(z.number().int().min(1).max(365)).min(1).max(20).optional(),
  isDefault: z.boolean().optional(),
});

export const messageListOptionsSchema = z.object({
  accountId: z.string().max(128).nullable().optional(),
  folderKind: z.enum(['inbox', 'sent', 'drafts', 'archive', 'snoozed', 'trash']).nullable().optional(),
  folderId: z.string().max(128).nullable().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
});

export const createFollowUpSchema = z.object({
  conversationId: z.string().min(1).max(128),
  intervalDays: z
    .number()
    .int()
    .min(MIN_FOLLOWUP_INTERVAL_DAYS)
    .max(MAX_FOLLOWUP_INTERVAL_DAYS)
    .nullable()
    .optional(),
  scheduleId: z.string().max(128).nullable().optional(),
});

export const followUpStatusSchema = z.enum([
  'scheduled',
  'due',
  'overdue',
  'waiting',
  'replied',
  'completed',
  'snoozed',
  'cancelled',
]);

export const idSchema = z.string().min(1).max(128);

/** A single recipient address. Bounded so a malformed draft cannot bloat the DB. */
const addressSchema = z.string().min(1).max(320);

/** Recipient lists are capped; no legitimate draft has hundreds of entries. */
const addressListSchema = z.array(addressSchema).max(100);

/**
 * Draft save payload.
 *
 * This is the one writable channel that used to skip zod: the handler did a
 * structural `typeof input === 'object'` check and then cast straight to
 * `SaveDraftInput`, so anything the renderer sent — arbitrary keys, huge
 * strings, wrong types — flowed into the repository and into SQL parameters.
 * Every field is optional because a draft may be a partial autosave, and
 * unknown keys are stripped rather than persisted.
 */
export const saveDraftSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  accountId: z.string().min(1).max(128).nullable().optional(),
  toAddresses: addressListSchema.optional(),
  ccAddresses: addressListSchema.optional(),
  bccAddresses: addressListSchema.optional(),
  subject: z.string().max(1000).optional(),
  // Generous, but bounded: a draft body is user text, not an upload channel.
  body: z.string().max(1_000_000).optional(),
  followUpEnabled: z.boolean().optional(),
  followUpIntervalDays: z
    .number()
    .int()
    .min(MIN_FOLLOWUP_INTERVAL_DAYS)
    .max(MAX_FOLLOWUP_INTERVAL_DAYS)
    .nullable()
    .optional(),
  inReplyToConversationId: z.string().min(1).max(128).nullable().optional(),
});

export const sendEmailSchema = z.object({
  accountId: idSchema,
  to: z.array(z.string().email().max(254)).min(1),
  cc: z.array(z.string().email().max(254)).optional(),
  bcc: z.array(z.string().email().max(254)).optional(),
  subject: z.string().max(1000),
  bodyText: z.string().max(500_000),
  inReplyTo: z.string().max(500).nullable().optional(),
  conversationId: z.string().min(1).max(128).nullable().optional(),
  draftId: z.string().min(1).max(128).nullable().optional(),
});

/**
 * Notification list limit. Absent or null input is allowed and defaults in the
 * handler, since a missing limit must never hide due reminders. Out-of-range
 * values are rejected rather than silently clamped.
 */
export const notificationLimitSchema = z
  .union([z.number().int().min(1).max(200), z.undefined(), z.null()])
  .optional();

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid IPC request: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.data;
}
