import type { Account, ConversationDetail, FollowUpListItem } from '../../shared/types';
import { useDateFormatters } from '../hooks/useDateFormatters';
import { ClockIcon, ForwardIcon, InboxIcon, PaperclipIcon, ReplyIcon, XIcon } from './icons';

interface ReadingPaneProps {
  detail: ConversationDetail | null;
  account: Account | null;
  followUp: FollowUpListItem | null;
  onReply: (detail: ConversationDetail, mode: 'reply' | 'reply-all' | 'forward') => void;
  /** One-click tracking of an outbound conversation (spec §6.1). */
  onEnableFollowUp: (detail: ConversationDetail) => void;
  /** One-click stop of tracking; history is preserved. */
  onDisableFollowUp: (detail: ConversationDetail) => void;
  /** For inbound-only threads: answer with follow-up switched on. */
  onReplyWithFollowUp: (detail: ConversationDetail) => void;
  onSendFollowUp: (item: FollowUpListItem) => void;
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  due: 'Due today',
  overdue: 'Overdue',
  waiting: 'Waiting for reply',
  replied: 'Replied',
  completed: 'Completed',
  snoozed: 'Snoozed',
  cancelled: 'Cancelled',
};

export function ReadingPane({
  detail,
  account,
  followUp,
  onReply,
  onEnableFollowUp,
  onDisableFollowUp,
  onReplyWithFollowUp,
  onSendFollowUp,
}: ReadingPaneProps) {
  const dates = useDateFormatters();

  if (!detail) {
    return (
      <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 px-8">
        <InboxIcon size={32} className="text-text-tertiary" />
        <p className="text-[13px] text-text-secondary">Select a conversation to read it here.</p>
      </main>
    );
  }

  const { conversation, messages } = detail;
  const hasOutbound = messages.some((m) => m.direction === 'outbound');
  const trackingActive =
    followUp !== null &&
    followUp.status !== 'completed' &&
    followUp.status !== 'replied' &&
    followUp.status !== 'cancelled';

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border px-6 pb-4 pt-5">
        <h1 className="text-[22px] font-semibold leading-snug">{conversation.subject}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-secondary">
          <span>{conversation.participants.join(', ')}</span>
          {account && (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: account.color ?? '#9a9a9a' }}
              />
              {account.displayName}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ActionButton icon={<ReplyIcon size={14} />} label="Reply" onClick={() => onReply(detail, 'reply')} />
          <ActionButton icon={<ReplyIcon size={14} />} label="Reply all" onClick={() => onReply(detail, 'reply-all')} />
          <ActionButton icon={<ForwardIcon size={14} />} label="Forward" onClick={() => onReply(detail, 'forward')} />
          <span className="mx-1 h-4 w-px bg-border" />
          {followUp ? (
            <>
              <span className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <ClockIcon size={13} className={trackingActive ? 'text-accent' : ''} />
                Follow-up · Stage {followUp.currentStage + 1} of {followUp.stageCount} ·{' '}
                {STATUS_LABELS[followUp.status] ?? followUp.status}
                {followUp.nextDueAt && <> · due {dates.relative(followUp.nextDueAt)}</>}
              </span>
              {trackingActive ? (
                <>
                  <ActionButton
                    icon={<ClockIcon size={14} />}
                    label="Send follow-up"
                    onClick={() => onSendFollowUp(followUp)}
                  />
                  <ActionButton
                    icon={<XIcon size={14} />}
                    label="Stop tracking"
                    onClick={() => onDisableFollowUp(detail)}
                  />
                </>
              ) : (
                // A finished sequence keeps its history but can be started
                // again — the repository only blocks *active* duplicates.
                hasOutbound && (
                  <ActionButton
                    icon={<ClockIcon size={14} />}
                    label="Enable follow-up"
                    onClick={() => onEnableFollowUp(detail)}
                  />
                )
              )}
            </>
          ) : hasOutbound ? (
            // One click starts tracking with the preferred default schedule.
            <ActionButton
              icon={<ClockIcon size={14} />}
              label="Enable follow-up"
              onClick={() => onEnableFollowUp(detail)}
            />
          ) : (
            // Nothing was sent yet, so there is nothing to follow up on:
            // answer with follow-up switched on instead.
            <ActionButton
              icon={<ClockIcon size={14} />}
              label="Reply with follow-up"
              onClick={() => onReplyWithFollowUp(detail)}
            />
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        {messages.map((message) => (
          <article key={message.id} className="border-b border-border py-5 last:border-b-0">
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <span className="text-[13px] font-semibold">
                  {message.fromName || message.fromAddress}
                </span>
                <span className="ml-2 text-[12px] text-text-secondary">
                  {message.direction === 'outbound' ? 'to ' : ''}
                  {message.direction === 'outbound'
                    ? message.toAddresses.join(', ')
                    : message.fromAddress}
                </span>
              </div>
              <span className="shrink-0 text-[12px] text-text-tertiary">
                {dates.full(message.sentAt)}
              </span>
            </div>
            {message.bodyText && (
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-text">
                {message.bodyText}
              </p>
            )}
            {message.hasAttachments && (
              <div className="mt-3 flex items-center gap-1.5 text-[12px] text-text-secondary">
                <PaperclipIcon size={13} />
                Attachment
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text"
    >
      {icon}
      {label}
    </button>
  );
}
