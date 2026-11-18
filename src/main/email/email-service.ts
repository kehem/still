import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type { DatabaseService } from '../database/db';
import type { AccountRepository } from '../database/repositories';
import type { CredentialStore } from '../security/credentials';
import type { Account } from '../../shared/types';

export interface SendEmailInput {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  inReplyTo?: string | null;
  conversationId?: string | null;
  draftId?: string | null;
}

export interface SendEmailResult {
  messageId: string;
  conversationId: string;
  sentAt: string;
  messageIdHeader: string | null;
}

export interface SyncAccountResult {
  accountId: string;
  syncedCount: number;
  error?: string;
}

export interface SyncAllResult {
  syncedCount: number;
  results: SyncAccountResult[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTextFromSource(raw: Buffer): { text: string; snippet: string } {
  const str = raw.toString('utf8');
  const headerEnd = str.indexOf('\r\n\r\n');
  const body = headerEnd !== -1 ? str.slice(headerEnd + 4) : str;
  const cleaned = body
    .replace(/=\r?\n/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    text: cleaned.slice(0, 50_000),
    snippet: cleaned.slice(0, 160),
  };
}

export class EmailService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accounts: AccountRepository,
    private readonly credentials: CredentialStore,
  ) {}

  private ensureFolder(accountId: string, name: string, kind: string): string {
    const existing = this.db.db
      .prepare('SELECT id FROM folders WHERE account_id = ? AND kind = ? LIMIT 1')
      .get(accountId, kind) as { id: string } | undefined;
    if (existing) return existing.id;

    const byName = this.db.db
      .prepare('SELECT id FROM folders WHERE account_id = ? AND name = ? LIMIT 1')
      .get(accountId, name) as { id: string } | undefined;
    if (byName) return byName.id;

    const id = crypto.randomUUID();
    this.db.db
      .prepare(
        'INSERT INTO folders(id, account_id, name, kind, sync_enabled) VALUES(?, ?, ?, ?, 1)',
      )
      .run(id, accountId, name, kind);
    return id;
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const account = this.accounts.list().find((a) => a.id === input.accountId);
    if (!account) {
      throw new Error('Account not found.');
    }
    const password = this.credentials.get(account.id, 'password');
    if (!password) {
      throw new Error(
        `No password stored for ${account.email}. Please re-enter your password in Settings.`,
      );
    }
    if (!account.smtpHost) {
      throw new Error(`SMTP host is not configured for ${account.email}.`);
    }

    const smtpPort = account.smtpPort ?? (account.smtpSecure ? 465 : 587);
    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: smtpPort,
      secure: account.smtpSecure,
      auth: {
        user: account.username ?? account.email,
        pass: password,
      },
    });

    const fromHeader = account.displayName
      ? `"${account.displayName.replace(/"/g, '\\"')}" <${account.email}>`
      : account.email;

    const info = await transporter.sendMail({
      from: fromHeader,
      to: input.to.join(', '),
      cc: input.cc && input.cc.length > 0 ? input.cc.join(', ') : undefined,
      bcc: input.bcc && input.bcc.length > 0 ? input.bcc.join(', ') : undefined,
      subject: input.subject || '(no subject)',
      text: input.bodyText,
      inReplyTo: input.inReplyTo ?? undefined,
    });

    const sentAt = nowIso();
    const sentFolderId = this.ensureFolder(account.id, 'Sent', 'sent');
    const conversationId = input.conversationId || crypto.randomUUID();

    const existingConv = this.db.db
      .prepare('SELECT id, participants FROM conversations WHERE id = ?')
      .get(conversationId) as { id: string; participants: string } | undefined;

    if (!existingConv) {
      const participants = Array.from(new Set([...input.to, ...(input.cc ?? [])]));
      this.db.db
        .prepare(
          `INSERT INTO conversations(
            id, account_id, subject, participants, last_message_at,
            unread_count, is_starred, created_at, updated_at
          ) VALUES(?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        )
        .run(
          conversationId,
          account.id,
          input.subject || '(no subject)',
          JSON.stringify(participants),
          sentAt,
          sentAt,
          sentAt,
        );
    } else {
      this.db.db
        .prepare('UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?')
        .run(sentAt, sentAt, conversationId);
    }

    const messageId = crypto.randomUUID();
    const snippet = input.bodyText.replace(/\s+/g, ' ').trim().slice(0, 160);
    this.db.db
      .prepare(
        `INSERT INTO messages(
          id, account_id, conversation_id, folder_id, provider_message_id,
          message_id_header, in_reply_to, subject, snippet, body_text,
          from_name, from_address, to_addresses, cc_addresses, bcc_addresses,
          sent_at, received_at, is_read, is_starred, direction
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'outbound')`,
      )
      .run(
        messageId,
        account.id,
        conversationId,
        sentFolderId,
        info.messageId ?? null,
        info.messageId ?? null,
        input.inReplyTo ?? null,
        input.subject || '(no subject)',
        snippet,
        input.bodyText,
        account.displayName || account.email,
        account.email,
        JSON.stringify(input.to),
        JSON.stringify(input.cc ?? []),
        JSON.stringify(input.bcc ?? []),
        sentAt,
        sentAt,
      );

    if (input.draftId) {
      this.db.db.prepare('DELETE FROM drafts WHERE id = ?').run(input.draftId);
    }

    return {
      messageId,
      conversationId,
      sentAt,
      messageIdHeader: info.messageId ?? null,
    };
  }

  async syncAccount(account: Account): Promise<SyncAccountResult> {
    if (!account.imapHost) {
      return {
        accountId: account.id,
        syncedCount: 0,
        error: `IMAP host is not configured for ${account.email}.`,
      };
    }
    const password = this.credentials.get(account.id, 'password');
    if (!password) {
      return {
        accountId: account.id,
        syncedCount: 0,
        error: `No password stored for ${account.email}.`,
      };
    }

    this.db.db
      .prepare(
        `INSERT INTO sync_state(account_id, status, last_error)
         VALUES(?, 'syncing', NULL)
         ON CONFLICT(account_id) DO UPDATE SET status = 'syncing', last_error = NULL`,
      )
      .run(account.id);

    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort ?? (account.imapSecure ? 993 : 143),
      secure: account.imapSecure,
      auth: {
        user: account.username ?? account.email,
        pass: password,
      },
      logger: false,
    });

    let syncedCount = 0;

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const inboxFolderId = this.ensureFolder(account.id, 'Inbox', 'inbox');
        const total = typeof client.mailbox === 'object' && client.mailbox ? client.mailbox.exists : 0;
        if (total > 0) {
          const startSeq = Math.max(1, total - 49);
          const range = `${startSeq}:*`;

          for await (const msg of client.fetch(range, {
            uid: true,
            envelope: true,
            flags: true,
            source: true,
          })) {
            const providerId = String(msg.uid);
            const messageIdHeader = msg.envelope?.messageId ?? null;

            const existing = this.db.db
              .prepare(
                `SELECT id FROM messages
                 WHERE account_id = ? AND (provider_message_id = ? OR (message_id_header IS NOT NULL AND message_id_header = ?))
                 LIMIT 1`,
              )
              .get(account.id, providerId, messageIdHeader) as { id: string } | undefined;

            if (existing) continue;

            const subject = msg.envelope?.subject || '(no subject)';
            const fromEntry = msg.envelope?.from?.[0];
            const fromAddress = fromEntry?.address || 'unknown@example.com';
            const fromName = fromEntry?.name || fromAddress;
            const toAddresses = (msg.envelope?.to ?? [])
              .map((a) => a.address)
              .filter((a): a is string => Boolean(a));
            const ccAddresses = (msg.envelope?.cc ?? [])
              .map((a) => a.address)
              .filter((a): a is string => Boolean(a));
            const sentAt = new Date(msg.envelope?.date ?? Date.now()).toISOString();
            const isRead = msg.flags?.has('\\Seen') ? 1 : 0;
            const isStarred = msg.flags?.has('\\Flagged') ? 1 : 0;
            const inReplyTo = msg.envelope?.inReplyTo ?? null;

            const parsed = msg.source
              ? extractTextFromSource(msg.source)
              : { text: '', snippet: '' };
            const bodyText = parsed.text || stripHtml(subject);
            const snippet = parsed.snippet;

            // Find or create conversation
            let conversationId: string | null = null;
            if (inReplyTo) {
              const parent = this.db.db
                .prepare(
                  'SELECT conversation_id FROM messages WHERE account_id = ? AND message_id_header = ? LIMIT 1',
                )
                .get(account.id, inReplyTo) as { conversation_id: string | null } | undefined;
              conversationId = parent?.conversation_id ?? null;
            }
            if (!conversationId) {
              const normalizedSubject = subject.replace(/^(re|fwd?):\s*/i, '').trim();
              const bySubject = this.db.db
                .prepare(
                  'SELECT id FROM conversations WHERE account_id = ? AND subject = ? ORDER BY last_message_at DESC LIMIT 1',
                )
                .get(account.id, normalizedSubject) as { id: string } | undefined;
              conversationId = bySubject?.id ?? null;
            }
            if (!conversationId) {
              conversationId = crypto.randomUUID();
              const now = nowIso();
              this.db.db
                .prepare(
                  `INSERT INTO conversations(
                    id, account_id, subject, participants, last_message_at,
                    unread_count, is_starred, created_at, updated_at
                  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                  conversationId,
                  account.id,
                  subject.replace(/^(re|fwd?):\s*/i, '').trim() || '(no subject)',
                  JSON.stringify([fromAddress, ...toAddresses]),
                  sentAt,
                  isRead ? 0 : 1,
                  isStarred,
                  now,
                  now,
                );
            } else {
              this.db.db
                .prepare(
                  `UPDATE conversations
                   SET last_message_at = MAX(last_message_at, ?),
                       unread_count = unread_count + ?,
                       updated_at = ?
                   WHERE id = ?`,
                )
                .run(sentAt, isRead ? 0 : 1, nowIso(), conversationId);
            }

            const messageId = crypto.randomUUID();
            this.db.db
              .prepare(
                `INSERT INTO messages(
                  id, account_id, conversation_id, folder_id, provider_message_id,
                  message_id_header, in_reply_to, subject, snippet, body_text,
                  from_name, from_address, to_addresses, cc_addresses, bcc_addresses,
                  sent_at, received_at, is_read, is_starred, direction
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 'inbound')`,
              )
              .run(
                messageId,
                account.id,
                conversationId,
                inboxFolderId,
                providerId,
                messageIdHeader,
                inReplyTo,
                subject,
                snippet,
                bodyText,
                fromName,
                fromAddress,
                JSON.stringify(toAddresses),
                JSON.stringify(ccAddresses),
                sentAt,
                nowIso(),
                isRead,
                isStarred,
              );
            syncedCount += 1;
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();

      this.db.db
        .prepare(
          `UPDATE sync_state SET last_sync_at = ?, status = 'idle', last_error = NULL WHERE account_id = ?`,
        )
        .run(nowIso(), account.id);

      return { accountId: account.id, syncedCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.db.db
        .prepare(
          `UPDATE sync_state SET status = 'error', last_error = ? WHERE account_id = ?`,
        )
        .run(message, account.id);
      try {
        await client.logout();
      } catch {
        // ignore logout error
      }
      return { accountId: account.id, syncedCount, error: message };
    }
  }

  async syncAllAccounts(): Promise<SyncAllResult> {
    const all = this.accounts.list().filter((a) => a.syncEnabled && a.imapHost);
    const results: SyncAccountResult[] = [];
    let syncedCount = 0;
    for (const account of all) {
      const res = await this.syncAccount(account);
      results.push(res);
      syncedCount += res.syncedCount;
    }
    return { syncedCount, results };
  }
}
