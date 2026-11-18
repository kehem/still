import { describe, expect, it } from 'vitest';
import { addCalendarDays, addWorkingDays, formatRelative, isSameDay } from './dates';

describe('addCalendarDays', () => {
  it('crosses month boundaries', () => {
    const result = addCalendarDays(new Date('2025-11-28T10:00:00'), 5);
    expect(result.getMonth()).toBe(11); // December
    expect(result.getDate()).toBe(3);
  });
});

describe('addWorkingDays', () => {
  it('skips Saturday and Sunday', () => {
    // Friday 2025-11-14 + 1 = Monday 2025-11-17
    const result = addWorkingDays(new Date('2025-11-14T10:00:00'), 1);
    expect(result.getDate()).toBe(17);
    expect(result.getDay()).toBe(1);
  });

  it('handles a full working week', () => {
    // Monday 2025-11-17 + 5 = Monday 2025-11-24
    const result = addWorkingDays(new Date('2025-11-17T10:00:00'), 5);
    expect(result.getDate()).toBe(24);
    expect(result.getDay()).toBe(1);
  });
});

describe('isSameDay', () => {
  it('compares calendar days ignoring time', () => {
    expect(isSameDay(new Date('2025-11-17T01:00:00'), new Date('2025-11-17T23:00:00'))).toBe(true);
    expect(isSameDay(new Date('2025-11-17T23:00:00'), new Date('2025-11-18T01:00:00'))).toBe(false);
  });
});

describe('formatRelative', () => {
  const now = new Date('2025-11-17T12:00:00');

  it('shows the time for today', () => {
    expect(formatRelative('2025-11-17T09:41:00', now)).toContain('9:41');
  });

  it('shows Yesterday', () => {
    expect(formatRelative('2025-11-16T18:00:00', now)).toBe('Yesterday');
  });

  it('shows the weekday within the last week', () => {
    expect(formatRelative('2025-11-14T10:00:00', now)).toBe('Fri');
  });

  it('shows month and day for older messages', () => {
    expect(formatRelative('2025-10-02T10:00:00', now)).toBe('Oct 2');
  });
});
