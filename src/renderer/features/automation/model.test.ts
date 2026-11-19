import { describe, expect, it } from 'vitest';
import { limitsValid, localDay, validRow, type QueueRow } from './model';
const row: QueueRow = { id: '1', to: 'a@example.com', subject: 'Hello', body: 'Hi', selected: true, status: 'pending' };
describe('automation validation', () => {
  it('allows one recipient and a nonempty body', () => {
    expect(validRow(row)).toBe(true);
    for (const to of ['bad', 'a@example.com,b@example.com', 'a@example.com;b@example.com', 'a b@example.com']) expect(validRow({ ...row, to })).toBe(false);
    expect(validRow({ ...row, body: '  ' })).toBe(false);
    expect(validRow({ ...row, subject: 'a'.repeat(1001) })).toBe(false);
  });
  it('bounds daily and interval values', () => {
    expect(limitsValid(50, 30)).toBe(true);
    for (const value of [0, -1, NaN, Infinity, 1.5, 10001]) expect(limitsValid(value, 30)).toBe(false);
    expect(limitsValid(50, 0)).toBe(false);
    expect(limitsValid(50, 86401)).toBe(false);
  });
  it('uses the local calendar day', () => { expect(localDay(new Date(2026, 10, 19))).toBe('2026-11-19'); });
});
