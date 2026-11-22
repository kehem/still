// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { FollowUpListItem } from '../../../shared/types';
import { FollowUpSpreadsheet } from './FollowUpSpreadsheet';
import { HEADERS } from './spreadsheet';
import Papa from 'papaparse';
const mocks = vi.hoisted(() => ({ toFile: vi.fn().mockResolvedValue(undefined), write: vi.fn() }));
vi.mock('write-excel-file/browser', () => ({ default: mocks.write }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const item = { recipient: 'person@example.com', account: { email: 'me@example.com' }, conversation: { id: 'thread' }, subject: 'Proposal', status: 'scheduled', currentStage: 0 } as FollowUpListItem;
async function upload(table: string[][]) {
  const file = new File([], 'followups.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => Papa.unparse(table) });
  fireEvent.change(screen.getByLabelText('Upload follow-up spreadsheet'), { target: { files: [file] } });
}
it('uploads a CSV and prepares the selected stage as a threaded review without sending', async () => {
  const prepare = vi.fn(); render(<FollowUpSpreadsheet items={[item]} onPrepare={prepare} />);
  await upload([HEADERS, ['person@example.com', 'me@example.com', 'thread', 'Proposal', 'One', 'Two', 'Three']]);
  await screen.findByRole('button', { name: 'Review follow-up 1' });
  expect(prepare).not.toHaveBeenCalled();
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
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  await waitFor(() => expect(mocks.toFile).toHaveBeenCalledWith('follow-ups.xlsx'));
  const table = mocks.write.mock.calls[0][0];
  expect(table[1][2]).toEqual({ type: String, value: 'thread' });
});
