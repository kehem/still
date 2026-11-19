import { useEffect, useMemo } from 'react';
import type { Account, Draft, Message } from '../../shared/types';
import { useDateFormatters } from '../hooks/useDateFormatters';
import {
  buildRows,
  matchesQuery,
  partitionByAccount,
  type MessageRow,
} from '../../shared/utils/messages';
import { useSettings } from '../hooks/useSettings';
import { ClockIcon, FileTextIcon, InboxIcon, PaperclipIcon, SearchIcon, TrashIcon } from './icons';

interface MessageListProps {
  title: string;
  messages: Message[];
  drafts: Draft[] | null;
  accounts: Account[];
  selectedMessageId: string | null;
  selectedConversationId: string | null;
  onSelect: (row: MessageRow) => void;
  onOpenDraft: (draft: Draft) => void;
  onTrashConversation: (id: string, restore: boolean) => void;
  onDeleteDraft: (draft: Draft) => void;
  query: string;
  onQueryChange: (q: string) => void;
  showAccountIndicator: boolean;
  followUpConversationIds: Set<string>;
  emptyHint: string;
}

export function MessageList({
  title,
  messages,
  drafts,
  accounts,
  selectedMessageId,
  selectedConversationId,
  onSelect,
  onOpenDraft,
  onDeleteDraft,
  onTrashConversation,
  query,
  onQueryChange,
  showAccountIndicator,
  followUpConversationIds,
  emptyHint,
}: MessageListProps) {
  const { settings } = useSettings();
  const dates = useDateFormatters();
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const rows = useMemo(() => {
    const filtered = messages.filter((m) => matchesQuery(m, query));
    return buildRows(filtered, {
      conversationGrouping: settings.conversationGrouping,
      sortOrder: settings.sortOrder,
    });
  }, [messages, query, settings.conversationGrouping, settings.sortOrder]);

  const groups = useMemo(
    () => (settings.groupByAccount ? partitionByAccount(rows) : null),
    [rows, settings.groupByAccount],
  );

  // Keyboard navigation: J/K move selection, / focuses search (spec §13).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key !== 'j' && e.key !== 'k') return;
      e.preventDefault();
      const idx = rows.findIndex(
        (r) =>
          r.message.id === selectedMessageId ||
          (r.conversationId !== null && r.conversationId === selectedConversationId),
      );
      const next = e.key === 'j' ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (rows[next]) onSelect(rows[next]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rows, selectedMessageId, selectedConversationId, onSelect]);

  const isDrafts = drafts !== null;
  const compact = settings.messageListLayout === 'compact';

  const renderRow = (row: MessageRow) => {
    const message = row.message;
    const account = accountById.get(message.accountId);
    const hasFollowUp =
      row.conversationId !== null && followUpConversationIds.has(row.conversationId);
    const selected =
      message.id === selectedMessageId ||
      (row.conversationId !== null && row.conversationId === selectedConversationId);
    const unread = row.hasUnread;

    return (
      <div key={row.key} className="flex items-center border-b border-border">
      <button
        type="button"
        onClick={() => onSelect(row)}
        className={`flex w-full items-start gap-2 px-4 text-left transition-colors ${
          compact ? 'py-[calc(var(--row-py)*0.6)]' : 'py-[var(--row-py)]'
        } ${selected ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
      >
        <span
          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
            unread ? 'bg-accent' : 'bg-transparent'
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={`truncate text-[13px] ${unread ? 'font-semibold' : ''} text-text`}
            >
              {compact ? (
                <>
                  <span className="text-text-secondary">
                    {message.direction === 'outbound' ? 'To: ' : ''}
                    {message.fromName || message.fromAddress}
                  </span>
                  <span className="mx-1.5 text-text-tertiary">·</span>
                  {message.subject}
                </>
              ) : (
                message.fromName || message.fromAddress
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-tertiary">
              {row.messageCount > 1 && settings.conversationGrouping && (
                <span>{row.messageCount}</span>
              )}
              <span>{dates.relative(message.sentAt)}</span>
            </span>
          </span>
          {!compact && (
            <span className="block truncate text-[13px] text-text">{message.subject}</span>
          )}
          {settings.showPreview && !compact && (
            <span className="block truncate text-[12px] text-text-secondary">
              {message.snippet}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 pt-1">
          {message.hasAttachments && <PaperclipIcon size={13} className="text-text-tertiary" />}
          {hasFollowUp && <ClockIcon size={13} className="text-accent" />}
          {showAccountIndicator && account?.color && (
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: account.color }}
              title={account.displayName}
            />
          )}
        </span>
      </button>
      {row.conversationId && <button type="button" className="mr-3 shrink-0 rounded p-2 text-text-secondary hover:bg-surface-hover" title={message.deletedAt ? 'Restore conversation (local only)' : 'Move conversation to Trash (local only)'} aria-label={message.deletedAt ? 'Restore conversation' : 'Delete conversation'} onClick={() => onTrashConversation(row.conversationId!, Boolean(message.deletedAt))}><TrashIcon size={15} /></button>}
      </div>
    );
  };

  return (
    <section className="flex min-h-0 w-full flex-col border-r border-border">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <span className="text-[12px] text-text-tertiary">
            {isDrafts ? drafts.length : rows.length}
          </span>
        </div>
        <div className="relative mt-2.5">
          <SearchIcon
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <input
            id="message-search"
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search"
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isDrafts ? (
          drafts.length === 0 ? (
            <EmptyState hint="No drafts. Compose a message and it will be saved here." />
          ) : (
            drafts.map((draft) => (
              // The row is a container, not a button: nesting an interactive
              // delete control inside an interactive row is invalid HTML and
              // breaks keyboard/AT behaviour.
              <div
                key={draft.id}
                className="group flex w-full items-start gap-2 border-b border-border px-4 py-[var(--row-py)] transition-colors hover:bg-surface-hover"
              >
                <FileTextIcon size={15} className="mt-0.5 shrink-0 text-text-tertiary" />
                <button
                  type="button"
                  onClick={() => onOpenDraft(draft)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[13px] font-medium">
                    {draft.subject || '(no subject)'}
                  </span>
                  <span className="block truncate text-[12px] text-text-secondary">
                    {draft.toAddresses.join(', ') || 'No recipients'}
                  </span>
                </button>
                <span className="shrink-0 pt-0.5 text-[11px] text-text-tertiary">
                  {dates.relative(draft.updatedAt)}
                </span>
                <button
                  type="button"
                  title="Delete draft"
                  aria-label={`Delete draft ${draft.subject || '(no subject)'}`}
                  onClick={() => void onDeleteDraft(draft)}
                  className="shrink-0 rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            ))
          )
        ) : rows.length === 0 ? (
          <EmptyState hint={emptyHint} />
        ) : groups ? (
          groups.map((group) => (
            <div key={group.accountId}>
              <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: accountById.get(group.accountId)?.color ?? '#9a9a9a',
                  }}
                />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {accountById.get(group.accountId)?.displayName ?? 'Unknown account'}
                </span>
                <span className="text-[11px] text-text-tertiary">{group.rows.length}</span>
              </div>
              {group.rows.map(renderRow)}
            </div>
          ))
        ) : (
          rows.map(renderRow)
        )}
      </div>
    </section>
  );
}

function EmptyState({ hint }: { hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <InboxIcon size={28} className="text-text-tertiary" />
      <p className="text-[13px] text-text-secondary">{hint}</p>
    </div>
  );
}
