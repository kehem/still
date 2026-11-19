import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Account,
  ConversationDetail,
  Draft,
  FollowUpListItem,
  Message,
  NotificationItem,
} from '../shared/types';
import { ALL_INBOX } from '../shared/constants';
import { folderToMessageOptions, resolveHomeFolder } from '../shared/utils/navigation';
import type { MessageRow } from '../shared/utils/messages';
import { getAPI, isElectron } from './services/api';
import { SettingsProvider, useSettings } from './hooks/useSettings';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { ReadingPane } from './components/ReadingPane';
import { Composer } from './components/Composer';
import { AutomationPage } from './features/automation/AutomationPage';
import { FollowUpsPage } from './components/FollowUpsPage';
import { SettingsPage, type SettingsSection } from './components/SettingsPage';
import { SetupScreen } from './features/setup/SetupScreen';

type View =
  | { kind: 'mail'; folder: string }
  | { kind: 'followups' }
  | { kind: 'automation' }
  | { kind: 'settings'; section: SettingsSection };

type ComposerState = { open: boolean; initial: Partial<Draft> & { id?: string } };

/** A selected row keeps both ids: the list highlights the message, the reading
 *  pane loads the conversation. They differ because a message id is not a
 *  conversation id. */
type Selection = { messageId: string | null; conversationId: string | null };

const LAST_FOLDER_KEY = 'still:last-folder';

function readLastFolder(): string | null {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY);
  } catch {
    return null;
  }
}

function writeLastFolder(folder: string): void {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, folder);
  } catch {
    // Storage unavailable — last-used inbox simply won't be remembered.
  }
}

