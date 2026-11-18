import { describe, expect, it } from 'vitest';
import {
  batchTime,
  deliveryTime,
  isOverdue,
  planReminders,
  repeatRound,
  type DueSequence,
  type ReminderOptions,
} from './reminder-engine';
import { isWithinQuietHours, nextAllowedTime } from './quiethours';
import { deriveTimingStatus } from '../followup/scheduler';

/**
 * Dates are built with the local-time constructor so these assertions hold in
 * any timezone: quiet hours are a wall-clock window in the user's own time.
 */
const at = (h: number, m = 0, day = 17) => new Date(2026, 10, day, h, m, 0, 0);

const QUIET_OFF = { enabled: false, start: '22:00', end: '08:00' };

function opts(overrides: Partial<ReminderOptions> = {}): ReminderOptions {
  return {
    quietHours: QUIET_OFF,
    frequency: 'immediate',
    reminderTime: '09:00',
    overdueRepeatHours: 0,
    ...overrides,
  };
}

function row(overrides: Partial<DueSequence> = {}): DueSequence {
  return {
    sequenceId: 'seq-1',
    conversationId: 'conv-1',
    currentStage: 0,
    totalStages: 4,
    nextDueAt: at(9).toISOString(),
    subject: 'Proposal for Q1',
    recipient: 'marco@partner.example',
    ...overrides,
  };
}

describe('isWithinQuietHours', () => {
  it('is false when quiet hours are disabled, even inside the window', () => {
    expect(isWithinQuietHours(at(23), QUIET_OFF)).toBe(false);
  });

  it('detects a window that crosses midnight on both sides', () => {
    const quiet = { enabled: true, start: '22:00', end: '08:00' };
    expect(isWithinQuietHours(at(23, 30), quiet)).toBe(true);
    expect(isWithinQuietHours(at(0, 15), quiet)).toBe(true);
    expect(isWithinQuietHours(at(7, 59), quiet)).toBe(true);
    expect(isWithinQuietHours(at(8, 0), quiet)).toBe(false);
    expect(isWithinQuietHours(at(21, 59), quiet)).toBe(false);
  });

  it('detects a same-day window', () => {
    const quiet = { enabled: true, start: '01:00', end: '06:00' };
    expect(isWithinQuietHours(at(3), quiet)).toBe(true);
    expect(isWithinQuietHours(at(6), quiet)).toBe(false);
    expect(isWithinQuietHours(at(0, 59), quiet)).toBe(false);
  });

  it('treats an empty or unparsable window as off, never as all-day silence', () => {
    // A typo in settings must not suppress every reminder the user relies on.
    expect(isWithinQuietHours(at(3), { enabled: true, start: '09:00', end: '09:00' })).toBe(false);
    expect(isWithinQuietHours(at(3), { enabled: true, start: 'nonsense', end: '08:00' })).toBe(false);
    expect(isWithinQuietHours(at(3), { enabled: true, start: '', end: '' })).toBe(false);
    expect(isWithinQuietHours(at(3), { enabled: true, start: '25:00', end: '08:00' })).toBe(false);
  });
});

describe('nextAllowedTime', () => {
  const quiet = { enabled: true, start: '22:00', end: '08:00' };

  it('returns the input unchanged outside the window', () => {
    const t = at(14, 30);
    expect(nextAllowedTime(t, quiet).getTime()).toBe(t.getTime());
  });

  it('defers an evening reminder to the next morning', () => {
    const result = nextAllowedTime(at(23, 15), quiet);
    expect(result.getHours()).toBe(8);
    expect(result.getMinutes()).toBe(0);
    expect(result.getDate()).toBe(18);
  });

  it('defers a pre-dawn reminder to that same morning', () => {
    const result = nextAllowedTime(at(2, 0), quiet);
    expect(result.getDate()).toBe(17);
    expect(result.getHours()).toBe(8);
  });

  it('never moves a reminder earlier', () => {
    const t = at(23, 15);
    expect(nextAllowedTime(t, quiet).getTime()).toBeGreaterThan(t.getTime());
  });
});

describe('repeatRound', () => {
  it('is 0 when repeats are disabled, however long the reminder sat unhandled', () => {
    expect(repeatRound(at(9), at(20), 0)).toBe(0);
  });

  it('counts whole repeat intervals since the reminder fell due', () => {
    const due = at(9);
    expect(repeatRound(due, at(9, 30), 4)).toBe(0);
    expect(repeatRound(due, at(13), 4)).toBe(1);
    expect(repeatRound(due, at(17), 4)).toBe(2);
    expect(repeatRound(due, at(21), 4)).toBe(3);
  });

  it('is derived from stored timestamps, so it is identical after a restart', () => {
    const due = at(9);
    const now = at(17);
    expect(repeatRound(due, now, 4)).toBe(repeatRound(due, now, 4));
  });
});

describe('batchTime', () => {
  it('delivers immediately when the user asked for immediate notifications', () => {
    const t = at(10, 37);
    expect(batchTime(t, 'immediate', '09:00').getTime()).toBe(t.getTime());
  });

  it('holds an hourly digest to the next top of the hour', () => {
    expect(batchTime(at(10, 37), 'hourly', '09:00').getHours()).toBe(11);
    expect(batchTime(at(10, 37), 'hourly', '09:00').getMinutes()).toBe(0);
  });

  it('holds a daily digest to the configured reminder time', () => {
    const morning = batchTime(at(10, 37), 'daily', '09:00');
    expect(morning.getDate()).toBe(18);
    expect(morning.getHours()).toBe(9);

    const today = batchTime(at(6, 0), 'daily', '09:00');
    expect(today.getDate()).toBe(17);
    expect(today.getHours()).toBe(9);
  });

  it('falls back to the occurrence when the reminder time is unparsable', () => {
    const t = at(10, 37);
    expect(batchTime(t, 'daily', 'not-a-time').getTime()).toBe(t.getTime());
  });
});

