import { emptyAutomation, type AutomationWorkspace, type AutomationSnapshot } from '../../shared/automation';
import type {
  Account,
  AppInfo,
  Conversation,
  ConversationDetail,
  CreateFollowUpInput,
  Draft,
  FollowUpListItem,
  FollowUpSchedule,
  FollowUpSequence,
  FollowUpStatus,
  Message,
  MessageListOptions,
  NewAccountInput,
  NotificationItem,
  SaveDraftInput,
  Settings,
  StillAPI,
  UpdateAccountInput,
} from '../../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_FOLLOWUP_STAGES } from '../../shared/constants';
import { matchesFolder } from '../../shared/utils/messages';
import { computeDueDate, deriveTimingStatus, initialSchedule } from '../../shared/followup/scheduler';
import { planReminders, type DueSequence, type ReminderOptions } from '../../shared/notifications/reminder-engine';

/**
 * Renderer data access. Inside Electron this delegates to the preload
 * bridge (`window.still`). In a plain browser (web preview) it falls back
 * to a localStorage-backed implementation with seeded sample data so the
 * interface can be evaluated outside the desktop app. The fallback is
 * never used inside Electron.
 */

export const isElectron: boolean =
  typeof window !== 'undefined' && typeof window.still !== 'undefined';

const LS_PREFIX = 'still-preview:';

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function lsWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable — preview data simply won't persist.
  }
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function daysAgoIso(days: number, hour = 9, minute = 0): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function daysFromNowIso(days: number, hour = 9, minute = 0): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

// ── Preview seed data (browser only) ─────────────────────────────────────────

const seedAccounts: Account[] = [
  {
    id: 'acc-personal',
    provider: 'google',
    displayName: 'Personal',
    email: 'alex@example.com',
    color: '#3E6FA3',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    username: 'alex@example.com',
    syncEnabled: true,
    isDefaultSender: true,
    authStatus: 'connected',
    createdAt: daysAgoIso(30),
    updatedAt: daysAgoIso(30),
  },
  {
    id: 'acc-work',
    provider: 'microsoft',
    displayName: 'Work',
    email: 'alex@company.com',
    color: '#6E8B67',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: true,
    username: 'alex@company.com',
    syncEnabled: true,
    isDefaultSender: false,
    authStatus: 'connected',
    createdAt: daysAgoIso(30),
    updatedAt: daysAgoIso(30),
  },
];

function seedMessage(partial: Partial<Message> & Pick<Message, 'id' | 'accountId' | 'subject'>): Message {
  return {
    conversationId: null,
    folderId: null,
    providerMessageId: null,
    messageIdHeader: null,
    inReplyTo: null,
    referencesHeader: null,
    threadId: null,
    snippet: '',
    bodyText: null,
    bodyHtml: null,
    fromName: '',
    fromAddress: '',
    toAddresses: [],
    ccAddresses: [],
    bccAddresses: [],
    sentAt: daysAgoIso(1),
    receivedAt: null,
    isRead: true,
    isStarred: false,
    isSnoozed: false,
    snoozedUntil: null,
    hasAttachments: false,
    direction: 'inbound',
    deletedAt: null,
    ...partial,
  };
}

