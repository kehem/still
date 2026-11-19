import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../shared/types';
import { FOLDER_FILTERS } from '../../shared/types';
import { matchesFolder } from '../../shared/utils/messages';

// `db.ts` reads the Electron userData path; the repository logic under test
// does not need Electron, so the module is stubbed.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/still-test' },
}));

const { DatabaseService } = await import('./db');
const { MessageRepository } = await import('./repositories');

interface Fixture {
  id: string;
  direction: 'inbound' | 'outbound';
  isSnoozed: boolean;
  folderId: string | null;
  deletedAt: string | null;
  isRead: boolean;
  sentAt: string;
}

const FIXTURES: Fixture[] = [
  { id: 'in-clean', direction: 'inbound', isSnoozed: false, folderId: null, deletedAt: null, isRead: false, sentAt: '2026-11-17T09:00:00.000Z' },
  { id: 'in-read', direction: 'inbound', isSnoozed: false, folderId: null, deletedAt: null, isRead: true, sentAt: '2026-11-16T09:00:00.000Z' },
  { id: 'in-snoozed', direction: 'inbound', isSnoozed: true, folderId: null, deletedAt: null, isRead: true, sentAt: '2026-11-15T09:00:00.000Z' },
  { id: 'in-archived', direction: 'inbound', isSnoozed: false, folderId: 'f-archive', deletedAt: null, isRead: true, sentAt: '2026-11-14T09:00:00.000Z' },
  { id: 'out-sent', direction: 'outbound', isSnoozed: false, folderId: 'f-sent', deletedAt: null, isRead: true, sentAt: '2026-11-13T09:00:00.000Z' },
  { id: 'out-plain', direction: 'outbound', isSnoozed: false, folderId: null, deletedAt: null, isRead: true, sentAt: '2026-11-12T09:00:00.000Z' },
  { id: 'in-deleted', direction: 'inbound', isSnoozed: false, folderId: null, deletedAt: '2026-11-11T09:00:00.000Z', isRead: true, sentAt: '2026-11-11T09:00:00.000Z' },
];

function toMessage(f: Fixture): Message {
  return {
    id: f.id,
    accountId: 'acc-1',
    conversationId: null,
    folderId: f.folderId,
    providerMessageId: null,
    messageIdHeader: null,
    inReplyTo: null,
    referencesHeader: null,
    threadId: null,
    subject: f.id,
    snippet: '',
    bodyText: null,
    bodyHtml: null,
    fromName: '',
    fromAddress: 'someone@example.com',
    toAddresses: [],
    ccAddresses: [],
    bccAddresses: [],
    sentAt: f.sentAt,
    receivedAt: null,
    isRead: f.isRead,
    isStarred: false,
    isSnoozed: f.isSnoozed,
    snoozedUntil: null,
    hasAttachments: false,
    direction: f.direction,
    deletedAt: f.deletedAt,
  };
}

