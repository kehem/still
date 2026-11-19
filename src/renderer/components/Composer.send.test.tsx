// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Account } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/constants';
const mocks = vi.hoisted(() => ({ sendEmail: vi.fn(), createFollowUp: vi.fn() }));
vi.mock('../services/api', () => ({ isElectron: true, getAPI: () => ({ ...mocks, listSchedules: async () => [], saveDraft: async () => ({ id: 'draft' }) }) }));
vi.mock('../hooks/useSettings', () => ({ useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, confirmBeforeSend: false } }) }));
import { Composer } from './Composer';
const accounts = [{ id: 'a', email: 'sender@example.com' }] as Account[];
beforeEach(() => { mocks.sendEmail.mockReset().mockResolvedValue({ conversationId: 'c1' }); mocks.createFollowUp.mockReset().mockResolvedValue({ id: 'tracking' }); });
afterEach(cleanup);
function compose() { return render(<Composer accounts={accounts} initial={{ accountId: 'a', toAddresses: ['r@example.com'], subject: 'Hello', body: 'Body', followUpEnabled: true, followUpIntervalDays: 7 }} onClose={vi.fn()} onSent={vi.fn()} />); }
it('enables follow-up with the selected interval on every compose session', async () => {
  const first = compose();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mocks.createFollowUp).toHaveBeenCalledWith({ conversationId: 'c1', intervalDays: 7 }));
  first.unmount();
  mocks.sendEmail.mockResolvedValue({ conversationId: 'c2' });
  compose();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mocks.createFollowUp).toHaveBeenLastCalledWith({ conversationId: 'c2', intervalDays: 7 }));
});
it('guards concurrent clicks and blocks resend after follow-up setup fails', async () => {
  mocks.createFollowUp.mockRejectedValue(new Error('Tracking unavailable'));
  compose();
  const send = screen.getByRole('button', { name: 'Send' });
  fireEvent.click(send); fireEvent.click(send);
  await screen.findByText(/Message sent. Follow-up setup failed/);
  fireEvent.click(send);
  expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
});