const seedMessages: Message[] = [
  seedMessage({
    id: 'm1',
    accountId: 'acc-personal',
    conversationId: 'c1',
    subject: 'Q4 planning sync',
    fromName: 'Sarah Chen',
    fromAddress: 'sarah.chen@example.com',
    toAddresses: ['alex@example.com'],
    sentAt: daysAgoIso(0, 9, 41),
    isRead: false,
    snippet: "Hi Alex — sharing the agenda for Thursday's planning session. Two items need your input before then…",
    bodyText:
      "Hi Alex,\n\nSharing the agenda for Thursday's planning session. Two items need your input before then: the roadmap priorities and the hiring plan for Q1.\n\nCould you take a look and add anything I'm missing?\n\nBest,\nSarah",
  }),
  seedMessage({
    id: 'm2',
    accountId: 'acc-personal',
    conversationId: 'c5',
    subject: 'Invoice #1042 — October services',
    fromName: 'Northwind Billing',
    fromAddress: 'billing@northwind.example',
    toAddresses: ['alex@example.com'],
    sentAt: daysAgoIso(1, 14, 5),
    hasAttachments: true,
    snippet: 'Please find attached invoice #1042 for October services. Payment terms are net 30…',
    bodyText:
      'Hello,\n\nPlease find attached invoice #1042 for October services. Payment terms are net 30.\n\nThank you,\nNorthwind Billing',
  }),
  seedMessage({
    id: 'm3',
    accountId: 'acc-personal',
    conversationId: 'c2',
    subject: 'Website redesign proposal',
    fromName: 'Alex',
    fromAddress: 'alex@example.com',
    toAddresses: ['lena@studio.example'],
    sentAt: daysAgoIso(5, 11, 20),
    direction: 'outbound',
    snippet: 'Hi Lena, attaching the proposal for the redesign — scope, timeline and pricing are in section 2…',
    bodyText:
      'Hi Lena,\n\nAttaching the proposal for the redesign — scope, timeline and pricing are in section 2.\n\nHappy to walk through it on a call.\n\nBest,\nAlex',
  }),
  seedMessage({
    id: 'm4',
    accountId: 'acc-personal',
    conversationId: 'c2',
    subject: 'Re: Website redesign proposal',
    fromName: 'Lena Fischer',
    fromAddress: 'lena@studio.example',
    toAddresses: ['alex@example.com'],
    sentAt: daysAgoIso(4, 16, 2),
    snippet: 'Thanks Alex — the timeline looks good. Could you confirm whether the CMS migration is included in phase one?',
    bodyText:
      'Thanks Alex — the timeline looks good. Could you confirm whether the CMS migration is included in phase one?\n\nLena',
  }),
  seedMessage({
    id: 'm5',
    accountId: 'acc-personal',
    conversationId: 'c2',
    subject: 'Re: Website redesign proposal',
    fromName: 'Alex',
    fromAddress: 'alex@example.com',
    toAddresses: ['lena@studio.example'],
    sentAt: daysAgoIso(3, 10, 15),
    direction: 'outbound',
    snippet: "Hi Lena, yes — CMS migration is included in phase one. I've updated the proposal accordingly…",
    bodyText:
      "Hi Lena,\n\nYes — CMS migration is included in phase one. I've updated the proposal accordingly.\n\nLet me know if you'd like to schedule a call.\n\nBest,\nAlex",
  }),
  seedMessage({
    id: 'm6',
    accountId: 'acc-work',
    conversationId: 'c3',
    subject: 'Partnership inquiry',
    fromName: 'Alex',
    fromAddress: 'alex@company.com',
    toAddresses: ['marco@partner.example'],
    sentAt: daysAgoIso(3, 9, 30),
    direction: 'outbound',
    snippet: "Hi Marco, following up on our conversation at the summit — we'd like to explore a partnership…",
    bodyText:
      "Hi Marco,\n\nFollowing up on our conversation at the summit — we'd like to explore a partnership.\n\nWould you be open to a short call next week?\n\nBest,\nAlex",
  }),
  seedMessage({
    id: 'm7',
    accountId: 'acc-work',
    conversationId: 'c4',
    subject: 'Contract review — Q4',
    fromName: 'Alex',
    fromAddress: 'alex@company.com',
    toAddresses: ['priya@legal.example'],
    sentAt: daysAgoIso(10, 15, 45),
    direction: 'outbound',
    snippet: 'Hi Priya, sending over the updated contract for review. Key changes are highlighted in section 4…',
    bodyText:
      'Hi Priya,\n\nSending over the updated contract for review. Key changes are highlighted in section 4.\n\nThanks,\nAlex',
  }),
  seedMessage({
    id: 'm8',
    accountId: 'acc-work',
    conversationId: 'c7',
    subject: 'Re: Hiring — frontend engineer',
    fromName: 'Alex',
    fromAddress: 'alex@company.com',
    toAddresses: ['tom@hr.example'],
    sentAt: daysAgoIso(20, 10, 0),
    direction: 'outbound',
    snippet: "Hi Tom, sharing the shortlist for the frontend role — three candidates I'd recommend interviewing…",
    bodyText:
      "Hi Tom,\n\nSharing the shortlist for the frontend role — three candidates I'd recommend interviewing.\n\nAlex",
  }),
  seedMessage({
    id: 'm9',
    accountId: 'acc-personal',
    conversationId: 'c6',
    subject: 'Welcome to Still',
    fromName: 'Still Team',
    fromAddress: 'hello@still.example',
    toAddresses: ['alex@example.com'],
    sentAt: daysAgoIso(12, 8, 0),
    snippet: 'Welcome to Still. Your inbox is private by design — everything stays on your device…',
    bodyText:
      'Welcome to Still.\n\nYour inbox is private by design — everything stays on your device. Enable follow-up on any sent email and Still will remind you if there is no reply.\n\nThe Still Team',
  }),
  seedMessage({
    id: 'm10',
    accountId: 'acc-personal',
    conversationId: 'c8',
    subject: 'Design review notes',
    fromName: 'Ana Sousa',
    fromAddress: 'ana@studio.example',
    toAddresses: ['alex@example.com'],
    sentAt: daysAgoIso(6, 13, 30),
    snippet: "Notes from today's design review — the new reading pane layout tested well with the group…",
    bodyText:
      "Notes from today's design review — the new reading pane layout tested well with the group.\n\nAna",
  }),
  seedMessage({
    id: 'm11',
    accountId: 'acc-work',
    conversationId: 'c9',
    subject: 'Budget approval needed',
    fromName: 'Priya Raman',
    fromAddress: 'priya@company.com',
    toAddresses: ['alex@company.com'],
    sentAt: daysAgoIso(0, 8, 12),
    isRead: false,
    snippet: 'The Q4 tooling budget needs your sign-off before Friday. Total is unchanged from last quarter…',
    bodyText:
      'The Q4 tooling budget needs your sign-off before Friday. Total is unchanged from last quarter.\n\nPriya',
  }),
  seedMessage({
    id: 'm12',
    accountId: 'acc-work',
    conversationId: 'c10',
    subject: 'Standup notes — November',
    fromName: 'Tom Weber',
    fromAddress: 'tom@company.com',
    toAddresses: ['team@company.com'],
    sentAt: daysAgoIso(2, 16, 40),
    snippet: 'Notes from this week. Follow-up engine moved to Phase 4, sync engine is next…',
    bodyText:
      'Notes from this week. Follow-up engine moved to Phase 4, sync engine is next.\n\nTom',
  }),
  seedMessage({
    id: 'm13',
    accountId: 'acc-work',
    conversationId: 'c11',
    subject: 'Renewal quote',
    fromName: 'Nordhost Billing',
    fromAddress: 'billing@nordhost.example',
    toAddresses: ['alex@company.com'],
    sentAt: daysAgoIso(4, 11, 5),
    hasAttachments: true,
    snippet: 'Your annual hosting renewal quote is attached. It is valid for 30 days…',
    bodyText:
      'Your annual hosting renewal quote is attached. It is valid for 30 days.\n\nNordhost Billing',
  }),
];

