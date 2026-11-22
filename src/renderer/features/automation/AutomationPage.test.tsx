// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Account } from '../../../shared/types';
import { automationTestAPI } from './test-api';
const mock = vi.hoisted(() => ({ api: {} as ReturnType<typeof automationTestAPI>['api'] }));
vi.mock('../../services/api', () => ({ isElectron: true, getAPI: () => mock.api }));
import { AutomationPage } from './AutomationPage';
const accounts = [{ id: 'a', email: 'sender@example.com' }] as Account[];
const rows = [1, 2].map(i => ({ id: String(i), to: `r${i}@example.com`, subject: 'Hello', body: 'Body', selected: true, status: 'pending' as const }));
let store: ReturnType<typeof automationTestAPI>;
beforeEach(() => {
  localStorage.clear(); store = automationTestAPI(); mock.api = store.api;
  store.seed({ fileName: 'contacts.xlsx', accountId: 'a', rows });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function open() {
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  await screen.findByText('contacts.xlsx');
  await waitFor(() => expect((screen.getByText('Send next') as HTMLButtonElement).disabled).toBe(false));
}
it('restores the saved file and sends a specific unselected row from its action button', async () => {
  store.seed({ rows: rows.map(r => ({ ...r, selected: false })) });
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  const action = await screen.findByRole('button', { name: 'Send mail to r2@example.com' });
  fireEvent.click(action);
  await waitFor(() => expect(mock.api.sendAutomationRow).toHaveBeenCalledWith('2'));
  expect(await screen.findByText('Done')).toBeTruthy();
  expect(store.get().workspace.rows[0].status).toBe('pending');
});
it('sends one row per manual click and respects the interval', async () => {
  await open();
  fireEvent.click(screen.getByText('Send next'));
  await screen.findByText('Done');
  fireEvent.click(screen.getByText('Send next'));
  expect(mock.api.sendAutomationRow).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('status', { name: 'Sending status' }).textContent).toContain('interval'));
});
it('saves a changed daily limit and stops at that limit', async () => {
  await open();
  const limit = screen.getByLabelText('Emails per day');
  fireEvent.change(limit, { target: { value: '1' } }); fireEvent.blur(limit);
  await waitFor(() => expect(store.get().workspace.daily).toBe(1));
  await waitFor(() => expect((screen.getByText('Send next') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Send next'));
  await screen.findByText('Done');
  fireEvent.click(screen.getByText('Send next'));
  expect(mock.api.sendAutomationRow).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('status', { name: 'Sending status' }).textContent).toContain('Daily limit'));
});
it('shows active follow-up matches as done and prevents sending them again', async () => {
  store.seed({ rows: [{ ...rows[0], status: 'sent', followUpActive: true, selected: false, sentAt: new Date().toISOString() }] });
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  expect(await screen.findByText('Follow-up active')).toBeTruthy();
  expect(screen.getByText('Done')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Send mail to r1@example.com' })).toBeNull();
});
it('pauses after uncertain failures without retrying', async () => {
  mock.api.sendAutomationRow.mockRejectedValue(new Error('SMTP failure'));
  await open();
  fireEvent.click(screen.getByText('Start automatic sending'));
  expect((await screen.findByRole('alert')).textContent).toContain('SMTP failure');
  expect(screen.getByRole('status', { name: 'Sending status' }).textContent).toContain('Paused');
  expect(mock.api.sendAutomationRow).toHaveBeenCalledTimes(1);
});
it('blocks zero daily limit rather than interpreting it as unlimited', async () => {
  await open();
  fireEvent.change(screen.getByLabelText('Emails per day'), { target: { value: '0' } });
  expect((screen.getByText('Send next') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Enter at least 1 email/)).toBeTruthy();
});
it('keeps progress and original mapping when the component is reopened', async () => {
  store.seed({ table: [['E', 'S', 'B'], ['r@example.com', 'Hi', 'Body']], columns: [2, 0, 1], rows: [{ ...rows[0], status: 'sent', selected: false }] });
  const first = render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  await screen.findByText('Done'); first.unmount();
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  await screen.findByText('Done');
  fireEvent.click(screen.getByText('Manage spreadsheet'));
  expect((screen.getByLabelText('Email column') as HTMLSelectElement).value).toBe('2');
});

it('refreshes sent detection on demand without sending any mail', async () => {
  await open();
  store.seed({ rows: [{ ...rows[0], status: 'sent', selected: false }] });
  fireEvent.click(screen.getByText('Refresh sent status'));
  expect(await screen.findByText('Done')).toBeTruthy();
  expect(mock.api.sendAutomationRow).not.toHaveBeenCalled();
  expect(screen.getByRole('status', { name: 'Sending status' }).textContent).toContain('refreshed');
});

it('shows the receiver mail provider below the address and in the send confirmation', async () => {
  mock.api.getEmailProviders.mockResolvedValue({ 'example.com': 'Google Workspace' });
  await open();
  await screen.findAllByText('Google Workspace');
  vi.mocked(window.confirm).mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Send mail to r1@example.com' }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Email provider: Google Workspace'));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('To: r1@example.com'));
  expect(mock.api.sendAutomationRow).not.toHaveBeenCalled();
});

