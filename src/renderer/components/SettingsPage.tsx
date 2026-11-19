import { useEffect, useState } from 'react';
import type { Account, AppInfo, FollowUpSchedule } from '../../shared/types';
import { ACCOUNT_COLORS, APP_NAME, DEFAULT_FOLLOWUP_STAGES, SHORTCUTS } from '../../shared/constants';
import { getAPI } from '../services/api';
import { useSettings } from '../hooks/useSettings';
import { AccountForm } from '../features/setup/AccountForm';
import {
  ColorDots,
  Note,
  Row,
  Section,
  Segmented,
  Select,
  TextInput,
  Toggle,
} from './settings/controls';
import { MoonIcon, MonitorIcon, PlusIcon, SunIcon, TrashIcon } from './icons';

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'accounts'
  | 'inbox'
  | 'followup'
  | 'notifications'
  | 'composition'
  | 'security'
  | 'shortcuts'
  | 'storage'
  | 'about';

const NAV: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'accounts', label: 'Email Accounts' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'composition', label: 'Composition' },
  { id: 'security', label: 'Security & Privacy' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  { id: 'storage', label: 'Storage & Sync' },
  { id: 'about', label: 'About' },
];

interface SettingsPageProps {
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
  accounts: Account[];
  onAccountsChanged: () => void;
}

