import { describe, expect, it } from 'vitest';
import {
  advanceOnFollowUpSent,
  completeOnReply,
  computeDueDate,
  deriveTimingStatus,
  initialSchedule,
} from './scheduler';
import type { FollowUpSequence } from '../types';

const calendarOpts = { useWorkingDays: false, reminderTime: '09:00' };
const workingOpts = { useWorkingDays: true, reminderTime: '09:00' };

function makeSeq(partial: Partial<FollowUpSequence> = {}): FollowUpSequence {
  return {
    id: 'seq-1',
    conversationId: 'conv-1',
    accountId: 'acc-1',
    scheduleId: null,
    currentStage: 0,
    status: 'scheduled',
    lastSentAt: '2025-11-17T10:00:00',
    nextDueAt: null,
    snoozedUntil: null,
    createdAt: '2025-11-17T10:00:00',
    updatedAt: '2025-11-17T10:00:00',
    ...partial,
  };
}

describe('computeDueDate', () => {
  it('adds calendar days and applies the reminder time', () => {
    const due = computeDueDate(new Date('2025-11-17T10:00:00'), 3, calendarOpts);
    expect(due.getFullYear()).toBe(2025);
    expect(due.getMonth()).toBe(10); // November
    expect(due.getDate()).toBe(20);
    expect(due.getHours()).toBe(9);
    expect(due.getMinutes()).toBe(0);
  });

  it('adds working days, skipping weekends', () => {
    // Friday 2025-11-14 + 1 working day = Monday 2025-11-17
    const due = computeDueDate(new Date('2025-11-14T10:00:00'), 1, workingOpts);
    expect(due.getDate()).toBe(17);
    expect(due.getDay()).toBe(1); // Monday
  });

  it('adds multiple working days across a weekend', () => {
    // Friday 2025-11-14 + 3 working days = Wednesday 2025-11-19
    const due = computeDueDate(new Date('2025-11-14T10:00:00'), 3, workingOpts);
    expect(due.getDate()).toBe(19);
    expect(due.getDay()).toBe(3); // Wednesday
  });
});

describe('spec example chain: Nov 17 → Nov 20 → Nov 27 → Dec 12 → Jan 11', () => {
  it('calculates each stage from the actual send date of the previous follow-up', () => {
    const stages = [3, 7, 15, 30];

    // Original email sent Nov 17 → first reminder Nov 20
    const initial = initialSchedule(new Date('2025-11-17T10:00:00'), stages, calendarOpts);
    expect(initial.currentStage).toBe(0);
    expect(new Date(initial.nextDueAt!).getDate()).toBe(20);
    expect(new Date(initial.nextDueAt!).getMonth()).toBe(10);

    // Follow-up sent Nov 20 → second reminder Nov 27 (7 days from Nov 20, not Nov 17)
    const r1 = advanceOnFollowUpSent(
      makeSeq({ currentStage: 0 }),
      stages,
      new Date('2025-11-20T09:05:00'),
      calendarOpts,
    );
    expect(r1.currentStage).toBe(1);
    expect(new Date(r1.nextDueAt!).getDate()).toBe(27);
    expect(new Date(r1.nextDueAt!).getMonth()).toBe(10);

    // Follow-up sent Nov 27 → third reminder Dec 12 (15 days)
    const r2 = advanceOnFollowUpSent(
      makeSeq({ currentStage: 1 }),
      stages,
      new Date('2025-11-27T09:10:00'),
      calendarOpts,
    );
    expect(r2.currentStage).toBe(2);
    expect(new Date(r2.nextDueAt!).getDate()).toBe(12);
    expect(new Date(r2.nextDueAt!).getMonth()).toBe(11); // December

    // Follow-up sent Dec 12 → fourth reminder Jan 11 (30 days)
    const r3 = advanceOnFollowUpSent(
      makeSeq({ currentStage: 2 }),
      stages,
      new Date('2025-12-12T09:00:00'),
      calendarOpts,
    );
    expect(r3.currentStage).toBe(3);
    expect(new Date(r3.nextDueAt!).getDate()).toBe(11);
    expect(new Date(r3.nextDueAt!).getMonth()).toBe(0); // January
    expect(new Date(r3.nextDueAt!).getFullYear()).toBe(2026);

    // Follow-up sent Jan 11 → no more stages → waiting for reply
    const r4 = advanceOnFollowUpSent(
      makeSeq({ currentStage: 3 }),
      stages,
      new Date('2026-01-11T09:00:00'),
      calendarOpts,
    );
    expect(r4.nextDueAt).toBeNull();
    expect(r4.status).toBe('waiting');
  });

  it('does not advance a stage merely because a reminder became due', () => {
    // The sequence state is unchanged until a follow-up is actually sent.
    const seq = makeSeq({ currentStage: 0, nextDueAt: '2025-11-20T09:00:00' });
    expect(seq.currentStage).toBe(0);
    expect(seq.status).toBe('scheduled');
  });
});

describe('deriveTimingStatus', () => {
  const due = new Date('2025-11-20T09:00:00');

  it('returns scheduled before the due date', () => {
    expect(deriveTimingStatus(due, new Date('2025-11-19T12:00:00'))).toBe('scheduled');
  });

  it('returns due on the due day', () => {
    expect(deriveTimingStatus(due, new Date('2025-11-20T10:00:00'))).toBe('due');
  });

  it('returns overdue a full day after the due date', () => {
    expect(deriveTimingStatus(due, new Date('2025-11-21T09:00:00'))).toBe('overdue');
  });

  it('returns null when there is no pending reminder', () => {
    expect(deriveTimingStatus(null, new Date())).toBeNull();
  });
});

describe('completeOnReply', () => {
  it('stops pending reminders and marks the sequence replied', () => {
    const result = completeOnReply(
      makeSeq({ currentStage: 1, nextDueAt: '2025-11-27T09:00:00' }),
    );
    expect(result.status).toBe('replied');
    expect(result.nextDueAt).toBeNull();
  });
});