describe('MessageRepository.list folder semantics', () => {
  let repo: InstanceType<typeof MessageRepository>;
  let service: InstanceType<typeof DatabaseService>;

  beforeAll(() => {
    service = new DatabaseService(':memory:');
    const ts = new Date().toISOString();
    service.db
      .prepare(
        "INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('acc-1', 'imap', 'Personal', 'a@example.com', ?, ?)",
      )
      .run(ts, ts);
    // Messages reference real folder rows (foreign keys are enforced).
    const insertFolder = service.db.prepare(
      "INSERT INTO folders(id, account_id, name, kind) VALUES(?, 'acc-1', ?, ?)",
    );
    insertFolder.run('f-archive', 'Archive', 'archive');
    insertFolder.run('f-sent', 'Sent', 'sent');
    const insert = service.db.prepare(
      `INSERT INTO messages(id, account_id, folder_id, subject, from_address, sent_at,
         is_read, is_snoozed, direction, deleted_at, created_at)
       VALUES(@id, 'acc-1', @folderId, @subject, 'someone@example.com', @sentAt,
         @isRead, @isSnoozed, @direction, @deletedAt, @sentAt)`,
    );
    for (const f of FIXTURES) {
      insert.run({
        id: f.id,
        folderId: f.folderId,
        subject: f.id,
        sentAt: f.sentAt,
        isRead: f.isRead ? 1 : 0,
        isSnoozed: f.isSnoozed ? 1 : 0,
        direction: f.direction,
        deletedAt: f.deletedAt,
      });
    }
    repo = new MessageRepository(service);
  });

  it('matches the shared pure predicate for every folder filter', () => {
    for (const kind of FOLDER_FILTERS) {
      const sqlIds = repo.list({ folderKind: kind }).map((m) => m.id).sort();
      const pureIds = FIXTURES.filter((f) => matchesFolder(toMessage(f), kind))
        .map((f) => f.id)
        .sort();
      expect(sqlIds, `folder filter "${kind}"`).toEqual(pureIds);
    }
  });

  it('returns received, unsnoozed, unfiled mail for the inbox', () => {
    expect(repo.list({ folderKind: 'inbox' }).map((m) => m.id).sort()).toEqual([
      'in-clean',
      'in-read',
    ]);
  });

  it('never shows sent mail in the archive or snoozed mail in the inbox', () => {
    expect(repo.list({ folderKind: 'archive' }).map((m) => m.id)).toEqual(['in-archived']);
    expect(repo.list({ folderKind: 'snoozed' }).map((m) => m.id)).toEqual(['in-snoozed']);
  });

  it('returns nothing for drafts, which live in their own table', () => {
    expect(repo.list({ folderKind: 'drafts' })).toEqual([]);
  });

  it('scopes results to one account', () => {
    expect(repo.list({ folderKind: 'inbox', accountId: 'acc-1' })).toHaveLength(2);
    expect(repo.list({ folderKind: 'inbox', accountId: 'acc-other' })).toHaveLength(0);
  });

  it('orders newest first and honours limit and offset', () => {
    const all = repo.list({});
    expect(all.map((m) => m.id)[0]).toBe('in-clean');
    expect(repo.list({ limit: 2 }).map((m) => m.id)).toEqual(['in-clean', 'in-read']);
    expect(repo.list({ limit: 2, offset: 2 }).map((m) => m.id)).toEqual([
      'in-snoozed',
      'in-archived',
    ]);
  });

  it('marks a whole conversation as read in one transaction', () => {
    const ts = new Date().toISOString();
    service.db
      .prepare(
        "INSERT INTO conversations(id, account_id, subject, last_message_at, unread_count, created_at, updated_at) VALUES('c-read', 'acc-1', 'Thread', ?, 2, ?, ?)",
      )
      .run(ts, ts, ts);
    const insert = service.db.prepare(
      `INSERT INTO messages(id, account_id, conversation_id, subject, from_address, sent_at, is_read, direction, created_at)
       VALUES(?, 'acc-1', 'c-read', 'Thread', 'someone@example.com', ?, 0, 'inbound', ?)`,
    );
    insert.run('t1', ts, ts);
    insert.run('t2', ts, ts);

    repo.markConversationRead('c-read');

    const unread = service.db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'c-read' AND is_read = 0")
      .get() as { n: number };
    const conversation = service.db
      .prepare("SELECT unread_count FROM conversations WHERE id = 'c-read'")
      .get() as { unread_count: number };
    expect(unread.n).toBe(0);
    expect(conversation.unread_count).toBe(0);
  });
  it('moves only the selected conversation to local Trash and restores original folders', () => {
    const ts = new Date().toISOString();
    service.db.prepare(
      "INSERT INTO conversations(id, account_id, subject, last_message_at, created_at, updated_at) VALUES('c-trash', 'acc-1', 'Trash test', ?, ?, ?)",
    ).run(ts, ts, ts);
    const insert = service.db.prepare(
      `INSERT INTO messages(id, account_id, conversation_id, folder_id, subject, from_address, sent_at, direction, created_at)
       VALUES(?, 'acc-1', 'c-trash', ?, 'Trash test', 'someone@example.com', ?, ?, ?)`,
    );
    insert.run('trash-in', null, ts, 'inbound', ts);
    insert.run('trash-out', 'f-sent', ts, 'outbound', ts);
    repo.setConversationTrashed('c-trash', true);
    expect(repo.list({ folderKind: 'trash' }).map((m) => m.id)).toEqual(expect.arrayContaining(['trash-in', 'trash-out']));
    expect(repo.list({ folderKind: 'inbox' }).some((m) => m.id === 'trash-in')).toBe(false);
    expect(repo.list({ folderKind: 'sent' }).some((m) => m.id === 'trash-out')).toBe(false);
    expect(repo.list({ folderKind: 'inbox' }).some((m) => m.id === 'in-clean')).toBe(true);
    repo.setConversationTrashed('c-trash', false);
    expect(repo.list({ folderKind: 'trash' }).some((m) => m.conversationId === 'c-trash')).toBe(false);
    expect(repo.list({ folderKind: 'inbox' }).some((m) => m.id === 'trash-in')).toBe(true);
    expect(repo.list({ folderKind: 'sent' }).find((m) => m.id === 'trash-out')?.folderId).toBe('f-sent');
    repo.setConversationTrashed('missing-conversation', true);
  });

});
