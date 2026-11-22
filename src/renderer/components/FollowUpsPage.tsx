import { FollowUpSpreadsheet } from '../features/followups/FollowUpSpreadsheet';
import { FOLLOW_UP_TABS, followUpTab, followUpDate, type FollowUpTab } from '../../shared/followup/tabs';
import { useEffect, useState } from 'react';
import type { FollowUpListItem, FollowUpSchedule } from '../../shared/types';
import { getAPI } from '../services/api';
import { useDateFormatters } from '../hooks/useDateFormatters';
import { useSettings } from '../hooks/useSettings';
import { BellIcon, CheckIcon, ClockIcon, GearIcon, InboxIcon, SendIcon, XIcon } from './icons';

interface FollowUpsPageProps {
  items: FollowUpListItem[];
  onOpen: (item: FollowUpListItem) => void;
  onSendFollowUp: (item: FollowUpListItem, body?: string, subject?: string) => void;
  onChanged: () => void;
}

export function FollowUpsPage({ items, onOpen, onSendFollowUp, onChanged }: FollowUpsPageProps) {
  const tabs = [{ key: 'all', label: 'All active', heading: 'All active follow-ups' }, ...FOLLOW_UP_TABS] as const;
  const [tab, setTab] = useState<FollowUpTab | 'all'>('today');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const [schedules, setSchedules] = useState<FollowUpSchedule[]>([]);

  useEffect(() => {
    let active = true;
    void getAPI()
      .listSchedules()
      .then((list) => {
        if (active) setSchedules(list);
      });
    return () => {
      active = false;
    };
  }, []);

  const buckets = Object.fromEntries(tabs.map(t => [t.key,
    items.filter(item => t.key === 'all' ? !['completed', 'replied', 'cancelled'].includes(item.status) : followUpTab(item, now) === t.key).sort((a, b) =>
      (followUpDate(a) || a.lastSentAt).localeCompare(followUpDate(b) || b.lastSentAt)),
  ])) as Record<FollowUpTab | 'all', FollowUpListItem[]>;
  const selected = tabs.find(t => t.key === tab)!;

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-[22px] font-semibold">Follow-ups</h1>
        <p className="mt-1 text-[13px] text-text-secondary">
          Conversations you are tracking because the recipient has not replied yet.
        </p>


        <FollowUpSpreadsheet items={items} onPrepare={onSendFollowUp} />
        <div role="tablist" aria-label="Follow-up dates" className="mt-6 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((entry, index) => <button key={entry.key} type="button" role="tab"
            id={`followup-tab-${entry.key}`} aria-controls={`followup-panel-${entry.key}`}
            aria-selected={tab === entry.key} tabIndex={tab === entry.key ? 0 : -1}
            onClick={() => { setNow(new Date()); setTab(entry.key); }}
            onKeyDown={event => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
              else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = tabs.length - 1;
              else return;
              event.preventDefault(); setTab(tabs[next].key);
              document.getElementById(`followup-tab-${tabs[next].key}`)?.focus();
            }}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-[12px] transition-colors ${tab === entry.key ? 'border-accent font-semibold text-text' : 'border-transparent text-text-secondary hover:text-text'}`}>
            {entry.label}<span className="text-[10px] tabular-nums text-text-tertiary">{buckets[entry.key].length}</span>
          </button>)}
        </div>
        <p className="mt-3 text-[11px] text-text-tertiary">Use All active to send manually to upcoming or waiting conversations too. Today shows today’s dates; Due shows earlier dates. Dates use your local time.</p>
        <section role="tabpanel" id={`followup-panel-${tab}`} aria-labelledby={`followup-tab-${tab}`} className="mt-5" tabIndex={0}>
          {buckets[tab].length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <BellIcon size={26} className="text-text-tertiary" />
              <p className="text-[13px] text-text-secondary">{items.length === 0 ? 'No follow-ups yet. Enable follow-up when you send an email and Still will track it here.' : `No follow-ups ${tab === 'today' ? 'for today' : tab === 'due' ? 'past due' : `in ${selected.label.toLowerCase()}`}.`}</p>
            </div>
          ) : <>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{selected.heading}</h2>
            {buckets[tab].map(item => <FollowUpRow key={item.sequence.id} item={item} schedules={schedules}
              onOpen={() => onOpen(item)} onSendFollowUp={() => onSendFollowUp(item)} onChanged={onChanged} />)}
          </>}
        </section>
      </div>
    </main>
  );
}

function FollowUpRow({
  item,
  schedules,
  onOpen,
  onSendFollowUp,
  onChanged,
}: {
  item: FollowUpListItem;
  schedules: FollowUpSchedule[];
  onOpen: () => void;
  onSendFollowUp: () => void;
  onChanged: () => void;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const { settings } = useSettings();
  const dates = useDateFormatters();
  const terminal = item.status === 'completed' || item.status === 'replied' || item.status === 'cancelled';
  // The configured default snooze leads the menu (Settings → Follow-up).
  const snoozeOptions = [settings.snoozeDefaultDays, 1, 3, 7]
    .filter((days, index, all) => days > 0 && all.indexOf(days) === index)
    .slice(0, 4);

  const setStatus = async (status: FollowUpListItem['status'], snoozeDays?: number) => {
    await getAPI().updateFollowUpStatus(item.sequence.id, status, snoozeDays);
    setSnoozeOpen(false);
    onChanged();
  };

  /** Applies a different schedule to this conversation only (spec §6.6). */
  const applySchedule = async (scheduleId: string) => {
    setScheduleOpen(false);
    await getAPI().setFollowUpSchedule(item.sequence.id, scheduleId);
    onChanged();
  };

  return (
    <div className="group relative flex items-center gap-3 border-b border-border py-3">
      <button type="button" onClick={onSendFollowUp} title="Reply to this conversation" className="min-w-0 flex-1 text-left">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium">{item.recipient}</span>
          <span className="shrink-0 text-[11px] text-text-tertiary">
            Stage {item.currentStage + 1} of {item.stageCount}
          </span>
        </span>
        <span className="block truncate text-[13px] text-text-secondary">{item.subject}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-text-tertiary">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: item.account.color ?? '#9a9a9a' }}
          />
          {item.account.displayName} · Next: follow-up {Math.max(item.sentFollowUpCount ?? 0, item.currentStage) + 1} · Last sent {dates.relative(item.lastSentAt)}
          {item.nextDueAt && <> · Next due {dates.relative(item.nextDueAt)}</>}
          {item.status === 'snoozed' && item.sequence.snoozedUntil && (
            <> · Snoozed until {dates.relative(item.sequence.snoozedUntil)}</>
          )}
        </span>
      </button>

      <RowAction icon={<InboxIcon size={13} />} label="Open conversation" onClick={onOpen} />
      {!terminal && (
        <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <RowAction icon={<SendIcon size={13} />} label="Send follow-up" onClick={onSendFollowUp} />
          <span className="relative">
            <RowAction
              icon={<ClockIcon size={13} />}
              label="Snooze"
              onClick={() => setSnoozeOpen((v) => !v)}
            />
            {snoozeOpen && (
              <>
                <span className="fixed inset-0 z-10" onClick={() => setSnoozeOpen(false)} />
                <span className="absolute right-0 top-full z-20 mt-1 flex w-36 flex-col rounded-md border border-border bg-surface py-1">
                  {snoozeOptions.map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => void setStatus('snoozed', days)}
                      className="px-3 py-1.5 text-left text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text"
                    >
                      {snoozeLabel(days)}
                      {days === settings.snoozeDefaultDays && (
                        <span className="ml-1.5 text-[11px] text-text-tertiary">default</span>
                      )}
                    </button>
                  ))}
                </span>
              </>
            )}
          </span>
          <span className="relative">
            <RowAction
              icon={<GearIcon size={13} />}
              label="Edit schedule"
              onClick={() => setScheduleOpen((v) => !v)}
            />
            {scheduleOpen && (
              <>
                <span className="fixed inset-0 z-10" onClick={() => setScheduleOpen(false)} />
                <span className="absolute right-0 top-full z-20 mt-1 flex w-52 flex-col rounded-md border border-border bg-surface py-1">
                  <span className="px-3 pb-1 pt-1.5 text-[11px] uppercase tracking-wider text-text-tertiary">
                    Apply schedule
                  </span>
                  {schedules.map((schedule) => (
                    <button
                      key={schedule.id}
                      type="button"
                      onClick={() => void applySchedule(schedule.id)}
                      className="flex items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text"
                    >
                      <span>{schedule.name}</span>
                      <span className="text-[11px] text-text-tertiary">
                        {schedule.stages.join(', ')}d
                      </span>
                    </button>
                  ))}
                  {schedules.length === 0 && (
                    <span className="px-3 py-1.5 text-[12px] text-text-tertiary">
                      No schedules available
                    </span>
                  )}
                </span>
              </>
            )}
          </span>
          <RowAction icon={<CheckIcon size={13} />} label="Mark complete" onClick={() => void setStatus('completed')} />
          <RowAction icon={<XIcon size={13} />} label="Cancel tracking" onClick={() => void setStatus('cancelled')} />
        </span>
      )}
    </div>
  );
}

function snoozeLabel(days: number): string {
  if (days === 1) return 'Tomorrow';
  if (days === 7) return 'Next week';
  return `In ${days} days`;
}

function RowAction({
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
      title={label}
      className="rounded-md border border-border p-1.5 text-text-secondary transition-colors hover:border-border-strong hover:text-text"
    >
      {icon}
    </button>
  );
}
