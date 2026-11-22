// @vitest-environment jsdom
import { emptyFollowUpImport } from '../../../shared/followup-import';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { FollowUpListItem } from '../../../shared/types';
import { FollowUpSpreadsheet } from './FollowUpSpreadsheet';
import { HEADERS } from './spreadsheet';
import Papa from 'papaparse';
const mocks = vi.hoisted(() => ({ toFile: vi.fn().mockResolvedValue(undefined), write: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock('../../services/api', () => ({ isElectron: true, getAPI: () => ({ getFollowUpImport: mocks.get, saveFollowUpImport: mocks.save }) }));
beforeEach(() => { mocks.get.mockResolvedValue(emptyFollowUpImport()); mocks.save.mockImplementation(async value => value); });
vi.mock('write-excel-file/browser', () => ({ default: mocks.write }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const item = { recipient: 'person@example.com', account: { email: 'me@example.com' }, conversation: { id: 'thread' }, subject: 'Proposal', status: 'scheduled', currentStage: 0 } as FollowUpListItem;
async function upload(table: string[][]) {
  await waitFor(() => expect((screen.getByRole('button', { name: 'Import Excel / CSV' }) as HTMLButtonElement).disabled).toBe(false));
  const file = new File([], 'followups.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(Papa.unparse(table)).buffer });
  Object.defineProperty(file, 'text', { value: async () => Papa.unparse(table) });
  fireEvent.change(screen.getByLabelText('Upload follow-up spreadsheet'), { target: { files: [file] } });
}
it('uploads a CSV and prepares the selected stage as a threaded review without sending', async () => {
  const prepare = vi.fn(); render(<FollowUpSpreadsheet items={[item]} onPrepare={prepare} />);
  await upload([HEADERS, ['person@example.com', 'me@example.com', 'thread', 'Proposal', 'One', 'Two', 'Three']]);
  await screen.findByRole('button', { name: 'Review follow-up 1' });
  expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Select follow-up row 2'));
  fireEvent.change(screen.getByLabelText('Follow-up message column'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review follow-up 3' }));
  expect(prepare).toHaveBeenCalledWith(item, 'Three');
  expect(item.currentStage).toBe(0);
});
it('does not offer a reply for unknown conversations or empty stage messages', async () => {
  render(<FollowUpSpreadsheet items={[item]} onPrepare={vi.fn()} />);
  await upload([HEADERS, ['unknown@example.com', '', '', '', 'One', 'Two', 'Three'], ['person@example.com', '', '', '', '', '', '']]);
  await screen.findByText(/No matching tracked conversation/);
  expect(screen.queryByRole('button', { name: /Review follow-up/ })).toBeNull();
  expect(screen.getByText('Follow-up 1 is empty')).toBeTruthy();
});
it('exports Excel with explicit string cells and conversation identity', async () => {
  mocks.write.mockReturnValue({ toFile: mocks.toFile });
  render(<FollowUpSpreadsheet items={[item]} onPrepare={vi.fn()} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  await waitFor(() => expect(mocks.toFile).toHaveBeenCalledWith('follow-ups.xlsx'));
  const table = mocks.write.mock.calls[0][0];
  expect(table[1][2]).toEqual({ type: String, value: 'thread' });
});

it('lets recipients choose different custom follow-ups and requires row selection before review', async () => {
  const other = { ...item, recipient: 'other@example.com', conversation: { ...item.conversation, id: 'other-thread' } };
  const prepare = vi.fn();
  render(<FollowUpSpreadsheet items={[item, other]} onPrepare={prepare} />);
  await upload([['Email'], ['person@example.com'], ['other@example.com']]);
  await screen.findAllByText('Follow-up 1 is empty');
  fireEvent.change(screen.getByLabelText('Follow-up body source'), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Follow-up 1 body'), { target: { value: 'My first message' } });
  fireEvent.change(screen.getByLabelText('Follow-up 3 body'), { target: { value: 'My third message' } });
  fireEvent.change(screen.getByLabelText('Follow-up for row 3'), { target: { value: '2' } });
  expect((screen.getByRole('button', { name: 'Review follow-up 3' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Select follow-up row 2'));
  fireEvent.click(screen.getByLabelText('Select follow-up row 3'));
  fireEvent.click(screen.getByRole('button', { name: 'Review follow-up 1' }));
  expect(prepare).toHaveBeenLastCalledWith(item, 'My first message');
  fireEvent.click(screen.getByRole('button', { name: 'Review follow-up 3' }));
  expect(prepare).toHaveBeenLastCalledWith(other, 'My third message');
  fireEvent.click(screen.getByRole('button', { name: 'Deselect all rows' }));
  expect((screen.getByRole('button', { name: 'Review follow-up 3' }) as HTMLButtonElement).disabled).toBe(true);
});
it('supports additional custom follow-up bodies and prevents whitespace-only messages', async () => {
  render(<FollowUpSpreadsheet items={[item]} onPrepare={vi.fn()} />);
  await upload([['Email'], ['person@example.com']]);
  await screen.findAllByText('Follow-up 1 is empty');
  fireEvent.change(screen.getByLabelText('Follow-up body source'), { target: { value: 'custom' } });
  fireEvent.click(screen.getByText('Add another follow-up body'));
  fireEvent.change(screen.getByLabelText('Follow-up for row 2'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Follow-up 4 body'), { target: { value: '   ' } });
  expect(screen.queryByRole('button', { name: 'Review follow-up 4' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Follow-up 4 body'), { target: { value: 'Fourth message' } });
  fireEvent.click(screen.getByText('Select all matched rows'));
  expect((screen.getByRole('button', { name: 'Review follow-up 4' }) as HTMLButtonElement).disabled).toBe(false);
});
it('prepares the fifth follow-up subject and message from a business-email draft sheet', async () => {
  const prepare = vi.fn();
  render(<FollowUpSpreadsheet items={[item]} onPrepare={prepare} />);
  await upload([['Company Name', 'Business Email', 'Original Subject', 'Follow-up 1 Message', 'Follow-up 5 Subject', 'Follow-up 5 Message'], ['Example Agency', 'person@example.com', 'Proposal', 'First message', 'Re: Fifth proposal', 'Fifth body']]);
  await screen.findByLabelText('Follow-up for row 2');
  fireEvent.click(screen.getByLabelText('Select follow-up row 2'));
  fireEvent.change(screen.getByLabelText('Follow-up for row 2'), { target: { value: '4' } });
  expect(screen.getByText('Subject: Re: Fifth proposal')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review follow-up 5' }));
  expect(prepare).toHaveBeenCalledWith(item, 'Fifth body', 'Re: Fifth proposal');
});
it('restores a saved import and allows reviewing an upcoming conversation before it is due', async () => {
  const future = { ...item, nextDueAt: '2099-01-01T09:00:00Z', status: 'scheduled' as const };
  mocks.get.mockResolvedValue({ ...emptyFollowUpImport(), fileName: 'saved.xlsx', selectedRows: [2], rowStages: { '2': 1 },
    rows: [{ row: 2, email: item.recipient, account: '', conversationId: 'thread', subject: 'Proposal', messages: ['First', 'Second', 'Third'] }] });
  const prepare = vi.fn(); render(<FollowUpSpreadsheet items={[future]} onPrepare={prepare} />);
  expect(await screen.findByText('saved.xlsx')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review follow-up 2' }));
  expect(prepare).toHaveBeenCalledWith(future, 'Second');
  fireEvent.change(screen.getByLabelText('Follow-up for row 2'), { target: { value: '2' } });
  await waitFor(() => expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ rowStages: { '2': 2 } })));
});
it('saves imported source bytes before exposing the new imported rows', async () => {
  render(<FollowUpSpreadsheet items={[item]} onPrepare={vi.fn()} />);
  await upload([['Email'], [item.recipient]]);
  await screen.findByText('Follow-up 1 is empty');
  const saved = mocks.save.mock.calls.find(([value]) => value.fileName === 'followups.csv')![0];
  expect(atob(saved.sourceBase64)).toContain(item.recipient);
  expect(saved.rows[0].email).toBe(item.recipient);
});
it('does not overwrite saved data when restoring the workspace fails', async () => {
  mocks.get.mockRejectedValue(new Error('Disk unavailable'));
  render(<FollowUpSpreadsheet items={[item]} onPrepare={vi.fn()} />);
  await screen.findByText(/Could not load saved import/);
  expect(mocks.save).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Import Excel / CSV' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
});
