import { randomUUID } from 'node:crypto';
import type { DatabaseService } from './db';
import type {
  Account,
  Conversation,
  ConversationDetail,
  Draft,
  FollowUpListItem,
  FollowUpSchedule,
  FollowUpStatus,
  Message,
  MessageListOptions,
  NewAccountInput,
  NotificationItem,
  SaveDraftInput,
  Settings,
  UpdateAccountInput,
} from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import { computeDueDate, deriveTimingStatus, initialSchedule, snoozeUntil } from '../../shared/followup/scheduler';
import { planReminders, type DueSequence, type ReminderOptions } from '../../shared/notifications/reminder-engine';

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonNumberArray(value: string | null | undefined): number[] {
  return parseJsonArray<number>(value).filter((n) => typeof n === 'number');
}

// ─── Settings ────────────────────────────────────────────────────────────────

export class SettingsRepository {
  constructor(private readonly db: DatabaseService) {}

  getAll(): Settings {
    const rows = this.db.db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const stored: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value);
      } catch {
        // Ignore corrupt entries; defaults apply.
      }
    }
    return { ...DEFAULT_SETTINGS, ...stored } as Settings;
  }

  update(patch: Partial<Settings>): Settings {
    const stmt = this.db.db.prepare(
      'INSERT INTO settings(key, value) VALUES(?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    const tx = this.db.db.transaction((entries: [string, string][]) => {
      for (const [key, value] of entries) stmt.run(key, value);
    });
    tx(Object.entries(patch).map(([k, v]) => [k, JSON.stringify(v)] as [string, string]));
    return this.getAll();
  }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

