import { type FollowUpImportWorkspace } from '../../../shared/followup-import';
import { getAPI, isElectron } from '../../services/api';
import { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import type { FollowUpListItem } from '../../../shared/types';
import { followUpExport, DRAFT_HEADERS, matchFollowUp, parseFollowUpTable, safeCSVCell, type ImportedFollowUp } from './spreadsheet';

const button = 'rounded-md border border-border px-3 py-2 text-[12px] disabled:opacity-40';
export function FollowUpSpreadsheet({ items, onPrepare }: { items: FollowUpListItem[]; onPrepare: (item: FollowUpListItem, body: string, subject?: string) => void }) {
  const [rows, setRows] = useState<ImportedFollowUp[]>([]);
  const [stage, setStage] = useState(0);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [rowStages, setRowStages] = useState<Record<number, number>>({});
  const [bodySource, setBodySource] = useState<'spreadsheet' | 'custom'>('spreadsheet');
  const [customBodies, setCustomBodies] = useState(['', '', '']);
  const [name, setName] = useState('');
  const [sourceBase64, setSourceBase64] = useState('');
  const [restored, setRestored] = useState(false);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const [saveStatus, setSaveStatus] = useState('Loading saved import…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void getAPI().getFollowUpImport().then(value => {
      if (!active) return;
      setRows(value.rows); setName(value.fileName); setSourceBase64(value.sourceBase64);
      setStage(value.stage); setSelectedRows(value.selectedRows); setRowStages(value.rowStages);
      setBodySource(value.bodySource); setCustomBodies(value.customBodies);
      setRestored(true); setSaveStatus(value.rows.length ? 'Saved import restored.' : 'No saved import yet.');
    }).catch(() => { if (active) setSaveStatus('Could not load saved import. Reopen Follow-ups to retry; saved data has not been overwritten.'); });
    return () => { active = false; };
  }, []);
  const persist = (workspace: FollowUpImportWorkspace) => {
    setSaveStatus('Saving import…');
    const task = saveChain.current.catch(() => {}).then(() => getAPI().saveFollowUpImport(workspace));
    saveChain.current = task;
    void task.then(() => setSaveStatus(isElectron ? 'Saved on this device · SQLite' : 'Saved in browser preview · local storage'))
      .catch(() => setSaveStatus('Import not saved. Check local storage/disk space, then change a selection to retry.'));
    return task;
  };
  useEffect(() => {
    if (!restored) return;
    void persist({ fileName: name, sourceBase64, rows, stage, selectedRows, rowStages, bodySource, customBodies }).catch(() => {});
  }, [restored, name, sourceBase64, rows, stage, selectedRows, rowStages, bodySource, customBodies]);
  const spreadsheetStages = Math.max(3, ...rows.map(row => row.messages.length));
  const stageCount = bodySource === 'custom' ? customBodies.length : spreadsheetStages;
  const upload = useRef<HTMLInputElement>(null);
  const download = async (format: 'xlsx' | 'csv', template = false) => {
    setError(''); setBusy(true);
    try {
      const table = template ? [DRAFT_HEADERS, ['Example company', 'recipient@example.com', '', '', '', 'Review before use', 'Original sent subject', '', ...Array.from({ length: 5 }, (_, n) => ['Re: Original sent subject', `Follow-up ${n + 1} message`]).flat()]] : followUpExport(items);
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
        if (result.errors.some(error => error.code !== 'UndetectableDelimiter')) throw new Error('CSV is malformed. Check quotes and delimiters.');
        table = result.data;
      } else if (/\.xlsx$/i.test(file.name)) {
        table = (await readSheet(file)).map(row => row.map(cell => cell == null ? '' : cell instanceof Date ? cell.toISOString() : String(cell)));
      } else throw new Error('Choose an .xlsx or .csv file. Legacy .xls is not supported.');
      const parsed = parseFollowUpTable(table);
      if (!parsed.length) throw new Error('The file has no data rows.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const base64 = btoa(binary);
      await persist({ fileName: file.name, sourceBase64: base64, rows: parsed, stage, selectedRows: [], rowStages: {}, bodySource, customBodies });
      setSourceBase64(base64);
      setRows(parsed); setSelectedRows([]); setRowStages({}); setName(file.name); setNotice(`Loaded ${parsed.length} rows. Choose a message source and follow-up number, then review each reply before sending.`);
    } catch (e) { setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  return <section aria-label="Follow-up spreadsheet" className="mt-5 rounded-xl border border-border p-4">
    <p role="status" className="mb-2 text-[11px] text-text-secondary">{saveStatus}</p>
    <fieldset disabled={!restored || busy}>
    <h2 className="text-[13px] font-semibold">Excel / CSV follow-ups</h2>
    <p className="mt-1 text-[11px] text-text-secondary">Match existing tracked conversations. Upload recipients, then use spreadsheet messages or write your own below. New recipients are not emailed. Supports Business Email, Original Subject, and numbered Follow-up Subject / Message columns. Files stay on this device.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => upload.current?.click()}>Import Excel / CSV</button>
      <input ref={upload} type="file" aria-label="Upload follow-up spreadsheet" accept=".xlsx,.csv" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }} />
      <button className={button} disabled={busy} onClick={() => void download('xlsx', true)}>Download Excel template</button>
      <button className={button} disabled={busy || !items.length} onClick={() => void download('xlsx')}>Export Excel</button>
      <button className={button} disabled={busy || !items.length} onClick={() => void download('csv')}>Export CSV</button>
    </div>
    <div className="mt-4 space-y-3">
      <label className="block text-[12px]">Message body source
        <select aria-label="Follow-up body source" className="ml-2 rounded border border-border bg-bg p-2" value={bodySource} onChange={e => { setBodySource(e.target.value as 'spreadsheet' | 'custom'); if (e.target.value === 'spreadsheet') { setStage(previous => Math.min(previous, spreadsheetStages - 1)); setRowStages(previous => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, Math.min(value, spreadsheetStages - 1)]))); } }}>
          <option value="spreadsheet">Use spreadsheet messages</option>
          <option value="custom">Write my own message</option>
        </select>
      </label>
      {bodySource === 'custom' && <div className="space-y-3">
        <p className="text-[11px] text-text-secondary">Enter your own body for each follow-up. The selected body applies to every matched row; you can edit each reply before sending. Your file only needs an Email column (Account and Conversation ID help match threads).</p>
        {customBodies.map((body, index) => <label key={index} className="block text-[12px]">Follow-up {index + 1} body
          <textarea aria-label={`Follow-up ${index + 1} body`} value={body} maxLength={50000} rows={4} className="mt-1 block w-full resize-y rounded border border-border bg-bg p-3 text-[12px]" placeholder="Write your follow-up message…" onChange={e => setCustomBodies(previous => previous.map((value, i) => i === index ? e.target.value : value))} />
        </label>)}
        <button className={button} disabled={customBodies.length >= 10} onClick={() => setCustomBodies(previous => [...previous, ''])}>Add another follow-up body</button>
        <p className="text-[11px] text-text-tertiary">Custom bodies and row choices are saved on this device with your import.</p>
      </div>}
    </div>
    {error && <p role="alert" className="mt-3 text-[12px] text-red-500">{error}</p>}
    <p role="status" className="mt-2 text-[11px] text-text-secondary">{busy ? 'Processing spreadsheet…' : notice}</p>
    {rows.length > 0 && <>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
        <span>{name}</span><label>Default follow-up <select aria-label="Follow-up message column" className="rounded border border-border bg-bg p-2" value={stage} onChange={e => setStage(Number(e.target.value))}>{Array.from({ length: stageCount }, (_, n) => n).map(n => <option key={n} value={n}>Follow-up {n + 1}</option>)}</select></label>
        <button className={button} onClick={() => { setRows([]); setSelectedRows([]); setRowStages({}); setName(''); setSourceBase64(''); setNotice('Saved import cleared.'); }}>Clear saved import</button>
      </div>
      <p className="mt-2 text-[11px] text-text-tertiary">The chosen column is a message template, not a stage override. Reminder stages advance only after sending. Imported messages and selections are restored when you reopen this page. Upcoming and waiting conversations can be reviewed too; due dates do not block manual follow-ups.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={button} onClick={() => setSelectedRows(rows.filter(row => Boolean(matchFollowUp(row, items).item)).map(row => row.row))}>Select all matched rows</button>
        <button className={button} onClick={() => setSelectedRows([])}>Deselect all rows</button>
        <span className="text-[12px]">{selectedRows.length} rows selected</span>
      </div>
      <p className="mt-2 text-[11px] text-text-tertiary">Select recipients, choose a follow-up for each row, then review their replies individually. Selection alone never sends mail.</p>
      <div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-[12px]"><thead><tr><th className="p-2">Select</th><th className="p-2">Recipient / conversation</th><th className="p-2">Follow-up</th><th className="p-2">Message / result</th><th className="p-2">Action</th></tr></thead><tbody>{rows.map(row => {
        const match = matchFollowUp(row, items);
        const count = stageCount;
        const chosenStage = Math.min(rowStages[row.row] ?? stage, count - 1);
        const subject = bodySource === 'spreadsheet' ? row.subjects?.[chosenStage] || undefined : undefined;
        const message = (bodySource === 'custom' ? customBodies[chosenStage] : row.messages[chosenStage]) || '';
        const selected = selectedRows.includes(row.row);
        const reason = match.error || (!message.trim() ? `Follow-up ${chosenStage + 1} is empty` : '');
        return <tr key={row.row} className="border-t border-border"><td className="p-2 align-top"><input type="checkbox" aria-label={`Select follow-up row ${row.row}`} checked={selected} disabled={!match.item} onChange={e => setSelectedRows(previous => e.target.checked ? [...previous, row.row] : previous.filter(n => n !== row.row))} /></td><td className="p-2 align-top">Row {row.row}: {row.company && <span>{row.company} · </span>}{row.email}<p className="text-text-tertiary">{match.item?.subject || row.subject}</p></td><td className="p-2 align-top"><select aria-label={`Follow-up for row ${row.row}`} value={chosenStage} className="rounded border border-border bg-bg p-2" onChange={e => setRowStages(previous => ({ ...previous, [row.row]: Number(e.target.value) }))}>{Array.from({ length: count }, (_, n) => <option key={n} value={n}>Follow-up {n + 1}</option>)}</select></td><td className="max-w-xs p-2 align-top"><p className="whitespace-pre-wrap break-words">{reason || message.slice(0, 250)}</p>{subject && <p className="mt-1 text-text-secondary">Subject: {subject}</p>}{row.verification && <p className="mt-1 text-text-tertiary">Sheet verification (not checked by Still): {row.verification}</p>}</td><td className="p-2 align-top">{!reason && match.item && <button className={button} disabled={!selected} onClick={() => subject ? onPrepare(match.item!, message, subject) : onPrepare(match.item!, message)}>Review follow-up {chosenStage + 1}</button>}</td></tr>;
      })}</tbody></table></div>
    </>}
    </fieldset>
  </section>;
}
