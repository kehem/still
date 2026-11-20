import { describe, expect, it } from 'vitest';
import type { FollowUpListItem } from '../types';
import { followUpTab } from './tabs';
const today = new Date(2026, 10, 19, 12);
function item(date: Date | null, status: FollowUpListItem['status'] = 'scheduled', snoozedUntil?: Date): FollowUpListItem {
  return { status, nextDueAt: date?.toISOString() ?? null, sequence: { snoozedUntil: snoozedUntil?.toISOString() ?? null } } as FollowUpListItem;
}
describe('follow-up date tabs', () => {
  it('keeps all of today, even future reminder hours, only in Today', () => {
    expect(followUpTab(item(new Date(2026, 10, 19, 0)), today)).toBe('today');
    expect(followUpTab(item(new Date(2026, 10, 19, 23, 59)), today)).toBe('today');
    expect(followUpTab(item(new Date(2026, 10, 19, 9), 'overdue'), today)).toBe('today');
  });
  it('moves past calendar dates to Due regardless of stale timing status', () => {
    expect(followUpTab(item(new Date(2026, 10, 18, 23, 59)), today)).toBe('due');
    expect(followUpTab(item(new Date(2026, 10, 20, 0), 'due'), today)).toBe('upcoming');
  });
  it('rolls from Today to Due at local midnight, not 24h after the reminder hour', () => {
    const followup = item(new Date(2026, 10, 19, 22));
    expect(followUpTab(followup, today)).toBe('today');
    expect(followUpTab(followup, new Date(2026, 10, 20, 0))).toBe('due');
  });
  it('uses the snoozed date instead of the original overdue date', () => {
    const past = new Date(2026, 10, 15);
    expect(followUpTab(item(past, 'snoozed', new Date(2026, 10, 20)), today)).toBe('upcoming');
    expect(followUpTab(item(past, 'snoozed', new Date(2026, 10, 19, 18)), today)).toBe('today');
  });
  it('keeps terminal and waiting items out of date tabs', () => {
    for (const state of ['completed', 'replied', 'cancelled'] as const) expect(followUpTab(item(new Date(2026, 10, 1), state), today)).toBe('completed');
    expect(followUpTab(item(null, 'waiting'), today)).toBe('waiting');
    expect(followUpTab(item(null), today)).toBe('upcoming');
  });
});