type AccountRow = {
  id: string;
  provider: string;
  display_name: string;
  email: string;
  color: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: number;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: number;
  username: string | null;
  sync_enabled: number;
  is_default_sender: number;
  auth_status: string;
  created_at: string;
  updated_at: string;
};

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    provider: row.provider as Account['provider'],
    displayName: row.display_name,
    email: row.email,
    color: row.color,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure === 1,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure === 1,
    username: row.username,
    syncEnabled: row.sync_enabled === 1,
    isDefaultSender: row.is_default_sender === 1,
    authStatus: row.auth_status as Account['authStatus'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AccountRepository {
  constructor(private readonly db: DatabaseService) {}

  list(): Account[] {
    const rows = this.db.db
      .prepare('SELECT * FROM accounts ORDER BY created_at ASC')
      .all() as AccountRow[];
    return rows.map(toAccount);
  }

  getById(id: string): Account | null {
    const row = this.db.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
      | AccountRow
      | undefined;
    return row ? toAccount(row) : null;
  }

  create(input: NewAccountInput): Account {
    const id = randomUUID();
    const ts = nowIso();
    this.db.db
      .prepare(
        `INSERT INTO accounts (id, provider, display_name, email, color,
          imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
          username, sync_enabled, is_default_sender, auth_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'connected', ?, ?)`,
      )
      .run(
        id,
        input.provider,
        input.displayName,
        input.email,
        input.color ?? null,
        input.imapHost ?? null,
        input.imapPort ?? null,
        input.imapSecure ? 1 : 0,
        input.smtpHost ?? null,
        input.smtpPort ?? null,
        input.smtpSecure ? 1 : 0,
        input.username ?? null,
        ts,
        ts,
      );
    return this.getById(id) as Account;
  }

  update(id: string, patch: UpdateAccountInput): Account {
    const current = this.getById(id);
    if (!current) throw new Error(`Account not found: ${id}`);
    const next: Account = { ...current, ...patch };
    this.db.db
      .prepare(
        `UPDATE accounts SET display_name = ?, email = ?, color = ?,
          imap_host = ?, imap_port = ?, imap_secure = ?,
          smtp_host = ?, smtp_port = ?, smtp_secure = ?,
          username = ?, sync_enabled = ?, is_default_sender = ?,
          auth_status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.displayName,
        next.email,
        next.color,
        next.imapHost,
        next.imapPort,
        next.imapSecure ? 1 : 0,
        next.smtpHost,
        next.smtpPort,
        next.smtpSecure ? 1 : 0,
        next.username,
        next.syncEnabled ? 1 : 0,
        next.isDefaultSender ? 1 : 0,
        next.authStatus,
        nowIso(),
        id,
      );
    return this.getById(id) as Account;
  }

  remove(id: string): void {
    this.db.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  }
}

// ─── Follow-up schedules ─────────────────────────────────────────────────────

type ScheduleRow = {
  id: string;
  name: string;
  stages: string;
  is_default: number;
  created_at: string;
  updated_at: string;
};

function toSchedule(row: ScheduleRow): FollowUpSchedule {
  return {
    id: row.id,
    name: row.name,
    stages: parseJsonNumberArray(row.stages),
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ScheduleRepository {
  constructor(private readonly db: DatabaseService) {}

  list(): FollowUpSchedule[] {
    const rows = this.db.db
      .prepare('SELECT * FROM followup_schedules ORDER BY is_default DESC, created_at ASC')
      .all() as ScheduleRow[];
    return rows.map(toSchedule);
  }

  create(input: { name: string; stages: number[] }): FollowUpSchedule {
    const id = randomUUID();
    const ts = nowIso();
    this.db.db
      .prepare(
        'INSERT INTO followup_schedules(id, name, stages, is_default, created_at, updated_at) VALUES(?, ?, ?, 0, ?, ?)',
      )
      .run(id, input.name, JSON.stringify(input.stages), ts, ts);
    return this.getById(id) as FollowUpSchedule;
  }

  getById(id: string): FollowUpSchedule | null {
    const row = this.db.db.prepare('SELECT * FROM followup_schedules WHERE id = ?').get(id) as
      | ScheduleRow
      | undefined;
    return row ? toSchedule(row) : null;
  }

  update(id: string, patch: Partial<FollowUpSchedule>): FollowUpSchedule {
    const current = this.getById(id);
    if (!current) throw new Error(`Schedule not found: ${id}`);
    const next: FollowUpSchedule = { ...current, ...patch };
    const tx = this.db.db.transaction(() => {
      if (patch.isDefault === true) {
        this.db.db.prepare('UPDATE followup_schedules SET is_default = 0').run();
      }
      this.db.db
        .prepare(
          'UPDATE followup_schedules SET name = ?, stages = ?, is_default = ?, updated_at = ? WHERE id = ?',
        )
        .run(next.name, JSON.stringify(next.stages), next.isDefault ? 1 : 0, nowIso(), id);
    });
    tx();
    return this.getById(id) as FollowUpSchedule;
  }

  remove(id: string): void {
    this.db.db.prepare('DELETE FROM followup_schedules WHERE id = ?').run(id);
  }
}

// ─── Messages & conversations ────────────────────────────────────────────────

type MessageRow = {
  id: string;
  account_id: string;
  conversation_id: string | null;
  folder_id: string | null;
  provider_message_id: string | null;
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  thread_id: string | null;
  subject: string;
  snippet: string;
  body_text: string | null;
  body_html: string | null;
  from_name: string;
  from_address: string;
  to_addresses: string;
  cc_addresses: string;
  bcc_addresses: string;
  sent_at: string;
  received_at: string | null;
  is_read: number;
  is_starred: number;
  is_snoozed: number;
  snoozed_until: string | null;
  has_attachments: number;
  direction: string;
  deleted_at: string | null;
};

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    folderId: row.folder_id,
    providerMessageId: row.provider_message_id,
    messageIdHeader: row.message_id_header,
    inReplyTo: row.in_reply_to,
    referencesHeader: row.references_header,
    threadId: row.thread_id,
    subject: row.subject,
    snippet: row.snippet,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    fromName: row.from_name,
    fromAddress: row.from_address,
    toAddresses: parseJsonArray<string>(row.to_addresses),
    ccAddresses: parseJsonArray<string>(row.cc_addresses),
    bccAddresses: parseJsonArray<string>(row.bcc_addresses),
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    isRead: row.is_read === 1,
    isStarred: row.is_starred === 1,
    isSnoozed: row.is_snoozed === 1,
    snoozedUntil: row.snoozed_until,
    hasAttachments: row.has_attachments === 1,
    direction: row.direction as Message['direction'],
    deletedAt: row.deleted_at,
  };
}

type ConversationRow = {
  id: string;
  account_id: string;
  subject: string;
  participants: string;
  last_message_at: string;
  unread_count: number;
  is_starred: number;
};

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    accountId: row.account_id,
    subject: row.subject,
    participants: parseJsonArray<string>(row.participants),
    lastMessageAt: row.last_message_at,
    unreadCount: row.unread_count,
    isStarred: row.is_starred === 1,
  };
}

export class MessageRepository {
  constructor(private readonly db: DatabaseService) {}

  list(options: MessageListOptions = {}): Message[] {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
    const offset = Math.max(options.offset ?? 0, 0);
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.accountId) {
      where.push('account_id = ?');
      params.push(options.accountId);
    }
    if (options.folderId) {
      where.push('folder_id = ?');
      params.push(options.folderId);
    }
    // Mirror of `matchesFolder()` in src/shared/utils/messages.ts — keep the two
    // in sync (asserted by repositories.folder-parity.test.ts).
    switch (options.folderKind) {
      case 'inbox':
        where.push(
          "direction = 'inbound' AND is_snoozed = 0 AND folder_id IS NULL AND deleted_at IS NULL",
        );
        break;
      case 'sent':
        where.push("direction = 'outbound' AND deleted_at IS NULL");
        break;
      case 'snoozed':
        where.push('is_snoozed = 1 AND deleted_at IS NULL');
        break;
      case 'archive':
        where.push(
          "folder_id IS NOT NULL AND direction = 'inbound' AND deleted_at IS NULL",
        );
        break;
      case 'trash':
        where.push('deleted_at IS NOT NULL');
        break;
      case 'drafts':
        // Drafts are stored in their own table and listed via drafts:list.
        where.push('0 = 1');
        break;
      default:
        where.push('deleted_at IS NULL');
        break;
    }
    const rows = this.db.db
      .prepare(
        `SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY sent_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as MessageRow[];
    return rows.map(toMessage);
  }

  getConversation(id: string): ConversationDetail | null {
    const row = this.db.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | ConversationRow
      | undefined;
    if (!row) return null;
    const messages = this.db.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC')
      .all(id) as MessageRow[];
    return { conversation: toConversation(row), messages: messages.map(toMessage) };
  }

  /**
   * Mark a whole conversation as read in one transaction, so the list and the
   * reading pane can never disagree about unread state (spec §11 Inbox).
   */
  /** Local soft deletion only; provider mail and original folders are untouched. */
  setConversationTrashed(conversationId: string, trashed: boolean): void {
    this.db.db.prepare('UPDATE messages SET deleted_at = ? WHERE conversation_id = ?')
      .run(trashed ? new Date().toISOString() : null, conversationId);
  }

  markConversationRead(conversationId: string): void {
    const now = new Date().toISOString();
    const run = this.db.db.transaction((id: string) => {
      this.db.db
        .prepare('UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND is_read = 0')
        .run(id);
      this.db.db
        .prepare('UPDATE conversations SET unread_count = 0, updated_at = ? WHERE id = ?')
        .run(now, id);
    });
    run(conversationId);
  }
}

// ─── Follow-up sequences ─────────────────────────────────────────────────────

export interface CreateFollowUpOptions {
  /** Stage intervals in days; stage 0 is due after the original send. */
  stages: number[];
  scheduleId: string | null;
  /** Working-day/calendar-day maths and the reminder time of day. */
  useWorkingDays: boolean;
  reminderTime: string;
  /** Reference time; injectable for tests. */
  now?: Date;
}

export class FollowUpRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Starts tracking a conversation (spec §6.1).
   *
   * Rules enforced here:
   * - Only conversations with an outbound message can be tracked; follow-up
   *   means "I wrote and nobody answered".
   * - Idempotent: an existing active sequence is returned unchanged, so a
   *   second click can never create duplicate reminders (spec §17).
   * - The first reminder is due `stages[0]` days after the actual send time of
   *   the most recent outbound message, at the configured reminder time.
   */
  create(conversationId: string, opts: CreateFollowUpOptions): FollowUpListItem | null {
    const conversation = this.db.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(conversationId) as ConversationRow | undefined;
    if (!conversation) return null;

    const existing = this.db.db
      .prepare(
        `SELECT id FROM followup_sequences
         WHERE conversation_id = ? AND status NOT IN ('completed','replied','cancelled')`,
      )
      .get(conversationId) as { id: string } | undefined;
    if (existing) return this.list().find((item) => item.sequence.id === existing.id) ?? null;

    const lastOutbound = this.db.db
      .prepare(
        `SELECT sent_at FROM messages
         WHERE conversation_id = ? AND direction = 'outbound' AND deleted_at IS NULL
         ORDER BY sent_at DESC LIMIT 1`,
      )
      .get(conversationId) as { sent_at: string } | undefined;
    if (!lastOutbound) return null;

    const stages = opts.stages.filter((n) => Number.isFinite(n) && n >= 1);
    if (stages.length === 0) return null;

    const plan = initialSchedule(new Date(lastOutbound.sent_at), stages, {
      useWorkingDays: opts.useWorkingDays,
      reminderTime: opts.reminderTime,
    });
    const id = randomUUID();
    const ts = (opts.now ?? new Date()).toISOString();

    const tx = this.db.db.transaction(() => {
      this.db.db
        .prepare(
          `INSERT INTO followup_sequences
             (id, conversation_id, account_id, schedule_id, current_stage, status,
              last_sent_at, next_due_at, snoozed_until, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          id,
          conversationId,
          conversation.account_id,
          opts.scheduleId,
          plan.currentStage,
          plan.status,
          lastOutbound.sent_at,
          plan.nextDueAt,
          ts,
          ts,
        );
      this.db.db
        .prepare(
          `INSERT INTO followup_events(id, sequence_id, kind, stage_index, note, created_at)
           VALUES (?, ?, 'enabled', 0, ?, ?)`,
        )
        .run(randomUUID(), id, JSON.stringify(stages), ts);
    });
    tx();

    return this.list().find((item) => item.sequence.id === id) ?? null;
  }

  /**
   * Stops tracking a conversation with one click (spec §6.1). The sequence and
   * its history are preserved — only the status changes to `cancelled`.
   */
  disable(conversationId: string): void {
    const active = this.db.db
      .prepare(
        `SELECT id FROM followup_sequences
         WHERE conversation_id = ? AND status NOT IN ('completed','replied','cancelled')`,
      )
      .all(conversationId) as { id: string }[];
    if (active.length === 0) return;
    const ts = nowIso();
    const tx = this.db.db.transaction(() => {
      for (const row of active) {
        this.db.db
          .prepare(
            'UPDATE followup_sequences SET status = ?, next_due_at = NULL, snoozed_until = NULL, updated_at = ? WHERE id = ?',
          )
          .run('cancelled', ts, row.id);
        this.db.db
          .prepare(
            'INSERT INTO followup_events(id, sequence_id, kind, stage_index, created_at) VALUES(?, ?, ?, NULL, ?)',
          )
          .run(randomUUID(), row.id, 'cancelled', ts);
      }
    });
    tx();
  }

  /**
   * Applies a different schedule to one tracked conversation (spec §6.6
   * "Edit schedule"). The pending reminder is recomputed from the actual last
   * send time, so changing a schedule never rewrites history or skips a stage.
   */
  setSchedule(
    sequenceId: string,
    scheduleId: string,
    opts: { useWorkingDays: boolean; reminderTime: string },
  ): FollowUpListItem | null {
    const sequence = this.db.db
      .prepare('SELECT * FROM followup_sequences WHERE id = ?')
      .get(sequenceId) as
      | {
          id: string;
          current_stage: number;
          last_sent_at: string;
          status: FollowUpStatus;
        }
      | undefined;
    if (!sequence) return null;

    const schedule = this.db.db
      .prepare('SELECT id, stages FROM followup_schedules WHERE id = ?')
      .get(scheduleId) as { id: string; stages: string } | undefined;
    if (!schedule) return null;

    const stages = parseJsonNumberArray(schedule.stages).filter(
      (n) => Number.isFinite(n) && n >= 1,
    );
    if (stages.length === 0) return null;

    const ts = nowIso();
    const pendingStage = sequence.current_stage;
    let nextDueAt: string | null = null;
    let status: FollowUpStatus = sequence.status;

    if (pendingStage < stages.length) {
      nextDueAt = computeDueDate(new Date(sequence.last_sent_at), stages[pendingStage], {
        useWorkingDays: opts.useWorkingDays,
        reminderTime: opts.reminderTime,
      }).toISOString();
      // A snoozed or terminal sequence keeps its own state; a live one is
      // re-derived from the new due date.
      if (status === 'scheduled' || status === 'due' || status === 'overdue') {
        status = (deriveTimingStatus(new Date(nextDueAt), new Date()) ?? 'scheduled') as
          | 'scheduled'
          | 'due'
          | 'overdue';
      }
    } else {
      // The new schedule is shorter than the stages already sent: nothing left
      // to remind about, so the sequence waits for a reply.
      nextDueAt = null;
      if (status === 'scheduled' || status === 'due' || status === 'overdue') {
        status = 'waiting';
      }
    }

    const tx = this.db.db.transaction(() => {
      this.db.db
        .prepare(
          `UPDATE followup_sequences
              SET schedule_id = ?, next_due_at = ?, status = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(schedule.id, nextDueAt, status, ts, sequenceId);
      this.db.db
        .prepare(
          `INSERT INTO followup_events(id, sequence_id, kind, stage_index, note, created_at)
           VALUES (?, ?, 'schedule_changed', ?, ?, ?)`,
        )
        .run(randomUUID(), sequenceId, pendingStage, JSON.stringify(stages), ts);
    });
    tx();

    return this.list().find((item) => item.sequence.id === sequenceId) ?? null;
  }

  list(): FollowUpListItem[] {
    const rows = this.db.db
      .prepare(
        `SELECT fs.*, c.subject AS conv_subject, c.participants AS conv_participants,
                c.last_message_at AS conv_last, c.unread_count AS conv_unread,
                c.is_starred AS conv_starred,
                a.id AS acc_id, a.provider AS acc_provider, a.display_name AS acc_name,
                a.email AS acc_email, a.color AS acc_color,
                a.imap_host AS acc_imap_host, a.imap_port AS acc_imap_port,
                a.imap_secure AS acc_imap_secure, a.smtp_host AS acc_smtp_host,
                a.smtp_port AS acc_smtp_port, a.smtp_secure AS acc_smtp_secure,
                a.username AS acc_username, a.sync_enabled AS acc_sync,
                a.is_default_sender AS acc_default, a.auth_status AS acc_auth,
                a.created_at AS acc_created, a.updated_at AS acc_updated,
                s.stages AS schedule_stages
         FROM followup_sequences fs
         JOIN conversations c ON c.id = fs.conversation_id
         JOIN accounts a ON a.id = fs.account_id
         LEFT JOIN followup_schedules s ON s.id = fs.schedule_id
         ORDER BY fs.next_due_at ASC`,
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => {
      const participants = parseJsonArray<string>(r.conv_participants as string);
      const stages = parseJsonNumberArray(r.schedule_stages as string | null);
      const account: Account = {
        id: r.acc_id as string,
        provider: r.acc_provider as Account['provider'],
        displayName: r.acc_name as string,
        email: r.acc_email as string,
        color: (r.acc_color as string | null) ?? null,
        imapHost: (r.acc_imap_host as string | null) ?? null,
        imapPort: (r.acc_imap_port as number | null) ?? null,
        imapSecure: r.acc_imap_secure === 1,
        smtpHost: (r.acc_smtp_host as string | null) ?? null,
        smtpPort: (r.acc_smtp_port as number | null) ?? null,
        smtpSecure: r.acc_smtp_secure === 1,
        username: (r.acc_username as string | null) ?? null,
        syncEnabled: r.acc_sync === 1,
        isDefaultSender: r.acc_default === 1,
        authStatus: r.acc_auth as Account['authStatus'],
        createdAt: r.acc_created as string,
        updatedAt: r.acc_updated as string,
      };
      const conversation: Conversation = {
        id: r.conversation_id as string,
        accountId: r.account_id as string,
        subject: r.conv_subject as string,
        participants,
        lastMessageAt: r.conv_last as string,
        unreadCount: (r.conv_unread as number) ?? 0,
        isStarred: r.conv_starred === 1,
      };
      const recipient =
        participants.find((p) => p.toLowerCase() !== account.email.toLowerCase()) ??
        participants[0] ??
        '';
      return {
        sequence: {
          id: r.id as string,
          conversationId: r.conversation_id as string,
          accountId: r.account_id as string,
          scheduleId: (r.schedule_id as string | null) ?? null,
          currentStage: r.current_stage as number,
          status: r.status as FollowUpStatus,
          lastSentAt: r.last_sent_at as string,
          nextDueAt: (r.next_due_at as string | null) ?? null,
          snoozedUntil: (r.snoozed_until as string | null) ?? null,
          createdAt: r.created_at as string,
          updatedAt: r.updated_at as string,
        },
        conversation,
        account,
        recipient,
        subject: r.conv_subject as string,
        lastSentAt: r.last_sent_at as string,
        nextDueAt: (r.next_due_at as string | null) ?? null,
        currentStage: r.current_stage as number,
        stageCount: stages.length,
        status: r.status as FollowUpStatus,
      };
    });
  }

  updateStatus(id: string, status: FollowUpStatus, snoozeDays?: number): void {
    const terminal = status === 'completed' || status === 'replied' || status === 'cancelled';
    const snoozedUntil = status === 'snoozed' ? snoozeUntil(snoozeDays ?? 3) : null;
    const eventKind =
      status === 'snoozed'
        ? 'snoozed'
        : status === 'completed'
          ? 'completed'
          : status === 'cancelled'
            ? 'cancelled'
            : status === 'replied'
              ? 'replied'
              : 'schedule_changed';
    const tx = this.db.db.transaction(() => {
      // A terminal sequence must never look due again: its pending reminder is
      // cleared, while the row and its event history are preserved (§6.5).
      // Non-terminal changes (e.g. snooze) keep the stored due date.
      this.db.db
        .prepare(
          `UPDATE followup_sequences
              SET status = ?,
                  snoozed_until = ?,
                  next_due_at = CASE WHEN ? = 1 THEN NULL ELSE next_due_at END,
                  updated_at = ?
            WHERE id = ?`,
        )
        .run(status, snoozedUntil, terminal ? 1 : 0, nowIso(), id);
      this.db.db
        .prepare(
          'INSERT INTO followup_events(id, sequence_id, kind, stage_index, created_at) VALUES(?, ?, ?, NULL, ?)',
        )
        .run(randomUUID(), id, eventKind, nowIso());
    });
    tx();
  }
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

type DraftRow = {
  id: string;
  account_id: string | null;
  to_addresses: string;
  cc_addresses: string;
  bcc_addresses: string;
  subject: string;
  body: string;
  follow_up_enabled: number;
  follow_up_interval_days: number | null;
  in_reply_to_conversation_id: string | null;
  created_at: string;
  updated_at: string;
};

function toDraft(row: DraftRow): Draft {
  return {
    id: row.id,
    accountId: row.account_id,
    toAddresses: parseJsonArray<string>(row.to_addresses),
    ccAddresses: parseJsonArray<string>(row.cc_addresses),
    bccAddresses: parseJsonArray<string>(row.bcc_addresses),
    subject: row.subject,
    body: row.body,
    followUpEnabled: row.follow_up_enabled === 1,
    followUpIntervalDays: row.follow_up_interval_days,
    inReplyToConversationId: row.in_reply_to_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DraftRepository {
  constructor(private readonly db: DatabaseService) {}

  list(): Draft[] {
    const rows = this.db.db
      .prepare('SELECT * FROM drafts ORDER BY updated_at DESC')
      .all() as DraftRow[];
    return rows.map(toDraft);
  }

  save(input: SaveDraftInput): Draft {
    const id = input.id ?? randomUUID();
    const existing = this.db.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as
      | DraftRow
      | undefined;
    const ts = nowIso();
    if (existing) {
      const current = toDraft(existing);
      const next: Draft = { ...current, ...input, id, updatedAt: ts };
      this.write(next);
      return next;
    }
    const draft: Draft = {
      id,
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
    this.write(draft);
    return draft;
  }

  private write(draft: Draft): void {
    this.db.db
      .prepare(
        `INSERT INTO drafts (id, account_id, to_addresses, cc_addresses, bcc_addresses,
          subject, body, follow_up_enabled, follow_up_interval_days,
          in_reply_to_conversation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id,
           to_addresses = excluded.to_addresses, cc_addresses = excluded.cc_addresses,
           bcc_addresses = excluded.bcc_addresses, subject = excluded.subject,
           body = excluded.body, follow_up_enabled = excluded.follow_up_enabled,
           follow_up_interval_days = excluded.follow_up_interval_days,
           in_reply_to_conversation_id = excluded.in_reply_to_conversation_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        draft.id,
        draft.accountId,
        JSON.stringify(draft.toAddresses),
        JSON.stringify(draft.ccAddresses),
        JSON.stringify(draft.bccAddresses),
        draft.subject,
        draft.body,
        draft.followUpEnabled ? 1 : 0,
        draft.followUpIntervalDays,
        draft.inReplyToConversationId,
        draft.createdAt,
        draft.updatedAt,
      );
  }

  remove(id: string): void {
    this.db.db.prepare('DELETE FROM drafts WHERE id = ?').run(id);
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────

export class NotificationRepository {
  constructor(private readonly db: DatabaseService) {}

  private static readonly SELECT = `
    SELECT id, kind, title, body, conversation_id, sequence_id, stage_index,
           is_read, due_at, deliver_at, delivered_at, dedupe_key, created_at
    FROM notifications`;

  private mapRow(r: Record<string, unknown>): NotificationItem {
    return {
      id: r.id as string,
      kind: r.kind as NotificationItem['kind'],
      title: r.title as string,
      body: (r.body as string) ?? '',
      conversationId: (r.conversation_id as string | null) ?? null,
      sequenceId: (r.sequence_id as string | null) ?? null,
      stageIndex: (r.stage_index as number | null) ?? null,
      isRead: r.is_read === 1,
      dueAt: (r.due_at as string | null) ?? null,
      deliverAt: (r.deliver_at as string | null) ?? null,
      deliveredAt: (r.delivered_at as string | null) ?? null,
      dedupeKey: (r.dedupe_key as string | null) ?? null,
      createdAt: r.created_at as string,
    };
  }

  /**
   * Active sequences whose stored `next_due_at` is at or before `now`.
   *
   * Cancelled, completed and replied sequences are excluded, and so is anything
   * snoozed into the future. Reading timestamps rather than trusting a timer is
   * what lets a reminder raised while the app was closed still appear.
   */
  private dueSequences(now: Date): DueSequence[] {
    const rows = this.db.db
      .prepare(
        `SELECT fs.id AS sequence_id, fs.conversation_id, fs.current_stage, fs.next_due_at,
                c.subject, c.participants, a.email AS account_email, s.stages AS schedule_stages
         FROM followup_sequences fs
         JOIN conversations c ON c.id = fs.conversation_id
         JOIN accounts a ON a.id = fs.account_id
         LEFT JOIN followup_schedules s ON s.id = fs.schedule_id
         WHERE fs.status NOT IN ('cancelled','completed','replied','snoozed')
           AND fs.next_due_at IS NOT NULL
           AND fs.next_due_at <= ?
         ORDER BY fs.next_due_at ASC`,
      )
      .all(now.toISOString()) as Record<string, unknown>[];

    return rows.map((r) => {
      const participants = parseJsonArray<string>(r.participants as string);
      const accountEmail = (r.account_email as string) ?? '';
      const stages = parseJsonNumberArray(r.schedule_stages as string | null);
      return {
        sequenceId: r.sequence_id as string,
        conversationId: r.conversation_id as string,
        currentStage: (r.current_stage as number) ?? 0,
        totalStages: stages.length,
        nextDueAt: r.next_due_at as string,
        subject: (r.subject as string) ?? '',
        recipient:
          participants.find((p) => p.toLowerCase() !== accountEmail.toLowerCase()) ??
          participants[0] ??
          '',
      };
    });
  }

  /**
   * Re-derives due reminders and persists any occurrence not seen before.
   *
   * Idempotent: `dedupe_key` has a unique index, so the same stage of the same
   * sequence is inserted once no matter how many times this runs. Returns only
   * the rows that are ready to be surfaced now (past their `deliver_at`).
   */
  scan(now: Date, opts: ReminderOptions): NotificationItem[] {
    const plans = planReminders(this.dueSequences(now), now, opts);
    if (plans.length === 0) return this.readyToDeliver(now);

    const insert = this.db.db.prepare(
      `INSERT OR IGNORE INTO notifications
         (id, kind, title, body, conversation_id, sequence_id, stage_index,
          is_read, due_at, deliver_at, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    );
    const createdAt = now.toISOString();

    const insertAll = this.db.db.transaction(() => {
      for (const plan of plans) {
        insert.run(
          randomUUID(),
          plan.kind,
          plan.title,
          plan.body,
          plan.conversationId,
          plan.sequenceId,
          plan.stageIndex,
          plan.dueAt,
          plan.deliverAt,
          plan.dedupeKey,
          createdAt,
        );
      }
    });
    insertAll();

    return this.readyToDeliver(now);
  }

  /** Undelivered notifications whose delivery time has arrived. */
  readyToDeliver(now: Date): NotificationItem[] {
    const rows = this.db.db
      .prepare(
        `${NotificationRepository.SELECT}
         WHERE delivered_at IS NULL AND (deliver_at IS NULL OR deliver_at <= ?)
         ORDER BY due_at ASC`,
      )
      .all(now.toISOString()) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  markDelivered(ids: string[], at: Date): void {
    if (ids.length === 0) return;
    const stamp = at.toISOString();
    const stmt = this.db.db.prepare(
      'UPDATE notifications SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL',
    );
    const markAll = this.db.db.transaction(() => {
      for (const id of ids) stmt.run(stamp, id);
    });
    markAll();
  }

  list(limit = 50): NotificationItem[] {
    const rows = this.db.db
      .prepare(`${NotificationRepository.SELECT} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(Math.max(1, Math.min(200, Math.floor(limit)))) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  unreadCount(): number {
    const row = this.db.db
      .prepare('SELECT COUNT(*) AS n FROM notifications WHERE is_read = 0')
      .get() as { n: number };
    return row.n;
  }

  markRead(id: string): void {
    this.db.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  }

  markAllRead(): void {
    this.db.db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
  }

  /** Removes a notification. Raised reminders for still-due stages come back on the next scan. */
  remove(id: string): void {
    this.db.db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
  }

  /**
   * Drops every reminder for a conversation — used when tracking is turned off,
   * so a cancelled sequence cannot leave stale reminders in the bell.
   */
  removeForConversation(conversationId: string): void {
    this.db.db.prepare('DELETE FROM notifications WHERE conversation_id = ?').run(conversationId);
  }

  /**
   * Drops reminders that have not been shown yet, so they are re-derived
   * against a changed schedule. Already-delivered reminders are kept: a banner
   * the user has seen is history, not something to repeat.
   */
  removePendingForSequence(sequenceId: string): void {
    this.db.db
      .prepare('DELETE FROM notifications WHERE sequence_id = ? AND delivered_at IS NULL')
      .run(sequenceId);
  }
}
