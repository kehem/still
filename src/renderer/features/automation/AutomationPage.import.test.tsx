// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Account } from '../../../shared/types';
const { readSheet } = vi.hoisted(() => ({ readSheet: vi.fn() }));
vi.mock('read-excel-file/browser', () => ({ readSheet }));
vi.mock('../../services/api', () => ({ isElectron: true, getAPI: () => ({}) }));
import { AutomationPage } from './AutomationPage';
const accounts = [{ id: 'a', email: 'sender@example.com' }] as Account[];
const data = [['Email', 'Subject', 'Body'], ['r@example.com', 'Hello', 'Hi there']];
function upload(name = 'contacts.xlsx') {
  fireEvent.change(screen.getByLabelText('Import CSV or Excel'), { target: { files: [new File(['test'], name)] } });
}
beforeEach(() => { localStorage.clear(); readSheet.mockReset().mockResolvedValue(data); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('keeps Build queue visible but disabled until a file loads', () => {
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  expect((screen.getByRole('button', { name: 'Build queue' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Choose a CSV or .xlsx file to begin.')).toBeTruthy();
});
it('shows loading, exposes mapping and builds rows after Excel is read', async () => {
  let resolve!: (value: string[][]) => void;
  readSheet.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  upload();
  expect(screen.getByText('Reading contacts.xlsx…')).toBeTruthy();
  await act(async () => { resolve(data); });
  const build = screen.getByRole('button', { name: 'Build queue' }) as HTMLButtonElement;
  expect(build.disabled).toBe(false);
  expect(readSheet).toHaveBeenCalledWith(expect.any(File), 1);
  fireEvent.click(build);
  expect(screen.getByText('r@example.com')).toBeTruthy();
  expect(screen.getByLabelText('Select row 2')).toBeTruthy();
});
it('reports parse errors without replacing the queue and supports retrying', async () => {
  const saved = '[{"id":"old","to":"old@example.com","subject":"Old","body":"Body","selected":false,"status":"pending"}]';
  localStorage.setItem('still:automation:v1', saved);
  readSheet.mockRejectedValueOnce(new Error('Invalid workbook'));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  upload();
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid workbook');
  expect(localStorage.getItem('still:automation:v1')).toBe(saved);
  upload();
  await screen.findByText(/1 rows loaded/);
  expect(screen.queryByRole('alert')).toBeNull();
});
it('times out a stuck reader rather than hiding the next step forever', async () => {
  vi.useFakeTimers();
  readSheet.mockReturnValue(new Promise(() => {}));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  upload();
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByRole('alert').textContent).toContain('Reading timed out');
  expect((screen.getByLabelText('Import CSV or Excel') as HTMLInputElement).disabled).toBe(false);
});
it('ignores a stale result when a newer file was chosen', async () => {
  let resolve!: (value: string[][]) => void;
  readSheet.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  upload('old.xlsx'); upload('new.xlsx');
  await screen.findByText(/new.xlsx: 1 rows loaded/);
  await act(async () => { resolve([['Wrong']]); });
  expect(screen.getByText(/new.xlsx: 1 rows loaded/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('reads CSV and rejects fewer than three columns', async () => {
  render(<AutomationPage accounts={accounts} onSent={() => {}} />);
  const file = new File([], 'contacts.csv');
  Object.defineProperty(file, 'text', { value: async () => 'Email,Subject,Body\nr@example.com,Hello,"Hello, world"' });
  fireEvent.change(screen.getByLabelText('Import CSV or Excel'), { target: { files: [file] } });
  await screen.findByText(/1 rows loaded/);
  fireEvent.click(screen.getByRole('button', { name: 'Build queue' }));
  expect(screen.getByText('Hello, world')).toBeTruthy();
  readSheet.mockResolvedValue([['Email', 'Body'], ['r@example.com', 'Hi']]);
  upload();
  expect((await screen.findByRole('alert')).textContent).toContain('at least three columns');
  expect((screen.getByRole('button', { name: 'Build queue' }) as HTMLButtonElement).disabled).toBe(true);
});