export function SettingsPage({
  section,
  onSectionChange,
  accounts,
  onAccountsChanged,
}: SettingsPageProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1">
      <nav className="w-52 shrink-0 overflow-y-auto border-r border-border px-2 py-4">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSectionChange(item.id)}
            className={`w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
              section === item.id
                ? 'bg-surface-hover font-medium text-text'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        {section === 'general' && <GeneralSection accounts={accounts} />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'accounts' && (
          <AccountsSection accounts={accounts} onAccountsChanged={onAccountsChanged} />
        )}
        {section === 'inbox' && <InboxSection />}
        {section === 'followup' && <FollowUpSection />}
        {section === 'notifications' && <NotificationsSection />}
        {section === 'composition' && <CompositionSection />}
        {section === 'security' && <SecuritySection />}
        {section === 'shortcuts' && <ShortcutsSection />}
        {section === 'storage' && <StorageSection />}
        {section === 'about' && <AboutSection />}
      </div>
    </main>
  );
}

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralSection({ accounts }: { accounts: Account[] }) {
  const { settings, update } = useSettings();
  return (
    <Section title="General" description="Startup behavior and defaults.">
      <Row label="Language" pending="English only in this release; more languages arrive later.">
        <Select
          value={settings.language}
          onChange={(v) => void update({ language: v })}
          options={[{ value: 'en', label: 'English' }]}
        />
      </Row>
      <Row label="Startup behavior">
        <Select
          value={settings.startupBehavior}
          onChange={(v) => void update({ startupBehavior: v as 'restore' | 'inbox' })}
          options={[
            { value: 'restore', label: 'Restore last session' },
            { value: 'inbox', label: 'Open inbox' },
          ]}
        />
      </Row>
      <Row label="Default opening page">
        <Select
          value={settings.defaultOpeningPage}
          onChange={(v) => void update({ defaultOpeningPage: v as 'all-inbox' | 'last-used' })}
          options={[
            { value: 'last-used', label: 'Last-used inbox' },
            { value: 'all-inbox', label: 'All Inbox' },
          ]}
        />
      </Row>
      <Row label="Default inbox">
        <Select
          value={settings.defaultInboxId}
          onChange={(v) => void update({ defaultInboxId: v })}
          options={[
            { value: 'all', label: 'All Inbox' },
            ...accounts.map((a) => ({ value: a.id, label: a.displayName })),
          ]}
        />
      </Row>
      <Row label="Remember last-used inbox">
        <Toggle
          checked={settings.rememberLastInbox}
          onChange={(v) => void update({ rememberLastInbox: v })}
        />
      </Row>
      <Row label="Default sending account">
        <Select
          value={settings.defaultSendingAccountId ?? ''}
          onChange={(v) => void update({ defaultSendingAccountId: v || null })}
          options={[
            { value: '', label: 'First account' },
            ...accounts.map((a) => ({ value: a.id, label: a.displayName })),
          ]}
        />
      </Row>
      <Row label="Date format">
        <Select
          value={settings.dateFormat}
          onChange={(v) => void update({ dateFormat: v as 'auto' | 'short' | 'long' })}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'short', label: 'Short' },
            { value: 'long', label: 'Long' },
          ]}
        />
      </Row>
      <Row label="Time format">
        <Select
          value={settings.timeFormat}
          onChange={(v) => void update({ timeFormat: v as 'auto' | '12h' | '24h' })}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: '12h', label: '12-hour' },
            { value: '24h', label: '24-hour' },
          ]}
        />
      </Row>
      <Row label="Confirm before deleting">
        <Toggle
          checked={settings.confirmBeforeDelete}
          onChange={(v) => void update({ confirmBeforeDelete: v })}
        />
      </Row>
      <Row label="Confirm before sending">
        <Toggle
          checked={settings.confirmBeforeSend}
          onChange={(v) => void update({ confirmBeforeSend: v })}
        />
      </Row>
    </Section>
  );
}

// ─── Appearance ──────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { settings, update } = useSettings();
  return (
    <Section title="Appearance" description="Theme, density, and layout.">
      <Row label="Theme">
        <Segmented
          value={settings.theme}
          onChange={(v) => void update({ theme: v })}
          options={[
            { value: 'light', label: 'Light', icon: <SunIcon size={13} /> },
            { value: 'dark', label: 'Dark', icon: <MoonIcon size={13} /> },
            { value: 'system', label: 'System', icon: <MonitorIcon size={13} /> },
          ]}
        />
      </Row>
      <Row label="Font size">
        <Segmented
          value={settings.fontSize}
          onChange={(v) => void update({ fontSize: v })}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
        />
      </Row>
      <Row label="Interface density">
        <Segmented
          value={settings.density}
          onChange={(v) => void update({ density: v })}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Row>
      <Row
        label="Sidebar labels"
        description="Turn off to collapse the sidebar to icons only. The Still title in the top bar toggles the same setting."
      >
        <Toggle
          checked={settings.sidebarVisible}
          onChange={(v) => void update({ sidebarVisible: v })}
        />
      </Row>
      <Row label="Accent color">
        <ColorDots
          value={settings.accentColor}
          onChange={(v) => void update({ accentColor: v })}
          colors={ACCOUNT_COLORS}
        />
      </Row>
      <Row label="Message list layout">
        <Segmented
          value={settings.messageListLayout}
          onChange={(v) => void update({ messageListLayout: v })}
          options={[
            { value: 'detailed', label: 'Detailed' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Row>
      <Row label="Reading pane layout" description="Split view arrives in Phase 5.">
        <Segmented
          value={settings.readingPaneLayout}
          onChange={(v) => void update({ readingPaneLayout: v })}
          options={[
            { value: 'single', label: 'Single' },
            { value: 'split', label: 'Split' },
          ]}
        />
      </Row>
    </Section>
  );
}

// ─── Email accounts ──────────────────────────────────────────────────────────

function AccountsSection({
  accounts,
  onAccountsChanged,
}: {
  accounts: Account[];
  onAccountsChanged: () => void;
}) {
  const { settings, update } = useSettings();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);

  const remove = async (account: Account) => {
    if (settings.confirmBeforeDelete) {
      const ok = window.confirm(`Remove ${account.displayName} (${account.email})? Local data for this account will be deleted.`);
      if (!ok) return;
    }
    await getAPI().removeAccount(account.id);
    onAccountsChanged();
  };

  /** Pause or resume synchronization for one account (spec §5). */
  const setSyncEnabled = async (account: Account, syncEnabled: boolean) => {
    await getAPI().updateAccount(account.id, { syncEnabled });
    onAccountsChanged();
  };

  /**
   * Sets the default sending account. Both the account flag and the
   * corresponding setting are updated so General and Accounts never disagree.
   */
  const makeDefaultSender = async (account: Account) => {
    await Promise.all(
      accounts.map((a) =>
        getAPI().updateAccount(a.id, { isDefaultSender: a.id === account.id }),
      ),
    );
    await update({ defaultSendingAccountId: account.id });
    onAccountsChanged();
  };

  if (editing) {
    return (
      <Section title={editing === 'new' ? 'Add account' : `Edit ${editing.displayName}`}>
        <div className="mt-4">
          <AccountForm
            initial={editing === 'new' ? undefined : editing}
            onSaved={() => {
              setEditing(null);
              onAccountsChanged();
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Email Accounts"
      description="Accounts connect directly to your provider. Credentials are encrypted with your OS keychain."
    >
      {accounts.length === 0 && (
        <p className="border-t border-border py-4 text-[13px] text-text-secondary">
          No accounts connected.
        </p>
      )}
      {accounts.map((account) => (
        <div
          key={account.id}
          className="flex items-center justify-between gap-4 border-t border-border py-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: account.color ?? '#9a9a9a' }}
              />
              <span className="text-[13px] font-medium">{account.displayName}</span>
              {account.isDefaultSender && (
                <span className="text-[11px] text-text-tertiary">Default sender</span>
              )}
              {account.authStatus !== 'connected' && (
                <span className="text-[11px] text-danger">Reconnect needed</span>
              )}
            </div>
            <div className="mt-0.5 text-[12px] text-text-secondary">
              {account.email} · {account.provider === 'imap' ? 'IMAP/SMTP' : account.provider}
              {account.syncEnabled ? '' : ' · Sync paused'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
              <Toggle
                checked={account.syncEnabled}
                onChange={(v) => void setSyncEnabled(account, v)}
                label={`Synchronize ${account.displayName}`}
              />
              Sync
            </label>
            {!account.isDefaultSender && (
              <button
                type="button"
                onClick={() => void makeDefaultSender(account)}
                className="rounded-md border border-border px-2.5 py-1 text-[12px] text-text-secondary hover:text-text"
              >
                Make default
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(account)}
              className="rounded-md border border-border px-2.5 py-1 text-[12px] text-text-secondary hover:text-text"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void remove(account)}
              title="Remove account"
              className="rounded-md border border-border p-1.5 text-text-secondary hover:text-danger"
            >
              <TrashIcon size={13} />
            </button>
          </div>
        </div>
      ))}
      <div className="border-t border-border py-4">
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover"
        >
          <PlusIcon size={14} />
          Add account
        </button>
      </div>
      <Note>
        Google and Microsoft OAuth sign-in arrive in Phase 2. Connection testing and
        reconnection flows arrive with the sync engine in Phase 3.
      </Note>
    </Section>
  );
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

function InboxSection() {
  const { settings, update } = useSettings();
  return (
    <Section title="Inbox" description="Unified inbox and message list behavior.">
      <Row label="Unified inbox (All Inbox)" description="Aggregate messages from every account.">
        <Toggle
          checked={settings.unifiedInboxEnabled}
          onChange={(v) => void update({ unifiedInboxEnabled: v })}
        />
      </Row>
      <Row label="Group by account">
        <Toggle
          checked={settings.groupByAccount}
          onChange={(v) => void update({ groupByAccount: v })}
        />
      </Row>
      <Row label="Sort order">
        <Select
          value={settings.sortOrder}
          onChange={(v) => void update({ sortOrder: v as 'newest' | 'oldest' })}
          options={[
            { value: 'newest', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
          ]}
        />
      </Row>
      <Row label="Show message preview">
        <Toggle
          checked={settings.showPreview}
          onChange={(v) => void update({ showPreview: v })}
        />
      </Row>
      <Row label="Mark as read on open">
        <Toggle
          checked={settings.markAsReadOnOpen}
          onChange={(v) => void update({ markAsReadOnOpen: v })}
        />
      </Row>
      <Row label="Refresh interval" pending="Consumed by the sync engine, which arrives in Phase 3.">
        <Select
          value={String(settings.refreshIntervalMinutes)}
          onChange={(v) => void update({ refreshIntervalMinutes: Number(v) })}
          options={[
            { value: '0', label: 'Manual' },
            { value: '1', label: 'Every minute' },
            { value: '5', label: 'Every 5 minutes' },
            { value: '15', label: 'Every 15 minutes' },
            { value: '30', label: 'Every 30 minutes' },
          ]}
        />
      </Row>
      <Row label="Conversation grouping" description="Thread messages into conversations.">
        <Toggle
          checked={settings.conversationGrouping}
          onChange={(v) => void update({ conversationGrouping: v })}
        />
      </Row>
    </Section>
  );
}

// ─── Follow-up ───────────────────────────────────────────────────────────────

function FollowUpSection() {
  const { settings, update } = useSettings();
  const [schedules, setSchedules] = useState<FollowUpSchedule[]>([]);
  const [newName, setNewName] = useState('');

  const refresh = () => void getAPI().listSchedules().then(setSchedules);
  useEffect(refresh, []);

  const setDefault = async (id: string) => {
    await getAPI().updateSchedule(id, { isDefault: true });
    await update({ defaultScheduleId: id });
    refresh();
  };

  const saveStages = async (schedule: FollowUpSchedule, text: string) => {
    const stages = text
      .split(',')
      .map((v) => Number.parseInt(v.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (stages.length === 0) return;
    await getAPI().updateSchedule(schedule.id, { stages });
    refresh();
  };

  const addSchedule = async () => {
    const name = newName.trim() || 'Custom schedule';
    await getAPI().createSchedule({ name, stages: [...DEFAULT_FOLLOWUP_STAGES] });
    setNewName('');
    refresh();
  };

  /**
   * Resets the default schedule to the shipped 3/7/15/30 stages (spec §6.2).
   * Reuses the existing default row when there is one, so sequences that point
   * at it keep their reference.
   */
  const restoreDefaultSchedule = async () => {
    const existing = schedules.find((s) => s.isDefault) ?? schedules[0];
    if (existing) {
      await getAPI().updateSchedule(existing.id, {
        name: 'Default',
        stages: [...DEFAULT_FOLLOWUP_STAGES],
        isDefault: true,
      });
      await update({ defaultScheduleId: existing.id });
    } else {
      const created = await getAPI().createSchedule({
        name: 'Default',
        stages: [...DEFAULT_FOLLOWUP_STAGES],
      });
      await getAPI().updateSchedule(created.id, { isDefault: true });
      await update({ defaultScheduleId: created.id });
    }
    refresh();
  };

  return (
    <div className="space-y-10">
      <Section title="Follow-up" description="Reminders when a recipient does not reply. Still never sends follow-ups automatically — it only reminds you.">
        <Row label="Enable follow-up by default" description="New messages start with follow-up on.">
          <Toggle
            checked={settings.followUpEnabledByDefault}
            onChange={(v) => void update({ followUpEnabledByDefault: v })}
          />
        </Row>
        <Row label="Default schedule">
          <Select
            value={settings.defaultScheduleId ?? schedules.find((s) => s.isDefault)?.id ?? ''}
            onChange={(v) => void setDefault(v)}
            options={schedules.map((s) => ({ value: s.id, label: s.name }))}
          />
        </Row>
        <Row label="Maximum stages">
          <TextInput
            type="number"
            value={String(settings.maxStages)}
            onChange={(v) => void update({ maxStages: Number(v) || 1 })}
          />
        </Row>
        <Row label="Reminder time" description="Reminders become due at this local time.">
          <TextInput
            type="time"
            value={settings.reminderTime}
            onChange={(v) => void update({ reminderTime: v })}
          />
        </Row>
        <Row label="Use working days" description="Count Monday–Friday only.">
          <Toggle
            checked={settings.useWorkingDays}
            onChange={(v) => void update({ useWorkingDays: v })}
          />
        </Row>
        <Row label="Weekend behavior">
          <Select
            value={settings.weekendBehavior}
            onChange={(v) => void update({ weekendBehavior: v as 'skip' | 'include' })}
            options={[
              { value: 'skip', label: 'Skip weekends' },
              { value: 'include', label: 'Include weekends' },
            ]}
          />
        </Row>
        <Row
        label="Auto-complete on reply"
        description="Stop reminders when the recipient replies."
        pending="Reply detection needs live mail, so it arrives with synchronization in Phase 3."
      >
          <Toggle
            checked={settings.autoCompleteOnReply}
            onChange={(v) => void update({ autoCompleteOnReply: v })}
          />
        </Row>
        <Row
        label="Automatic reply handling"
        description="Out-of-office messages are handled separately."
        pending="Arrives with reply detection in Phase 3."
      >
          <Select
            value={settings.autoReplyHandling}
            onChange={(v) => void update({ autoReplyHandling: v as 'ignore' | 'complete' })}
            options={[
              { value: 'ignore', label: 'Ignore' },
              { value: 'complete', label: 'Mark complete' },
            ]}
          />
        </Row>
        <Row label="Snooze default">
          <Select
            value={String(settings.snoozeDefaultDays)}
            onChange={(v) => void update({ snoozeDefaultDays: Number(v) })}
            options={[
              { value: '1', label: '1 day' },
              { value: '3', label: '3 days' },
              { value: '7', label: '1 week' },
            ]}
          />
        </Row>
        <Row
          label="Overdue reminder repeat"
          description="Re-raise a reminder nobody has handled. Each repeat is a distinct occurrence, so it is never raised twice."
        >
          <Select
            value={String(settings.overdueReminderRepeatHours)}
            onChange={(v) => void update({ overdueReminderRepeatHours: Number(v) })}
            options={[
              { value: '0', label: 'Do not repeat' },
              { value: '12', label: 'Every 12 hours' },
              { value: '24', label: 'Every 24 hours' },
              { value: '48', label: 'Every 48 hours' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Schedules" description="Stage intervals in days, measured from the actual send date of each follow-up.">
        {schedules.map((schedule) => (
          <div key={schedule.id} className="border-t border-border py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium">
                {schedule.name}
                {schedule.isDefault && (
                  <span className="ml-2 text-[11px] text-text-tertiary">Default</span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                {!schedule.isDefault && (
                  <button
                    type="button"
                    onClick={() => void setDefault(schedule.id)}
                    className="rounded-md border border-border px-2 py-1 text-[12px] text-text-secondary hover:text-text"
                  >
                    Set default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void getAPI().removeSchedule(schedule.id).then(refresh)}
                  title="Delete schedule"
                  className="rounded-md border border-border p-1.5 text-text-secondary hover:text-danger"
                >
                  <TrashIcon size={13} />
                </button>
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <StagesEditor schedule={schedule} onSave={saveStages} />
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 border-t border-border py-3">
          <TextInput
            value={newName}
            onChange={setNewName}
            placeholder="New schedule name"
          />
          <button
            type="button"
            onClick={() => void addSchedule()}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-secondary hover:text-text"
          >
            <PlusIcon size={13} />
            Add schedule
          </button>
          <button
            type="button"
            onClick={() => void restoreDefaultSchedule()}
            className="rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-secondary hover:text-text"
            title={`Reset the default schedule to ${DEFAULT_FOLLOWUP_STAGES.join(', ')} days`}
          >
            Restore default schedule
          </button>
        </div>
        <Note>
          Each interval is measured from the day you actually send the previous follow-up —
          never from the original email date.
        </Note>
      </Section>
    </div>
  );
}

function StagesEditor({
  schedule,
  onSave,
}: {
  schedule: FollowUpSchedule;
  onSave: (schedule: FollowUpSchedule, text: string) => Promise<void>;
}) {
  const { settings } = useSettings();
  const [text, setText] = useState(schedule.stages.join(', '));
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== schedule.stages.join(', ');

  useEffect(() => {
    if (!dirty) setText(schedule.stages.join(', '));
  }, [schedule.stages, dirty]);

  return (
    <>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder="3, 7, 15, 30"
        aria-label={`${schedule.name} stage intervals in days`}
        className="w-56 rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent"
      />
      <button
        type="button"
        disabled={!dirty}
        onClick={() => {
          const stages = text
            .split(',')
            .map((v) => Number.parseInt(v.trim(), 10))
            .filter((n) => Number.isFinite(n));
          if (stages.length === 0 || stages.some((n) => n < 1)) {
            setError('Enter at least one interval of 1 day or more.');
            return;
          }
          if (stages.length > settings.maxStages) {
            setError(`Maximum stages is ${settings.maxStages} (Settings → Follow-up).`);
            return;
          }
          void onSave(schedule, text);
        }}
        className="rounded-md border border-border px-2.5 py-1 text-[12px] text-text-secondary hover:text-text disabled:opacity-40"
      >
        Save
      </button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────

function NotificationsSection() {
  const { settings, update } = useSettings();
  return (
    <Section
      title="Notifications"
      description="Reminders are derived from stored timestamps, so one that falls due while Still is closed is raised on the next launch. These preferences control when a due reminder may be surfaced."
    >
      <Row
        label="Desktop notifications"
        description="Show an OS banner when a reminder is ready. Banners need the desktop app; the reminder list works everywhere."
      >
        <Toggle
          checked={settings.desktopNotifications}
          onChange={(v) => void update({ desktopNotifications: v })}
        />
      </Row>
      <Row
        label="Follow-up notifications"
        description="When off, due follow-ups stay in the list but raise no reminder at all."
      >
        <Toggle
          checked={settings.followUpNotifications}
          onChange={(v) => void update({ followUpNotifications: v })}
        />
      </Row>
      <Row
        label="Quiet hours"
        description="Defer reminders that fall due inside this local-time window until it closes. The follow-up itself stays visible in the list."
      >
        <Toggle
          checked={settings.quietHoursEnabled}
          onChange={(v) => void update({ quietHoursEnabled: v })}
        />
      </Row>
      {settings.quietHoursEnabled && (
        <>
          <Row label="Quiet hours start">
            <TextInput
              type="time"
              value={settings.quietHoursStart}
              onChange={(v) => void update({ quietHoursStart: v })}
            />
          </Row>
          <Row label="Quiet hours end">
            <TextInput
              type="time"
              value={settings.quietHoursEnd}
              onChange={(v) => void update({ quietHoursEnd: v })}
            />
          </Row>
        </>
      )}
      <Row label="Notification sound" description="Play the system sound with each banner.">
        <Toggle
          checked={settings.notificationSound}
          onChange={(v) => void update({ notificationSound: v })}
        />
      </Row>
      <Row
        label="Notification frequency"
        description="Immediately when due, or batched into an hourly or once-daily digest at your reminder time."
      >
        <Select
          value={settings.notificationFrequency}
          onChange={(v) => void update({ notificationFrequency: v as 'immediate' | 'hourly' | 'daily' })}
          options={[
            { value: 'immediate', label: 'Immediately when due' },
            { value: 'hourly', label: 'Hourly digest' },
            { value: 'daily', label: 'Daily digest' },
          ]}
        />
      </Row>
    </Section>
  );
}

// ─── Composition ─────────────────────────────────────────────────────────────

function CompositionSection() {
  const { settings, update } = useSettings();
  return (
    <Section title="Composition" description="Defaults for writing and replying.">
      <Row label="Default signature">
        <textarea
          value={settings.defaultSignature}
          onChange={(e) => void update({ defaultSignature: e.target.value })}
          placeholder="Alex — alex@example.com"
          rows={3}
          className="w-72 resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent"
        />
      </Row>
      <Row
        label="Rich-text editor"
        pending="The composer is plain text for now; rich-text editing arrives in Phase 3."
      >
        <Toggle
          checked={settings.richTextEnabled}
          onChange={(v) => void update({ richTextEnabled: v })}
        />
      </Row>
      <Row label="Reply behavior">
        <Select
          value={settings.replyBehavior}
          onChange={(v) => void update({ replyBehavior: v as 'reply' | 'reply-all' })}
          options={[
            { value: 'reply', label: 'Reply' },
            { value: 'reply-all', label: 'Reply all' },
          ]}
        />
      </Row>
      <Row label="CC on reply all">
        <Toggle
          checked={settings.ccOnReplyAll}
          onChange={(v) => void update({ ccOnReplyAll: v })}
        />
      </Row>
    </Section>
  );
}

// ─── Security & privacy ──────────────────────────────────────────────────────

function SecuritySection() {
  const { settings, update } = useSettings();
  return (
    <Section title="Security & Privacy" description="Still is local-first: no Still account, no cloud, no telemetry.">
      <Row
        label="Block remote images"
        description="Remote images in emails are blocked by default."
        pending="Enforced once email HTML is rendered, in Phase 3. The Content Security Policy already denies remote origins."
      >
        <Toggle
          checked={settings.blockRemoteImages}
          onChange={(v) => void update({ blockRemoteImages: v })}
        />
      </Row>
      <Row label="External content" pending="Enforced with HTML rendering in Phase 3.">
        <Select
          value={settings.externalContent}
          onChange={(v) => void update({ externalContent: v as 'blocked' | 'ask' | 'allowed' })}
          options={[
            { value: 'blocked', label: 'Blocked' },
            { value: 'ask', label: 'Ask each time' },
            { value: 'allowed', label: 'Allowed' },
          ]}
        />
      </Row>
      <Row label="Application lock" pending="Enforced by the security layer in Phase 6.">
        <Toggle
          checked={settings.appLockEnabled}
          onChange={(v) => void update({ appLockEnabled: v })}
        />
      </Row>
      <Row
        label="Local database encryption"
        description="Credentials are already encrypted via the OS keychain."
        pending="Whole-database encryption arrives in Phase 6."
      >
        <Toggle
          checked={settings.databaseEncryption}
          onChange={(v) => void update({ databaseEncryption: v })}
        />
      </Row>
      <Row label="AI features" description="Optional and off by default. Email content is never sent to AI providers without explicit consent.">
        <Toggle
          checked={settings.aiEnabled}
          onChange={(v) => void update({ aiEnabled: v })}
        />
      </Row>
      <Row label="AI provider">
        <Select
          value={settings.aiProvider ?? ''}
          onChange={(v) => void update({ aiProvider: v || null })}
          disabled={!settings.aiEnabled}
          options={[
            { value: '', label: 'None' },
            { value: 'openai', label: 'OpenAI' },
            { value: 'anthropic', label: 'Anthropic' },
            { value: 'local', label: 'Local model' },
          ]}
        />
      </Row>
      <Row label="Local data retention" pending="Retention pruning arrives in Phase 6.">
        <Select
          value={String(settings.dataRetentionDays)}
          onChange={(v) => void update({ dataRetentionDays: Number(v) })}
          options={[
            { value: '0', label: 'Keep forever' },
            { value: '90', label: '90 days' },
            { value: '365', label: '1 year' },
          ]}
        />
      </Row>
    </Section>
  );
}

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────

function ShortcutsSection() {
  return (
    <Section
      title="Keyboard Shortcuts"
      description="Shortcuts are ignored while you are typing in a field. Custom shortcuts arrive in Phase 5."
    >
      <div className="border-t border-border">
        {SHORTCUTS.map((shortcut) => (
          <div
            key={shortcut.keys}
            className="flex items-center justify-between gap-4 border-b border-border py-2.5"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-[13px]">{shortcut.action}</span>
              {!shortcut.active && (
                <span className="shrink-0 text-[11px] text-text-tertiary">
                  arrives with message actions in {shortcut.arrivesIn}
                </span>
              )}
            </span>
            <kbd className="shrink-0 rounded border border-border bg-surface px-2 py-0.5 text-[12px] text-text-secondary">
              {shortcut.keys}
            </kbd>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Storage & synchronization ───────────────────────────────────────────────

function StorageSection() {
  const { settings, update } = useSettings();
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void getAPI().getAppInfo().then(setInfo);
  }, []);

  return (
    <Section title="Storage & Synchronization" description="Everything is stored locally on this device.">
      <Row label="Sync on startup">
        <Toggle
          checked={settings.syncOnStartup}
          onChange={(v) => void update({ syncOnStartup: v })}
        />
      </Row>
      <Row
        label="Background sync interval"
        description="How often Still checks for new emails automatically."
      >
        <select
          value={settings.syncIntervalSeconds ?? 30}
          onChange={(e) =>
            void update({
              syncIntervalSeconds: Number(e.target.value) as 5 | 30 | 60 | 300 | 600,
            })
          }
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
        >
          <option value={5}>5 seconds</option>
          <option value={30}>30 seconds</option>
          <option value={60}>1 minute</option>
          <option value={300}>5 minutes</option>
          <option value={600}>10 minutes</option>
        </select>
      </Row>
      <Row label="Local database">
        <span className="max-w-72 truncate text-[12px] text-text-secondary" title={info?.dbPath}>
          {info?.dbPath ?? '—'}
        </span>
      </Row>
      <Row label="Attachment storage" pending="Attachments are downloaded and stored in Phase 3.">
        <TextInput
          value={settings.attachmentStoragePath ?? ''}
          onChange={(v) => void update({ attachmentStoragePath: v || null })}
          placeholder="Default location"
        />
      </Row>
      <Note>
        Local backup and restore arrive in Phase 6. Per-account synchronization controls
        arrive with the sync engine in Phase 3.
      </Note>
    </Section>
  );
}

// ─── About ───────────────────────────────────────────────────────────────────

function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void getAPI().getAppInfo().then(setInfo);
  }, []);

  return (
    <Section
      title="About"
      description={`${APP_NAME} — a quieter place for email. Private by design, thoughtful by nature.`}
    >
      <Row label="Version">
        <span className="text-[13px] text-text-secondary">{info?.version ?? '—'}</span>
      </Row>
      <Row label="Platform">
        <span className="text-[13px] text-text-secondary">{info?.platform ?? '—'}</span>
      </Row>
      <Row label="License">
        <span className="text-[13px] text-text-secondary">All rights reserved</span>
      </Row>
      <Note>
        Still connects directly to your email provider. There is no Still account, no Still
        cloud backend, and no telemetry. All data remains on your device.
      </Note>
    </Section>
  );
}