const seedConversations: Conversation[] = [
  { id: 'c1', accountId: 'acc-personal', subject: 'Q4 planning sync', participants: ['sarah.chen@example.com'], lastMessageAt: daysAgoIso(0, 9, 41), unreadCount: 1, isStarred: false },
  { id: 'c2', accountId: 'acc-personal', subject: 'Website redesign proposal', participants: ['lena@studio.example'], lastMessageAt: daysAgoIso(3, 10, 15), unreadCount: 0, isStarred: false },
  { id: 'c3', accountId: 'acc-work', subject: 'Partnership inquiry', participants: ['marco@partner.example'], lastMessageAt: daysAgoIso(3, 9, 30), unreadCount: 0, isStarred: false },
  { id: 'c4', accountId: 'acc-work', subject: 'Contract review — Q4', participants: ['priya@legal.example'], lastMessageAt: daysAgoIso(10, 15, 45), unreadCount: 0, isStarred: false },
  { id: 'c5', accountId: 'acc-personal', subject: 'Invoice #1042 — October services', participants: ['billing@northwind.example'], lastMessageAt: daysAgoIso(1, 14, 5), unreadCount: 0, isStarred: false },
  { id: 'c6', accountId: 'acc-personal', subject: 'Welcome to Still', participants: ['hello@still.example'], lastMessageAt: daysAgoIso(12, 8, 0), unreadCount: 0, isStarred: false },
  { id: 'c7', accountId: 'acc-work', subject: 'Re: Hiring — frontend engineer', participants: ['tom@hr.example'], lastMessageAt: daysAgoIso(20, 10, 0), unreadCount: 0, isStarred: false },
  { id: 'c8', accountId: 'acc-personal', subject: 'Design review notes', participants: ['ana@studio.example'], lastMessageAt: daysAgoIso(6, 13, 30), unreadCount: 0, isStarred: false },
  { id: 'c9', accountId: 'acc-work', subject: 'Budget approval needed', participants: ['priya@company.com'], lastMessageAt: daysAgoIso(0, 8, 12), unreadCount: 1, isStarred: false },
  { id: 'c10', accountId: 'acc-work', subject: 'Standup notes — November', participants: ['tom@company.com'], lastMessageAt: daysAgoIso(2, 16, 40), unreadCount: 0, isStarred: false },
  { id: 'c11', accountId: 'acc-work', subject: 'Renewal quote', participants: ['billing@nordhost.example'], lastMessageAt: daysAgoIso(4, 11, 5), unreadCount: 0, isStarred: false },
];

