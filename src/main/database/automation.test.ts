import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIGRATIONS } from './migrations';
import { AutomationRepository } from './automation';
import { FollowUpRepository } from './repositories';
import type { DatabaseService } from './db';
import { automationWorkspaceSchema, automationImportSchema } from '../security/ipc-validation';
import { enableAutomationFollowUp } from '../email/automation-followup';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import { emptyAutomation } from '../../shared/automation';

// Exercise actual SQLite SQL and on-disk persistence using Node's SQLite engine.
// The Electron-specific better-sqlite3 binary is not required by this test.
function service(db: DatabaseSync): DatabaseService {
  const adapter = {
    prepare: (sql: string) => db.prepare(sql),
    transaction: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(...args); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  return { db: adapter } as unknown as DatabaseService;
}
let directory: string;
let file: string;
let db: DatabaseSync;
let repo: AutomationRepository;
const row = { id: 'r1', to: 'reader@example.com', subject: 'Hello', body: 'Body', selected: true, status: 'pending' as const };
function saveRows() { return repo.save({ ...emptyAutomation(), accountId: 'a', fileName: 'contacts.csv', rows: [row, { ...row, id: 'r2', to: 'other@example.com' }] }); }
function sentMessage() {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('a', 'imap', 'Me', 'me@example.com', ?, ?)").run(now, now);
  db.prepare("INSERT INTO conversations(id, account_id, subject, last_message_at, created_at, updated_at) VALUES('c', 'a', 'Hello', ?, ?, ?)").run(now, now, now);
  db.prepare("INSERT INTO messages(id, account_id, conversation_id, subject, body_text, to_addresses, direction, sent_at, created_at) VALUES('m', 'a', 'c', 'Hello', 'Body', '[\"Reader@Example.com\"]', 'outbound', ?, ?)").run(now, now);
}
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'still-auto-')); file = path.join(directory, 'mail.db');
  db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys = ON');
  for (const migration of MIGRATIONS) db.exec(migration.sql);
  repo = new AutomationRepository(service(db));
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });
describe('SQLite automation persistence', () => {
  it('upgrades legacy opt-out flags so every new automation send is tracked', () => {
    const legacy = { ...emptyAutomation(), followUp: false };
    db.prepare('INSERT INTO automation_workspace(id, document, updated_at) VALUES(1, ?, ?)').run(JSON.stringify(legacy), new Date().toISOString());
    expect(repo.snapshot().workspace.followUp).toBe(true);
    expect(repo.save(legacy).workspace.followUp).toBe(true);
  });
  it('saves original file bytes immediately and restores mapping, settings and rows after reopening', () => {
    const table = [['Email', 'Subject', 'Body'], ['reader@example.com', 'Hello', 'Body']];
    repo.importFile('contacts.csv', Buffer.from('original,csv,bytes').toString('base64'), table);
    const source = db.prepare('SELECT source_name, source_bytes FROM automation_workspace').get() as { source_name: string; source_bytes: Uint8Array };
    expect(source.source_name).toBe('contacts.csv'); expect(Buffer.from(source.source_bytes).toString()).toBe('original,csv,bytes');
    repo.save({ ...repo.snapshot().workspace, columns: [2, 0, 1], daily: 12, seconds: 45, rows: [row] });
    db.close(); db = new DatabaseSync(file); repo = new AutomationRepository(service(db)); repo.recover();
    const restored = repo.snapshot().workspace;
    expect(restored.table).toEqual(table); expect(restored.columns).toEqual([2, 0, 1]);
    expect(restored.daily).toBe(12); expect(restored.seconds).toBe(45); expect(restored.rows[0].to).toBe(row.to);
  });
  it('claims only one row and persists counts and delivery state across reopening', () => {
    saveRows(); const claim = repo.claim('r2');
    expect(claim.row.to).toBe('other@example.com');
    const finished = repo.finish(claim.deliveryId, 'r2', { conversationId: 'sent-c', sentAt: new Date().toISOString() });
    expect(finished.sentTotal).toBe(1); expect(finished.attemptedToday).toBe(1);
    expect(finished.workspace.rows[0].status).toBe('pending');
    db.close(); db = new DatabaseSync(file); repo = new AutomationRepository(service(db)); repo.recover();
    expect(repo.snapshot().sentToday).toBe(1);
    expect(repo.snapshot().workspace.rows[1].status).toBe('sent');
    expect(() => repo.claim('r2')).toThrow('already sent');
    repo.save({ ...repo.snapshot().workspace, rows: [] });
    expect(repo.snapshot().sentTotal).toBe(1);
  });
  it('reconciles a matching already-sent message with active follow-up as Done', () => {
    sentMessage();
    const followups = new FollowUpRepository(service(db));
    const tracking = followups.create('c', { stages: [3, 7], scheduleId: null, useWorkingDays: false, reminderTime: '09:00' });
    expect(tracking).toBeTruthy();
    const snapshot = saveRows();
    expect(snapshot.workspace.rows[0]).toMatchObject({ status: 'sent', conversationId: 'c', followUpActive: true, selected: false });
    expect(snapshot.sentTotal).toBe(1); expect(snapshot.sentToday).toBe(1);
    expect(repo.snapshot().sentTotal).toBe(1); // Reconciliation is idempotent.
    expect(snapshot.workspace.rows[1].status).toBe('pending');
    expect(() => repo.claim('r1')).toThrow('already sent');
    db.prepare("UPDATE followup_sequences SET status = 'completed' WHERE conversation_id = 'c'").run();
    expect(repo.snapshot().workspace.rows[0]).toMatchObject({ status: 'sent', followUpActive: false });
  });
  it('persists automatic default-schedule tracking with the sent automation row', () => {
    saveRows();
    const claim = repo.claim('r1');
    sentMessage(); // SMTP result has been saved as a local outbound message.
    const now = new Date().toISOString();
    db.prepare("INSERT INTO followup_schedules(id, name, stages, is_default, created_at, updated_at) VALUES('chosen', 'My default', '[2,5,10]', 0, ?, ?)").run(now, now);
    enableAutomationFollowUp({
      settings: { getAll: () => ({ ...DEFAULT_SETTINGS, defaultScheduleId: 'chosen', maxStages: 2 }) },
      schedules: { list: () => [{ id: 'chosen', name: 'My default', stages: [2, 5, 10], isDefault: false, createdAt: now, updatedAt: now }] },
      followups: new FollowUpRepository(service(db)),
    }, 'c');
    const snapshot = repo.finish(claim.deliveryId, 'r1', { conversationId: 'c', sentAt: now });
    expect(snapshot.workspace.rows[0]).toMatchObject({ status: 'sent', followUpActive: true });
    expect(db.prepare("SELECT schedule_id FROM followup_sequences WHERE conversation_id = 'c'").get()?.schedule_id).toBe('chosen');
    expect(snapshot.sentTotal).toBe(1);
  });
  it('detects sends despite Windows line endings, wrapped whitespace and subject formatting', () => {
    sentMessage();
    db.prepare("UPDATE messages SET subject = ' Hello  World ', body_text = ? WHERE id = 'm'").run('Hi reader,\r\n\r\nThanks\u00a0for your\n time.');
    const snapshot = repo.save({ ...emptyAutomation(), accountId: 'a', rows: [{ ...row, subject: 'hello world', body: 'Hi reader,\nThanks for your time.' }] });
    expect(snapshot.workspace.rows[0].status).toBe('sent');
    expect(() => repo.claim('r1')).toThrow('already sent');
  });
  it('recognizes the configured composer signature but not arbitrary added paragraphs', () => {
    sentMessage();
    db.prepare("INSERT INTO settings(key, value) VALUES('defaultSignature', ?)").run(JSON.stringify('Best,\nAlex'));
    db.prepare("UPDATE messages SET body_text = ? WHERE id = 'm'").run('Body\r\n\r\nBest,\r\nAlex');
    expect(saveRows().workspace.rows[0].status).toBe('sent');
    const changed = repo.save({ ...emptyAutomation(), accountId: 'a', rows: [{ ...row, id: 'changed', body: 'Body. A different offer' }] });
    expect(changed.workspace.rows[0].status).toBe('pending');
  });
  it('uses successful delivery history after clearing and rebuilding even if mail was removed', () => {
    saveRows(); const claim = repo.claim('r1');
    repo.finish(claim.deliveryId, 'r1', { conversationId: 'removed-thread', sentAt: new Date().toISOString() });
    repo.save({ ...repo.snapshot().workspace, rows: [] });
    const rebuilt = repo.save({ ...repo.snapshot().workspace, rows: [{ ...row, id: 'rebuilt' }] });
    expect(rebuilt.workspace.rows[0]).toMatchObject({ status: 'sent', conversationId: 'removed-thread' });
    expect(rebuilt.sentTotal).toBe(1); expect(repo.snapshot().sentTotal).toBe(1);
    expect(() => repo.claim('rebuilt')).toThrow('already sent');
  });
  it('does not count failed or cross-account delivery records as proof of a send', () => {
    saveRows(); const claim = repo.claim('r1'); repo.finish(claim.deliveryId, 'r1', { error: 'SMTP rejected' });
    expect(repo.save({ ...repo.snapshot().workspace, rows: [{ ...row, id: 'new' }] }).workspace.rows[0].status).toBe('pending');
    db.prepare("UPDATE automation_deliveries SET status = 'sent', account_id = 'other-account', sent_at = attempted_at").run();
    expect(repo.snapshot().workspace.rows[0].status).toBe('pending');
  });
  it('does not mark a different body or account as already sent', () => {
    sentMessage();
    const ws = { ...emptyAutomation(), accountId: 'a', rows: [{ ...row, body: 'New message' }] };
    expect(repo.save(ws).workspace.rows[0].status).toBe('pending');
    expect(repo.save({ ...ws, accountId: 'different', rows: [row] }).workspace.rows[0].status).toBe('pending');
  });
  it('preserves uncertain failures on restart and never retries them', () => {
    saveRows(); repo.claim('r1');
    db.close(); db = new DatabaseSync(file); repo = new AutomationRepository(service(db)); repo.recover();
    expect(repo.snapshot().workspace.rows[0].status).toBe('failed');
    expect(() => repo.claim('r1')).toThrow('already sent');
    expect(repo.snapshot().attemptedToday).toBe(1);
  });
  it('enforces daily limits and intervals in SQLite, even if renderer checks are bypassed', () => {
    saveRows(); const claim = repo.claim('r1'); repo.finish(claim.deliveryId, 'r1', { error: 'SMTP uncertain' });
    expect(() => repo.claim('r2')).toThrow('interval');
    repo.save({ ...repo.snapshot().workspace, daily: 1 });
    expect(() => repo.claim('r2')).toThrow('Daily limit');
    expect(repo.snapshot().sentToday).toBe(0); expect(repo.snapshot().attemptedToday).toBe(1);
  });
  it('does not allow stale renderer saves to turn sent rows back to pending', () => {
    const old = saveRows().workspace; const claim = repo.claim('r1');
    repo.finish(claim.deliveryId, 'r1', { conversationId: 'c', sentAt: new Date().toISOString() });
    expect(repo.save(old).workspace.rows[0].status).toBe('sent');
  });
  it('validates limits, duplicate row IDs, and source import formats before IPC writes', () => {
    expect(automationWorkspaceSchema.safeParse({ ...emptyAutomation(), daily: 0 }).success).toBe(false);
    expect(automationWorkspaceSchema.safeParse({ ...emptyAutomation(), rows: [row, row] }).success).toBe(false);
    expect(automationImportSchema.safeParse({ name: 'contacts.xls', base64: '', table: [] }).success).toBe(false);
  });
});