function Shell() {
  const { settings, update } = useSettings();
  const [phase, setPhase] = useState<'loading' | 'setup' | 'app'>('loading');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpListItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [selection, setSelection] = useState<Selection>({
    messageId: null,
    conversationId: null,
  });
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [query, setQuery] = useState('');
  const [composer, setComposer] = useState<ComposerState>({ open: false, initial: {} });
  const [syncStatus, setSyncStatus] = useState<'local' | 'syncing' | 'synced' | 'error'>('local');
  const syncingRef = useRef(false);
  const [listWidth, setListWidth] = useState(360);
  const [reloadToken, setReloadToken] = useState(0);

  const refreshAccounts = useCallback(async () => {
    const list = await getAPI().listAccounts();
    setAccounts(list);
    setPhase(list.length === 0 ? 'setup' : 'app');
  }, []);

  const refreshFollowUps = useCallback(async () => {
    setFollowUps(await getAPI().listFollowUps());
  }, []);

  /**
   * Re-derives due reminders from stored timestamps, then reads the list.
   * Called on launch and whenever follow-ups change, so a reminder that fell
   * due while the app was closed is raised here rather than by a timer.
   */
  const refreshNotifications = useCallback(async () => {
    const api = getAPI();
    await api.scanReminders();
    const [list, unread] = await Promise.all([
      api.listNotifications(50),
      api.unreadNotificationCount(),
    ]);
    setNotifications(list);
    setUnreadNotifications(unread);
  }, []);

  useEffect(() => {
    void refreshAccounts();
    void refreshFollowUps();
    void refreshNotifications();
  }, [refreshAccounts, refreshFollowUps, refreshNotifications]);

  // First-launch routing (spec §4): no accounts → setup, otherwise the home
  // inbox resolved from settings. Never a dashboard.
  useEffect(() => {
    if (phase !== 'app' || view !== null || accounts.length === 0) return;
    setView({
      kind: 'mail',
      folder: resolveHomeFolder(settings, accounts, readLastFolder()),
    });
  }, [phase, view, accounts, settings]);

  // Turning the unified inbox off while it is open must not leave the user on a
  // folder that no longer exists in navigation.
  useEffect(() => {
    if (
      phase === 'app' &&
      !settings.unifiedInboxEnabled &&
      view?.kind === 'mail' &&
      view.folder === ALL_INBOX &&
      accounts.length > 0
    ) {
      setView({ kind: 'mail', folder: resolveHomeFolder(settings, accounts, null) });
    }
  }, [phase, settings, view, accounts]);

  // Remember the last-used inbox (Settings → General).
  useEffect(() => {
    if (view?.kind === 'mail' && settings.rememberLastInbox) writeLastFolder(view.folder);
  }, [view, settings.rememberLastInbox]);

  // Theme (light / dark / system) — spec §9.
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved =
        settings.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : settings.theme;
      root.dataset.theme = resolved;
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  // Font size, density and accent colour are applied as design tokens.
  useEffect(() => {
    const root = document.documentElement;
    document.body.style.fontSize =
      settings.fontSize === 'small' ? '13px' : settings.fontSize === 'large' ? '15px' : '14px';
    root.dataset.density = settings.density;
    if (settings.accentColor && settings.accentColor !== '#3E6FA3') {
      root.style.setProperty('--accent', settings.accentColor);
    } else {
      root.style.removeProperty('--accent');
    }
  }, [settings.fontSize, settings.density, settings.accentColor]);

  // Load the messages of the active folder.
  useEffect(() => {
    if (phase !== 'app' || view?.kind !== 'mail') return;
    const folder = view.folder;
    let active = true;
    void (async () => {
      if (folder === 'drafts') {
        const list = await getAPI().listDrafts();
        if (active) {
          setDrafts(list);
          setMessages([]);
        }
        return;
      }
      const list = await getAPI().listMessages(folderToMessageOptions(folder, accounts));
      if (active) setMessages(list);
    })();
    return () => {
      active = false;
    };
  }, [phase, view, accounts, reloadToken]);

  // Load the selected conversation, and mark it read when the setting says so.
  useEffect(() => {
    const conversationId = selection.conversationId;
    if (!conversationId) {
      setDetail(null);
      return;
    }
    let active = true;
    void getAPI()
      .getConversation(conversationId)
      .then((d) => {
        if (active) setDetail(d);
      });
    if (settings.markAsReadOnOpen) {
      void getAPI()
        .markConversationRead(conversationId)
        .then(() => {
          if (active) setReloadToken((t) => t + 1);
        });
    }
    return () => {
      active = false;
    };
  }, [selection.conversationId, settings.markAsReadOnOpen]);

  const handleSync = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const res = await getAPI().syncEmails();
      const hasError = res.results.some((r) => Boolean(r.error));
      setSyncStatus(hasError ? 'error' : 'synced');
      if (view?.kind === 'mail') {
        const list = await getAPI().listMessages(folderToMessageOptions(view.folder, accounts));
        setMessages(list);
      }
      if (selection.conversationId) {
        const conv = await getAPI().getConversation(selection.conversationId);
        if (conv) setDetail(conv);
      }
    } catch {
      setSyncStatus('error');
    }
  }, [view, accounts]);

  const openComposer = useCallback(
    (initial: Partial<Draft> & { id?: string }) => {
      const accountId =
        initial.accountId ?? settings.defaultSendingAccountId ?? accounts[0]?.id ?? null;
      setComposer({ open: true, initial: { accountId, ...initial } });
    },
    [accounts, settings.defaultSendingAccountId],
  );

  // Reply / reply all / forward from the open conversation. The account that
  // received the mail is used by default (spec §5).
  const openReply = useCallback(
    (d: ConversationDetail, mode: 'reply' | 'reply-all' | 'forward') => {
      const last = d.messages[d.messages.length - 1];
      const subject =
        mode === 'forward' ? `Fwd: ${d.conversation.subject}` : `Re: ${d.conversation.subject}`;
      const to =
        mode === 'reply' || !last
          ? [last?.fromAddress ?? d.conversation.participants[0] ?? ''].filter(Boolean)
          : [last.fromAddress, ...last.toAddresses.filter((a) => a !== last.fromAddress)];
      const cc =
        mode === 'reply-all' && last && settings.ccOnReplyAll ? last.ccAddresses : [];
      openComposer({
        accountId: d.conversation.accountId,
        toAddresses: to,
        ccAddresses: cc,
        subject,
        inReplyToConversationId: d.conversation.id,
      });
    },
    [openComposer, settings.ccOnReplyAll],
  );

  /** One-click follow-up activation on an outbound conversation (spec §6.1). */
  const enableFollowUp = useCallback(
    async (d: ConversationDetail) => {
      await getAPI().createFollowUp({ conversationId: d.conversation.id });
      await refreshFollowUps();
      await refreshNotifications();
    },
    [refreshFollowUps, refreshNotifications],
  );

  /** One-click stop; the sequence and its history are preserved. */
  const disableFollowUp = useCallback(
    async (d: ConversationDetail) => {
      await getAPI().disableFollowUp(d.conversation.id);
      await refreshFollowUps();
      // Turning tracking off must also clear its pending reminders.
      await refreshNotifications();
    },
    [refreshFollowUps, refreshNotifications],
  );

  // Where "Esc" and startup return to: the resolved home inbox.
  const homeFolder = useMemo(
    () => resolveHomeFolder(settings, accounts, readLastFolder()),
    [settings, accounts],
  );

  // Global shortcuts (spec §13). Text editing and OS shortcuts are left alone.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (e.key === 'Escape') {
        if (composer.open) setComposer({ open: false, initial: {} });
        else if (view?.kind !== 'mail') setView({ kind: 'mail', folder: homeFolder });
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || composer.open) return;

      const key = e.key.toLowerCase();
      if (key === 'c') {
        e.preventDefault();
        openComposer({});
        return;
      }
      if (!detail) return;
      if (key === 'r') {
        e.preventDefault();
        // The R shortcut follows the configured reply behaviour.
        openReply(detail, settings.replyBehavior);
      } else if (key === 'a') {
        e.preventDefault();
        openReply(detail, 'reply-all');
      } else if (key === 'f') {
        e.preventDefault();
        openReply(detail, 'forward');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [composer.open, view, openComposer, openReply, detail, homeFolder, settings.replyBehavior]);

  const selectRow = useCallback((row: MessageRow) => {
    setSelection({ messageId: row.message.id, conversationId: row.conversationId });
  }, []);

  const trashConversation = async (conversation: ConversationDetail, restore: boolean) => {
    if (!restore && settings.confirmBeforeDelete && !window.confirm(
      `Move "${conversation.conversation.subject || '(no subject)'}" to Trash? This affects the entire local conversation only. You can restore it from Trash. Mail at your provider is unchanged.`,
    )) return;
    try {
      const api = getAPI();
      if (restore) await api.restoreConversation(conversation.conversation.id);
      else await api.trashConversation(conversation.conversation.id);
      setSelection({ messageId: null, conversationId: null });
      setDetail(null);
      setReloadToken((t) => t + 1);
    } catch {
      window.alert('Could not update this conversation. Please try again.');
    }
  };

  /** Deletes a local draft, honouring the delete confirmation preference. */
  const deleteDraft = useCallback(
    async (draft: Draft) => {
      if (settings.confirmBeforeDelete) {
        const ok = window.confirm(
          `Delete the draft "${draft.subject || '(no subject)'}"? This cannot be undone.`,
        );
        if (!ok) return;
      }
      await getAPI().removeDraft(draft.id);
      setDrafts(await getAPI().listDrafts());
    },
    [settings.confirmBeforeDelete],
  );

  const openConversationFromFollowUp = (item: FollowUpListItem) => {
    // Open in the account that owns the conversation — valid whether or not the
    // unified inbox is enabled, and it keeps the account context visible.
    setView({ kind: 'mail', folder: item.account.id });
    setSelection({ messageId: null, conversationId: item.conversation.id });
  };

  /** Opens the conversation behind a reminder and clears its unread state. */
  const openNotification = (notification: NotificationItem) => {
    const conversationId = notification.conversationId;
    if (!conversationId) return;
    const tracked = followUps.find((item) => item.conversation.id === conversationId);
    if (tracked) {
      openConversationFromFollowUp(tracked);
    } else {
      // The reminder outlived its sequence (tracking was turned off). Selecting
      // alone is not enough: from Settings or Follow-ups the mail pane is not
      // on screen, so the click would appear to do nothing. Move to a folder
      // that can actually show the conversation first.
      setView({
        kind: 'mail',
        folder: settings.unifiedInboxEnabled
          ? ALL_INBOX
          : resolveHomeFolder(settings, accounts, null),
      });
      setSelection({ messageId: null, conversationId });
    }
    void getAPI()
      .markNotificationRead(notification.id)
      .then(() => refreshNotifications());
  };

  const dismissNotification = (id: string) => {
    void getAPI()
      .dismissNotification(id)
      .then(() => refreshNotifications());
  };

  const markAllNotificationsRead = () => {
    void getAPI()
      .markAllNotificationsRead()
      .then(() => refreshNotifications());
  };

  const sendFollowUp = (item: FollowUpListItem) => {
    openComposer({
      accountId: item.account.id,
      toAddresses: [item.recipient],
      subject: `Re: ${item.subject}`,
      inReplyToConversationId: item.conversation.id,
      followUpEnabled: true,
    });
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listWidth;
    const move = (ev: MouseEvent) => {
      setListWidth(Math.min(560, Math.max(260, startWidth + (ev.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const dueCount = followUps.filter((f) => f.status === 'due' || f.status === 'overdue').length;

  // A conversation can hold a finished sequence and a new active one after the
  // user re-enables tracking. Prefer the active sequence so the reading pane
  // never depends on array order.
  const followUpByConversation = useMemo(() => {
    const isTerminal = (item: FollowUpListItem) =>
      item.status === 'completed' || item.status === 'replied' || item.status === 'cancelled';
    const map = new Map<string, FollowUpListItem>();
    for (const item of followUps) {
      const existing = map.get(item.conversation.id);
      if (!existing || (isTerminal(existing) && !isTerminal(item))) {
        map.set(item.conversation.id, item);
      }
    }
    return map;
  }, [followUps]);

  const folderTitle = useMemo(() => {
    if (view?.kind !== 'mail') return '';
    if (view.folder === ALL_INBOX) return 'All Inbox';
    const account = accounts.find((a) => a.id === view.folder);
    if (account) return account.displayName;
    return view.folder.charAt(0).toUpperCase() + view.folder.slice(1);
  }, [view, accounts]);

  if (phase === 'loading') {
    return (
      <div className="grid h-full place-items-center text-[13px] text-text-secondary">
        Loading Still…
      </div>
    );
  }

  if (phase === 'setup') {
    return <SetupScreen onConnected={() => void refreshAccounts()} />;
  }

  if (view === null) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-text-secondary">
        Opening your inbox…
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-bg text-text">
      <TopBar
        onCompose={() => openComposer({})}
        onToggleSidebar={() => void update({ sidebarVisible: !settings.sidebarVisible })}
        syncStatus={syncStatus}
        onSync={() => void handleSync()}
        notifications={notifications}
        unreadNotifications={unreadNotifications}
        onOpenNotification={openNotification}
        onDismissNotification={dismissNotification}
        onMarkAllNotificationsRead={markAllNotificationsRead}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          accounts={accounts}
          activeFolder={view.kind === 'mail' ? view.folder : ''}
          onSelectFolder={(folder) => {
            setView({ kind: 'mail', folder });
            setSelection({ messageId: null, conversationId: null });
            setQuery('');
          }}
          onOpenAutomation={() => setView({ kind: 'automation' })}
          automationActive={view.kind === 'automation'}
          onOpenFollowUps={() => setView({ kind: 'followups' })}
          onOpenSettings={() => setView({ kind: 'settings', section: 'general' })}
          followUpsActive={view.kind === 'followups'}
          settingsActive={view.kind === 'settings'}
          dueCount={dueCount}
          collapsed={!settings.sidebarVisible}
          onToggleCollapsed={() => void update({ sidebarVisible: !settings.sidebarVisible })}
          showAllInbox={settings.unifiedInboxEnabled}
        />

        <div hidden={view.kind !== 'automation'} className={view.kind === 'automation' ? 'flex min-w-0 flex-1' : 'hidden'}>
          <AutomationPage accounts={accounts} onSent={() => setReloadToken(t => t + 1)} />
        </div>
        {view.kind === 'automation' ? null : view.kind === 'settings' ? (
          <SettingsPage
            section={view.section}
            onSectionChange={(s) => setView({ kind: 'settings', section: s })}
            accounts={accounts}
            onAccountsChanged={() => void refreshAccounts()}
          />
        ) : view.kind === 'followups' ? (
          <FollowUpsPage
            items={followUps}
            onOpen={openConversationFromFollowUp}
            onSendFollowUp={sendFollowUp}
            onChanged={() => {
              void refreshFollowUps();
              void refreshNotifications();
            }}
          />
        ) : (
          <>
            <div style={{ width: listWidth }} className="flex min-h-0 shrink-0">
              <MessageList
                title={folderTitle}
                messages={messages}
                drafts={view.folder === 'drafts' ? drafts : null}
                accounts={accounts}
                selectedMessageId={selection.messageId}
                selectedConversationId={selection.conversationId}
                onSelect={selectRow}
                onOpenDraft={(draft) => openComposer({ ...draft, id: draft.id })}
                onTrashConversation={(id, restore) => {
                  void getAPI().getConversation(id).then(d => { if (d) void trashConversation(d, restore); }).catch(() => window.alert('Could not load this conversation. Please try again.'));
                }}
                onDeleteDraft={(draft) => void deleteDraft(draft)}
                query={query}
                onQueryChange={setQuery}
                showAccountIndicator={view.folder === ALL_INBOX}
                followUpConversationIds={new Set(followUpByConversation.keys())}
                emptyHint={
                  isElectron
                    ? 'No messages here yet. Mail appears once account synchronization is connected in Phase 3.'
                    : 'No messages in this folder.'
                }
              />
            </div>
            <div
              onMouseDown={startResize}
              className="w-px shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent"
              title="Drag to resize the message list"
            />
            <ReadingPane
              detail={detail}
              account={accounts.find((a) => a.id === detail?.conversation.accountId) ?? null}
              followUp={detail ? followUpByConversation.get(detail.conversation.id) ?? null : null}
              onTrash={(d, restore) => void trashConversation(d, restore)}
              onReply={openReply}
              onEnableFollowUp={(d) => void enableFollowUp(d)}
              onDisableFollowUp={(d) => void disableFollowUp(d)}
              onReplyWithFollowUp={(d) =>
                openComposer({
                  accountId: d.conversation.accountId,
                  subject: `Re: ${d.conversation.subject}`,
                  inReplyToConversationId: d.conversation.id,
                  followUpEnabled: true,
                })
              }
              onSendFollowUp={sendFollowUp}
            />
          </>
        )}
      </div>

      {composer.open && (
        <Composer
          accounts={accounts}
          initial={composer.initial}
          onClose={() => setComposer({ open: false, initial: {} })}
          onSent={() => {
            setReloadToken((t) => t + 1);
            void refreshFollowUps();
            void refreshNotifications();
            if (view.kind === 'mail') {
              void getAPI()
                .listMessages(folderToMessageOptions(view.folder, accounts))
                .then(setMessages);
            }
          }}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}
