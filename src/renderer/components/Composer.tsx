import { useEffect, useRef, useState } from 'react';
import type { Account, Draft } from '../../shared/types';
import {
  DEFAULT_FOLLOWUP_STAGES,
  MAX_FOLLOWUP_INTERVAL_DAYS,
  MIN_FOLLOWUP_INTERVAL_DAYS,
} from '../../shared/constants';
import { getAPI, isElectron } from '../services/api';
import { useSettings } from '../hooks/useSettings';
import { CheckIcon, ClockIcon, SendIcon, XIcon } from './icons';

interface ComposerProps {
  accounts: Account[];
  initial: Partial<Draft> & { id?: string };
  onClose: () => void;
  onSent?: () => void;
}


function parseAddresses(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function Composer({ accounts, initial, onClose, onSent }: ComposerProps) {
  const { settings } = useSettings();
  const [accountId, setAccountId] = useState<string | null>(
    initial.accountId ?? settings.defaultSendingAccountId ?? accounts[0]?.id ?? null,
  );
  const [to, setTo] = useState((initial.toAddresses ?? []).join(', '));
  const [cc, setCc] = useState((initial.ccAddresses ?? []).join(', '));
  const [bcc, setBcc] = useState((initial.bccAddresses ?? []).join(', '));
  const [showCcBcc, setShowCcBcc] = useState(true);
  const [subject, setSubject] = useState(initial.subject ?? '');
  const [body, setBody] = useState(initial.body ?? '');
  const [followUpEnabled, setFollowUpEnabled] = useState(
    initial.followUpEnabled ?? settings.followUpEnabledByDefault,
  );
  // Stage intervals come from the user's default schedule, so edits in
  // Settings → Follow-up are reflected here (spec §6.1/§6.2).
  const [stages, setStages] = useState<number[]>(DEFAULT_FOLLOWUP_STAGES);
  const [customDays, setCustomDays] = useState(false);
  const [followUpDays, setFollowUpDays] = useState<number>(
    initial.followUpIntervalDays ?? DEFAULT_FOLLOWUP_STAGES[0],
  );
  const [draftId, setDraftId] = useState<string | undefined>(initial.id);
  const [notice, setNotice] = useState<string | null>(null);
  // Autosave follows a real edit. Programmatic prefills (the default signature,
  // a loaded schedule) must not silently create a draft the user never wrote.
  const [touched, setTouched] = useState(false);
  const firstRender = useRef(true);
  const markTouched = () => setTouched(true);
  const isNewMessage = !initial.inReplyToConversationId && !initial.id;

  useEffect(() => {
    let active = true;
    void getAPI()
      .listSchedules()
      .then((list) => {
        if (!active || list.length === 0) return;
        const schedule =
          list.find((s) => s.id === settings.defaultScheduleId) ??
          list.find((s) => s.isDefault) ??
          list[0];
        setStages(schedule.stages);
        // Only preselect the first stage when the user has not chosen one.
        if (initial.followUpIntervalDays == null) setFollowUpDays(schedule.stages[0]);
      })
      .catch(() => {
        // Keep the built-in default stages.
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.defaultScheduleId]);

  // A new message starts with the default signature (Settings → Composition).
  useEffect(() => {
    if (!isNewMessage) return;
    const signature = settings.defaultSignature.trim();
    if (!signature) return;
    setBody((current) => (current.trim() === '' ? `\n\n${signature}` : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewMessage]);

  const snapshot = (): Partial<Draft> & { id?: string } => ({
    id: draftId,
    accountId,
    toAddresses: parseAddresses(to),
    ccAddresses: parseAddresses(cc),
    bccAddresses: parseAddresses(bcc),
    subject,
    body,
    followUpEnabled,
    followUpIntervalDays: followUpEnabled ? followUpDays : null,
    inReplyToConversationId: initial.inReplyToConversationId ?? null,
  });

  // Autosave drafts locally (spec §7). The ref keeps the pending debounce
  // pointed at the current draft id, so an in-flight save can never create a
  // duplicate draft.
  const latest = useRef(snapshot());
  latest.current = snapshot();

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!touched) return;
    const timer = window.setTimeout(() => {
      void getAPI()
        .saveDraft(latest.current)
        .then((saved) => setDraftId(saved.id))
        .catch(() => {
          // Best-effort: the composer stays usable, but a draft that did not
          // save must not fail silently — the user would otherwise believe
          // their text is stored and lose it on close.
          setNotice('Draft not saved.');
        });
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, to, cc, bcc, subject, body, followUpEnabled, followUpDays, touched]);

  const handleSend = async () => {
    if (!accountId) {
      setNotice('Select an account to send from.');
      return;
    }
    const toList = to.split(',').map((s) => s.trim()).filter(Boolean);
    if (toList.length === 0) {
      setNotice('Enter at least one recipient.');
      return;
    }
    if (settings.confirmBeforeSend) {
      const ok = window.confirm('Send this message?');
      if (!ok) return;
    }
    setNotice('Sending…');
    try {
      const ccList = cc.split(',').map((s) => s.trim()).filter(Boolean);
      const bccList = bcc.split(',').map((s) => s.trim()).filter(Boolean);
      const result = await getAPI().sendEmail({
        accountId,
        to: toList,
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
        subject,
        bodyText: body,
        conversationId: initial.inReplyToConversationId ?? null,
        draftId: draftId ?? null,
      });
      if (followUpEnabled && result.conversationId) {
        await getAPI().createFollowUp({
          conversationId: result.conversationId,
        });
      }
      onSent?.();
      onClose();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to send email.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      markTouched();
      setFollowUpEnabled((v) => !v);
    }
  };

  return (
    <aside
      className="absolute bottom-0 right-0 top-11 z-20 flex w-[520px] max-w-[90vw] flex-col border-l border-border bg-bg"
      onKeyDown={handleKeyDown}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-[15px] font-semibold">
          {initial.inReplyToConversationId ? 'Reply' : 'New message'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
          title="Close (Esc)"
        >
          <XIcon size={16} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-5">
        <Field label="From">
          <select
            value={accountId ?? ''}
            onChange={(e) => {
              markTouched();
              setAccountId(e.target.value || null);
            }}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName} &lt;{a.email}&gt;
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <input
            type="text"
            value={to}
            onChange={(e) => {
              markTouched();
              setTo(e.target.value);
            }}
            placeholder="name@example.com"
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent"
          />
        </Field>
        {showCcBcc ? (
          <>
            <Field label="Cc">
              <input
                type="text"
                value={cc}
                onChange={(e) => {
                  markTouched();
                  setCc(e.target.value);
                }}
                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent"
              />
            </Field>
            <Field label="Bcc">
              <input
                type="text"
                value={bcc}
                onChange={(e) => {
                  markTouched();
                  setBcc(e.target.value);
                }}
                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent"
              />
            </Field>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowCcBcc(true)}
            className="self-start py-1 text-[12px] text-text-tertiary hover:text-text"
          >
            Cc / Bcc
          </button>
        )}
        <Field label="Subject">
          <input
            type="text"
            value={subject}
            onChange={(e) => {
              markTouched();
              setSubject(e.target.value);
            }}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent"
          />
        </Field>
        <textarea
          value={body}
          onChange={(e) => {
            markTouched();
            setBody(e.target.value);
          }}
          placeholder="Write your message…"
          className="min-h-0 flex-1 resize-none py-3 text-[14px] leading-relaxed outline-none placeholder:text-text-tertiary"
        />
      </div>

      <footer className="shrink-0 border-t border-border px-5 py-3">
        {notice && (
          <p className="mb-2 flex items-center gap-1.5 text-[12px] text-text-secondary">
            <CheckIcon size={13} className="text-accent" />
            {notice}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              markTouched();
              setFollowUpEnabled((v) => !v);
            }}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
              followUpEnabled
                ? 'border-accent text-accent'
                : 'border-border text-text-secondary hover:text-text'
            }`}
            title="Toggle follow-up (Ctrl/⌘ + Shift + F)"
          >
            <ClockIcon size={14} />
            Follow-up: {followUpEnabled ? 'On' : 'Off'}
          </button>
          {followUpEnabled && (
            <select
              value={customDays ? 'custom' : String(followUpDays)}
              onChange={(e) => {
                markTouched();
                if (e.target.value === 'custom') {
                  setCustomDays(true);
                  return;
                }
                setCustomDays(false);
                setFollowUpDays(Number(e.target.value));
              }}
              aria-label="Follow-up interval"
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:border-accent"
            >
              {stages.map((days) => (
                <option key={days} value={days}>
                  Remind in {days} days
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          )}
          {followUpEnabled && customDays && (
            <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
              <input
                type="number"
                min={MIN_FOLLOWUP_INTERVAL_DAYS}
                max={MAX_FOLLOWUP_INTERVAL_DAYS}
                value={followUpDays}
                onChange={(e) => {
                  markTouched();
                  // Clamp to the same bounds the IPC schema enforces. `max` on
                  // the input only steers the spinner, so without this a typed
                  // 9999 would be rejected on save and the draft silently lost.
                  const raw = Number(e.target.value);
                  const next = Number.isFinite(raw)
                    ? raw
                    : MIN_FOLLOWUP_INTERVAL_DAYS;
                  setFollowUpDays(
                    Math.min(
                      MAX_FOLLOWUP_INTERVAL_DAYS,
                      Math.max(MIN_FOLLOWUP_INTERVAL_DAYS, Math.round(next)),
                    ),
                  );
                }}
                aria-label="Custom follow-up interval in days"
                className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:border-accent"
              />
              days
            </label>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => {
              void getAPI()
                .saveDraft(snapshot())
                .then((saved) => {
                  setDraftId(saved.id);
                  setNotice('Draft saved.');
                });
            }}
            className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:text-text"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={handleSend}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <SendIcon size={14} />
            Send
          </button>
        </div>
      </footer>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 border-b border-border py-2">
      <span className="w-14 shrink-0 text-[12px] text-text-tertiary">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}
