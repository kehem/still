import type { FolderFilter, Message } from '../types';

/**
 * Message-list shaping logic (spec §8, §10, §11 Inbox settings).
 *
 * Kept outside UI components so it can be unit tested and reused by both the
 * unified inbox and account-specific inboxes.
 */

/**
 * Semantic folder membership. `MessageRepository.list()` implements the same
 * rules in SQL; `repositories.folder-parity.test.ts` asserts the two agree so
 * the Electron path and the preview path can never drift apart.
 */
export function matchesFolder(message: Message, kind: FolderFilter): boolean {
  switch (kind) {
    case 'inbox':
      return (
        message.direction === 'inbound' &&
        !message.isSnoozed &&
        !message.folderId &&
        !message.deletedAt
      );
    case 'sent':
      return message.direction === 'outbound' && !message.deletedAt;
    case 'snoozed':
      return message.isSnoozed && !message.deletedAt;
    case 'drafts':
      // Drafts live in their own table; they are never message rows.
      return false;
    case 'archive':
      // Archive holds received mail the user filed away; sent mail stays in Sent.
      return (
        message.folderId !== null && message.direction === 'inbound' && !message.deletedAt
      );
    case 'trash':
      return message.deletedAt !== null;
    default:
      return true;
  }
}

export interface MessageRow {
  /** Stable key for list rendering. */
  key: string;
  /** Representative message shown in the row. */
  message: Message;
  /** Conversation this row opens, when threading is known. */
  conversationId: string | null;
  /** Number of messages collapsed into this row (1 when not grouped). */
  messageCount: number;
  /** True when this row or any message collapsed into it is unread. */
  hasUnread: boolean;
}

export interface BuildRowsOptions {
  /** Collapse messages that belong to the same conversation into one row. */
  conversationGrouping: boolean;
  sortOrder: 'newest' | 'oldest';
}

export function sortMessages(
  messages: readonly Message[],
  order: 'newest' | 'oldest',
): Message[] {
  const sorted = [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  return order === 'newest' ? sorted.reverse() : sorted;
}

/**
 * Collapse a message list into one row per conversation, keeping the most
 * recent message of each conversation as the representative.
 *
 * Messages without a known conversation id are never collapsed — threading is
 * established from Message-ID / In-Reply-To / References / provider thread ids
 * (spec §6.5), and guessing from identical subjects is explicitly not allowed.
 */
export function groupIntoConversations(messages: readonly Message[]): Message[] {
  const byConversation = new Map<string, Message>();
  const standalone: Message[] = [];

  for (const message of messages) {
    if (!message.conversationId) {
      standalone.push(message);
      continue;
    }
    const existing = byConversation.get(message.conversationId);
    if (!existing || message.sentAt > existing.sentAt) {
      byConversation.set(message.conversationId, message);
    }
  }

  return [...byConversation.values(), ...standalone];
}

export function countByConversation(
  messages: readonly Message[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (!message.conversationId) continue;
    counts.set(message.conversationId, (counts.get(message.conversationId) ?? 0) + 1);
  }
  return counts;
}

export function unreadByConversation(
  messages: readonly Message[],
): Map<string, boolean> {
  const unread = new Map<string, boolean>();
  for (const message of messages) {
    if (!message.conversationId) continue;
    unread.set(
      message.conversationId,
      (unread.get(message.conversationId) ?? false) || !message.isRead,
    );
  }
  return unread;
}

export function buildRows(
  messages: readonly Message[],
  options: BuildRowsOptions,
): MessageRow[] {
  const counts = countByConversation(messages);
  const unread = unreadByConversation(messages);
  const visible = options.conversationGrouping
    ? groupIntoConversations(messages)
    : [...messages];

  return sortMessages(visible, options.sortOrder).map((message) => {
    const grouped = Boolean(message.conversationId) && options.conversationGrouping;
    return {
      key: grouped ? `conv:${message.conversationId}` : `msg:${message.id}`,
      message,
      conversationId: message.conversationId,
      messageCount: message.conversationId ? (counts.get(message.conversationId) ?? 1) : 1,
      // A collapsed row is unread when any message in the thread is unread.
      hasUnread: grouped
        ? (unread.get(message.conversationId as string) ?? !message.isRead)
        : !message.isRead,
    };
  });
}

/** Group rows under per-account headers for the unified inbox (spec §5). */
export interface AccountGroup {
  accountId: string;
  rows: MessageRow[];
}

export function partitionByAccount(rows: readonly MessageRow[]): AccountGroup[] {
  const groups = new Map<string, MessageRow[]>();
  for (const row of rows) {
    const list = groups.get(row.message.accountId);
    if (list) list.push(row);
    else groups.set(row.message.accountId, [row]);
  }
  return [...groups.entries()].map(([accountId, groupRows]) => ({
    accountId,
    rows: groupRows,
  }));
}

/** Client-side text search over sender, recipient, subject and preview (§12). */
export function matchesQuery(message: Message, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    message.fromName,
    message.fromAddress,
    message.subject,
    message.snippet,
    message.bodyText ?? '',
    ...message.toAddresses,
    ...message.ccAddresses,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}
