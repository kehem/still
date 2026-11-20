import type { DatabaseService } from '../database/db';

function messageIds(value: string | null | undefined): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

/** Resolve RFC reply headers from the persisted thread, including reopened drafts. */
export function replyHeaders(db: DatabaseService, input: { accountId: string; conversationId?: string | null; inReplyTo?: string | null }) {
  const explicit = input.inReplyTo ? messageIds(input.inReplyTo)[0] : undefined;
  if (input.inReplyTo && explicit !== input.inReplyTo) throw new Error('Invalid reply Message-ID.');
  if (!input.conversationId) return { inReplyTo: explicit, references: explicit ? [explicit] : undefined };
  const conversation = db.db.prepare('SELECT account_id FROM conversations WHERE id = ?').get(input.conversationId) as { account_id: string } | undefined;
  if (!conversation || conversation.account_id !== input.accountId) throw new Error('The original conversation does not belong to this sending account.');
  const parent = db.db.prepare(`SELECT message_id_header, in_reply_to, references_header FROM messages
    WHERE conversation_id = ? AND account_id = ? ${explicit ? 'AND message_id_header = ?' : ''}
    ORDER BY sent_at DESC, rowid DESC LIMIT 1`).get(...(explicit ? [input.conversationId, input.accountId, explicit] : [input.conversationId, input.accountId])) as {
      message_id_header: string | null; in_reply_to: string | null; references_header: string | null;
    } | undefined;
  const inReplyTo = explicit ?? messageIds(parent?.message_id_header)[0];
  if (!parent || !inReplyTo) throw new Error('The original message has no Message-ID. Sync the conversation before replying.');
  const references = [...new Set([...messageIds(parent.references_header), ...messageIds(parent.in_reply_to), inReplyTo])];
  return { inReplyTo, references };
}
