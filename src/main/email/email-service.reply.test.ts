import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/db';
import type { AccountRepository } from '../database/repositories';
import type { CredentialStore } from '../security/credentials';
import { MIGRATIONS } from '../database/migrations';
const { sendMail, createTransport } = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));
import { EmailService } from './email-service';
let db: DatabaseSync;
let service: EmailService;
beforeEach(() => {
  db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON');
  for (const m of MIGRATIONS) db.exec(m.sql);
  const ts = '2026-01-01T10:00:00.000Z';
  db.prepare("INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('a', 'imap', 'Me', 'me@example.com', ?, ?)").run(ts, ts);
  db.prepare("INSERT INTO conversations(id, account_id, subject, participants, last_message_at, created_at, updated_at) VALUES('c', 'a', 'Hello', '[\"recipient@example.com\"]', ?, ?, ?)").run(ts, ts, ts);
  db.prepare(`INSERT INTO messages(id, account_id, conversation_id, message_id_header, subject, body_text, to_addresses, direction, sent_at, created_at)
    VALUES('original', 'a', 'c', '<original@example.com>', 'Hello', 'Original', '["recipient@example.com"]', 'outbound', ?, ?)`).run(ts, ts);
  sendMail.mockReset(); createTransport.mockReset().mockReturnValue({ sendMail });
  service = new EmailService({ db } as unknown as DatabaseService,
    { list: () => [{ id: 'a', email: 'me@example.com', displayName: 'Me', smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecure: false }] } as unknown as AccountRepository,
    { get: () => 'test-password' } as unknown as CredentialStore);
});
afterEach(() => db.close());
const input = { accountId: 'a', to: ['recipient@example.com'], subject: 'Re: Hello', bodyText: 'Following up', conversationId: 'c' };
it('sends real reply headers and persists them on the same conversation for subsequent replies', async () => {
  sendMail.mockResolvedValueOnce({ messageId: '<followup1@example.com>' }).mockResolvedValueOnce({ messageId: '<followup2@example.com>' });
  const first = await service.sendEmail(input);
  expect(first.conversationId).toBe('c');
  expect(sendMail).toHaveBeenNthCalledWith(1, expect.objectContaining({
    to: 'recipient@example.com', inReplyTo: '<original@example.com>', references: ['<original@example.com>'],
  }));
  expect(db.prepare('SELECT in_reply_to, references_header FROM messages WHERE id = ?').get(first.messageId)).toMatchObject({
    in_reply_to: '<original@example.com>', references_header: '<original@example.com>',
  });
  await service.sendEmail(input);
  expect(sendMail).toHaveBeenNthCalledWith(2, expect.objectContaining({
    inReplyTo: '<followup1@example.com>', references: ['<original@example.com>', '<followup1@example.com>'],
  }));
  expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'c'").get()?.n).toBe(3);
});
it('refuses cross-account or missing conversations before calling SMTP', async () => {
  db.prepare("INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('different', 'imap', 'Other', 'other@example.com', '2026-01-01', '2026-01-01')").run();
  db.prepare("UPDATE conversations SET account_id = 'different' WHERE id = 'c'").run();
  await expect(service.sendEmail(input)).rejects.toThrow('does not belong');
  expect(sendMail).not.toHaveBeenCalled();
});
it('does not silently send a new unthreaded message when the original has no Message-ID', async () => {
  db.prepare("UPDATE messages SET message_id_header = NULL WHERE id = 'original'").run();
  await expect(service.sendEmail(input)).rejects.toThrow('no Message-ID');
  expect(sendMail).not.toHaveBeenCalled();
});
it('keeps new messages independent without reply headers', async () => {
  sendMail.mockResolvedValue({ messageId: '<new@example.com>' });
  const result = await service.sendEmail({ ...input, conversationId: null });
  expect(result.conversationId).not.toBe('c');
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ inReplyTo: undefined, references: undefined }));
});
