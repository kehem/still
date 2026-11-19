import { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import type { Account } from '../../../shared/types';
import { getAPI, isElectron } from '../../services/api';
import { limitsValid, localDay, validRow, type QueueRow } from './model';

const KEY = 'still:automation:v1';
function savedConfig(): { daily?: number; seconds?: number; account?: string } {
  try { return JSON.parse(localStorage.getItem('still:automation:config') || '{}'); } catch { return {}; }
}
export function AutomationPage({ accounts, onSent }: { accounts: Account[]; onSent: () => void }) {
  const [rows, setRows] = useState<QueueRow[]>(() => {
    try { return (JSON.parse(localStorage.getItem(KEY) || '[]') as QueueRow[]).map(r => r.status === 'sending' ? { ...r, status: 'failed', error: 'Interrupted send: check Sent before importing again. Not retried.' } : r); } catch { return []; }
  });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importStatus, setImportStatus] = useState('Choose a CSV or .xlsx file to begin.');
  const importVersion = useRef(0);
  const [table, setTable] = useState<string[][]>([]);
  const [columns, setColumns] = useState([0, 1, 2]);
  const [account, setAccount] = useState(savedConfig().account || accounts[0]?.id || '');
  const [daily, setDaily] = useState(savedConfig().daily || 50);
  const [seconds, setSeconds] = useState(savedConfig().seconds || 30);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const run = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const commit = (next: QueueRow[]) => { localStorage.setItem(KEY, JSON.stringify(next)); rowsRef.current = next; setRows(next); };
  const pause = () => { run.current = false; setRunning(false); };
  useEffect(() => () => { run.current = false; }, []);

  const sendNext = async () => {
    if (busy.current) return;
    if (!isElectron) { pause(); setNotice('Sending requires the desktop app.'); return; }
    if (!accounts.some(a => a.id === account) || !limitsValid(daily, seconds)) { pause(); setNotice('Choose an account and valid limits.'); return; }
    const row = rowsRef.current.find(r => r.selected && r.status === 'pending');
    if (!row) { pause(); setNotice('No selected pending rows.'); return; }
    if (!validRow(row)) { pause(); setNotice('Fix invalid email, subject or body before sending.'); return; }
    busy.current = true;
    let attempted = false;
    try {
      localStorage.setItem('still:automation:config', JSON.stringify({ daily, seconds, account }));
      const now = Date.now();
      const ledger = JSON.parse(localStorage.getItem('still:automation:limits') || '{}') as { day?: string; count?: number; last?: number };
      const count = ledger.day === localDay() ? ledger.count || 0 : 0;
      if (count >= daily) { setNotice('Daily limit reached. Waiting for tomorrow.'); return; }
      if (now - (ledger.last || 0) < seconds * 1000) { setNotice('Waiting for the send interval.'); return; }
      // Persist before SMTP: ambiguous failures are never automatically retried.
      commit(rowsRef.current.map(r => r.id === row.id ? { ...r, status: 'sending' } : r));
      localStorage.setItem('still:automation:limits', JSON.stringify({ day: localDay(), count: count + 1, last: now }));
      attempted = true;
      await getAPI().sendEmail({ accountId: account, to: [row.to], subject: row.subject, bodyText: row.body });
      commit(rowsRef.current.map(r => r.id === row.id ? { ...r, status: 'sent' } : r));
      setNotice(`Sent to ${row.to}`); onSent();
    } catch (error) {
      pause();
      const message = error instanceof Error ? error.message : String(error);
      if (attempted) {
        try { commit(rowsRef.current.map(r => r.id === row.id ? { ...r, status: 'failed', error: message } : r)); } catch { /* Keep persisted sending status for recovery. */ }
      }
      setNotice(`${message}. Queue paused. Check Sent before retrying any uncertain delivery.`);
    } finally { busy.current = false; }
  };
  const tick = useRef(sendNext); tick.current = sendNext;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => { if (run.current) void tick.current(); }, 1000);
    return () => window.clearInterval(id);
  }, [running]);
  const input = 'rounded border border-border bg-surface px-3 py-2 text-sm';
  return <main className="min-w-0 flex-1 overflow-auto p-6">
    <h1 className="text-xl font-semibold">Automation</h1>
    <p className="my-2 text-sm text-text-secondary">Import a CSV or Excel (.xlsx) sheet, map columns, and select rows. First row is the header; Excel uses the first sheet. Queue stays on this device. Keep Still open: closing pauses automation; resume explicitly after reopening.</p>
    <p className="my-2 text-sm">Only send to recipients who expect your mail. Failed or interrupted rows are never retried automatically. Daily limits count attempts, including failures, across queues.</p>
    <p role="status" aria-live="polite" className="my-3 text-sm text-text-secondary">{importStatus}</p>
    {importError && <p role="alert" className="my-3 text-sm">{importError}</p>}
    <fieldset disabled={running || busy.current} className="my-4 flex flex-wrap items-center gap-3">
      <input aria-label="Import CSV or Excel" type="file" accept=".csv,.xlsx" onChange={async e => {
        const file = e.target.files?.[0];
        e.target.value = ''; // Allow retrying the same file after an error.
        if (!file) return;
        const version = ++importVersion.current;
        setTable([]);
        setColumns([0, 1, 2]);
        setImportError('');
        setImporting(true);
        setImportStatus(`Reading ${file.name}…`);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          if (file.size > 5 * 1024 * 1024) throw new Error('Maximum file size is 5 MB');
          const parse = async (): Promise<string[][]> => {
            if (/\.xlsx$/i.test(file.name)) return (await readSheet(file, 1)).map(r => r.map(c => c == null ? '' : String(c)));
            if (/\.csv$/i.test(file.name)) {
              const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: 'greedy' });
              if (parsed.errors.length) throw new Error(parsed.errors[0].message);
              return parsed.data;
            }
            throw new Error('Use a CSV or .xlsx file (legacy .xls is not supported).');
          };
          const data = await Promise.race([
            parse(),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Reading timed out. Try saving the first sheet as CSV UTF-8 and selecting it again.')), 30000); }),
          ]);
          if (version !== importVersion.current) return;
          if (data.length < 2 || data.length > 1001) throw new Error('Import 1–1000 data rows with a header');
          if (data[0].length < 3) throw new Error('The header needs at least three columns: email, subject and body.');
          setTable(data);
          setImportStatus(`${file.name}: ${data.length - 1} rows loaded. Choose the email, subject and body columns, then click Build queue.`);
        } catch (err) {
          if (version !== importVersion.current) return;
          setImportError(`Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
          setImportStatus('Import failed. Choose the file again to retry. Your existing queue has not changed.');
        } finally {
          clearTimeout(timeout);
          if (version === importVersion.current) setImporting(false);
        }
      }} />
      <>
        {['Email column', 'Subject column', 'Body column'].map((label, i) => <label key={label}>{label} <select className={input} disabled={importing || table.length === 0} aria-label={label} value={columns[i]} onChange={e => setColumns(c => c.map((v, j) => j === i ? Number(e.target.value) : v))}>{(table[0] || ['Choose a file first']).map((h, j) => <option key={j} value={j}>{j + 1}: {h}</option>)}</select></label>)}
        <button className={input} disabled={importing || table.length === 0} onClick={() => {
          if (columns.some(c => c < 0 || c >= table[0].length) || new Set(columns).size !== 3) { setNotice('Choose three different columns.'); return; }
          if (rows.length && !window.confirm('Replace the current queue? Previously sent mail cannot be undone.')) return;
          try { commit(table.slice(1).map(r => ({ id: crypto.randomUUID(), to: (r[columns[0]] || '').trim(), subject: r[columns[1]] || '', body: r[columns[2]] || '', selected: false, status: 'pending' }))); setImportStatus('Queue built. Select the rows you want to send, then use Send next or Start automatic sending.'); } catch { setNotice('Cannot store queue. No mail sent.'); }
        }}>Build queue</button>
      </>
      <label>From <select aria-label="Automation sending account" className={input} value={account} onChange={e => setAccount(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}</select></label>
      <label>Emails per day <input className={input} aria-label="Emails per day" type="number" min="1" max="10000" value={daily} onChange={e => setDaily(Number(e.target.value))} /></label>
      <label>Interval (seconds) <input className={input} aria-label="Interval in seconds" type="number" min="1" max="86400" value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label>
    </fieldset>
    <div className="my-3 flex gap-3">
      <button className={input} disabled={running} onClick={() => { if (window.confirm('Send the next selected email now?')) void sendNext(); }}>Send next</button>
      <button className={input} disabled={running} onClick={() => {
        if (!rows.some(r => r.selected && r.status === 'pending') || !limitsValid(daily, seconds)) { setNotice('Select pending rows and valid limits.'); return; }
        if (window.confirm(`Automatically send selected rows, up to ${daily} per day, at least ${seconds} seconds apart?`)) { run.current = true; setRunning(true); void sendNext(); }
      }}>Start automatic sending</button>
      <button className={input} disabled={!running} onClick={pause}>Pause</button>
      <span role="status" aria-label="Sending status">{running ? 'Running' : 'Paused'} · {notice}</span>
    </div>
    <button className={input} disabled={running} onClick={() => commit(rows.map(r => ({ ...r, selected: r.status === 'pending' && validRow(r) })))}>Select all valid pending rows</button>
    <button className={input} disabled={running || busy.current} onClick={() => { if (window.confirm('Clear the local automation queue? Sent emails and daily counters are not removed.')) { try { commit([]); } catch { setNotice('Cannot clear queue.'); } } }}>Clear queue</button>
    <table className="mt-4 w-full text-left text-sm"><thead><tr>{['Choose', 'Row', 'Email', 'Subject', 'Body preview', 'Status'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={r.id} className="border-t border-border">
      <td className="p-2"><input type="checkbox" aria-label={`Select row ${i + 2}`} checked={r.selected} disabled={running || r.status !== 'pending'} onChange={e => commit(rows.map(x => x.id === r.id ? { ...x, selected: e.target.checked } : x))} /></td>
      <td>{i + 2}</td><td>{r.to}</td><td>{r.subject.slice(0, 80)}</td><td className="max-w-xs truncate" title={r.body}>{r.body.slice(0, 100)}</td><td>{!validRow(r) ? 'Invalid data' : r.status}{r.error && <p>{r.error}</p>}</td>
    </tr>)}</tbody></table>
  </main>;
}
