import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations';

function createMigratedDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS) {
    db.exec(migration.sql);
  }
  return db;
}

describe('database migrations', () => {
  it('creates all expected tables', () => {
    const db = createMigratedDb();
    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((r) => r.name),
    );
    for (const table of [
      'settings',
      'accounts',
      'credentials',
      'folders',
      'conversations',
      'messages',
      'attachments',
      'drafts',
      'followup_schedules',
      'followup_sequences',
      'followup_events',
      'notifications',
      'sync_state',
      'messages_fts',
    ]) {
      expect(tables.has(table), `missing table ${table}`).toBe(true);
    }
    db.close();
  });

  it('enforces foreign keys and cascades account deletion', () => {
    const db = createMigratedDb();
    const ts = new Date().toISOString();
    db.prepare(
      "INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('a1', 'imap', 'Personal', 'a@example.com', ?, ?)",
    ).run(ts, ts);
    db.prepare(
      "INSERT INTO conversations(id, account_id, subject, last_message_at, created_at, updated_at) VALUES('c1', 'a1', 'Hi', ?, ?, ?)",
    ).run(ts, ts, ts);
    db.prepare(
      "INSERT INTO messages(id, account_id, conversation_id, subject, sent_at, created_at) VALUES('m1', 'a1', 'c1', 'Hi', ?, ?)",
    ).run(ts, ts);

    db.prepare('DELETE FROM accounts WHERE id = ?').run('a1');
    const messages = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    const conversations = db.prepare('SELECT COUNT(*) AS n FROM conversations').get() as {
      n: number;
    };
    expect(messages.n).toBe(0);
    expect(conversations.n).toBe(0);
    db.close();
  });

  it('prevents duplicate provider messages per account', () => {
    const db = createMigratedDb();
    const ts = new Date().toISOString();
    db.prepare(
      "INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('a1', 'imap', 'Personal', 'a@example.com', ?, ?)",
    ).run(ts, ts);
    const insert = db.prepare(
      "INSERT INTO messages(id, account_id, provider_message_id, subject, sent_at, created_at) VALUES(?, 'a1', 'provider-1', 'Hi', ?, ?)",
    );
    insert.run('m1', ts, ts);
    expect(() => insert.run('m2', ts, ts)).toThrow();
    db.close();
  });

  it('indexes message text with FTS5 triggers', () => {
    const db = createMigratedDb();
    const ts = new Date().toISOString();
    db.prepare(
      "INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('a1', 'imap', 'Personal', 'a@example.com', ?, ?)",
    ).run(ts, ts);
    db.prepare(
      "INSERT INTO messages(id, account_id, subject, body_text, from_name, from_address, sent_at, created_at) VALUES('m1', 'a1', 'Quarterly report', 'The quarterly report is ready for review.', 'Sarah', 'sarah@example.com', ?, ?)",
    ).run(ts, ts);

    const hits = db
      .prepare(
        "SELECT m.id FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE messages_fts MATCH 'quarterly'",
      )
      .all() as { id: string }[];
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('m1');
    db.close();
  });
});
