import type { FollowUpListItem } from '../types';

export const FOLLOW_UP_TABS = [
  { key: 'today', label: 'Today', heading: 'Due Today' },
  { key: 'due', label: 'Due', heading: 'Past due' },
  { key: 'upcoming', label: 'Upcoming', heading: 'Upcoming follow-ups' },
  { key: 'waiting', label: 'Waiting', heading: 'Waiting for Reply' },
  { key: 'completed', label: 'Completed', heading: 'Completed follow-ups' },
] as const;
export type FollowUpTab = typeof FOLLOW_UP_TABS[number]['key'];

export function followUpDate(item: FollowUpListItem): string | null {
  return item.status === 'snoozed' && item.sequence.snoozedUntil ? item.sequence.snoozedUntil : item.nextDueAt;
}
/** Date buckets use local calendar days, not stale status labels or a 24-hour offset. */
export function followUpTab(item: FollowUpListItem, now = new Date()): FollowUpTab {
  if (['completed', 'replied', 'cancelled'].includes(item.status)) return 'completed';
  if (item.status === 'waiting') return 'waiting';
  const date = followUpDate(item);
  if (!date) return 'upcoming';
  const due = new Date(date);
  if (!Number.isFinite(due.getTime())) return 'upcoming';
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const nextDay = new Date(today); nextDay.setDate(nextDay.getDate() + 1);
  if (due < today) return 'due';
  return due < nextDay ? 'today' : 'upcoming';
}
