import type { Settings } from './types';

export const APP_NAME = 'Still';

/** Default follow-up schedule: 3, 7, 15, 30 days (spec §6.2). */
export const DEFAULT_FOLLOWUP_STAGES: number[] = [3, 7, 15, 30];

/**
 * Bounds for a custom follow-up interval, in days.
 *
 * Shared deliberately: the composer clamps user input to this range and the IPC
 * schema rejects anything outside it. Keeping one definition means a value the
 * UI can produce can never be refused on the way in — which would otherwise
 * fail silently, because draft autosave treats errors as best-effort.
 */
export const MIN_FOLLOWUP_INTERVAL_DAYS = 1;
export const MAX_FOLLOWUP_INTERVAL_DAYS = 365;

export const ACCOUNT_COLORS: string[] = [
  '#3E6FA3',
  '#6E8B67',
  '#B5894A',
  '#8A6D9B',
  '#4F8A8B',
  '#A86B5B',
  '#5B7A99',
  '#9B8A5B',
];

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  startupBehavior: 'restore',
  defaultOpeningPage: 'last-used',
  defaultInboxId: 'all',
  rememberLastInbox: true,
  defaultSendingAccountId: null,
  dateFormat: 'auto',
  timeFormat: 'auto',
  confirmBeforeDelete: true,
  confirmBeforeSend: false,

  theme: 'system',
  fontSize: 'medium',
  density: 'comfortable',
  sidebarVisible: true,
  accentColor: '#3E6FA3',
  messageListLayout: 'detailed',
  readingPaneLayout: 'single',

  unifiedInboxEnabled: true,
  groupByAccount: false,
  sortOrder: 'newest',
  showPreview: true,
  markAsReadOnOpen: true,
  refreshIntervalMinutes: 5,
  conversationGrouping: true,

  followUpEnabledByDefault: false,
  defaultScheduleId: null,
  maxStages: 6,
  reminderTime: '09:00',
  useWorkingDays: false,
  weekendBehavior: 'skip',
  autoCompleteOnReply: true,
  autoReplyHandling: 'ignore',
  snoozeDefaultDays: 3,
  overdueReminderRepeatHours: 24,

  desktopNotifications: true,
  followUpNotifications: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  notificationSound: false,
  notificationFrequency: 'immediate',

  defaultSignature: '',
  richTextEnabled: true,
  replyBehavior: 'reply',
  ccOnReplyAll: true,

  appLockEnabled: false,
  databaseEncryption: false,
  blockRemoteImages: true,
  externalContent: 'blocked',
  aiEnabled: false,
  aiProvider: null,
  dataRetentionDays: 0,

  syncOnStartup: true,
  syncIntervalSeconds: 30,
  attachmentStoragePath: null,
};

/** Identifier of the unified inbox pseudo-folder (not a real folder row). */
export const ALL_INBOX = 'all-inbox';

export interface ShortcutDef {
  keys: string;
  action: string;
  /** True when the shortcut is wired up in the current build. */
  active: boolean;
  /** For inactive shortcuts: the phase that delivers them. */
  arrivesIn?: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: 'C', action: 'Compose new message', active: true },
  { keys: 'R', action: 'Reply', active: true },
  { keys: 'A', action: 'Reply all', active: true },
  { keys: 'F', action: 'Forward', active: true },
  { keys: 'J / K', action: 'Next / previous message', active: true },
  { keys: '/', action: 'Search', active: true },
  { keys: 'Esc', action: 'Close current view', active: true },
  { keys: 'Ctrl/⌘ + Enter', action: 'Send message', active: true },
  { keys: 'Ctrl/⌘ + Shift + F', action: 'Toggle follow-up', active: true },
  // Message actions need the sync engine and folder rows to move mail safely.
  { keys: 'E', action: 'Archive', active: false, arrivesIn: 'Phase 3' },
  { keys: 'Delete', action: 'Delete', active: false, arrivesIn: 'Phase 3' },
  { keys: 'S', action: 'Star / unstar', active: false, arrivesIn: 'Phase 3' },
];
