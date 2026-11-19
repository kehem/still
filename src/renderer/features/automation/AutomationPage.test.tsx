// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Account } from '../../../shared/types';
const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('../../services/api', () => ({ isElectron: true, getAPI: () => ({ sendEmail }) }));
import { AutomationPage } from './AutomationPage';
const accounts = [{ id: 'a', email: 'sender@example.com' }] as Account[];
const rows = [1, 2].map(i => ({ id: String(i), to: `r${i}@example.com`, subject: 'Hello', body: 'Body', selected: true, status: 'pending' }));
beforeEach(() => { localStorage.clear(); localStorage.setItem('still:automation:v1', JSON.stringify(rows)); sendEmail.mockReset().mockResolvedValue({}); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('sends only one selected row per manual click and honours interval', async () => {
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  fireEvent.click(screen.getByText('Send next'));
  await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
  await screen.findByText('sent');
  fireEvent.click(screen.getByText('Send next'));
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem('still:automation:v1')!)[0].status).toBe('sent');
});
it('stops at daily limit without sending', async () => {
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  fireEvent.change(screen.getByLabelText('Emails per day'), { target: { value: '1' } });
  fireEvent.click(screen.getByText('Send next'));
  await screen.findByText('sent');
  fireEvent.click(screen.getByText('Send next'));
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('Daily limit');
});
it('does not retry failed sends and pauses', async () => {
  sendEmail.mockRejectedValue(new Error('SMTP failure'));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  fireEvent.click(screen.getByText('Start automatic sending'));
  await screen.findByText('failed');
  expect(screen.getByRole('status').textContent).toContain('Paused');
  expect(sendEmail).toHaveBeenCalledTimes(1);
});
it('recovers interrupted sends as failed and never starts on mount', () => {
  localStorage.setItem('still:automation:v1', JSON.stringify([{ ...rows[0], status: 'sending' }]));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  expect(screen.getByText('failed')).toBeTruthy();
  expect(sendEmail).not.toHaveBeenCalled();
});
