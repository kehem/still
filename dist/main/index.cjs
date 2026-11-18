"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main/index.ts
var import_node_path2 = __toESM(require("node:path"));
var import_node_url = require("node:url");
var import_electron4 = require("electron");

// src/main/database/db.ts
var import_better_sqlite3 = __toESM(require("better-sqlite3"));
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_node_crypto = require("node:crypto");
var import_electron = require("electron");

// src/main/database/migrations.ts
var MIGRATIONS = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'imap')),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  color TEXT,
  imap_host TEXT,
  imap_port INTEGER,
  imap_secure INTEGER NOT NULL DEFAULT 1,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_secure INTEGER NOT NULL DEFAULT 1,
  username TEXT,
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  is_default_sender INTEGER NOT NULL DEFAULT 0,
  auth_status TEXT NOT NULL DEFAULT 'connected',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Credentials are stored encrypted with the OS keychain (safeStorage).
CREATE TABLE IF NOT EXISTS credentials (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  PRIMARY KEY (account_id, kind)
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL DEFAULT '[]',
  last_message_at TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_account_last
  ON conversations(account_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  message_id_header TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  thread_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT,
  body_html TEXT,
  from_name TEXT NOT NULL DEFAULT '',
  from_address TEXT NOT NULL DEFAULT '',
  to_addresses TEXT NOT NULL DEFAULT '[]',
  cc_addresses TEXT NOT NULL DEFAULT '[]',
  bcc_addresses TEXT NOT NULL DEFAULT '[]',
  sent_at TEXT NOT NULL,
  received_at TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  is_snoozed INTEGER NOT NULL DEFAULT 0,
  snoozed_until TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT 'inbound',
  deleted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_account_sent ON messages(account_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id_header);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedupe
  ON messages(account_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  to_addresses TEXT NOT NULL DEFAULT '[]',
  cc_addresses TEXT NOT NULL DEFAULT '[]',
  bcc_addresses TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  follow_up_enabled INTEGER NOT NULL DEFAULT 0,
  follow_up_interval_days INTEGER,
  in_reply_to_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  provider_draft_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS followup_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stages TEXT NOT NULL DEFAULT '[3,7,15,30]',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS followup_sequences (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  schedule_id TEXT REFERENCES followup_schedules(id) ON DELETE SET NULL,
  current_stage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'scheduled',
  last_sent_at TEXT NOT NULL,
  next_due_at TEXT,
  snoozed_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followup_status_due ON followup_sequences(status, next_due_at);

CREATE TABLE IF NOT EXISTS followup_events (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES followup_sequences(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  stage_index INTEGER,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id TEXT,
  last_sync_at TEXT,
  cursor TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT
);

-- Full-text search over local messages (SQLite FTS5, spec \xA712).
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  subject, body, sender,
  content='messages', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, body, sender)
  VALUES (new.rowid, new.subject, COALESCE(new.body_text, ''), new.from_name || ' ' || new.from_address);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, body, sender)
  VALUES ('delete', old.rowid, old.subject, COALESCE(old.body_text, ''), old.from_name || ' ' || old.from_address);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, body, sender)
  VALUES ('delete', old.rowid, old.subject, COALESCE(old.body_text, ''), old.from_name || ' ' || old.from_address);
  INSERT INTO messages_fts(rowid, subject, body, sender)
  VALUES (new.rowid, new.subject, COALESCE(new.body_text, ''), new.from_name || ' ' || new.from_address);
END;
`
  },
  {
    version: 2,
    name: "notifications_reminder_engine",
    // Reminders must survive the app being closed and must never be raised
    // twice for the same occurrence (spec §6.7, §17). That needs a link to the
    // sequence and stage, the due time, a dedupe key, and delivery state.
    sql: `
ALTER TABLE notifications ADD COLUMN sequence_id TEXT
  REFERENCES followup_sequences(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN stage_index INTEGER;
ALTER TABLE notifications ADD COLUMN due_at TEXT;
ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;
ALTER TABLE notifications ADD COLUMN deliver_at TEXT;
ALTER TABLE notifications ADD COLUMN delivered_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_pending
  ON notifications(delivered_at, deliver_at);
CREATE INDEX IF NOT EXISTS idx_notifications_sequence
  ON notifications(sequence_id);
`
  }
];

// src/shared/constants.ts
var DEFAULT_FOLLOWUP_STAGES = [3, 7, 15, 30];
var MIN_FOLLOWUP_INTERVAL_DAYS = 1;
var MAX_FOLLOWUP_INTERVAL_DAYS = 365;
var DEFAULT_SETTINGS = {
  language: "en",
  startupBehavior: "restore",
  defaultOpeningPage: "last-used",
  defaultInboxId: "all",
  rememberLastInbox: true,
  defaultSendingAccountId: null,
  dateFormat: "auto",
  timeFormat: "auto",
  confirmBeforeDelete: true,
  confirmBeforeSend: false,
  theme: "system",
  fontSize: "medium",
  density: "comfortable",
  sidebarVisible: true,
  accentColor: "#3E6FA3",
  messageListLayout: "detailed",
  readingPaneLayout: "single",
  unifiedInboxEnabled: true,
  groupByAccount: false,
  sortOrder: "newest",
  showPreview: true,
  markAsReadOnOpen: true,
  refreshIntervalMinutes: 5,
  conversationGrouping: true,
  followUpEnabledByDefault: false,
  defaultScheduleId: null,
  maxStages: 6,
  reminderTime: "09:00",
  useWorkingDays: false,
  weekendBehavior: "skip",
  autoCompleteOnReply: true,
  autoReplyHandling: "ignore",
  snoozeDefaultDays: 3,
  overdueReminderRepeatHours: 24,
  desktopNotifications: true,
  followUpNotifications: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  notificationSound: false,
  notificationFrequency: "immediate",
  defaultSignature: "",
  richTextEnabled: true,
  replyBehavior: "reply",
  ccOnReplyAll: true,
  appLockEnabled: false,
  databaseEncryption: false,
  blockRemoteImages: true,
  externalContent: "blocked",
  aiEnabled: false,
  aiProvider: null,
  dataRetentionDays: 0,
  syncOnStartup: true,
  attachmentStoragePath: null
};

// src/main/database/db.ts
var DatabaseService = class {
  db;
  dbPath;
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new import_better_sqlite3.default(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");
    this.runMigrations();
    this.seedDefaults();
  }
  runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      this.db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version)
    );
    const apply = this.db.transaction((version, name, sql) => {
      this.db.exec(sql);
      this.db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)").run(version, name, (/* @__PURE__ */ new Date()).toISOString());
    });
    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.version)) {
        apply(migration.version, migration.name, migration.sql);
      }
    }
  }
  seedDefaults() {
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM followup_schedules").get();
    if (count.n === 0) {
      const ts = (/* @__PURE__ */ new Date()).toISOString();
      this.db.prepare(
        "INSERT INTO followup_schedules(id, name, stages, is_default, created_at, updated_at) VALUES(?, ?, ?, 1, ?, ?)"
      ).run((0, import_node_crypto.randomUUID)(), "Default", JSON.stringify(DEFAULT_FOLLOWUP_STAGES), ts, ts);
    }
  }
  close() {
    this.db.close();
  }
};
function getDefaultDbPath() {
  return import_node_path.default.join(import_electron.app.getPath("userData"), "still.db");
}
function openDatabaseWithRecovery(dbPath) {
  try {
    import_node_fs.default.mkdirSync(import_node_path.default.dirname(dbPath), { recursive: true });
    return { service: new DatabaseService(dbPath), recovered: false, quarantined: [], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const quarantined = [];
    for (const suffix of ["", "-wal", "-shm"]) {
      const candidate = dbPath + suffix;
      if (import_node_fs.default.existsSync(candidate)) {
        const target = `${candidate}.corrupt-${stamp}`;
        try {
          import_node_fs.default.renameSync(candidate, target);
          quarantined.push(target);
        } catch {
        }
      }
    }
    return {
      service: new DatabaseService(dbPath),
      recovered: true,
      quarantined,
      error: message
    };
  }
}

// src/main/database/repositories.ts
var import_node_crypto2 = require("node:crypto");

// src/shared/utils/dates.ts
function addCalendarDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function addWorkingDays(d, days) {
  let x = new Date(d);
  let remaining = days;
  while (remaining > 0) {
    x = addCalendarDays(x, 1);
    const day = x.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return x;
}

// src/shared/followup/scheduler.ts
function computeDueDate(lastSentAt, intervalDays, opts) {
  const base = opts.useWorkingDays ? addWorkingDays(lastSentAt, intervalDays) : addCalendarDays(lastSentAt, intervalDays);
  const [h, m] = opts.reminderTime.split(":").map((v) => Number.parseInt(v, 10));
  const due = new Date(base);
  due.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  return due;
}
function deriveTimingStatus(nextDueAt, now) {
  if (!nextDueAt) return null;
  if (now.getTime() < nextDueAt.getTime()) return "scheduled";
  const overdueAt = addCalendarDays(nextDueAt, 1);
  return now.getTime() >= overdueAt.getTime() ? "overdue" : "due";
}
function initialSchedule(sentAt, stages, opts) {
  if (stages.length === 0) {
    return { currentStage: 0, nextDueAt: null, status: "waiting" };
  }
  return {
    currentStage: 0,
    nextDueAt: computeDueDate(sentAt, stages[0], opts).toISOString(),
    status: "scheduled"
  };
}
function snoozeUntil(days, now = /* @__PURE__ */ new Date()) {
  return addCalendarDays(now, days).toISOString();
}

// src/shared/notifications/quiethours.ts
function parseHHmm(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}
function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}
function isWithinQuietHours(at, quiet) {
  if (!quiet.enabled) return false;
  const start = parseHHmm(quiet.start);
  const end = parseHHmm(quiet.end);
  if (!start || !end) return false;
  const startMin = start.hours * 60 + start.minutes;
  const endMin = end.hours * 60 + end.minutes;
  if (startMin === endMin) return false;
  const now = minutesOfDay(at);
  return startMin < endMin ? now >= startMin && now < endMin : now >= startMin || now < endMin;
}
function nextAllowedTime(at, quiet) {
  if (!isWithinQuietHours(at, quiet)) return at;
  const end = parseHHmm(quiet.end);
  if (!end) return at;
  const result = new Date(at);
  result.setHours(end.hours, end.minutes, 0, 0);
  if (result.getTime() <= at.getTime()) result.setDate(result.getDate() + 1);
  return result;
}

// src/shared/notifications/reminder-engine.ts
var HOUR_MS = 60 * 60 * 1e3;
function parseISO(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function parseHHmm2(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}
function repeatRound(dueAt, now, repeatHours) {
  if (!Number.isFinite(repeatHours) || repeatHours <= 0) return 0;
  const elapsedMs = now.getTime() - dueAt.getTime();
  if (elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / (repeatHours * HOUR_MS));
}
function batchTime(occurrence, frequency, reminderTime) {
  if (frequency === "immediate") return occurrence;
  if (frequency === "hourly") {
    const top = new Date(occurrence);
    top.setMinutes(0, 0, 0);
    if (top.getTime() <= occurrence.getTime()) top.setTime(top.getTime() + HOUR_MS);
    return top;
  }
  const time = parseHHmm2(reminderTime);
  if (!time) return occurrence;
  const target = new Date(occurrence);
  target.setHours(time.hours, time.minutes, 0, 0);
  if (target.getTime() <= occurrence.getTime()) target.setDate(target.getDate() + 1);
  return target;
}
function deliveryTime(occurrence, opts) {
  const batched = batchTime(occurrence, opts.frequency, opts.reminderTime);
  return nextAllowedTime(batched, opts.quietHours);
}
function isOverdue(dueAt, now) {
  return now.getTime() >= addCalendarDays(dueAt, 1).getTime();
}
function describeRecipient(recipient) {
  const trimmed = recipient.trim();
  return trimmed.length > 0 ? trimmed : "this conversation";
}
function planReminders(rows, now, opts) {
  const plans = [];
  for (const row of rows) {
    const dueAt = parseISO(row.nextDueAt);
    if (!dueAt) continue;
    if (now.getTime() < dueAt.getTime()) continue;
    const round = repeatRound(dueAt, now, opts.overdueRepeatHours);
    const occurrence = new Date(dueAt.getTime() + round * opts.overdueRepeatHours * HOUR_MS);
    const overdue = isOverdue(dueAt, now);
    const stage = row.currentStage + 1;
    const title = overdue ? "Follow-up overdue" : "Follow-up due";
    const body = `Stage ${stage} of ${Math.max(row.totalStages, stage)} \xB7 ${describeRecipient(row.recipient)}` + (row.subject.trim().length > 0 ? ` \xB7 \u201C${row.subject.trim()}\u201D` : "");
    plans.push({
      sequenceId: row.sequenceId,
      conversationId: row.conversationId,
      stageIndex: row.currentStage,
      kind: overdue ? "followup_overdue" : "followup_due",
      title,
      body,
      dedupeKey: round === 0 ? `followup:${row.sequenceId}:stage:${row.currentStage}` : `followup:${row.sequenceId}:stage:${row.currentStage}:repeat:${round}`,
      dueAt: dueAt.toISOString(),
      deliverAt: deliveryTime(occurrence, opts).toISOString()
    });
  }
  return plans;
}

// src/main/database/repositories.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function parseJsonNumberArray(value) {
  return parseJsonArray(value).filter((n) => typeof n === "number");
}
var SettingsRepository = class {
  constructor(db2) {
    this.db = db2;
  }
  getAll() {
    const rows = this.db.db.prepare("SELECT key, value FROM settings").all();
    const stored = {};
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value);
      } catch {
      }
    }
    return { ...DEFAULT_SETTINGS, ...stored };
  }
  update(patch) {
    const stmt = this.db.db.prepare(
      "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    const tx = this.db.db.transaction((entries) => {
      for (const [key, value] of entries) stmt.run(key, value);
    });
    tx(Object.entries(patch).map(([k, v]) => [k, JSON.stringify(v)]));
    return this.getAll();
  }
};
function toAccount(row) {
  return {
    id: row.id,
    provider: row.provider,
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
    authStatus: row.auth_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
var AccountRepository = class {
  constructor(db2) {
    this.db = db2;
  }
  list() {
    const rows = this.db.db.prepare("SELECT * FROM accounts ORDER BY created_at ASC").all();
    return rows.map(toAccount);
  }
  getById(id) {
    const row = this.db.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
    return row ? toAccount(row) : null;
  }
  create(input) {
    const id = (0, import_node_crypto2.randomUUID)();
    const ts = nowIso();
    this.db.db.prepare(
      `INSERT INTO accounts (id, provider, display_name, email, color,
          imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
          username, sync_enabled, is_default_sender, auth_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'connected', ?, ?)`
    ).run(
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
      ts
    );
    return this.getById(id);
  }
  update(id, patch) {
    const current = this.getById(id);
    if (!current) throw new Error(`Account not found: ${id}`);
    const next = { ...current, ...patch };
    this.db.db.prepare(
      `UPDATE accounts SET display_name = ?, email = ?, color = ?,
          imap_host = ?, imap_port = ?, imap_secure = ?,
          smtp_host = ?, smtp_port = ?, smtp_secure = ?,
          username = ?, sync_enabled = ?, is_default_sender = ?,
          auth_status = ?, updated_at = ? WHERE id = ?`
    ).run(
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
      id
    );
    return this.getById(id);
  }
  remove(id) {
    this.db.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  }
};
function toSchedule(row) {
  return {
    id: row.id,
    name: row.name,
    stages: parseJsonNumberArray(row.stages),
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
var ScheduleRepository = class {
  constructor(db2) {
    this.db = db2;
  }
  list() {
    const rows = this.db.db.prepare("SELECT * FROM followup_schedules ORDER BY is_default DESC, created_at ASC").all();
    return rows.map(toSchedule);
  }
  create(input) {
    const id = (0, import_node_crypto2.randomUUID)();
    const ts = nowIso();
    this.db.db.prepare(
      "INSERT INTO followup_schedules(id, name, stages, is_default, created_at, updated_at) VALUES(?, ?, ?, 0, ?, ?)"
    ).run(id, input.name, JSON.stringify(input.stages), ts, ts);
    return this.getById(id);
  }
  getById(id) {
    const row = this.db.db.prepare("SELECT * FROM followup_schedules WHERE id = ?").get(id);
    return row ? toSchedule(row) : null;
  }
  update(id, patch) {
    const current = this.getById(id);
    if (!current) throw new Error(`Schedule not found: ${id}`);
    const next = { ...current, ...patch };
    const tx = this.db.db.transaction(() => {
      if (patch.isDefault === true) {
        this.db.db.prepare("UPDATE followup_schedules SET is_default = 0").run();
      }
      this.db.db.prepare(
        "UPDATE followup_schedules SET name = ?, stages = ?, is_default = ?, updated_at = ? WHERE id = ?"
      ).run(next.name, JSON.stringify(next.stages), next.isDefault ? 1 : 0, nowIso(), id);
    });
    tx();
    return this.getById(id);
  }
  remove(id) {
    this.db.db.prepare("DELETE FROM followup_schedules WHERE id = ?").run(id);
  }
};
function toMessage(row) {
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
    toAddresses: parseJsonArray(row.to_addresses),
    ccAddresses: parseJsonArray(row.cc_addresses),
    bccAddresses: parseJsonArray(row.bcc_addresses),
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    isRead: row.is_read === 1,
    isStarred: row.is_starred === 1,
    isSnoozed: row.is_snoozed === 1,
    snoozedUntil: row.snoozed_until,
    hasAttachments: row.has_attachments === 1,
    direction: row.direction,
    deletedAt: row.deleted_at
  };
}
function toConversation(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    subject: row.subject,
    participants: parseJsonArray(row.participants),
    lastMessageAt: row.last_message_at,
    unreadCount: row.unread_count,
    isStarred: row.is_starred === 1
  };
}
var MessageRepository = class {
  constructor(db2) {
    this.db = db2;
  }
  list(options = {}) {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1e3);
    const offset = Math.max(options.offset ?? 0, 0);
    const where = [];
    const params = [];
    if (options.accountId) {
      where.push("account_id = ?");
      params.push(options.accountId);
    }
    if (options.folderId) {
      where.push("folder_id = ?");
      params.push(options.folderId);
    }
    switch (options.folderKind) {
      case "inbox":
        where.push(
          "direction = 'inbound' AND is_snoozed = 0 AND folder_id IS NULL AND deleted_at IS NULL"
        );
        break;
      case "sent":
        where.push("direction = 'outbound' AND deleted_at IS NULL");
        break;
      case "snoozed":
        where.push("is_snoozed = 1 AND deleted_at IS NULL");
        break;
      case "archive":
        where.push(
          "folder_id IS NOT NULL AND direction = 'inbound' AND deleted_at IS NULL"
        );
        break;
      case "trash":
        where.push("deleted_at IS NOT NULL");
        break;
      case "drafts":
        where.push("0 = 1");
        break;
      default:
        where.push("deleted_at IS NULL");
        break;
    }
    const rows = this.db.db.prepare(
      `SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY sent_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    return rows.map(toMessage);
  }
  getConversation(id) {
    const row = this.db.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    if (!row) return null;
    const messages = this.db.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC").all(id);
    return { conversation: toConversation(row), messages: messages.map(toMessage) };
  }
  /**
   * Mark a whole conversation as read in one transaction, so the list and the
   * reading pane can never disagree about unread state (spec §11 Inbox).
   */
  markConversationRead(conversationId) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const run = this.db.db.transaction((id) => {
      this.db.db.prepare("UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND is_read = 0").run(id);
      this.db.db.prepare("UPDATE conversations SET unread_count = 0, updated_at = ? WHERE id = ?").run(now, id);
    });
    run(conversationId);
  }
};
var FollowUpRepository = class {
  constructor(db2) {
    this.db = db2;
  }
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
  create(conversationId, opts) {
    const conversation = this.db.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
    if (!conversation) return null;
    const existing = this.db.db.prepare(
      `SELECT id FROM followup_sequences
         WHERE conversation_id = ? AND status NOT IN ('completed','replied','cancelled')`
    ).get(conversationId);
    if (existing) return this.list().find((item) => item.sequence.id === existing.id) ?? null;
    const lastOutbound = this.db.db.prepare(
      `SELECT sent_at FROM messages
         WHERE conversation_id = ? AND direction = 'outbound' AND deleted_at IS NULL
         ORDER BY sent_at DESC LIMIT 1`
    ).get(conversationId);
    if (!lastOutbound) return null;
    const stages = opts.stages.filter((n) => Number.isFinite(n) && n >= 1);
    if (stages.length === 0) return null;
    const plan = initialSchedule(new Date(lastOutbound.sent_at), stages, {
      useWorkingDays: opts.useWorkingDays,
      reminderTime: opts.reminderTime
    });
    const id = (0, import_node_crypto2.randomUUID)();
    const ts = (opts.now ?? /* @__PURE__ */ new Date()).toISOString();
    const tx = this.db.db.transaction(() => {
      this.db.db.prepare(
        `INSERT INTO followup_sequences
             (id, conversation_id, account_id, schedule_id, current_stage, status,
              last_sent_at, next_due_at, snoozed_until, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      ).run(
        id,
        conversationId,
        conversation.account_id,
        opts.scheduleId,
        plan.currentStage,
        plan.status,
        lastOutbound.sent_at,
        plan.nextDueAt,
        ts,
        ts
      );
      this.db.db.prepare(
        `INSERT INTO followup_events(id, sequence_id, kind, stage_index, note, created_at)
           VALUES (?, ?, 'enabled', 0, ?, ?)`
      ).run((0, import_node_crypto2.randomUUID)(), id, JSON.stringify(stages), ts);
    });
    tx();
    return this.list().find((item) => item.sequence.id === id) ?? null;
  }
  /**
   * Stops tracking a conversation with one click (spec §6.1). The sequence and
   * its history are preserved — only the status changes to `cancelled`.
   */
  disable(conversationId) {
    const active = this.db.db.prepare(
      `SELECT id FROM followup_sequences
         WHERE conversation_id = ? AND status NOT IN ('completed','replied','cancelled')`
    ).all(conversationId);
    if (active.length === 0) return;
    const ts = nowIso();
    const tx = this.db.db.transaction(() => {
      for (const row of active) {
        this.db.db.prepare(
          "UPDATE followup_sequences SET status = ?, next_due_at = NULL, snoozed_until = NULL, updated_at = ? WHERE id = ?"
        ).run("cancelled", ts, row.id);
        this.db.db.prepare(
          "INSERT INTO followup_events(id, sequence_id, kind, stage_index, created_at) VALUES(?, ?, ?, NULL, ?)"
        ).run((0, import_node_crypto2.randomUUID)(), row.id, "cancelled", ts);
      }
    });
    tx();
  }
  /**
   * Applies a different schedule to one tracked conversation (spec §6.6
   * "Edit schedule"). The pending reminder is recomputed from the actual last
   * send time, so changing a schedule never rewrites history or skips a stage.
   */
  setSchedule(sequenceId, scheduleId, opts) {
    const sequence = this.db.db.prepare("SELECT * FROM followup_sequences WHERE id = ?").get(sequenceId);
    if (!sequence) return null;
    const schedule = this.db.db.prepare("SELECT id, stages FROM followup_schedules WHERE id = ?").get(scheduleId);
    if (!schedule) return null;
    const stages = parseJsonNumberArray(schedule.stages).filter(
      (n) => Number.isFinite(n) && n >= 1
    );
    if (stages.length === 0) return null;
    const ts = nowIso();
    const pendingStage = sequence.current_stage;
    let nextDueAt = null;
    let status = sequence.status;
    if (pendingStage < stages.length) {
      nextDueAt = computeDueDate(new Date(sequence.last_sent_at), stages[pendingStage], {
        useWorkingDays: opts.useWorkingDays,
        reminderTime: opts.reminderTime
      }).toISOString();
      if (status === "scheduled" || status === "due" || status === "overdue") {
        status = deriveTimingStatus(new Date(nextDueAt), /* @__PURE__ */ new Date()) ?? "scheduled";
      }
    } else {
      nextDueAt = null;
      if (status === "scheduled" || status === "due" || status === "overdue") {
        status = "waiting";
      }
    }
    const tx = this.db.db.transaction(() => {
      this.db.db.prepare(
        `UPDATE followup_sequences
              SET schedule_id = ?, next_due_at = ?, status = ?, updated_at = ?
            WHERE id = ?`
      ).run(schedule.id, nextDueAt, status, ts, sequenceId);
      this.db.db.prepare(
        `INSERT INTO followup_events(id, sequence_id, kind, stage_index, note, created_at)
           VALUES (?, ?, 'schedule_changed', ?, ?, ?)`
      ).run((0, import_node_crypto2.randomUUID)(), sequenceId, pendingStage, JSON.stringify(stages), ts);
    });
    tx();
    return this.list().find((item) => item.sequence.id === sequenceId) ?? null;
  }
  list() {
    const rows = this.db.db.prepare(
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
         ORDER BY fs.next_due_at ASC`
    ).all();
    return rows.map((r) => {
      const participants = parseJsonArray(r.conv_participants);
      const stages = parseJsonNumberArray(r.schedule_stages);
      const account = {
        id: r.acc_id,
        provider: r.acc_provider,
        displayName: r.acc_name,
        email: r.acc_email,
        color: r.acc_color ?? null,
        imapHost: r.acc_imap_host ?? null,
        imapPort: r.acc_imap_port ?? null,
        imapSecure: r.acc_imap_secure === 1,
        smtpHost: r.acc_smtp_host ?? null,
        smtpPort: r.acc_smtp_port ?? null,
        smtpSecure: r.acc_smtp_secure === 1,
        username: r.acc_username ?? null,
        syncEnabled: r.acc_sync === 1,
        isDefaultSender: r.acc_default === 1,
        authStatus: r.acc_auth,
        createdAt: r.acc_created,
        updatedAt: r.acc_updated
      };
      const conversation = {
        id: r.conversation_id,
        accountId: r.account_id,
        subject: r.conv_subject,
        participants,
        lastMessageAt: r.conv_last,
        unreadCount: r.conv_unread ?? 0,
        isStarred: r.conv_starred === 1
      };
      const recipient = participants.find((p) => p.toLowerCase() !== account.email.toLowerCase()) ?? participants[0] ?? "";
      return {
        sequence: {
          id: r.id,
          conversationId: r.conversation_id,
          accountId: r.account_id,
          scheduleId: r.schedule_id ?? null,
          currentStage: r.current_stage,
          status: r.status,
          lastSentAt: r.last_sent_at,
          nextDueAt: r.next_due_at ?? null,
          snoozedUntil: r.snoozed_until ?? null,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        },
        conversation,
        account,
        recipient,
        subject: r.conv_subject,
        lastSentAt: r.last_sent_at,
        nextDueAt: r.next_due_at ?? null,
        currentStage: r.current_stage,
        stageCount: stages.length,
        status: r.status
      };
    });
  }
  updateStatus(id, status, snoozeDays) {
    const terminal = status === "completed" || status === "replied" || status === "cancelled";
    const snoozedUntil = status === "snoozed" ? snoozeUntil(snoozeDays ?? 3) : null;
    const eventKind = status === "snoozed" ? "snoozed" : status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : status === "replied" ? "replied" : "schedule_changed";
    const tx = this.db.db.transaction(() => {
      this.db.db.prepare(
        `UPDATE followup_sequences
              SET status = ?,
                  snoozed_until = ?,
                  next_due_at = CASE WHEN ? = 1 THEN NULL ELSE next_due_at END,
                  updated_at = ?
            WHERE id = ?`
      ).run(status, snoozedUntil, terminal ? 1 : 0, nowIso(), id);
      this.db.db.prepare(
        "INSERT INTO followup_events(id, sequence_id, kind, stage_index, created_at) VALUES(?, ?, ?, NULL, ?)"
      ).run((0, import_node_crypto2.randomUUID)(), id, eventKind, nowIso());
    });
    tx();
  }
};
function toDraft(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    toAddresses: parseJsonArray(row.to_addresses),
    ccAddresses: parseJsonArray(row.cc_addresses),
    bccAddresses: parseJsonArray(row.bcc_addresses),
    subject: row.subject,
    body: row.body,
    followUpEnabled: row.follow_up_enabled === 1,
    followUpIntervalDays: row.follow_up_interval_days,
    inReplyToConversationId: row.in_reply_to_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
var DraftRepository = class {
  constructor(db2) {
    this.db = db2;
  }
  list() {
    const rows = this.db.db.prepare("SELECT * FROM drafts ORDER BY updated_at DESC").all();
    return rows.map(toDraft);
  }
  save(input) {
    const id = input.id ?? (0, import_node_crypto2.randomUUID)();
    const existing = this.db.db.prepare("SELECT * FROM drafts WHERE id = ?").get(id);
    const ts = nowIso();
    if (existing) {
      const current = toDraft(existing);
      const next = { ...current, ...input, id, updatedAt: ts };
      this.write(next);
      return next;
    }
    const draft = {
      id,
      accountId: input.accountId ?? null,
      toAddresses: input.toAddresses ?? [],
      ccAddresses: input.ccAddresses ?? [],
      bccAddresses: input.bccAddresses ?? [],
      subject: input.subject ?? "",
      body: input.body ?? "",
      followUpEnabled: input.followUpEnabled ?? false,
      followUpIntervalDays: input.followUpIntervalDays ?? null,
      inReplyToConversationId: input.inReplyToConversationId ?? null,
      createdAt: ts,
      updatedAt: ts
    };
    this.write(draft);
    return draft;
  }
  write(draft) {
    this.db.db.prepare(
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
           updated_at = excluded.updated_at`
    ).run(
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
      draft.updatedAt
    );
  }
  remove(id) {
    this.db.db.prepare("DELETE FROM drafts WHERE id = ?").run(id);
  }
};
var NotificationRepository = class _NotificationRepository {
  constructor(db2) {
    this.db = db2;
  }
  static SELECT = `
    SELECT id, kind, title, body, conversation_id, sequence_id, stage_index,
           is_read, due_at, deliver_at, delivered_at, dedupe_key, created_at
    FROM notifications`;
  mapRow(r) {
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body ?? "",
      conversationId: r.conversation_id ?? null,
      sequenceId: r.sequence_id ?? null,
      stageIndex: r.stage_index ?? null,
      isRead: r.is_read === 1,
      dueAt: r.due_at ?? null,
      deliverAt: r.deliver_at ?? null,
      deliveredAt: r.delivered_at ?? null,
      dedupeKey: r.dedupe_key ?? null,
      createdAt: r.created_at
    };
  }
  /**
   * Active sequences whose stored `next_due_at` is at or before `now`.
   *
   * Cancelled, completed and replied sequences are excluded, and so is anything
   * snoozed into the future. Reading timestamps rather than trusting a timer is
   * what lets a reminder raised while the app was closed still appear.
   */
  dueSequences(now) {
    const rows = this.db.db.prepare(
      `SELECT fs.id AS sequence_id, fs.conversation_id, fs.current_stage, fs.next_due_at,
                c.subject, c.participants, a.email AS account_email, s.stages AS schedule_stages
         FROM followup_sequences fs
         JOIN conversations c ON c.id = fs.conversation_id
         JOIN accounts a ON a.id = fs.account_id
         LEFT JOIN followup_schedules s ON s.id = fs.schedule_id
         WHERE fs.status NOT IN ('cancelled','completed','replied','snoozed')
           AND fs.next_due_at IS NOT NULL
           AND fs.next_due_at <= ?
         ORDER BY fs.next_due_at ASC`
    ).all(now.toISOString());
    return rows.map((r) => {
      const participants = parseJsonArray(r.participants);
      const accountEmail = r.account_email ?? "";
      const stages = parseJsonNumberArray(r.schedule_stages);
      return {
        sequenceId: r.sequence_id,
        conversationId: r.conversation_id,
        currentStage: r.current_stage ?? 0,
        totalStages: stages.length,
        nextDueAt: r.next_due_at,
        subject: r.subject ?? "",
        recipient: participants.find((p) => p.toLowerCase() !== accountEmail.toLowerCase()) ?? participants[0] ?? ""
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
  scan(now, opts) {
    const plans = planReminders(this.dueSequences(now), now, opts);
    if (plans.length === 0) return this.readyToDeliver(now);
    const insert = this.db.db.prepare(
      `INSERT OR IGNORE INTO notifications
         (id, kind, title, body, conversation_id, sequence_id, stage_index,
          is_read, due_at, deliver_at, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    );
    const createdAt = now.toISOString();
    const insertAll = this.db.db.transaction(() => {
      for (const plan of plans) {
        insert.run(
          (0, import_node_crypto2.randomUUID)(),
          plan.kind,
          plan.title,
          plan.body,
          plan.conversationId,
          plan.sequenceId,
          plan.stageIndex,
          plan.dueAt,
          plan.deliverAt,
          plan.dedupeKey,
          createdAt
        );
      }
    });
    insertAll();
    return this.readyToDeliver(now);
  }
  /** Undelivered notifications whose delivery time has arrived. */
  readyToDeliver(now) {
    const rows = this.db.db.prepare(
      `${_NotificationRepository.SELECT}
         WHERE delivered_at IS NULL AND (deliver_at IS NULL OR deliver_at <= ?)
         ORDER BY due_at ASC`
    ).all(now.toISOString());
    return rows.map((r) => this.mapRow(r));
  }
  markDelivered(ids, at) {
    if (ids.length === 0) return;
    const stamp = at.toISOString();
    const stmt = this.db.db.prepare(
      "UPDATE notifications SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL"
    );
    const markAll = this.db.db.transaction(() => {
      for (const id of ids) stmt.run(stamp, id);
    });
    markAll();
  }
  list(limit = 50) {
    const rows = this.db.db.prepare(`${_NotificationRepository.SELECT} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(Math.max(1, Math.min(200, Math.floor(limit))));
    return rows.map((r) => this.mapRow(r));
  }
  unreadCount() {
    const row = this.db.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE is_read = 0").get();
    return row.n;
  }
  markRead(id) {
    this.db.db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
  }
  markAllRead() {
    this.db.db.prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0").run();
  }
  /** Removes a notification. Raised reminders for still-due stages come back on the next scan. */
  remove(id) {
    this.db.db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
  }
  /**
   * Drops every reminder for a conversation — used when tracking is turned off,
   * so a cancelled sequence cannot leave stale reminders in the bell.
   */
  removeForConversation(conversationId) {
    this.db.db.prepare("DELETE FROM notifications WHERE conversation_id = ?").run(conversationId);
  }
  /**
   * Drops reminders that have not been shown yet, so they are re-derived
   * against a changed schedule. Already-delivered reminders are kept: a banner
   * the user has seen is history, not something to repeat.
   */
  removePendingForSequence(sequenceId) {
    this.db.db.prepare("DELETE FROM notifications WHERE sequence_id = ? AND delivered_at IS NULL").run(sequenceId);
  }
};

// src/main/security/credentials.ts
var import_electron2 = require("electron");
var CredentialStore = class {
  constructor(db2) {
    this.db = db2;
  }
  isAvailable() {
    return import_electron2.safeStorage.isEncryptionAvailable();
  }
  set(accountId, kind, plaintext) {
    if (!this.isAvailable()) {
      throw new Error(
        "OS credential encryption is unavailable on this device. Connect an account after unlocking your system keychain."
      );
    }
    const ciphertext = import_electron2.safeStorage.encryptString(plaintext);
    this.db.db.prepare(
      "INSERT INTO credentials(account_id, kind, ciphertext) VALUES(?, ?, ?) ON CONFLICT(account_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext"
    ).run(accountId, kind, ciphertext);
  }
  get(accountId, kind) {
    const row = this.db.db.prepare("SELECT ciphertext FROM credentials WHERE account_id = ? AND kind = ?").get(accountId, kind);
    if (!row) return null;
    return import_electron2.safeStorage.decryptString(row.ciphertext);
  }
  remove(accountId, kind) {
    this.db.db.prepare("DELETE FROM credentials WHERE account_id = ? AND kind = ?").run(accountId, kind);
  }
};

// src/main/ipc/handlers.ts
var import_electron3 = require("electron");

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path3, errorMaps, issueData } = params;
  const fullPath = [...path3, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path3, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path3;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/main/security/ipc-validation.ts
var settingsPatchSchema = external_exports.object({
  language: external_exports.string().max(16),
  startupBehavior: external_exports.enum(["restore", "inbox"]),
  defaultOpeningPage: external_exports.enum(["all-inbox", "last-used"]),
  defaultInboxId: external_exports.string().max(128),
  rememberLastInbox: external_exports.boolean(),
  defaultSendingAccountId: external_exports.string().max(128).nullable(),
  dateFormat: external_exports.enum(["auto", "short", "long"]),
  timeFormat: external_exports.enum(["auto", "12h", "24h"]),
  confirmBeforeDelete: external_exports.boolean(),
  confirmBeforeSend: external_exports.boolean(),
  theme: external_exports.enum(["light", "dark", "system"]),
  fontSize: external_exports.enum(["small", "medium", "large"]),
  density: external_exports.enum(["comfortable", "compact"]),
  sidebarVisible: external_exports.boolean(),
  accentColor: external_exports.string().max(16),
  messageListLayout: external_exports.enum(["detailed", "compact"]),
  readingPaneLayout: external_exports.enum(["single", "split"]),
  unifiedInboxEnabled: external_exports.boolean(),
  groupByAccount: external_exports.boolean(),
  sortOrder: external_exports.enum(["newest", "oldest"]),
  showPreview: external_exports.boolean(),
  markAsReadOnOpen: external_exports.boolean(),
  refreshIntervalMinutes: external_exports.number().int().min(0).max(1440),
  conversationGrouping: external_exports.boolean(),
  followUpEnabledByDefault: external_exports.boolean(),
  defaultScheduleId: external_exports.string().max(128).nullable(),
  maxStages: external_exports.number().int().min(1).max(20),
  reminderTime: external_exports.string().regex(/^\d{2}:\d{2}$/),
  useWorkingDays: external_exports.boolean(),
  weekendBehavior: external_exports.enum(["skip", "include"]),
  autoCompleteOnReply: external_exports.boolean(),
  autoReplyHandling: external_exports.enum(["ignore", "complete"]),
  snoozeDefaultDays: external_exports.number().int().min(1).max(90),
  overdueReminderRepeatHours: external_exports.number().int().min(0).max(168),
  desktopNotifications: external_exports.boolean(),
  followUpNotifications: external_exports.boolean(),
  quietHoursEnabled: external_exports.boolean(),
  quietHoursStart: external_exports.string().regex(/^\d{2}:\d{2}$/),
  quietHoursEnd: external_exports.string().regex(/^\d{2}:\d{2}$/),
  notificationSound: external_exports.boolean(),
  notificationFrequency: external_exports.enum(["immediate", "hourly", "daily"]),
  defaultSignature: external_exports.string().max(1e4),
  richTextEnabled: external_exports.boolean(),
  replyBehavior: external_exports.enum(["reply", "reply-all"]),
  ccOnReplyAll: external_exports.boolean(),
  appLockEnabled: external_exports.boolean(),
  databaseEncryption: external_exports.boolean(),
  blockRemoteImages: external_exports.boolean(),
  externalContent: external_exports.enum(["blocked", "ask", "allowed"]),
  aiEnabled: external_exports.boolean(),
  aiProvider: external_exports.string().max(64).nullable(),
  dataRetentionDays: external_exports.number().int().min(0).max(3650),
  syncOnStartup: external_exports.boolean(),
  attachmentStoragePath: external_exports.string().max(1024).nullable()
}).partial();
var newAccountSchema = external_exports.object({
  provider: external_exports.enum(["google", "microsoft", "imap"]),
  displayName: external_exports.string().min(1).max(120),
  email: external_exports.string().email().max(254),
  color: external_exports.string().max(16).nullable().optional(),
  imapHost: external_exports.string().max(255).nullable().optional(),
  imapPort: external_exports.number().int().min(1).max(65535).nullable().optional(),
  imapSecure: external_exports.boolean().optional(),
  smtpHost: external_exports.string().max(255).nullable().optional(),
  smtpPort: external_exports.number().int().min(1).max(65535).nullable().optional(),
  smtpSecure: external_exports.boolean().optional(),
  username: external_exports.string().max(254).nullable().optional(),
  password: external_exports.string().max(512).nullable().optional()
});
var updateAccountSchema = external_exports.object({
  displayName: external_exports.string().min(1).max(120).optional(),
  email: external_exports.string().email().max(254).optional(),
  color: external_exports.string().max(16).nullable().optional(),
  imapHost: external_exports.string().max(255).nullable().optional(),
  imapPort: external_exports.number().int().min(1).max(65535).nullable().optional(),
  imapSecure: external_exports.boolean().optional(),
  smtpHost: external_exports.string().max(255).nullable().optional(),
  smtpPort: external_exports.number().int().min(1).max(65535).nullable().optional(),
  smtpSecure: external_exports.boolean().optional(),
  username: external_exports.string().max(254).nullable().optional(),
  password: external_exports.string().max(512).nullable().optional(),
  syncEnabled: external_exports.boolean().optional(),
  isDefaultSender: external_exports.boolean().optional(),
  authStatus: external_exports.enum(["connected", "expired", "error"]).optional()
});
var scheduleInputSchema = external_exports.object({
  name: external_exports.string().min(1).max(80),
  stages: external_exports.array(external_exports.number().int().min(1).max(365)).min(1).max(20)
});
var schedulePatchSchema = external_exports.object({
  name: external_exports.string().min(1).max(80).optional(),
  stages: external_exports.array(external_exports.number().int().min(1).max(365)).min(1).max(20).optional(),
  isDefault: external_exports.boolean().optional()
});
var messageListOptionsSchema = external_exports.object({
  accountId: external_exports.string().max(128).nullable().optional(),
  folderKind: external_exports.enum(["inbox", "sent", "drafts", "archive", "snoozed", "trash"]).nullable().optional(),
  folderId: external_exports.string().max(128).nullable().optional(),
  limit: external_exports.number().int().min(1).max(1e3).optional(),
  offset: external_exports.number().int().min(0).optional()
});
var createFollowUpSchema = external_exports.object({
  conversationId: external_exports.string().min(1).max(128),
  intervalDays: external_exports.number().int().min(MIN_FOLLOWUP_INTERVAL_DAYS).max(MAX_FOLLOWUP_INTERVAL_DAYS).nullable().optional(),
  scheduleId: external_exports.string().max(128).nullable().optional()
});
var followUpStatusSchema = external_exports.enum([
  "scheduled",
  "due",
  "overdue",
  "waiting",
  "replied",
  "completed",
  "snoozed",
  "cancelled"
]);
var idSchema = external_exports.string().min(1).max(128);
var addressSchema = external_exports.string().min(1).max(320);
var addressListSchema = external_exports.array(addressSchema).max(100);
var saveDraftSchema = external_exports.object({
  id: external_exports.string().min(1).max(128).optional(),
  accountId: external_exports.string().min(1).max(128).nullable().optional(),
  toAddresses: addressListSchema.optional(),
  ccAddresses: addressListSchema.optional(),
  bccAddresses: addressListSchema.optional(),
  subject: external_exports.string().max(1e3).optional(),
  // Generous, but bounded: a draft body is user text, not an upload channel.
  body: external_exports.string().max(1e6).optional(),
  followUpEnabled: external_exports.boolean().optional(),
  followUpIntervalDays: external_exports.number().int().min(MIN_FOLLOWUP_INTERVAL_DAYS).max(MAX_FOLLOWUP_INTERVAL_DAYS).nullable().optional(),
  inReplyToConversationId: external_exports.string().min(1).max(128).nullable().optional()
});
var notificationLimitSchema = external_exports.union([external_exports.number().int().min(1).max(200), external_exports.undefined(), external_exports.null()]).optional();
function parseOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid IPC request: ${result.error.issues.map((i) => i.message).join("; ")}`
    );
  }
  return result.data;
}

// src/main/ipc/handlers.ts
function reminderOptionsFor(settingsRepo) {
  const settings = settingsRepo.getAll();
  return {
    quietHours: {
      enabled: settings.quietHoursEnabled,
      start: settings.quietHoursStart,
      end: settings.quietHoursEnd
    },
    frequency: settings.notificationFrequency,
    reminderTime: settings.reminderTime,
    overdueRepeatHours: settings.overdueReminderRepeatHours
  };
}
function registerIpcHandlers(s) {
  import_electron3.ipcMain.handle("settings:get", () => s.settings.getAll());
  import_electron3.ipcMain.handle(
    "settings:update",
    (_event, patch) => s.settings.update(parseOrThrow(settingsPatchSchema, patch))
  );
  import_electron3.ipcMain.handle("accounts:list", () => s.accounts.list());
  import_electron3.ipcMain.handle("accounts:add", (_event, input) => {
    const data = parseOrThrow(newAccountSchema, input);
    const account = s.accounts.create(data);
    if (data.password) {
      s.credentials.set(account.id, "password", data.password);
    }
    return account;
  });
  import_electron3.ipcMain.handle("accounts:update", (_event, id, patch) => {
    const accountId = parseOrThrow(idSchema, id);
    const data = parseOrThrow(updateAccountSchema, patch);
    if (data.password) {
      s.credentials.set(accountId, "password", data.password);
    }
    const { password: _password, ...rest } = data;
    return s.accounts.update(accountId, rest);
  });
  import_electron3.ipcMain.handle("accounts:remove", (_event, id) => {
    s.accounts.remove(parseOrThrow(idSchema, id));
  });
  import_electron3.ipcMain.handle("schedules:list", () => s.schedules.list());
  import_electron3.ipcMain.handle(
    "schedules:create",
    (_event, input) => s.schedules.create(parseOrThrow(scheduleInputSchema, input))
  );
  import_electron3.ipcMain.handle(
    "schedules:update",
    (_event, id, patch) => s.schedules.update(
      parseOrThrow(idSchema, id),
      parseOrThrow(schedulePatchSchema, patch)
    )
  );
  import_electron3.ipcMain.handle("schedules:remove", (_event, id) => {
    s.schedules.remove(parseOrThrow(idSchema, id));
  });
  import_electron3.ipcMain.handle(
    "messages:list",
    (_event, options) => s.messages.list(parseOrThrow(messageListOptionsSchema, options ?? {}))
  );
  import_electron3.ipcMain.handle(
    "conversations:get",
    (_event, id) => s.messages.getConversation(parseOrThrow(idSchema, id))
  );
  import_electron3.ipcMain.handle("conversations:markRead", (_event, id) => {
    s.messages.markConversationRead(parseOrThrow(idSchema, id));
  });
  import_electron3.ipcMain.handle("followups:list", () => s.followups.list());
  import_electron3.ipcMain.handle("followups:create", (_event, input) => {
    const data = parseOrThrow(createFollowUpSchema, input);
    const settings = s.settings.getAll();
    const schedules = s.schedules.list();
    const schedule = schedules.find((x) => x.id === data.scheduleId) ?? schedules.find((x) => x.id === settings.defaultScheduleId) ?? schedules.find((x) => x.isDefault) ?? schedules[0];
    if (!schedule) return null;
    let stages = [...schedule.stages];
    if (typeof data.intervalDays === "number") stages[0] = data.intervalDays;
    const maxStages = Math.max(1, settings.maxStages);
    stages = stages.slice(0, maxStages);
    return s.followups.create(data.conversationId, {
      stages,
      scheduleId: schedule.id,
      // Weekend behaviour decides whether working-day maths applies at all.
      useWorkingDays: settings.useWorkingDays && settings.weekendBehavior === "skip",
      reminderTime: settings.reminderTime
    });
  });
  import_electron3.ipcMain.handle("followups:disable", (_event, conversationId) => {
    const id = parseOrThrow(idSchema, conversationId);
    s.followups.disable(id);
    s.notifications.removeForConversation(id);
  });
  import_electron3.ipcMain.handle(
    "followups:setSchedule",
    (_event, sequenceId, scheduleId) => {
      const settings = s.settings.getAll();
      const id = parseOrThrow(idSchema, sequenceId);
      const updated = s.followups.setSchedule(id, parseOrThrow(idSchema, scheduleId), {
        useWorkingDays: settings.useWorkingDays && settings.weekendBehavior === "skip",
        reminderTime: settings.reminderTime
      });
      if (updated) s.notifications.removePendingForSequence(id);
      return updated;
    }
  );
  import_electron3.ipcMain.handle(
    "followups:updateStatus",
    (_event, id, status, snoozeDays) => {
      const sequenceId = parseOrThrow(idSchema, id);
      const nextStatus = parseOrThrow(followUpStatusSchema, status);
      const days = typeof snoozeDays === "number" && Number.isFinite(snoozeDays) ? Math.min(Math.max(Math.round(snoozeDays), 1), 90) : void 0;
      s.followups.updateStatus(sequenceId, nextStatus, days);
    }
  );
  import_electron3.ipcMain.handle(
    "notifications:scan",
    () => s.notifications.scan(/* @__PURE__ */ new Date(), reminderOptionsFor(s.settings))
  );
  import_electron3.ipcMain.handle(
    "notifications:list",
    (_event, limit) => s.notifications.list(parseOrThrow(notificationLimitSchema, limit) ?? 50)
  );
  import_electron3.ipcMain.handle("notifications:unreadCount", () => s.notifications.unreadCount());
  import_electron3.ipcMain.handle("notifications:markRead", (_event, id) => {
    s.notifications.markRead(parseOrThrow(idSchema, id));
  });
  import_electron3.ipcMain.handle("notifications:markAllRead", () => s.notifications.markAllRead());
  import_electron3.ipcMain.handle("notifications:dismiss", (_event, id) => {
    s.notifications.remove(parseOrThrow(idSchema, id));
  });
  import_electron3.ipcMain.handle("drafts:list", () => s.drafts.list());
  import_electron3.ipcMain.handle(
    "drafts:save",
    (_event, input) => (
      // Fully validated: bounded addresses, subject and body lengths, and unknown
      // keys stripped. The repository still applies its own defaults.
      s.drafts.save(parseOrThrow(saveDraftSchema, input))
    )
  );
  import_electron3.ipcMain.handle("drafts:remove", (_event, id) => {
    s.drafts.remove(parseOrThrow(idSchema, id));
  });
  import_electron3.ipcMain.handle("app:info", () => ({
    version: import_electron3.app.getVersion(),
    platform: process.platform,
    dbPath: s.db.dbPath,
    userDataPath: import_electron3.app.getPath("userData"),
    isPackaged: import_electron3.app.isPackaged
  }));
}

// src/main/index.ts
var isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
var rendererDir = import_node_path2.default.resolve(__dirname, "../renderer");
var mainWindow = null;
var db = null;
var reminderTimer = null;
function pumpReminders(notifications, settings) {
  const prefs = settings.getAll();
  const ready = notifications.scan(/* @__PURE__ */ new Date(), reminderOptionsFor(settings));
  if (ready.length === 0) return;
  if (prefs.desktopNotifications && prefs.followUpNotifications && import_electron4.Notification.isSupported()) {
    for (const item of ready) {
      const banner = new import_electron4.Notification({
        title: item.title,
        body: item.body,
        silent: !prefs.notificationSound
      });
      banner.on("click", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
      banner.show();
    }
  }
  notifications.markDelivered(
    ready.map((n) => n.id),
    /* @__PURE__ */ new Date()
  );
}
function installDevContentSecurityPolicy() {
  if (!isDev) return;
  import_electron4.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws://localhost:5173 http://localhost:5173;"
        ]
      }
    });
  });
}
function initialBackgroundColor(settings) {
  const dark = settings.getAll().theme === "dark" || settings.getAll().theme === "system" && import_electron4.nativeTheme.shouldUseDarkColors;
  return dark ? "#171717" : "#FAF8F5";
}
function createWindow(settings) {
  const dark = initialBackgroundColor(settings) === "#171717";
  mainWindow = new import_electron4.BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: initialBackgroundColor(settings),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "win32" ? { color: dark ? "#171717" : "#FAF8F5", symbolColor: dark ? "#EDEDED" : "#2B2B2B", height: 44 } : void 0,
    webPreferences: {
      preload: import_node_path2.default.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void import_electron4.shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    let allowed = false;
    if (isDev) {
      allowed = url.startsWith("http://localhost:5173");
    } else if (url.startsWith("file://")) {
      try {
        allowed = import_node_path2.default.resolve((0, import_node_url.fileURLToPath)(url)).startsWith(rendererDir + import_node_path2.default.sep);
      } catch {
        allowed = false;
      }
    }
    if (!allowed) event.preventDefault();
  });
  if (isDev) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(import_node_path2.default.join(rendererDir, "index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
var gotLock = import_electron4.app.requestSingleInstanceLock();
if (!gotLock) {
  import_electron4.app.quit();
} else {
  import_electron4.app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void import_electron4.app.whenReady().then(() => {
    installDevContentSecurityPolicy();
    const dbPath = getDefaultDbPath();
    let opened;
    try {
      opened = openDatabaseWithRecovery(dbPath);
    } catch (err) {
      import_electron4.dialog.showErrorBox(
        "Still could not open its database",
        `${err instanceof Error ? err.message : String(err)}

Database location: ${dbPath}`
      );
      import_electron4.app.quit();
      return;
    }
    db = opened.service;
    const settings = new SettingsRepository(db);
    registerIpcHandlers({
      db,
      settings,
      accounts: new AccountRepository(db),
      schedules: new ScheduleRepository(db),
      messages: new MessageRepository(db),
      followups: new FollowUpRepository(db),
      notifications: new NotificationRepository(db),
      drafts: new DraftRepository(db),
      credentials: new CredentialStore(db)
    });
    createWindow(settings);
    const notifications = new NotificationRepository(db);
    const tick = () => {
      try {
        pumpReminders(notifications, settings);
      } catch (err) {
        console.error("[still] reminder scan failed:", err);
      }
    };
    tick();
    reminderTimer = setInterval(tick, 6e4);
    if (opened.recovered) {
      import_electron4.dialog.showMessageBox({
        type: "warning",
        title: "Database repaired",
        message: "Still could not read its local database and started a fresh one.",
        detail: `The previous files were kept, not deleted:
${opened.quarantined.join("\n") || dbPath}

Reason: ${opened.error ?? "unknown"}`,
        buttons: ["Continue"]
      });
    }
    import_electron4.nativeTheme.on("updated", () => {
      if (settings.getAll().theme === "system" && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(import_electron4.nativeTheme.shouldUseDarkColors ? "#171717" : "#FAF8F5");
      }
    });
    import_electron4.app.on("activate", () => {
      if (import_electron4.BrowserWindow.getAllWindows().length === 0) createWindow(settings);
    });
  });
  import_electron4.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") import_electron4.app.quit();
  });
  import_electron4.app.on("before-quit", () => {
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = null;
    db?.close();
  });
}
//# sourceMappingURL=index.cjs.map
