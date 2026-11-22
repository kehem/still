import { recipientCanSend } from '../../../shared/recipient-check';
import { confirmAction } from '../../services/dialogs';
import { emailDomain, knownEmailProvider } from '../../../shared/email-providers';
import { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import type { Account, RecipientCheck } from '../../../shared/types';
import type { AutomationSnapshot, AutomationWorkspace } from '../../../shared/automation';
import { getAPI, isElectron } from '../../services/api';
import { limitsValid, validRow } from './model';
import { fileBase64, loadAutomation } from './storage';
import { FileTextIcon, SendIcon } from '../../components/icons';

export function AutomationPage({ accounts, onSent, active = true }: { accounts: Account[]; onSent: () => void; active?: boolean }) {
  const [snapshot, setSnapshot] = useState<AutomationSnapshot | null>(null);
  const current = useRef<AutomationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const [running, setRunning] = useState(false);
  const run = useRef(false);
  const [importing, setImporting] = useState(false);
  const importVersion = useRef(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dailyText, setDailyText] = useState('50');
  const [secondsText, setSecondsText] = useState('30');
  const [showImport, setShowImport] = useState(false);
  const [checks, setChecks] = useState<Record<string, RecipientCheck>>({});
  const [checkVersion, setCheckVersion] = useState(0);
  const ready = (row: { to: string }) => recipientCanSend(checks[row.to]);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const accept = (value: AutomationSnapshot) => {
    current.current = value; setSnapshot(value);
    setDailyText(String(value.workspace.daily)); setSecondsText(String(value.workspace.seconds));
  };
  useEffect(() => {
    let mounted = true;
    void loadAutomation().then(async value => {
      if (!value.workspace.accountId && accounts[0]) value = await getAPI().saveAutomation({ ...value.workspace, accountId: accounts[0].id });
      if (mounted) { accept(value); setShowImport(!value.workspace.fileName || !value.workspace.rows.length); }
    }).catch(e => { if (mounted) setError(String(e)); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; run.current = false; importVersion.current++; };
  }, []);

  const pause = () => { run.current = false; setRunning(false); };
  const save = async (patch: Partial<AutomationWorkspace>) => {
    if (busy.current || !current.current) return;
    busy.current = true; setWorking(true); setError('');
    try { accept(await getAPI().saveAutomation({ ...current.current.workspace, ...patch })); }
    catch (e) { setError(`Changes not saved: ${e instanceof Error ? e.message : String(e)}`); }
    finally { busy.current = false; setWorking(false); }
  };
  const refresh = async (manual = false) => {
    if (busy.current || importing || loading) return;
    busy.current = true;
    if (manual) { setWorking(true); setError(''); }
    try { accept(await getAPI().getAutomation()); if (manual) setNotice('Sent status refreshed from local messages and delivery history.'); }
    catch (e) { setError(`Could not refresh saved data: ${String(e)}`); }
    finally { busy.current = false; if (manual) setWorking(false); }
  };
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    if ((!active && !running) || loading) return;
    void refreshRef.current();
    const id = window.setInterval(() => { void refreshRef.current(); }, 15000);
    return () => window.clearInterval(id);
  }, [active, loading, running]);

  const send = async (id?: string) => {
    if (busy.current || importing || !current.current) return;
    const ws = current.current.workspace;
    if (!isElectron) { pause(); setError('Sending requires the desktop app.'); return; }
    if (!accounts.some(a => a.id === ws.accountId)) { pause(); setError('Choose a sending account.'); return; }
    if (!limitsValid(Number(dailyText), Number(secondsText)) || Number(dailyText) !== ws.daily || Number(secondsText) !== ws.seconds) {
      pause(); setError('Save a daily limit of 1–10,000 and an interval of 1–86,400 seconds before sending.'); return;
    }
    const row = id ? ws.rows.find(r => r.id === id) : ws.rows.find(r => r.selected && r.status === 'pending' && validRow(r) && ready(r));
    if (!row || row.status !== 'pending' || (!validRow(row) || !ready(row))) { pause(); setNotice('No selected valid pending rows.'); return; }
    if (current.current.attemptedToday >= ws.daily) { setNotice('Daily limit reached. Automatic sending will wait for tomorrow.'); return; }
    if (Date.now() - current.current.lastAttemptAt < ws.seconds * 1000) { setNotice('Waiting for the send interval.'); return; }
    busy.current = true; setWorking(true); setError(''); setNotice(`Sending to ${row.to}…`);
    try {
      const result = await getAPI().sendAutomationRow(row.id);
      accept(result);
      const delivered = result.workspace.rows.find(r => r.id === row.id);
      if (delivered?.status === 'failed') { pause(); setError(`${delivered.error || 'Delivery failed'}. Check Sent before retrying uncertain deliveries.`); }
      else { setNotice(delivered?.followUpActive ? 'Sent. Follow-up is active.' : 'Email sent.'); onSent(); }
      if (delivered?.error && delivered.status === 'sent') setError(delivered.error);
    } catch (e) {
      pause(); setError(e instanceof Error ? e.message : String(e));
      try { accept(await getAPI().getAutomation()); } catch { /* Keep the queue frozen until a successful refresh. */ }
    } finally { busy.current = false; setWorking(false); }
  };
  const tick = useRef(send); tick.current = send;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => { if (run.current) void tick.current(); }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const importFile = async (file: File) => {
    if (!current.current || busy.current) return;
    if (current.current.workspace.rows.length && !await confirmAction('Replace the current spreadsheet and queue? Sent history and daily counters will be kept.')) return;
    const version = ++importVersion.current;
    setImporting(true); setError(''); setNotice(`Reading ${file.name}…`);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Maximum file size is 5 MB');
      const parse = async () => {
        if (/\.xlsx$/i.test(file.name)) return (await readSheet(file, 1)).map(r => r.map(c => c == null ? '' : String(c)));
        if (/\.csv$/i.test(file.name)) {
          const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: 'greedy' });
          if (parsed.errors.length) throw new Error(parsed.errors[0].message);
          return parsed.data;
        }
        throw new Error('Use a CSV or .xlsx file (legacy .xls is not supported).');
      };
      const [table, base64] = await Promise.race([
        Promise.all([parse(), fileBase64(file)]),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Reading timed out. Try CSV UTF-8.')), 30000); }),
      ]);
      if (version !== importVersion.current) return;
      if (table.length < 2 || table.length > 1001) throw new Error('Import 1–1000 data rows with a header');
      if (table[0].length < 3) throw new Error('The header needs at least three columns: email, subject and body.');
      if (table.some(r => r.length > 200)) throw new Error('Maximum 200 columns');
      accept(await getAPI().importAutomationFile({ name: file.name, base64, table }));
      setShowImport(true); setNotice(`${file.name}: ${table.length - 1} rows loaded and saved. Map the columns, then build your queue.`);
    } catch (e) { if (version === importVersion.current) setError(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}. Your previous saved data is unchanged.`); }
    finally { clearTimeout(timeout); if (version === importVersion.current) setImporting(false); }
  };

  const ws = snapshot?.workspace;
  const previousCheckVersion = useRef(checkVersion);
  const recipientKey = JSON.stringify([...new Set((ws?.rows || []).filter(r => r.status === 'pending' && validRow(r)).map(r => r.to))]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    if (previousCheckVersion.current !== checkVersion) { setChecks({}); previousCheckVersion.current = checkVersion; }
    void (async () => {
      const addresses = JSON.parse(recipientKey) as string[];
      for (let i = 0; i < addresses.length; i++) {
        if (cancelled) return;
        const batch = [addresses[i]];
        let results: Record<string, RecipientCheck>;
        try { results = await getAPI().checkEmailRecipients(batch); }
        catch { results = Object.fromEntries(batch.map(a => [a, { status: 'unknown', detail: 'Recipient check unavailable' }])); }
        if (!cancelled) setChecks(previous => ({ ...previous, ...results }));
      }
    })();
    return () => { cancelled = true; };
  }, [recipientKey, active, checkVersion]);
  const domainKey = JSON.stringify([...new Set((ws?.rows || []).map(row => emailDomain(row.to)).filter((d): d is string => Boolean(d)))].sort());
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const domains = JSON.parse(domainKey) as string[];
    const custom = domains.filter(domain => !knownEmailProvider(domain));
    void (async () => {
      for (let i = 0; i < custom.length; i += 20) {
        if (cancelled) return;
        const batch = custom.slice(i, i + 20);
        let results: Record<string, string>;
        try { results = await getAPI().getEmailProviders(batch); }
        catch { results = Object.fromEntries(batch.map(domain => [domain, 'Unknown'])); }
        if (!cancelled) setProviders(previous => ({ ...previous, ...results }));
      }
    })();
    return () => { cancelled = true; };
  }, [domainKey, active]);
  const providerFor = (address: string) => {
    const domain = emailDomain(address);
    return domain ? knownEmailProvider(domain) ?? providers[domain] ?? 'Checking provider…' : 'Unknown';
  };
  const disabled = loading || working || importing || running;
  const input = 'h-9 w-full rounded-md border border-border bg-bg px-3 text-[12px] outline-none focus:border-accent disabled:opacity-50';
  const button = 'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-bg px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40';
  const primary = `${button} !border-transparent !bg-accent !text-white hover:!bg-accent-hover`;
  const done = ws?.rows.filter(r => r.status === 'sent').length || 0;
  const pending = ws?.rows.filter(r => r.status === 'pending' && validRow(r) && ready(r)).length || 0;
  const selected = ws?.rows.filter(r => r.selected && r.status === 'pending' && validRow(r) && ready(r)).length || 0;
  const invalid = ws?.rows.filter(r => !validRow(r)).length || 0;
  const settingsValid = limitsValid(Number(dailyText), Number(secondsText));

  return <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-bg">
    <div className="mx-auto w-full max-w-[1440px] px-6 py-7 lg:px-10">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">Productivity</div>
          <h1 className="text-[24px] font-semibold tracking-tight">Automation</h1>
          <p className="mt-1 text-[13px] text-text-secondary">A considered queue. One personal email at a time.</p>
        </div>
        <button className={button} disabled={loading || working || importing || running} onClick={() => setShowImport(v => !v)}><FileTextIcon size={14} />{showImport ? 'Hide import' : ws?.fileName ? 'Manage spreadsheet' : 'Import spreadsheet'}</button>
      </header>
      {loading && <p role="status" className="py-8 text-sm text-text-secondary">Loading saved workspace…</p>}
      {error && <p role="alert" className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-[12px]">{error}</p>}
      {ws && <>
        <section className="mb-5 grid grid-cols-2 gap-5 border-y border-border py-5 sm:grid-cols-4" aria-label="Delivery progress">
          {[[done, 'Done in this queue'], [pending, 'Ready to send'], [snapshot?.sentToday || 0, 'Sent today'], [snapshot?.sentTotal || 0, 'Automation sends · all time']].map(([value, label]) => <div key={label}><div className="text-[25px] font-semibold tabular-nums tracking-tight">{value}</div><div className="mt-1 text-[11px] text-text-tertiary">{label}</div></div>)}
        </section>
        {(showImport || !ws.fileName) && <section className="mb-5 rounded-xl border border-border bg-surface p-5" aria-label="Spreadsheet import">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[13px] font-semibold">Your spreadsheet</h2><p className="mt-1 text-[12px] text-text-secondary">CSV or .xlsx · first sheet, first row as headers · up to 1,000 rows</p></div>
            <label className={`${button} relative overflow-hidden ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
              {importing ? 'Reading file…' : ws.fileName ? 'Replace file' : 'Choose file'}
              <input className="absolute inset-0 cursor-pointer opacity-0" disabled={disabled} aria-label="Import CSV or Excel" type="file" accept=".csv,.xlsx" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }} />
            </label>
          </div>
          <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
            {['Email column', 'Subject column', 'Body column'].map((label, i) => <label key={label} className="text-[11px] text-text-secondary">{label}<select className={`${input} mt-1.5`} disabled={disabled || !ws.table.length} aria-label={label} value={ws.table.length ? ws.columns[i] : ''} onChange={e => void save({ columns: ws.columns.map((v, j) => j === i ? Number(e.target.value) : v) })}>
              {!ws.table.length && <option value="">Choose a file first</option>}{ws.table[0]?.map((h, j) => <option key={j} value={j}>{j + 1}: {h || `Column ${j + 1}`}</option>)}
            </select></label>)}
            <button className={primary} disabled={disabled || !ws.table.length} onClick={async () => {
              if (new Set(ws.columns).size !== 3 || ws.columns.some(c => c >= ws.table[0].length)) { setError('Choose three different columns.'); return; }
              if (ws.rows.length && !await confirmAction('Rebuild the queue? Matching sent emails will remain done.')) return;
              await save({ rows: ws.table.slice(1).map(r => ({ id: crypto.randomUUID(), to: (r[ws.columns[0]] || '').trim(), subject: r[ws.columns[1]] || '', body: r[ws.columns[2]] || '', selected: false, status: 'pending' })) });
              setShowImport(false); setNotice('Queue saved. Select rows or send an individual email.');
            }}>Build queue</button>
          </div>
        </section>}
        <section className="mb-6 grid items-end gap-4 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-[minmax(160px,1fr)_140px_140px_auto]" aria-label="Sending preferences">
          <label className="text-[11px] text-text-secondary">Send from<select aria-label="Automation sending account" className={`${input} mt-1.5`} value={ws.accountId} disabled={disabled} onChange={e => void save({ accountId: e.target.value })}><option value="">Choose account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}</select></label>
          <label className="text-[11px] text-text-secondary">Emails per day<input aria-label="Emails per day" className={`${input} mt-1.5`} type="number" min="1" max="10000" value={dailyText} disabled={disabled} onChange={e => setDailyText(e.target.value)} onBlur={() => { if (limitsValid(Number(dailyText), ws.seconds)) void save({ daily: Number(dailyText) }); }} /></label>
          <label className="text-[11px] text-text-secondary">Interval · seconds<input aria-label="Interval in seconds" className={`${input} mt-1.5`} type="number" min="1" max="86400" value={secondsText} disabled={disabled} onChange={e => setSecondsText(e.target.value)} onBlur={() => { if (limitsValid(ws.daily, Number(secondsText))) void save({ seconds: Number(secondsText) }); }} /></label>
          <p className="pb-2 text-[11px] text-text-secondary">Follow-up on automatically<br /><span className="text-text-tertiary">Uses your default schedule</span></p>
          {!settingsValid && <p className="text-[12px] text-text-secondary sm:col-span-2 lg:col-span-4">Enter at least 1 email per day and 1 second between emails.</p>}
        </section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><h2 className="truncate text-[13px] font-semibold">{ws.fileName || 'No spreadsheet yet'}</h2><p className="mt-1 text-[11px] text-text-tertiary">{ws.rows.length} rows · {selected} selected{invalid > 0 ? ` · ${invalid} invalid` : ''} · {isElectron ? 'Saved on this device · SQLite' : 'Browser preview · local storage'}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={button} disabled={disabled} onClick={() => void refresh(true)}>Refresh sent status</button>
            <button className={button} disabled={disabled || !pending} onClick={() => void save({ rows: ws.rows.map(r => ({ ...r, selected: r.status === 'pending' && validRow(r) && ready(r) })) })}>Select all valid pending rows</button>
            <button className={button} disabled={disabled || !selected || !settingsValid} onClick={async () => { if (await confirmAction('Send the next selected email now?')) void send(); }}>Send next</button>
            {running ? <button className={primary} onClick={pause}>Pause</button> : <button className={primary} disabled={disabled || !selected || !settingsValid} onClick={async () => {
              if (await confirmAction(`Send ${selected} selected emails automatically, up to ${ws.daily} per day and at least ${ws.seconds} seconds apart?`)) { run.current = true; setRunning(true); void send(); }
            }}>Start automatic sending</button>}
          </div>
        </div>
        <p role="status" aria-label="Sending status" className="mb-3 text-[12px] text-text-secondary"><span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${running ? 'bg-accent' : 'bg-border-strong'}`} />{running ? 'Running' : 'Paused'}{notice ? ` · ${notice}` : ''}</p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full table-fixed text-left text-[12px]" style={{ minWidth: 780 }}>
            <thead className="border-b border-border bg-surface text-[10px] uppercase tracking-wider text-text-tertiary"><tr><th className="w-10 px-3 py-3"><span className="sr-only">Choose</span></th><th className="w-12 py-3">Row</th><th className="w-[22%] py-3">Recipient</th><th className="py-3">Message</th><th className="w-36 py-3">Status</th><th className="w-28 px-3 py-3 text-right">Action</th></tr></thead>
            <tbody>{ws.rows.map((r, i) => <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
              <td className="px-3 py-4 align-top"><input type="checkbox" aria-label={`Select row ${i + 2}`} checked={r.selected} disabled={disabled || r.status !== 'pending' || !validRow(r) || !ready(r)} onChange={e => void save({ rows: ws.rows.map(x => x.id === r.id ? { ...x, selected: e.target.checked } : x) })} /></td>
              <td className="py-4 align-top tabular-nums text-text-tertiary">{i + 2}</td>
              <td className="py-4 pr-4 align-top"><div className="truncate" title={r.to}>{r.to}</div><div className="mt-1 text-[10px] text-text-tertiary" title="Detected from the public email domain or MX records. A gateway may hide the mailbox provider; this does not verify the mailbox exists.">{providerFor(r.to)}</div></td>
              <td className="py-4 pr-5 align-top"><button className="block w-full truncate text-left font-medium" aria-label={`Preview row ${i + 2}`} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{r.subject || '(no subject)'}</button><p className={`${expanded === r.id ? 'whitespace-pre-wrap' : 'truncate'} mt-1 text-text-secondary`}>{expanded === r.id ? r.body : r.body.slice(0, 100)}</p>{r.error && <p className="mt-2 text-[11px] text-text-secondary">{r.error}</p>}</td>
              <td className="py-4 pr-3 align-top"><span className={`rounded-full px-2 py-1 text-[10px] ${r.status === 'sent' ? 'bg-accent/10 text-accent' : 'bg-surface text-text-secondary'}`}>{r.status === 'sent' ? 'Done' : !validRow(r) ? 'Invalid data' : r.status === 'pending' ? 'Ready' : r.status === 'sending' ? 'Sending…' : 'Needs review'}</span>{r.followUpActive && <p className="mt-2 text-[10px] text-accent">Follow-up active</p>}{r.sentAt && <p className="mt-2 text-[10px] text-text-tertiary">{new Date(r.sentAt).toLocaleDateString()}</p>}</td>
              <td className="px-3 py-3 text-right align-top">{validRow(r) && ready(r) && <button className={`${button} !h-8 !px-2`} aria-label={`Send mail to ${r.to}`} disabled={disabled || r.status !== 'pending' || !validRow(r) || !settingsValid} onClick={async () => { if (await confirmAction(`Send email?\n\nTo: ${r.to}\nEmail provider: ${providerFor(r.to)}\nSubject: ${r.subject}\n\n${checks[r.to]?.status === 'catch_all' ? 'Catch-all domain: the server accepts arbitrary addresses. This specific mailbox is unverified; delivery may bounce.' : 'MX and SMTP checks passed. This does not guarantee delivery or exclude catch-all mailboxes.'}`)) void send(r.id); }}><SendIcon size={12} />Send mail</button>}<p className="mt-2 text-[10px] text-text-tertiary">{!validRow(r) ? 'Invalid email or message' : checks[r.to]?.detail || (r.status === 'pending' ? 'Checking MX and SMTP…' : '')}</p></td>
            </tr>)}</tbody>
          </table>
          {!ws.rows.length && <div className="px-6 py-14 text-center"><FileTextIcon size={26} className="mx-auto mb-3 text-text-tertiary" /><p className="text-[13px] font-medium">{ws.table.length ? 'Your spreadsheet is saved.' : 'A clear place for your next send.'}</p><p className="mt-1 text-[12px] text-text-secondary">{ws.table.length ? 'Choose the columns above and build your queue.' : 'Import a spreadsheet to prepare individual emails.'}</p></div>}
        </div>
        <p className="mt-3 text-[11px] text-text-tertiary">Recipient checks contact the domain’s MX server on port 25 and disclose the recipient address, but send no message. Servers may block checks or accept all addresses. Only passed checks unlock sending. <button className="underline" disabled={disabled} onClick={() => setCheckVersion(v => v + 1)}>Recheck recipients</button></p>
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-text-tertiary"><p>Keep Still open for scheduled sending. Failed deliveries are never retried automatically. Only contact recipients who expect your mail.</p><button disabled={disabled || !ws.fileName} className="hover:text-text disabled:opacity-40" onClick={async () => { if (await confirmAction('Clear the imported spreadsheet and queue? Delivery history and daily limits will be retained.')) void save({ fileName: '', table: [], rows: [], columns: [0, 1, 2] }); }}>Clear queue</button></footer>
      </>}
    </div>
  </main>;
}
