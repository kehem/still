export interface RecipientCheck { status: 'valid' | 'invalid' | 'unknown'; detail: string }
import type { AutomationWorkspace, AutomationSnapshot } from './automation';
// ─── Accounts ────────────────────────────────────────────────────────────────

export type ProviderType = 'google' | 'microsoft' | 'imap';
export type AuthStatus = 'connected' | 'expired' | 'error';

export interface Account {
  id: string;
  provider: ProviderType;
  displayName: string;
  email: string;
  color: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  username: string | null;
  syncEnabled: boolean;
  isDefaultSender: boolean;
  authStatus: AuthStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewAccountInput {
  provider: ProviderType;
  displayName: string;
  email: string;
  color?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecure?: boolean;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  username?: string | null;
  /** Stored encrypted via OS credential storage. Never returned by the API. */
  password?: string | null;
}

export type UpdateAccountInput = Partial<Omit<NewAccountInput, 'provider'>> & {
  syncEnabled?: boolean;
  isDefaultSender?: boolean;
  authStatus?: AuthStatus;
};

// ─── Mail ────────────────────────────────────────────────────────────────────

export type FolderKind = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam' | 'custom';

export interface Folder {
  id: string;
  accountId: string;
  name: string;
  kind: FolderKind;
  syncEnabled: boolean;
}

export type MessageDirection = 'inbound' | 'outbound';

export interface Message {
  id: string;
  accountId: string;
  conversationId: string | null;
  folderId: string | null;
  providerMessageId: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  threadId: string | null;
  subject: string;
  snippet: string;
  bodyText: string | null;
  bodyHtml: string | null;
  fromName: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  sentAt: string;
  receivedAt: string | null;
  isRead: boolean;
  isStarred: boolean;
  isSnoozed: boolean;
  snoozedUntil: string | null;
  hasAttachments: boolean;
  direction: MessageDirection;
  deletedAt: string | null;
}

export interface Conversation {
  id: string;
  accountId: string;
  subject: string;
  participants: string[];
  lastMessageAt: string;
  unreadCount: number;
  isStarred: boolean;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
}

/**
 * Sidebar folder filters. Distinct from `FolderKind`, which describes a
 * synchronized provider folder: `snoozed` is a Still-local view, not a folder
 * that exists on the server.
 */
export type FolderFilter = 'inbox' | 'sent' | 'drafts' | 'archive' | 'snoozed' | 'trash';

export const FOLDER_FILTERS: FolderFilter[] = [
  'inbox',
  'sent',
  'drafts',
  'archive',
  'snoozed',
  'trash',
];

export interface MessageListOptions {
  accountId?: string | null;
  /**
   * Semantic folder filter. `inbox` means received, not archived, not trashed
   * and not snoozed. Use `folderId` for a specific synchronized folder.
   */
  folderKind?: FolderFilter | null;
  /** Row id of a specific synchronized folder (populated by Phase 3 sync). */
  folderId?: string | null;
  limit?: number;
  offset?: number;
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

export interface Draft {
  id: string;
  accountId: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  subject: string;
  body: string;
  followUpEnabled: boolean;
  followUpIntervalDays: number | null;
  inReplyToConversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SaveDraftInput = Partial<Omit<Draft, 'id' | 'createdAt' | 'updatedAt'>> & {
  id?: string;
};

// ─── Follow-ups ──────────────────────────────────────────────────────────────

export type FollowUpStatus =
  | 'scheduled'
  | 'due'
  | 'overdue'
  | 'waiting'
  | 'replied'
  | 'completed'
  | 'snoozed'
  | 'cancelled';

export interface FollowUpSchedule {
  id: string;
  name: string;
  /** Day intervals between stages, e.g. [3, 7, 15, 30]. */
  stages: number[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpSequence {
  id: string;
  conversationId: string;
  accountId: string;
  scheduleId: string | null;
  /** Index of the stage whose reminder is currently pending. */
  currentStage: number;
  status: FollowUpStatus;
  /** Actual send time of the original email or the most recent follow-up. */
  lastSentAt: string;
  nextDueAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FollowUpEventKind =
  | 'enabled'
  | 'reminder_due'
  | 'followup_sent'
  | 'reply_received'
  | 'snoozed'
  | 'completed'
  | 'cancelled'
  | 'schedule_changed';

export interface FollowUpEvent {
  id: string;
  sequenceId: string;
  kind: FollowUpEventKind;
  stageIndex: number | null;
  note: string | null;
  createdAt: string;
}

/** Input for one-click follow-up activation on a conversation (spec §6.1). */
export interface CreateFollowUpInput {
  conversationId: string;
  /**
   * Custom first interval in days. When set it replaces stage 0 of the chosen
   * schedule; later stages are unchanged.
   */
  intervalDays?: number | null;
  /** Schedule to use; defaults to the user's default schedule. */
  scheduleId?: string | null;
}

export interface FollowUpListItem {
  sequence: FollowUpSequence;
  conversation: Conversation;
  account: Account;
  recipient: string;
  subject: string;
  lastSentAt: string;
  nextDueAt: string | null;
  currentStage: number;
  stageCount: number;
  status: FollowUpStatus;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  // General
  language: string;
  startupBehavior: 'restore' | 'inbox';
  defaultOpeningPage: 'all-inbox' | 'last-used';
  defaultInboxId: string;
  rememberLastInbox: boolean;
  defaultSendingAccountId: string | null;
  dateFormat: 'auto' | 'short' | 'long';
  timeFormat: 'auto' | '12h' | '24h';
  confirmBeforeDelete: boolean;
  confirmBeforeSend: boolean;
  // Appearance
  theme: 'light' | 'dark' | 'system';
  fontSize: 'small' | 'medium' | 'large';
  density: 'comfortable' | 'compact';
  sidebarVisible: boolean;
  accentColor: string;
  messageListLayout: 'detailed' | 'compact';
  readingPaneLayout: 'single' | 'split';
  // Inbox
  unifiedInboxEnabled: boolean;
  groupByAccount: boolean;
  sortOrder: 'newest' | 'oldest';
  showPreview: boolean;
  markAsReadOnOpen: boolean;
  refreshIntervalMinutes: number;
  conversationGrouping: boolean;
  // Follow-up
  followUpEnabledByDefault: boolean;
  defaultScheduleId: string | null;
  maxStages: number;
  reminderTime: string;
  useWorkingDays: boolean;
  weekendBehavior: 'skip' | 'include';
  autoCompleteOnReply: boolean;
  autoReplyHandling: 'ignore' | 'complete';
  snoozeDefaultDays: number;
  overdueReminderRepeatHours: number;
  // Notifications
  desktopNotifications: boolean;
  followUpNotifications: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  notificationSound: boolean;
  notificationFrequency: 'immediate' | 'hourly' | 'daily';
  // Composition
  defaultSignature: string;
  richTextEnabled: boolean;
  replyBehavior: 'reply' | 'reply-all';
  ccOnReplyAll: boolean;
  // Security & privacy
  appLockEnabled: boolean;
  databaseEncryption: boolean;
  blockRemoteImages: boolean;
  externalContent: 'blocked' | 'ask' | 'allowed';
  aiEnabled: boolean;
  aiProvider: string | null;
  dataRetentionDays: number;
  // Storage & synchronization
  syncOnStartup: boolean;
  syncIntervalSeconds: 5 | 30 | 60 | 300 | 600;
  attachmentStoragePath: string | null;
}

// ─── Notifications ───────────────────────────────────────────────────────────

export type NotificationKind =
  | 'followup_due'
  | 'followup_overdue'
  | 'sync_error'
  | 'security';

/**
 * A reminder raised for a follow-up occurrence.
 *
 * Notifications are *derived*, never queued by a timer: `dueAt` comes from the
 * sequence's stored `next_due_at` and `dedupeKey` identifies one occurrence of
 * one stage, so restarting the app cannot raise the same reminder twice.
 */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  conversationId: string | null;
  sequenceId: string | null;
  stageIndex: number | null;
  isRead: boolean;
  /** When the reminder became due (the follow-up's own timestamp). */
  dueAt: string | null;
  /** When it may be surfaced — deferred by batching and quiet hours. */
  deliverAt: string | null;
  /** When the desktop notification was actually shown; null until then. */
  deliveredAt: string | null;
  dedupeKey: string | null;
  createdAt: string;
}

// ─── App ─────────────────────────────────────────────────────────────────────

export interface AppInfo {
  version: string;
  platform: string;
  dbPath: string;
  userDataPath: string;
  isPackaged: boolean;
}

// ─── Preload API (implemented by the preload bridge, consumed by the renderer)

export interface StillAPI {
  checkEmailRecipients(addresses: string[]): Promise<Record<string, RecipientCheck>>;
  getEmailProviders(domains: string[]): Promise<Record<string, string>>;
  getAutomation(): Promise<AutomationSnapshot>;
  saveAutomation(workspace: AutomationWorkspace): Promise<AutomationSnapshot>;
  importAutomationFile(input: { name: string; base64: string; table: string[][] }): Promise<AutomationSnapshot>;
  sendAutomationRow(id: string): Promise<AutomationSnapshot>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  listAccounts(): Promise<Account[]>;
  addAccount(input: NewAccountInput): Promise<Account>;
  updateAccount(id: string, patch: UpdateAccountInput): Promise<Account>;
  removeAccount(id: string): Promise<void>;
  listSchedules(): Promise<FollowUpSchedule[]>;
  createSchedule(input: { name: string; stages: number[] }): Promise<FollowUpSchedule>;
  updateSchedule(id: string, patch: Partial<FollowUpSchedule>): Promise<FollowUpSchedule>;
  removeSchedule(id: string): Promise<void>;
  listMessages(options?: MessageListOptions): Promise<Message[]>;
  /** `id` is a conversation id, not a message id. */
  getConversation(id: string): Promise<ConversationDetail | null>;
  /** Mark every message in a conversation as read and clear its unread count. */
  markConversationRead(conversationId: string): Promise<void>;
  trashConversation(conversationId: string): Promise<void>;
  restoreConversation(conversationId: string): Promise<void>;
  getFollowUpImport(): Promise<import('./followup-import').FollowUpImportWorkspace>;
  saveFollowUpImport(workspace: import('./followup-import').FollowUpImportWorkspace): Promise<import('./followup-import').FollowUpImportWorkspace>;
  listFollowUps(): Promise<FollowUpListItem[]>;
  /**
   * Starts tracking a conversation. Returns null when it cannot be tracked
   * (unknown conversation, or no outbound message to follow up on).
   */
  createFollowUp(input: CreateFollowUpInput): Promise<FollowUpListItem | null>;
  /** Stops tracking a conversation; history is preserved. */
  disableFollowUp(conversationId: string): Promise<void>;
  /**
   * Applies a different schedule to one tracked conversation and recomputes the
   * pending reminder from the actual last send time.
   */
  setFollowUpSchedule(
    sequenceId: string,
    scheduleId: string,
  ): Promise<FollowUpListItem | null>;
  updateFollowUpStatus(id: string, status: FollowUpStatus, snoozeDays?: number): Promise<void>;
  /**
   * Re-derives due reminders from stored timestamps and returns the ones that
   * may now be surfaced. Safe to call on startup and on a tick.
   */
  scanReminders(): Promise<NotificationItem[]>;
  listNotifications(limit?: number): Promise<NotificationItem[]>;
  unreadNotificationCount(): Promise<number>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  dismissNotification(id: string): Promise<void>;
  listDrafts(): Promise<Draft[]>;
  saveDraft(input: SaveDraftInput): Promise<Draft>;
  removeDraft(id: string): Promise<void>;
  sendEmail(input: {
    accountId: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    bodyText: string;
    inReplyTo?: string | null;
    conversationId?: string | null;
    draftId?: string | null;
  }): Promise<{
    messageId: string;
    conversationId: string;
    sentAt: string;
    messageIdHeader: string | null;
    warning?: string;
  }>;
  syncEmails(): Promise<{
    syncedCount: number;
    results: Array<{ accountId: string; syncedCount: number; error?: string }>;
  }>;
  getAppInfo(): Promise<AppInfo>;
}