function seedSequence(partial: Partial<FollowUpSequence> & Pick<FollowUpSequence, 'id' | 'conversationId' | 'accountId' | 'status'>): FollowUpSequence {
  return {
    scheduleId: 'default',
    currentStage: 0,
    lastSentAt: daysAgoIso(3),
    nextDueAt: null,
    snoozedUntil: null,
    createdAt: daysAgoIso(3),
    updatedAt: daysAgoIso(3),
    ...partial,
  };
}

function seedFollowUp(
  sequence: FollowUpSequence,
  recipient: string,
  subject: string,
  stageCount = 4,
): FollowUpListItem {
  const conversation = seedConversations.find((c) => c.id === sequence.conversationId) as Conversation;
  const account = seedAccounts.find((a) => a.id === sequence.accountId) as Account;
  return {
    sequence,
    conversation,
    account,
    recipient,
    subject,
    lastSentAt: sequence.lastSentAt,
    nextDueAt: sequence.nextDueAt,
    currentStage: sequence.currentStage,
    stageCount,
    status: sequence.status,
  };
}

const seedFollowUps: FollowUpListItem[] = [
  seedFollowUp(
    seedSequence({
      id: 'f2',
      conversationId: 'c2',
      accountId: 'acc-personal',
      status: 'scheduled',
      currentStage: 1,
      lastSentAt: daysAgoIso(3, 10, 15),
      nextDueAt: daysFromNowIso(4, 9),
    }),
    'lena@studio.example',
    'Website redesign proposal',
  ),
  seedFollowUp(
    seedSequence({
      id: 'f3',
      conversationId: 'c3',
      accountId: 'acc-work',
      status: 'due',
      currentStage: 0,
      lastSentAt: daysAgoIso(3, 9, 30),
      nextDueAt: daysAgoIso(0, 8),
    }),
    'marco@partner.example',
    'Partnership inquiry',
  ),
  seedFollowUp(
    seedSequence({
      id: 'f4',
      conversationId: 'c4',
      accountId: 'acc-work',
      status: 'overdue',
      currentStage: 2,
      lastSentAt: daysAgoIso(10, 15, 45),
      nextDueAt: daysAgoIso(1, 9),
    }),
    'priya@legal.example',
    'Contract review — Q4',
  ),
  seedFollowUp(
    seedSequence({
      id: 'f7',
      conversationId: 'c7',
      accountId: 'acc-work',
      status: 'waiting',
      currentStage: 3,
      lastSentAt: daysAgoIso(20, 10),
      nextDueAt: null,
    }),
    'tom@hr.example',
    'Re: Hiring — frontend engineer',
  ),
  seedFollowUp(
    seedSequence({
      id: 'f8',
      conversationId: 'c8',
      accountId: 'acc-personal',
      status: 'completed',
      currentStage: 1,
      lastSentAt: daysAgoIso(6, 13, 30),
      nextDueAt: null,
    }),
    'ana@studio.example',
    'Design review notes',
  ),
];

const defaultSchedule: FollowUpSchedule = {
  id: 'default',
  name: 'Default',
  stages: [...DEFAULT_FOLLOWUP_STAGES],
  isDefault: true,
  createdAt: daysAgoIso(30),
  updatedAt: daysAgoIso(30),
};

// ── Browser preview implementation ───────────────────────────────────────────

class BrowserPreviewAPI implements StillAPI {
  async getAutomation(): Promise<AutomationSnapshot> {
    return { workspace: lsRead('automation-workspace', emptyAutomation()), sentToday: 0, sentTotal: 0, attemptedToday: 0, lastAttemptAt: 0 };
  }
  async saveAutomation(workspace: AutomationWorkspace): Promise<AutomationSnapshot> {
    lsWrite('automation-workspace', workspace);
    return this.getAutomation();
  }
  async importAutomationFile(input: { name: string; base64: string; table: string[][] }): Promise<AutomationSnapshot> {
    const { workspace } = await this.getAutomation();
    // Browser preview stores parsed data only; original bytes belong in desktop SQLite.
    return this.saveAutomation({ ...workspace, fileName: input.name, table: input.table, columns: [0, 1, 2], rows: [] });
  }
  async sendAutomationRow(_id: string): Promise<AutomationSnapshot> {
    throw new Error('Sending requires the desktop app.');
  }

