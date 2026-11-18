import type { NotificationKind } from '../types';
import { addCalendarDays } from '../utils/dates';
import { nextAllowedTime, type QuietHours } from './quiethours';

/**
 * Reminder planning (spec §6.7, §17).
 *
 * The whole point of this module is that a reminder is a *derived fact*, not a
 * scheduled callback. Every decision below is a pure function of stored
 * timestamps plus the current time, so:
 *
 *   - closing the app loses nothing — the next scan re-derives the same answer;
 *   - a reminder that became due while the app was closed is raised on launch;
 *   - nothing is ever raised twice, because each occurrence has a stable
 *     dedupe key that the database enforces with a unique index;
 *   - changing the clock or the timezone cannot double-fire a reminder.
 *
 * Still never sends a follow-up. It only tells the user one is due.
 */

export type NotificationFrequency = 'immediate' | 'hourly' | 'daily';

/** One active follow-up sequence with enough context to describe it. */
export interface DueSequence {
  sequenceId: string;
  conversationId: string;
  currentStage: number;
  totalStages: number;
  /** ISO timestamp the current stage became due. */
  nextDueAt: string;
  subject: string;
  /** Human-readable recipient for the notification body. */
  recipient: string;
}

export interface ReminderOptions {
  quietHours: QuietHours;
  frequency: NotificationFrequency;
  /** "HH:mm" used when batching to a once-daily digest. */
  reminderTime: string;
  /** Repeat an unhandled reminder every N hours; 0 disables repeats. */
  overdueRepeatHours: number;
}

export interface ReminderPlan {
  sequenceId: string;
  conversationId: string;
  stageIndex: number;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Unique per occurrence; the database rejects duplicates. */
  dedupeKey: string;
  dueAt: string;
  deliverAt: string;
}

const HOUR_MS = 60 * 60 * 1000;

function parseISO(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseHHmm(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Which repeat round a due reminder belongs to. Round 0 is the original
 * occurrence; round N is the Nth repeat for a reminder nobody handled.
 * Derived from the stored due time, so it is identical after a restart.
 */
export function repeatRound(dueAt: Date, now: Date, repeatHours: number): number {
  if (!Number.isFinite(repeatHours) || repeatHours <= 0) return 0;
  const elapsedMs = now.getTime() - dueAt.getTime();
  if (elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / (repeatHours * HOUR_MS));
}

/** Batches an occurrence according to the user's notification frequency. */
export function batchTime(
  occurrence: Date,
  frequency: NotificationFrequency,
  reminderTime: string,
): Date {
  if (frequency === 'immediate') return occurrence;

  if (frequency === 'hourly') {
    const top = new Date(occurrence);
    top.setMinutes(0, 0, 0);
    if (top.getTime() <= occurrence.getTime()) top.setTime(top.getTime() + HOUR_MS);
    return top;
  }

  // 'daily': the next occurrence of the configured reminder time.
  const time = parseHHmm(reminderTime);
  if (!time) return occurrence;
  const target = new Date(occurrence);
  target.setHours(time.hours, time.minutes, 0, 0);
  if (target.getTime() <= occurrence.getTime()) target.setDate(target.getDate() + 1);
  return target;
}

/**
 * The moment this occurrence may actually be surfaced: batching first, then
 * quiet hours. Quiet hours can only push delivery later, never earlier, and
 * never change whether the follow-up appears in the list.
 */
export function deliveryTime(occurrence: Date, opts: ReminderOptions): Date {
  const batched = batchTime(occurrence, opts.frequency, opts.reminderTime);
  return nextAllowedTime(batched, opts.quietHours);
}

/** Whether the reminder counts as overdue rather than merely due. */
export function isOverdue(dueAt: Date, now: Date): boolean {
  return now.getTime() >= addCalendarDays(dueAt, 1).getTime();
}

function describeRecipient(recipient: string): string {
  const trimmed = recipient.trim();
  return trimmed.length > 0 ? trimmed : 'this conversation';
}

/**
 * Turns due sequences into concrete, deduped reminder plans.
 *
 * Rows whose `next_due_at` is still in the future are ignored, so a caller may
 * safely pass every active sequence — the scan is idempotent.
 */
export function planReminders(
  rows: DueSequence[],
  now: Date,
  opts: ReminderOptions,
): ReminderPlan[] {
  const plans: ReminderPlan[] = [];

  for (const row of rows) {
    const dueAt = parseISO(row.nextDueAt);
    if (!dueAt) continue;
    if (now.getTime() < dueAt.getTime()) continue;

    const round = repeatRound(dueAt, now, opts.overdueRepeatHours);
    const occurrence = new Date(dueAt.getTime() + round * opts.overdueRepeatHours * HOUR_MS);
    const overdue = isOverdue(dueAt, now);
    const stage = row.currentStage + 1;

    const title = overdue ? 'Follow-up overdue' : 'Follow-up due';
    const body =
      `Stage ${stage} of ${Math.max(row.totalStages, stage)} · ${describeRecipient(row.recipient)}` +
      (row.subject.trim().length > 0 ? ` · “${row.subject.trim()}”` : '');

    plans.push({
      sequenceId: row.sequenceId,
      conversationId: row.conversationId,
      stageIndex: row.currentStage,
      kind: overdue ? 'followup_overdue' : 'followup_due',
      title,
      body,
      dedupeKey:
        round === 0
          ? `followup:${row.sequenceId}:stage:${row.currentStage}`
          : `followup:${row.sequenceId}:stage:${row.currentStage}:repeat:${round}`,
      dueAt: dueAt.toISOString(),
      deliverAt: deliveryTime(occurrence, opts).toISOString(),
    });
  }

  return plans;
}
