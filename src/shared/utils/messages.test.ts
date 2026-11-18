import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
  buildRows,
  groupIntoConversations,
  matchesFolder,
  matchesQuery,
  partitionByAccount,
  sortMessages,
} from './messages';

function message(partial: Partial<Message> & Pick<Message, 'id'>): Message {
  return {
    accountId: 'acc-1',
    conversationId: null,
    folderId: null,
    providerMessageId: null,
    messageIdHeader: null,
    inReplyTo: null,
    referencesHeader: null,
    threadId: null,
    subject: '',
    snippet: '',
    bodyText: null,
    bodyHtml: null,
    fromName: '',
    fromAddress: '',
    toAddresses: [],
    ccAddresses: [],
    bccAddresses: [],
    sentAt: '2026-11-17T09:00:00.000Z',
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

const thread = [
  message({ id: 'm1', conversationId: 'c1', sentAt: '2026-11-10T09:00:00.000Z', subject: 'Proposal' }),
  message({ id: 'm2', conversationId: 'c1', sentAt: '2026-11-12T09:00:00.000Z', subject: 'Re: Proposal' }),
  message({ id: 'm3', conversationId: 'c1', sentAt: '2026-11-14T09:00:00.000Z', subject: 'Re: Proposal' }),
];

describe('sortMessages', () => {
  it('sorts newest first and oldest first', () => {
    expect(sortMessages(thread, 'newest').map((m) => m.id)).toEqual(['m3', 'm2', 'm1']);
    expect(sortMessages(thread, 'oldest').map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('does not mutate the input', () => {
    const input = [...thread];
    sortMessages(input, 'newest');
    expect(input.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('groupIntoConversations', () => {
  it('collapses a thread to its most recent message', () => {
    const grouped = groupIntoConversations(thread);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe('m3');
  });

  it('never collapses messages without a conversation id', () => {
    const loose = [
      message({ id: 'a', subject: 'Identical subject' }),
      message({ id: 'b', subject: 'Identical subject' }),
    ];
    expect(groupIntoConversations([...thread, ...loose]).map((m) => m.id)).toEqual([
      'm3',
      'a',
      'b',
    ]);
  });

  it('keeps conversations from different accounts separate even with identical subjects', () => {
    const same = [
      message({ id: 'x1', accountId: 'acc-1', conversationId: 'cx', subject: 'Invoice' }),
      message({ id: 'x2', accountId: 'acc-2', conversationId: 'cy', subject: 'Invoice' }),
    ];
    expect(groupIntoConversations(same)).toHaveLength(2);
  });
});

describe('buildRows', () => {
  it('returns one row per message when grouping is off', () => {
    const rows = buildRows(thread, { conversationGrouping: false, sortOrder: 'newest' });
    expect(rows.map((r) => r.message.id)).toEqual(['m3', 'm2', 'm1']);
    expect(rows.every((r) => r.messageCount === 3)).toBe(true);
    expect(rows[0].key).toBe('msg:m3');
  });

  it('returns one row per conversation when grouping is on', () => {
    const rows = buildRows(thread, { conversationGrouping: true, sortOrder: 'newest' });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('conv:c1');
    expect(rows[0].messageCount).toBe(3);
    expect(rows[0].conversationId).toBe('c1');
  });

  it('applies sort order to grouped rows', () => {
    const messages = [
      ...thread,
      message({ id: 'n1', conversationId: 'c2', sentAt: '2026-11-16T09:00:00.000Z' }),
    ];
    const newest = buildRows(messages, { conversationGrouping: true, sortOrder: 'newest' });
    expect(newest.map((r) => r.conversationId)).toEqual(['c2', 'c1']);
    const oldest = buildRows(messages, { conversationGrouping: true, sortOrder: 'oldest' });
    expect(oldest.map((r) => r.conversationId)).toEqual(['c1', 'c2']);
  });
});

describe('partitionByAccount', () => {
  it('groups rows by account while preserving order', () => {
    const rows = buildRows(
      [
        ...thread,
        message({ id: 'w1', accountId: 'acc-2', conversationId: 'c9', sentAt: '2026-11-15T09:00:00.000Z' }),
      ],
      { conversationGrouping: true, sortOrder: 'newest' },
    );
    const groups = partitionByAccount(rows);
    expect(groups.map((g) => g.accountId).sort()).toEqual(['acc-1', 'acc-2']);
    expect(groups.find((g) => g.accountId === 'acc-2')?.rows).toHaveLength(1);
  });
});

describe('matchesFolder', () => {
  it('keeps received, unsnoozed, unfiled mail in the inbox', () => {
    expect(matchesFolder(message({ id: 'a' }), 'inbox')).toBe(true);
    expect(matchesFolder(message({ id: 'a', isSnoozed: true }), 'inbox')).toBe(false);
    expect(matchesFolder(message({ id: 'a', folderId: 'f1' }), 'inbox')).toBe(false);
    expect(
      matchesFolder(message({ id: 'a', deletedAt: '2026-11-17T00:00:00.000Z' }), 'inbox'),
    ).toBe(false);
    expect(matchesFolder(message({ id: 'a', direction: 'outbound' }), 'inbox')).toBe(false);
  });

  it('puts outbound mail in sent and deleted mail in trash', () => {
    expect(matchesFolder(message({ id: 'a', direction: 'outbound' }), 'sent')).toBe(true);
    expect(matchesFolder(message({ id: 'a' }), 'sent')).toBe(false);
    expect(
      matchesFolder(message({ id: 'a', deletedAt: '2026-11-17T00:00:00.000Z' }), 'trash'),
    ).toBe(true);
    expect(matchesFolder(message({ id: 'a' }), 'trash')).toBe(false);
  });

  it('never lists drafts as messages and keeps archive free of sent mail', () => {
    expect(matchesFolder(message({ id: 'a' }), 'drafts')).toBe(false);
    expect(matchesFolder(message({ id: 'a', folderId: 'f1' }), 'archive')).toBe(true);
    expect(
      matchesFolder(message({ id: 'a', folderId: 'f1', direction: 'outbound' }), 'archive'),
    ).toBe(false);
  });
});

describe('buildRows unread state', () => {
  it('marks a collapsed row unread when any message in the thread is unread', () => {
    const messages = [
      message({ id: 'm1', conversationId: 'c1', isRead: false, sentAt: '2026-11-10T09:00:00.000Z' }),
      message({ id: 'm2', conversationId: 'c1', isRead: true, sentAt: '2026-11-12T09:00:00.000Z' }),
    ];
    const grouped = buildRows(messages, { conversationGrouping: true, sortOrder: 'newest' });
    expect(grouped).toHaveLength(1);
    expect(grouped[0].hasUnread).toBe(true);

    const flat = buildRows(messages, { conversationGrouping: false, sortOrder: 'newest' });
    expect(flat.map((r) => r.hasUnread)).toEqual([false, true]);
  });
});

describe('matchesQuery', () => {
  const m = message({
    id: 'm1',
    subject: 'Q4 planning sync',
    fromName: 'Sarah Chen',
    fromAddress: 'sarah@example.com',
    snippet: 'Let us align on the roadmap',
    bodyText: 'Attached is the draft budget.',
    toAddresses: ['alex@example.com'],
  });

  it('matches subject, sender, snippet, body and recipients', () => {
    for (const q of ['q4', 'sarah', 'example.com', 'roadmap', 'budget', 'alex@']) {
      expect(matchesQuery(m, q), q).toBe(true);
    }
  });

  it('returns true for an empty query and false for no match', () => {
    expect(matchesQuery(m, '   ')).toBe(true);
    expect(matchesQuery(m, 'zzz')).toBe(false);
  });
});
