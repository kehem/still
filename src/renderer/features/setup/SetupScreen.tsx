import { useState } from 'react';
import { ArrowRightIcon } from '../../components/icons';
import { AccountForm } from './AccountForm';

/**
 * First-launch experience (spec §4, Scenario A): no account configured →
 * the setup screen opens immediately. No dashboard, no empty inbox.
 */
export function SetupScreen({ onConnected }: { onConnected: () => void }) {
  const [mode, setMode] = useState<'choose' | 'imap'>('choose');
  const [notice, setNotice] = useState<string | null>(null);

  const oauthNotice = (provider: string) =>
    setNotice(
      `${provider} sign-in arrives in Phase 2. Connect with IMAP/SMTP for now — your account is saved locally and syncs in Phase 3.`,
    );

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-lg">
        <h1 className="text-[28px] font-semibold tracking-tight">Welcome to Still.</h1>
        <p className="mt-2 text-[14px] text-text-secondary">
          Connect your email account to get started.
        </p>

        {mode === 'choose' ? (
          <>
            <div className="mt-8 border-t border-border">
              <OptionRow label="Continue with Google" onClick={() => oauthNotice('Google')} />
              <OptionRow label="Continue with Microsoft" onClick={() => oauthNotice('Microsoft')} />
              <OptionRow label="Connect using IMAP/SMTP" onClick={() => setMode('imap')} />
            </div>
            {notice && <p className="mt-4 text-[12px] text-text-secondary">{notice}</p>}
            <p className="mt-8 text-[12px] leading-relaxed text-text-tertiary">
              Still is private by design. Your email connects directly to your provider and all
              data stays on this device — there is no Still account and no Still cloud.
            </p>
          </>
        ) : (
          <div className="mt-8">
            <AccountForm
              onSaved={() => onConnected()}
              onCancel={() => setMode('choose')}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function OptionRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-between border-b border-border py-4 text-left text-[15px] font-medium transition-colors hover:text-accent"
    >
      {label}
      <ArrowRightIcon size={17} className="text-text-tertiary transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
    </button>
  );
}
