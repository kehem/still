// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FollowUpListItem } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/constants';
vi.mock('../services/api', () => ({ getAPI: () => ({ listSchedules: async () => [], getFollowUpImport: async () => ({ fileName: '', sourceBase64: '', rows: [], stage: 0, selectedRows: [], rowStages: {}, bodySource: 'spreadsheet', customBodies: ['', '', ''] }), saveFollowUpImport: async (value: unknown) => value }) }));
vi.mock('../hooks/useSettings', () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }) }));
import { FollowUpsPage } from './FollowUpsPage';
function item(id: string, date: Date, status: FollowUpListItem['status'] = 'scheduled') {
  return { subject: id, recipient: `${id}@example.com`, status, lastSentAt: date.toISOString(), nextDueAt: date.toISOString(), currentStage: 0, stageCount: 3,
    account: { displayName: 'Personal', color: null }, sequence: { id, status, snoozedUntil: null } } as FollowUpListItem;
}
function page(items: FollowUpListItem[]) { return <FollowUpsPage items={items} onOpen={() => {}} onChanged={() => {}} onSendFollowUp={() => {}} />; }
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('only renders the selected date tab and separates past, current and future days', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 19, 12));
  await act(async () => { render(page([
    item('today-message', new Date(2026, 10, 19, 23)),
    item('past-message', new Date(2026, 10, 18, 23)),
    item('future-message', new Date(2026, 10, 20, 9)),
    item('finished-message', new Date(2026, 10, 19, 9), 'completed'),
  ])); });
  fireEvent.click(screen.getByRole('tab', { name: /^Today / }));
  expect(screen.getByText('today-message')).toBeTruthy();
  expect(screen.queryByText('past-message')).toBeNull();
  expect(screen.queryByText('future-message')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /^Due / }));
  expect(screen.getByText('past-message')).toBeTruthy();
  expect(screen.queryByText('today-message')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /^Upcoming / }));
  expect(screen.getByText('future-message')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /^Completed / }));
  expect(screen.getByText('finished-message')).toBeTruthy();
});
it('moves today items into Due automatically after midnight while the page stays open', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 19, 23, 59, 45));
  await act(async () => { render(page([item('rolling-message', new Date(2026, 10, 19, 9))])); });
  fireEvent.click(screen.getByRole('tab', { name: /^Today / }));
  expect(screen.getByText('rolling-message')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByText('rolling-message')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /^Due / }));
  expect(screen.getByText('rolling-message')).toBeTruthy();
});
it('includes future and waiting conversations in All active without requiring a due date', async () => {
  const future = item('not-due', new Date(2099, 0, 1));
  const waiting = item('waiting-for-reply', new Date(2099, 0, 2), 'waiting');
  await act(async () => { render(page([future, waiting])); });
  fireEvent.click(screen.getByRole('tab', { name: /^All active / }));
  expect(screen.getByText('not-due')).toBeTruthy();
  expect(screen.getByText('waiting-for-reply')).toBeTruthy();
  expect(screen.getAllByTitle('Send follow-up')).toHaveLength(2);
});
