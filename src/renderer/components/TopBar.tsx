import { useEffect, useRef, useState } from 'react';
import type { NotificationItem } from '../../shared/types';
import { APP_NAME } from '../../shared/constants';
import { isElectron } from '../services/api';
import { BellIcon, CheckIcon, PenIcon, RefreshIcon, XIcon } from './icons';

interface TopBarProps {
  onCompose: () => void;
  onToggleSidebar: () => void;
  /**
   * `local` — data is on this device and no provider sync has run yet
   * (Phase 1). `syncing` / `upToDate` are driven by the sync engine (Phase 3).
   */
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';
  onSync?: () => void;
  /** Reminders raised for follow-ups that fell due (spec §6.7). */
  notifications: NotificationItem[];
  unreadNotifications: number;
  onOpenNotification: (notification: NotificationItem) => void;
  onDismissNotification: (id: string) => void;
  onMarkAllNotificationsRead: () => void;
}

const SYNC_LABEL: Record<TopBarProps['syncStatus'], string> = {
  local: 'Local',
  syncing: 'Syncing…',
  synced: 'Synced',
  error: 'Sync error',
};

function dueLabel(notification: NotificationItem): string {
  if (!notification.dueAt) return '';
  const due = new Date(notification.dueAt);
  if (Number.isNaN(due.getTime())) return '';
  const hours = Math.round((Date.now() - due.getTime()) / 3_600_000);
  if (hours < 1) return 'due now';
  if (hours < 24) return `due ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `due ${days}d ago`;
}

export function TopBar({
  onCompose,
  onToggleSidebar,
  syncStatus,
  onSync,
  notifications,
  unreadNotifications,
  onOpenNotification,
  onDismissNotification,
  onMarkAllNotificationsRead,
}: TopBarProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on outside click or Escape, like the other popovers.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <header className="drag-region flex h-11 shrink-0 items-center gap-3 border-b border-border pl-4 pr-36">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="no-drag text-[15px] font-semibold tracking-tight text-text"
        title="Toggle sidebar"
      >
        {APP_NAME}
      </button>
      {!isElectron && (
        <span className="no-drag rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
          Preview
        </span>
      )}
      <div className="flex-1" />

      <div className="no-drag relative" ref={panelRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Reminders${unreadNotifications > 0 ? `, ${unreadNotifications} unread` : ''}`}
          title="Follow-up reminders"
          className="relative flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text"
        >
          <BellIcon size={15} />
          {unreadNotifications > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
              {unreadNotifications > 99 ? '99+' : unreadNotifications}
            </span>
          )}
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Follow-up reminders"
            className="absolute right-0 top-9 z-40 w-[340px] border border-border bg-bg"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[12px] font-semibold">Reminders</span>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllNotificationsRead}
                  className="flex items-center gap-1 text-[11px] text-text-tertiary transition-colors hover:text-accent"
                >
                  <CheckIcon size={11} />
                  Mark all read
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-text-tertiary">
                No reminders.
                <br />
                Due follow-ups appear here — and survive a restart.
              </p>
            ) : (
              <ul className="max-h-[320px] overflow-y-auto">
                {notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className="group flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onOpenNotification(notification);
                        setOpen(false);
                      }}
                      aria-label={`Open reminder: ${notification.title}`}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        {!notification.isRead && (
                          <span
                            aria-label="Unread"
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                          />
                        )}
                        <span
                          className={
                            notification.kind === 'followup_overdue'
                              ? 'truncate text-[12px] font-semibold text-danger'
                              : 'truncate text-[12px] font-semibold'
                          }
                        >
                          {notification.title}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-text-secondary">
                        {notification.body}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-text-tertiary">
                        {dueLabel(notification)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismissNotification(notification.id)}
                      aria-label={`Dismiss reminder: ${notification.title}`}
                      className="mt-0.5 shrink-0 text-text-tertiary opacity-0 transition-opacity hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <XIcon size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onSync}
        disabled={syncStatus === 'syncing'}
        aria-label="Sync email"
        title="Sync email with mail server"
        className="no-drag flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text disabled:opacity-60"
      >
        <RefreshIcon
          size={13}
          className={syncStatus === 'syncing' ? 'animate-spin text-accent' : 'text-text-secondary'}
        />
        {syncStatus === 'local' ? 'Sync' : SYNC_LABEL[syncStatus]}
      </button>
      <button
        type="button"
        onClick={onCompose}
        className="no-drag flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
      >
        <PenIcon size={14} />
        Compose
      </button>
    </header>
  );
}
