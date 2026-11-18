import { addCalendarDays, addWorkingDays } from '../utils/dates';
import type { FollowUpSequence, FollowUpStatus } from '../types';

/**
 * Follow-up scheduling core (spec §6.3).
 *
 * Rules:
 * - The next interval is always calculated from the actual date/time the
 *   previous follow-up was sent — never from the original email date.
 * - A stage advances only after the user actually sends the follow-up.
 * - A reminder becoming due never advances a stage by itself.
 */

export interface ScheduleOptions {
  useWorkingDays: boolean;
  /** Local time of day ("HH:mm") at which a reminder becomes due. */
  reminderTime: string;
}

export interface StageAdvanceResult {
  currentStage: number;
  nextDueAt: string | null;
  status: FollowUpStatus;
}

/** Computes when the reminder for a stage becomes due. */
export function computeDueDate(
  lastSentAt: Date,
  intervalDays: number,
  opts: ScheduleOptions,
): Date {
  const base = opts.useWorkingDays
    ? addWorkingDays(lastSentAt, intervalDays)
    : addCalendarDays(lastSentAt, intervalDays);
  const [h, m] = opts.reminderTime.split(':').map((v) => Number.parseInt(v, 10));
  const due = new Date(base);
  due.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  return due;
}

/**
 * Derives the timing status of a pending reminder:
 * - scheduled: due date is in the future
 * - due: due date reached, still within the due day
 * - overdue: a full day has passed since the due date
 */
export function deriveTimingStatus(
  nextDueAt: Date | null,
  now: Date,
): 'scheduled' | 'due' | 'overdue' | null {
  if (!nextDueAt) return null;
  if (now.getTime() < nextDueAt.getTime()) return 'scheduled';
  const overdueAt = addCalendarDays(nextDueAt, 1);
  return now.getTime() >= overdueAt.getTime() ? 'overdue' : 'due';
}

/** Initial schedule when follow-up is enabled on an outbound message. */
export function initialSchedule(
  sentAt: Date,
  stages: number[],
  opts: ScheduleOptions,
): StageAdvanceResult {
  if (stages.length === 0) {
    return { currentStage: 0, nextDueAt: null, status: 'waiting' };
  }
  return {
    currentStage: 0,
    nextDueAt: computeDueDate(sentAt, stages[0], opts).toISOString(),
    status: 'scheduled',
  };
}

/**
 * Advances a sequence after the user actually sends a follow-up.
 * The next interval is measured from `sentAt` (the real send time).
 */
export function advanceOnFollowUpSent(
  seq: FollowUpSequence,
  stages: number[],
  sentAt: Date,
  opts: ScheduleOptions,
): StageAdvanceResult {
  const nextStage = seq.currentStage + 1;
  if (nextStage >= stages.length) {
    return { currentStage: seq.currentStage, nextDueAt: null, status: 'waiting' };
  }
  return {
    currentStage: nextStage,
    nextDueAt: computeDueDate(sentAt, stages[nextStage], opts).toISOString(),
    status: 'scheduled',
  };
}

/** Marks a sequence as replied — all pending reminders stop (spec §6.5). */
export function completeOnReply(seq: FollowUpSequence): StageAdvanceResult {
  return { currentStage: seq.currentStage, nextDueAt: null, status: 'replied' };
}

/** Snoozes a sequence until `days` from `now`. */
export function snoozeUntil(days: number, now: Date = new Date()): string {
  return addCalendarDays(now, days).toISOString();
}
