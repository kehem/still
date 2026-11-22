import { useRef, useState } from 'react';
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import type { FollowUpListItem } from '../../../shared/types';
import { followUpExport, HEADERS, matchFollowUp, parseFollowUpTable, safeCSVCell, type ImportedFollowUp } from './spreadsheet';

const button = 'rounded-md border border-border px-3 py-2 text-[12px] disabled:opacity-40';
export function FollowUpSpreadsheet({ items, onPrepare }: { items: FollowUpListItem[]; onPrepare: (item: FollowUpListItem, body: string) => void }) {
  const [rows, setRows] = useState<ImportedFollowUp[]>([]);
  const [stage, setStage] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const download = async (format: 'xlsx' | 'csv', template = false) => {
    setError(''); setBusy(true);
    try {
      const table = template ? [HEADERS, ['recipient@example.com', '', '', '', 'First follow-up message', 'Second follow-up message', 'Third follow-up message']] : followUpExport(items);
      const filename = template ? 'follow-up-template' : 'follow-ups';
      if (format === 'xlsx') {
        const { default: writeXlsxFile } = await import('write-excel-file/browser');
        // Explicit String type prevents formula interpretation in Excel.
        await writeXlsxFile(table.map(row => row.map(value => ({ type: String, value }))), { sheet: 'Follow-ups' }).toFile(`${filename}.xlsx`);
      } else {
        const blob = new Blob(['\uFEFF', Papa.unparse(table.map(row => row.map(safeCSVCell)))], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `${filename}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice(template ? 'Template downloaded. Fill message columns, then import it.' : `Exported ${items.length} tracked conversations.`);
    } catch (e) { setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const importFile = async (file: File) => {
    setBusy(true); setError('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Maximum file size is 5 MB.');
      let table: string[][];
      if (/\.csv$/i.test(file.name)) {
        const result = Papa.parse<string[]>(await file.text(), { skipEmptyLines: 'greedy' });
        if (result.errors.length) throw new Error('CSV is malformed. Check quotes and delimiters.');
        table = result.data;
      } else if (/\.xlsx$/i.test(file.name)) {
        table = (await readSheet(file)).map(row => row.map(cell => cell == null ? '' : cell instanceof Date ? cell.toISOString() : String(cell)));
      } else throw new Error('Choose an .xlsx or .csv file. Legacy .xls is not supported.');
      const parsed = parseFollowUpTable(table);
      if (!parsed.length) throw new Error('The file has no data rows.');
      setRows(parsed); setName(file.name); setNotice(`Loaded ${parsed.length} rows. Choose a message column and review each reply before sending.`);
    } catch (e) { setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  return <section aria-label="Follow-up spreadsheet" className="mt-5 rounded-xl border border-border p-4">
    <h2 className="text-[13px] font-semibold">Excel / CSV follow-ups</h2>
    <p className="mt-1 text-[11px] text-text-secondary">Match existing tracked conversations. Export, fill Follow-up 1 / 2 / 3, then upload. New recipients are not emailed. Files stay on this device.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => upload.current?.click()}>Import Excel / CSV</button>
      <input ref={upload} type="file" aria-label="Upload follow-up spreadsheet" accept=".xlsx,.csv" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }} />
      <button className={button} disabled={busy} onClick={() => void download('xlsx', true)}>Download Excel template</button>
      <button className={button} disabled={busy || !items.length} onClick={() => void download('xlsx')}>Export Excel</button>
      <button className={button} disabled={busy || !items.length} onClick={() => void download('csv')}>Export CSV</button>
    </div>
    {error && <p role="alert" className="mt-3 text-[12px] text-red-500">{error}</p>}
    <p role="status" className="mt-2 text-[11px] text-text-secondary">{busy ? 'Processing spreadsheet…' : notice}</p>
    {rows.length > 0 && <>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
        <span>{name}</span><label>Message column <select aria-label="Follow-up message column" className="rounded border border-border bg-bg p-2" value={stage} onChange={e => setStage(Number(e.target.value))}>{[0, 1, 2].map(n => <option key={n} value={n}>Follow-up {n + 1}</option>)}</select></label>
        <button className={button} onClick={() => { setRows([]); setName(''); setNotice('Imported preview cleared.'); }}>Clear preview</button>
      </div>
      <p className="mt-2 text-[11px] text-text-tertiary">The chosen column is a message template, not a stage override. Reminder stages advance only after sending. Import preview is temporary; save your file to keep templates.</p>
      <div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-[12px]"><thead><tr><th className="p-2">Recipient / conversation</th><th className="p-2">Message / result</th><th className="p-2">Action</th></tr></thead><tbody>{rows.map(row => {
        const match = matchFollowUp(row, items); const message = row.messages[stage];
        const reason = match.error || (!message.trim() ? `Follow-up ${stage + 1} is empty` : '');
        return <tr key={row.row} className="border-t border-border"><td className="p-2 align-top">Row {row.row}: {row.email}<p className="text-text-tertiary">{match.item?.subject || row.subject}</p></td><td className="max-w-xs p-2 align-top"><p className="whitespace-pre-wrap break-words">{reason || message.slice(0, 250)}</p></td><td className="p-2 align-top">{!reason && match.item && <button className={button} onClick={() => onPrepare(match.item!, message)}>Review follow-up {stage + 1}</button>}</td></tr>;
      })}</tbody></table></div>
    </>}
  </section>;
}
