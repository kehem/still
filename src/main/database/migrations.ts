/**
 * Database migrations. Each migration is applied once, in order, inside a
 * transaction. Never edit an applied migration — add a new one instead.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
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

-- Full-text search over local messages (SQLite FTS5, spec §12).
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
`,
  },
  {
    version: 2,
    name: 'notifications_reminder_engine',
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
`,
  },
  {
    version: 3,
    name: 'automation_workspace',
    sql: `
CREATE TABLE automation_workspace (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  document TEXT NOT NULL,
  source_name TEXT,
  source_bytes BLOB,
  updated_at TEXT NOT NULL
);
CREATE TABLE automation_deliveries (
  id TEXT PRIMARY KEY,
  row_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  day TEXT NOT NULL,
  conversation_id TEXT,
  sent_at TEXT,
  error TEXT
);
CREATE INDEX automation_delivery_day ON automation_deliveries(day);
CREATE INDEX automation_delivery_conversation ON automation_deliveries(conversation_id, status);
CREATE INDEX idx_messages_automation_match ON messages(account_id, direction, subject);
`,
  },

];
