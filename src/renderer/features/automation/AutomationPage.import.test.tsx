// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Account } from '../../../shared/types';
import { automationTestAPI } from './test-api';
const mock = vi.hoisted(() => ({ readSheet: vi.fn(), api: {} as ReturnType<typeof automationTestAPI>['api'] }));
vi.mock('read-excel-file/browser', () => ({ readSheet: mock.readSheet }));
vi.mock('../../services/api', () => ({ isElectron: true, getAPI: () => mock.api }));
import { AutomationPage } from './AutomationPage';
const accounts = [{ id: 'a', email: 'sender@example.com' }] as Account[];
const data = [['Email', 'Subject', 'Body'], ['r@example.com', 'Hello', 'Hi there']];
let store: ReturnType<typeof automationTestAPI>;
async function open() { render(<AutomationPage accounts={accounts} onSent={() => {}} />); await screen.findByText('Build queue'); }
function upload(name = 'contacts.xlsx') {
  fireEvent.change(screen.getByLabelText('Import CSV or Excel'), { target: { files: [new File(['test'], name)] } });
}
beforeEach(() => { localStorage.clear(); mock.readSheet.mockReset().mockResolvedValue(data); store = automationTestAPI(); mock.api = store.api; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('keeps Build queue visible but disabled before import', async () => {
  await open();
  expect((screen.getByText('Build queue') as HTMLButtonElement).disabled).toBe(true);
});
it('saves original bytes and parsed rows immediately, before Build queue is clicked', async () => {
  await open(); upload();
  await waitFor(() => expect(mock.api.importAutomationFile).toHaveBeenCalledWith({ name: 'contacts.xlsx', base64: 'dGVzdA==', table: data }));
  await waitFor(() => expect((screen.getByText('Build queue') as HTMLButtonElement).disabled).toBe(false));
  expect(store.get().workspace.table).toEqual(data);
  fireEvent.click(screen.getByText('Build queue'));
  expect(await screen.findByText('r@example.com')).toBeTruthy();
  expect(store.get().workspace.rows).toHaveLength(1);
});
it('reports parse errors without replacing saved data and supports retrying', async () => {
  mock.readSheet.mockRejectedValueOnce(new Error('Invalid workbook'));
  await open(); upload();
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid workbook');
  expect(mock.api.importAutomationFile).not.toHaveBeenCalled();
  upload();
  await waitFor(() => expect(mock.api.importAutomationFile).toHaveBeenCalledTimes(1));
});
it('times out a stuck reader and leaves file selection usable', async () => {
  await open(); vi.useFakeTimers();
  mock.readSheet.mockReturnValue(new Promise(() => {})); upload();
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByRole('alert').textContent).toContain('Reading timed out');
  expect((screen.getByLabelText('Import CSV or Excel') as HTMLInputElement).disabled).toBe(false);
});
it('reads CSV and rejects files with fewer than three columns', async () => {
  await open();
  const file = new File(['Email,Subject,Body\nr@example.com,Hello,"Hello, world"'], 'contacts.csv');
  Object.defineProperty(file, 'text', { value: async () => 'Email,Subject,Body\nr@example.com,Hello,"Hello, world"' });
  fireEvent.change(screen.getByLabelText('Import CSV or Excel'), { target: { files: [file] } });
  await waitFor(() => expect(mock.api.importAutomationFile).toHaveBeenCalledTimes(1));
  await waitFor(() => expect((screen.getByText('Build queue') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Build queue'));
  expect(await screen.findByText('Hello, world')).toBeTruthy();
});