  private settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...lsRead<Partial<Settings>>('settings', {}),
  };
  private accounts: Account[] = lsRead<Account[]>('accounts', seedAccounts);
  private schedules: FollowUpSchedule[] = lsRead<FollowUpSchedule[]>('schedules', [defaultSchedule]);
  private drafts: Draft[] = lsRead<Draft[]>('drafts', []);
  private followUps: FollowUpListItem[] = lsRead<FollowUpListItem[]>('followups', seedFollowUps);
  private notifications: NotificationItem[] = lsRead<NotificationItem[]>('notifications', []);
  private messages: Message[] = lsRead<Message[]>('messages', seedMessages);

  async getSettings(): Promise<Settings> {
    return this.settings;
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    this.settings = { ...this.settings, ...patch };
    lsWrite('settings', this.settings);
    return this.settings;
  }

  async listAccounts(): Promise<Account[]> {
    return this.accounts;
  }

  async addAccount(input: NewAccountInput): Promise<Account> {
    const account: Account = {
      id: uid(),
      provider: input.provider,
      displayName: input.displayName,
      email: input.email,
      color: input.color ?? null,
      imapHost: input.imapHost ?? null,
      imapPort: input.imapPort ?? null,
      imapSecure: input.imapSecure ?? true,
      smtpHost: input.smtpHost ?? null,
      smtpPort: input.smtpPort ?? null,
      smtpSecure: input.smtpSecure ?? true,
      username: input.username ?? null,
      syncEnabled: true,
      isDefaultSender: this.accounts.length === 0,
      authStatus: 'connected',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.accounts = [...this.accounts, account];
    lsWrite('accounts', this.accounts);
    return account;
  }

  async updateAccount(id: string, patch: UpdateAccountInput): Promise<Account> {
    this.accounts = this.accounts.map((a) =>
      a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a,
    );
    lsWrite('accounts', this.accounts);
    return this.accounts.find((a) => a.id === id) as Account;
  }

  async removeAccount(id: string): Promise<void> {
    this.accounts = this.accounts.filter((a) => a.id !== id);
    lsWrite('accounts', this.accounts);
  }

  async listSchedules(): Promise<FollowUpSchedule[]> {
    return this.schedules;
  }

  async createSchedule(input: { name: string; stages: number[] }): Promise<FollowUpSchedule> {
    const schedule: FollowUpSchedule = {
      id: uid(),
      name: input.name,
      stages: input.stages,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.schedules = [...this.schedules, schedule];
    lsWrite('schedules', this.schedules);
    return schedule;
  }

  async updateSchedule(id: string, patch: Partial<FollowUpSchedule>): Promise<FollowUpSchedule> {
    if (patch.isDefault === true) {
      this.schedules = this.schedules.map((s) => ({ ...s, isDefault: false }));
    }
    this.schedules = this.schedules.map((s) =>
      s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s,
    );
    lsWrite('schedules', this.schedules);
    return this.schedules.find((s) => s.id === id) as FollowUpSchedule;
  }

  async removeSchedule(id: string): Promise<void> {
    this.schedules = this.schedules.filter((s) => s.id !== id);
    lsWrite('schedules', this.schedules);
  }

  async listMessages(options: MessageListOptions = {}): Promise<Message[]> {
    let list = [...this.messages];
    if (options.accountId) list = list.filter((m) => m.accountId === options.accountId);
    if (options.folderId) list = list.filter((m) => m.folderId === options.folderId);
    if (options.folderKind) list = list.filter((m) => matchesFolder(m, options.folderKind!));
    else list = list.filter((m) => !m.deletedAt);
    list.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    const offset = options.offset ?? 0;
    return list.slice(offset, offset + (options.limit ?? 200));
  }

  async getConversation(id: string): Promise<ConversationDetail | null> {
    const conversation = seedConversations.find((c) => c.id === id);
    if (!conversation) return null;
    const messages = this.messages
      .filter((m) => m.conversationId === id)
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    return { conversation, messages };
  }

  async trashConversation(conversationId: string): Promise<void> {
    const deletedAt = new Date().toISOString();
    this.messages = this.messages.map((m) => m.conversationId === conversationId ? { ...m, deletedAt } : m);
    lsWrite('messages', this.messages);
  }

  async restoreConversation(conversationId: string): Promise<void> {
    this.messages = this.messages.map((m) => m.conversationId === conversationId ? { ...m, deletedAt: null } : m);
    lsWrite('messages', this.messages);
  }

  async markConversationRead(conversationId: string): Promise<void> {
    this.messages = this.messages.map((m) =>
      m.conversationId === conversationId && !m.isRead ? { ...m, isRead: true } : m,
    );
    lsWrite('messages', this.messages);
  }

  async listFollowUps(): Promise<FollowUpListItem[]> {
    return this.followUps;
  }

  async updateFollowUpStatus(id: string, status: FollowUpStatus, snoozeDays?: number): Promise<void> {
    const terminal = status === 'completed' || status === 'replied' || status === 'cancelled';
    this.followUps = this.followUps.map((item) => {
      if (item.sequence.id !== id) return item;
      const sequence: FollowUpSequence = {
        ...item.sequence,
        status,
        snoozedUntil: status === 'snoozed' ? daysFromNowIso(snoozeDays ?? 3) : null,
        nextDueAt: terminal ? null : item.sequence.nextDueAt,
        updatedAt: new Date().toISOString(),
      };
      return { ...item, sequence, status };
    });
    lsWrite('followups', this.followUps);
  }

  /**
   * Mirrors `FollowUpRepository.create()`: same rules, same scheduler. Only
   * conversations with an outbound message can be tracked, and enabling twice
   * never produces a second sequence.
   */
  async createFollowUp(input: CreateFollowUpInput): Promise<FollowUpListItem | null> {
    const conversation = seedConversations.find((c) => c.id === input.conversationId);
    if (!conversation) return null;

    const active = this.followUps.find(
      (f) =>
        f.conversation.id === conversation.id &&
        !['completed', 'replied', 'cancelled'].includes(f.status),
    );
    if (active) return active;

    const outbound = this.messages
      .filter((m) => m.conversationId === conversation.id && m.direction === 'outbound')
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    if (!outbound) return null;

    const schedule =
      this.schedules.find((s) => s.id === input.scheduleId) ??
      this.schedules.find((s) => s.id === this.settings.defaultScheduleId) ??
      this.schedules.find((s) => s.isDefault) ??
      this.schedules[0];
    if (!schedule) return null;

    let stages = [...schedule.stages];
    if (typeof input.intervalDays === 'number') stages[0] = input.intervalDays;
    stages = stages.slice(0, Math.max(1, this.settings.maxStages));

    const plan = initialSchedule(new Date(outbound.sentAt), stages, {
      useWorkingDays:
        this.settings.useWorkingDays && this.settings.weekendBehavior === 'skip',
      reminderTime: this.settings.reminderTime,
    });

    const account = this.accounts.find((a) => a.id === conversation.accountId);
    if (!account) return null;

    const ts = new Date().toISOString();
    const sequence: FollowUpSequence = {
      id: uid(),
      conversationId: conversation.id,
      accountId: account.id,
      scheduleId: schedule.id,
      currentStage: plan.currentStage,
      status: plan.status,
      lastSentAt: outbound.sentAt,
      nextDueAt: plan.nextDueAt,
      snoozedUntil: null,
      createdAt: ts,
      updatedAt: ts,
    };
    const recipient =
      outbound.toAddresses.find((a) => a.toLowerCase() !== account.email.toLowerCase()) ??
      outbound.toAddresses[0] ??
      conversation.participants[0] ??
      '';
    const item: FollowUpListItem = {
      sequence,
      conversation,
      account,
      recipient,
      subject: conversation.subject,
      lastSentAt: sequence.lastSentAt,
      nextDueAt: sequence.nextDueAt,
      currentStage: sequence.currentStage,
      stageCount: stages.length,
      status: sequence.status,
    };
    this.followUps = [...this.followUps, item];
    lsWrite('followups', this.followUps);
    return item;
  }

  /** Mirrors `FollowUpRepository.setSchedule()`: same recomputation rules. */
  async setFollowUpSchedule(
    sequenceId: string,
    scheduleId: string,
  ): Promise<FollowUpListItem | null> {
    const schedule = this.schedules.find((s) => s.id === scheduleId);
    if (!schedule) return null;
    const stages = schedule.stages.filter((n) => Number.isFinite(n) && n >= 1);
    if (stages.length === 0) return null;

    let updated: FollowUpListItem | null = null;
    this.followUps = this.followUps.map((item) => {
      if (item.sequence.id !== sequenceId) return item;

      const pendingStage = item.sequence.currentStage;
      const hasStage = pendingStage < stages.length;
      const nextDueAt = hasStage
        ? computeDueDate(new Date(item.sequence.lastSentAt), stages[pendingStage], {
            useWorkingDays:
              this.settings.useWorkingDays && this.settings.weekendBehavior === 'skip',
            reminderTime: this.settings.reminderTime,
          }).toISOString()
        : null;

      const live =
        item.status === 'scheduled' || item.status === 'due' || item.status === 'overdue';
      const status: FollowUpStatus = hasStage
        ? live
          ? ((deriveTimingStatus(nextDueAt ? new Date(nextDueAt) : null, new Date()) ??
              'scheduled') as FollowUpStatus)
          : item.status
        : live
          ? 'waiting'
          : item.status;

      const sequence: FollowUpSequence = {
        ...item.sequence,
        scheduleId: schedule.id,
        nextDueAt,
        status,
        updatedAt: new Date().toISOString(),
      };
      updated = {
        ...item,
        sequence,
        status,
        nextDueAt,
        stageCount: stages.length,
      };
      return updated;
    });
    lsWrite('followups', this.followUps);

    // Mirrors the Electron handler: the due time just moved, so drop reminders
    // that have not been shown yet and let the next scan re-derive them.
    if (updated) {
      const before = this.notifications.length;
      this.notifications = this.notifications.filter(
        (n) => n.sequenceId !== sequenceId || n.deliveredAt !== null,
      );
      if (this.notifications.length !== before) lsWrite('notifications', this.notifications);
    }
    return updated;
  }

  async disableFollowUp(conversationId: string): Promise<void> {
    this.followUps = this.followUps.map((item) => {
      if (item.conversation.id !== conversationId) return item;
      if (['completed', 'replied', 'cancelled'].includes(item.status)) return item;
      const sequence: FollowUpSequence = {
        ...item.sequence,
        status: 'cancelled',
        nextDueAt: null,
        snoozedUntil: null,
        updatedAt: new Date().toISOString(),
      };
      return { ...item, sequence, status: 'cancelled' as FollowUpStatus };
    });
    lsWrite('followups', this.followUps);
    // Reminders for a cancelled sequence must not linger (spec §6.4).
    const dropped = new Set(
      this.followUps
        .filter((f) => f.conversation.id === conversationId && f.status === 'cancelled')
        .map((f) => f.sequence.id),
    );
    if (dropped.size > 0) {
      this.notifications = this.notifications.filter(
        (n) => !n.sequenceId || !dropped.has(n.sequenceId),
      );
      lsWrite('notifications', this.notifications);
    }
  }

  // ─── Reminders ─────────────────────────────────────────────────────────────
  //
  // The browser preview runs the same pure planner as the Electron main
  // process, so behaviour under test matches the shipped app. Reminders are
  // derived from stored timestamps, never from a running timer.

  private reminderOptions(): ReminderOptions {
    return {
      quietHours: {
        enabled: this.settings.quietHoursEnabled,
        start: this.settings.quietHoursStart,
        end: this.settings.quietHoursEnd,
      },
      frequency: this.settings.notificationFrequency,
      reminderTime: this.settings.reminderTime,
      overdueRepeatHours: this.settings.overdueReminderRepeatHours,
    };
  }

  private dueSequences(now: Date): DueSequence[] {
    return this.followUps
      .filter((item) => {
        const { sequence } = item;
        if (['cancelled', 'completed', 'replied', 'snoozed'].includes(sequence.status)) return false;
        if (!sequence.nextDueAt) return false;
        return new Date(sequence.nextDueAt).getTime() <= now.getTime();
      })
      .map((item) => {
        const schedule = this.schedules.find((sc) => sc.id === item.sequence.scheduleId);
        const participants = item.conversation.participants;
        const accountEmail =
          this.accounts.find((a) => a.id === item.conversation.accountId)?.email ?? '';
        return {
          sequenceId: item.sequence.id,
          conversationId: item.conversation.id,
          currentStage: item.sequence.currentStage,
          totalStages: schedule?.stages.length ?? item.stageCount,
          nextDueAt: item.sequence.nextDueAt as string,
          subject: item.conversation.subject,
          recipient:
            participants.find((p) => p.toLowerCase() !== accountEmail.toLowerCase()) ??
            participants[0] ??
            '',
        };
      });
  }

  async scanReminders(): Promise<NotificationItem[]> {
    const now = new Date();
    const opts = this.reminderOptions();
    if (!this.settings.followUpNotifications) return this.readyReminders(now);

    const plans = planReminders(this.dueSequences(now), now, opts);
    const seen = new Set(this.notifications.map((n) => n.dedupeKey));
    const createdAt = now.toISOString();
    for (const plan of plans) {
      if (seen.has(plan.dedupeKey)) continue;
      seen.add(plan.dedupeKey);
      this.notifications = [
        {
          id: uid(),
          kind: plan.kind,
          title: plan.title,
          body: plan.body,
          conversationId: plan.conversationId,
          sequenceId: plan.sequenceId,
          stageIndex: plan.stageIndex,
          isRead: false,
          dueAt: plan.dueAt,
          deliverAt: plan.deliverAt,
          deliveredAt: null,
          dedupeKey: plan.dedupeKey,
          createdAt,
        },
        ...this.notifications,
      ];
    }
    lsWrite('notifications', this.notifications);
    return this.readyReminders(now);
  }

  private readyReminders(now: Date): NotificationItem[] {
    return this.notifications
      .filter(
        (n) =>
          n.deliveredAt === null &&
          (n.deliverAt === null || new Date(n.deliverAt).getTime() <= now.getTime()),
      )
      .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  }

  async listNotifications(limit = 50): Promise<NotificationItem[]> {
    return this.notifications.slice(0, Math.max(1, Math.min(200, limit)));
  }

  async unreadNotificationCount(): Promise<number> {
    return this.notifications.filter((n) => !n.isRead).length;
  }

  async markNotificationRead(id: string): Promise<void> {
    this.notifications = this.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
    lsWrite('notifications', this.notifications);
  }

  async markAllNotificationsRead(): Promise<void> {
    this.notifications = this.notifications.map((n) => ({ ...n, isRead: true }));
    lsWrite('notifications', this.notifications);
  }

  async dismissNotification(id: string): Promise<void> {
    this.notifications = this.notifications.filter((n) => n.id !== id);
    lsWrite('notifications', this.notifications);
  }

  async listDrafts(): Promise<Draft[]> {
    return this.drafts;
  }

  async saveDraft(input: SaveDraftInput): Promise<Draft> {
    const ts = new Date().toISOString();
    const existing = input.id ? this.drafts.find((d) => d.id === input.id) : undefined;
    const draft: Draft = existing
      ? { ...existing, ...input, id: existing.id, updatedAt: ts }
      : {
          id: input.id ?? uid(),
          accountId: input.accountId ?? null,
          toAddresses: input.toAddresses ?? [],
          ccAddresses: input.ccAddresses ?? [],
          bccAddresses: input.bccAddresses ?? [],
          subject: input.subject ?? '',
          body: input.body ?? '',
          followUpEnabled: input.followUpEnabled ?? false,
          followUpIntervalDays: input.followUpIntervalDays ?? null,
          inReplyToConversationId: input.inReplyToConversationId ?? null,
          createdAt: ts,
          updatedAt: ts,
        };
    this.drafts = existing
      ? this.drafts.map((d) => (d.id === draft.id ? draft : d))
      : [draft, ...this.drafts];
    lsWrite('drafts', this.drafts);
    return draft;
  }

  async removeDraft(id: string): Promise<void> {
    this.drafts = this.drafts.filter((d) => d.id !== id);
    lsWrite('drafts', this.drafts);
  }

  async sendEmail(input: {
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
  }> {
    const sentAt = new Date().toISOString();
    const conversationId = input.conversationId || uid();
    const messageId = uid();
    const account = this.accounts.find((a) => a.id === input.accountId);
    const msg: Message = {
      id: messageId,
      accountId: input.accountId,
      conversationId,
      folderId: 'sent',
      providerMessageId: messageId,
      messageIdHeader: `<${messageId}@still.local>`,
      inReplyTo: input.inReplyTo ?? null,
      referencesHeader: null,
      threadId: null,
      subject: input.subject || '(no subject)',
      snippet: input.bodyText.slice(0, 160),
      bodyText: input.bodyText,
      bodyHtml: null,
      fromName: account?.displayName ?? 'Me',
      fromAddress: account?.email ?? 'me@example.com',
      toAddresses: input.to,
      ccAddresses: input.cc ?? [],
      bccAddresses: input.bcc ?? [],
      sentAt,
      receivedAt: sentAt,
      isRead: true,
      isStarred: false,
      isSnoozed: false,
      snoozedUntil: null,
      hasAttachments: false,
      direction: 'outbound',
      deletedAt: null,
    };
    this.messages = [msg, ...this.messages];
    if (input.draftId) {
      this.drafts = this.drafts.filter((d) => d.id !== input.draftId);
      lsWrite('drafts', this.drafts);
    }
    return {
      messageId,
      conversationId,
      sentAt,
      messageIdHeader: msg.messageIdHeader,
    };
  }

  async syncEmails(): Promise<{
    syncedCount: number;
    results: Array<{ accountId: string; syncedCount: number; error?: string }>;
  }> {
    return { syncedCount: 0, results: [] };
  }

  async getAppInfo(): Promise<AppInfo> {
    return {
      version: '0.1.0-preview',
      platform: 'browser',
      dbPath: '—',
      userDataPath: '—',
      isPackaged: false,
    };
  }
}

let fallback: BrowserPreviewAPI | null = null;

export function getAPI(): StillAPI {
  if (typeof window !== 'undefined' && window.still) return window.still;
  if (!fallback) fallback = new BrowserPreviewAPI();
  return fallback;
}