describe('deliveryTime', () => {
  it('applies batching before quiet hours', () => {
    const quiet = { enabled: true, start: '22:00', end: '08:00' };
    // 21:40 batches to 22:00, which is inside the window, so it lands at 08:00.
    const result = deliveryTime(at(21, 40), opts({ quietHours: quiet, frequency: 'hourly' }));
    expect(result.getHours()).toBe(8);
    expect(result.getDate()).toBe(18);
  });
});

describe('isOverdue', () => {
  it('is due within the first day and overdue from the 24-hour mark onwards', () => {
    const due = at(9);
    expect(isOverdue(due, at(15))).toBe(false);
    expect(isOverdue(due, at(8, 59, 18))).toBe(false);
    // The boundary is inclusive, exactly as deriveTimingStatus treats it.
    expect(isOverdue(due, at(9, 0, 18))).toBe(true);
    expect(isOverdue(due, at(9, 1, 18))).toBe(true);
  });

  it('agrees with the status the reading pane shows, so a list row and its notification never contradict', () => {
    const due = at(9);
    for (const now of [at(10), at(23, 59), at(9, 0, 18), at(12, 0, 20)]) {
      const timing = deriveTimingStatus(due, now);
      expect(isOverdue(due, now)).toBe(timing === 'overdue');
    }
  });
});

describe('planReminders', () => {
  it('ignores sequences that are not due yet, so a full scan is safe', () => {
    const plans = planReminders([row({ nextDueAt: at(18).toISOString() })], at(10), opts());
    expect(plans).toEqual([]);
  });

  it('raises one reminder when a stage falls due', () => {
    const [plan] = planReminders([row()], at(10), opts());
    expect(plan.kind).toBe('followup_due');
    expect(plan.title).toBe('Follow-up due');
    expect(plan.body).toContain('Stage 1 of 4');
    expect(plan.body).toContain('marco@partner.example');
    expect(plan.body).toContain('Proposal for Q1');
    expect(plan.conversationId).toBe('conv-1');
    expect(plan.stageIndex).toBe(0);
  });

  it('switches to overdue once a day has passed', () => {
    const [plan] = planReminders([row()], at(12, 0, 19), opts());
    expect(plan.kind).toBe('followup_overdue');
    expect(plan.title).toBe('Follow-up overdue');
  });

  it('produces a stable dedupe key that survives an app restart', () => {
    const now = at(10);
    const before = planReminders([row()], now, opts())[0];
    const after = planReminders([row()], now, opts())[0];
    expect(before.dedupeKey).toBe('followup:seq-1:stage:0');
    expect(after.dedupeKey).toBe(before.dedupeKey);
  });

  it('gives every stage its own key, so stage 2 is not suppressed by stage 1', () => {
    const stage1 = planReminders([row({ currentStage: 0 })], at(10), opts())[0];
    const stage2 = planReminders([row({ currentStage: 1 })], at(10), opts())[0];
    expect(stage1.dedupeKey).not.toBe(stage2.dedupeKey);
    expect(stage2.body).toContain('Stage 2 of 4');
  });

  it('adds a new key for each repeat of an unhandled reminder', () => {
    const due = at(9);
    const keys = [at(10), at(13), at(17), at(21)].map(
      (now) => planReminders([row({ nextDueAt: due.toISOString() })], now, opts({ overdueRepeatHours: 4 }))[0].dedupeKey,
    );
    expect(keys).toEqual([
      'followup:seq-1:stage:0',
      'followup:seq-1:stage:0:repeat:1',
      'followup:seq-1:stage:0:repeat:2',
      'followup:seq-1:stage:0:repeat:3',
    ]);
    // A restart re-derives the same key rather than inventing a new reminder.
    const again = planReminders([row({ nextDueAt: due.toISOString() })], at(17), opts({ overdueRepeatHours: 4 }))[0];
    expect(again.dedupeKey).toBe('followup:seq-1:stage:0:repeat:2');
  });

  it('does not repeat at all when repeats are disabled', () => {
    const due = at(9);
    const keys = [at(10), at(23, 0, 20)].map(
      (now) => planReminders([row({ nextDueAt: due.toISOString() })], now, opts())[0].dedupeKey,
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('defers delivery inside quiet hours but still plans the reminder', () => {
    const quiet = { enabled: true, start: '22:00', end: '08:00' };
    const [plan] = planReminders(
      [row({ nextDueAt: at(23, 30).toISOString() })],
      at(23, 45),
      opts({ quietHours: quiet }),
    );
    // The reminder exists — only the banner is held until morning.
    expect(plan).toBeTruthy();
    expect(new Date(plan.deliverAt).getHours()).toBe(8);
    expect(new Date(plan.deliverAt).getDate()).toBe(18);
    expect(plan.dueAt).toBe(at(23, 30).toISOString());
  });

  it('skips rows with an unparsable due timestamp instead of throwing', () => {
    expect(planReminders([row({ nextDueAt: 'not-a-date' })], at(10), opts())).toEqual([]);
  });

  it('describes a conversation with no recipient sensibly', () => {
    const [plan] = planReminders([row({ recipient: '' })], at(10), opts());
    expect(plan.body).toContain('this conversation');
  });

  it('never claims more stages than the schedule has', () => {
    const [plan] = planReminders([row({ currentStage: 3, totalStages: 2 })], at(10), opts());
    expect(plan.body).toContain('Stage 4 of 4');
  });
});