it('hides row sending and blocks batch sending for failed or inconclusive recipient checks', async () => {
  mock.api.checkEmailRecipients.mockResolvedValue({
    'r1@example.com': { status: 'invalid', detail: 'SMTP rejected recipient' },
    'r2@example.com': { status: 'unknown', detail: 'SMTP timed out' },
  });
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  await screen.findByText('SMTP rejected recipient');
  expect(screen.queryByRole('button', { name: 'Send mail to r1@example.com' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send mail to r2@example.com' })).toBeNull();
  expect((screen.getByText('Send next') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Start automatic sending') as HTMLButtonElement).disabled).toBe(true);
  expect(mock.api.sendAutomationRow).not.toHaveBeenCalled();
});
it('reveals a passed recipient immediately while checking the next recipient separately', async () => {
  let finishFirst!: (value: Record<string, { status: string; detail: string }>) => void;
  let finishSecond!: (value: Record<string, { status: string; detail: string }>) => void;
  mock.api.checkEmailRecipients.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  await waitFor(() => expect(mock.api.checkEmailRecipients).toHaveBeenCalledWith(['r1@example.com']));
  expect(screen.queryByRole('button', { name: 'Send mail to r1@example.com' })).toBeNull();
  finishFirst({ 'r1@example.com': { status: 'valid', detail: 'SMTP accepted' } });
  expect(await screen.findByRole('button', { name: 'Send mail to r1@example.com' })).toBeTruthy();
  await waitFor(() => expect(mock.api.checkEmailRecipients).toHaveBeenCalledWith(['r2@example.com']));
  expect(screen.queryByRole('button', { name: 'Send mail to r2@example.com' })).toBeNull();
  finishSecond({ 'r2@example.com': { status: 'invalid', detail: 'No mailbox' } });
  await screen.findByText('No mailbox');
});
it('shows Send for catch-all recipients with a warning and permits the send action', async () => {
  mock.api.checkEmailRecipients.mockImplementation(async (addresses: string[]) => Object.fromEntries(addresses.map(address => [address, { status: 'catch_all', detail: 'Catch-all domain: specific mailbox unverified; sending may bounce.' }])));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  const send = await screen.findByRole('button', { name: 'Send mail to r1@example.com' });
  expect((send as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(send);
  await waitFor(() => expect(mock.api.sendAutomationRow).toHaveBeenCalledWith('1'));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('specific mailbox is unverified'));
});
it('passes the exact displayed approval when sending rather than starting another recipient check', async () => {
  mock.api.checkEmailRecipients.mockImplementation(async (addresses: string[]) => Object.fromEntries(addresses.map(address => [address, { status: 'valid', detail: 'Accepted', expiresAt: Date.now() + 300000, verificationId: `proof:${address}` }])));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send mail to r1@example.com' }));
  await waitFor(() => expect(mock.api.sendAutomationRow).toHaveBeenCalledWith('1', 'proof:r1@example.com'));
});
it('disables Send actions when the daily limit is already reached', async () => {
  const original = mock.api.getAutomation.getMockImplementation()!;
  mock.api.getAutomation.mockImplementation(async () => ({ ...await original(), attemptedToday: 50 }));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  const send = await screen.findByRole('button', { name: 'Send mail to r1@example.com' });
  expect((send as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Send next') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status', { name: 'Sending status' }).textContent).toContain('Daily limit reached');
});
it('shows an interval wait and disables row sending until the interval permits it', async () => {
  const original = mock.api.getAutomation.getMockImplementation()!;
  mock.api.getAutomation.mockImplementation(async () => ({ ...await original(), lastAttemptAt: Date.now() }));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  const send = await screen.findByRole('button', { name: 'Send mail to r1@example.com' });
  expect((send as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status', { name: 'Sending status' }).textContent).toContain('Waiting for the send interval');
  expect(mock.api.sendAutomationRow).not.toHaveBeenCalled();
});

it('does not periodically recheck settled recipients and supports explicit manual Recheck', async () => {
  await open();
  await waitFor(() => expect(mock.api.checkEmailRecipients).toHaveBeenCalledTimes(2));
  vi.useFakeTimers();
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });
    expect(mock.api.checkEmailRecipients).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recheck recipients' })); });
    expect(mock.api.checkEmailRecipients).toHaveBeenCalledWith(['r1@example.com'], true);
    expect(mock.api.checkEmailRecipients).toHaveBeenCalledWith(['r2@example.com'], true);
  } finally { vi.useRealTimers(); }
});
