import { useState } from 'react';
import type { Account, NewAccountInput } from '../../../shared/types';
import { ACCOUNT_COLORS } from '../../../shared/constants';
import { getAPI } from '../../services/api';
import { ColorDots } from '../../components/settings/controls';

interface AccountFormProps {
  initial?: Account;
  onSaved: (account: Account) => void;
  onCancel: () => void;
}

export function AccountForm({ initial, onSaved, onCancel }: AccountFormProps) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState(initial?.imapHost ?? '');
  const [imapPort, setImapPort] = useState(initial?.imapPort ? String(initial.imapPort) : '993');
  const [imapSecure, setImapSecure] = useState(initial?.imapSecure ?? true);
  const [smtpHost, setSmtpHost] = useState(initial?.smtpHost ?? '');
  const [smtpPort, setSmtpPort] = useState(initial?.smtpPort ? String(initial.smtpPort) : '587');
  const [smtpSecure, setSmtpSecure] = useState(initial?.smtpSecure ?? true);
  const [color, setColor] = useState(initial?.color ?? ACCOUNT_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!displayName.trim() || !email.trim()) {
      setError('Display name and email address are required.');
      return;
    }
    setSaving(true);
    try {
      const input: NewAccountInput = {
        provider: initial?.provider ?? 'imap',
        displayName: displayName.trim(),
        email: email.trim(),
        color,
        imapHost: imapHost.trim() || null,
        imapPort: imapPort ? Number(imapPort) : null,
        imapSecure,
        smtpHost: smtpHost.trim() || null,
        smtpPort: smtpPort ? Number(smtpPort) : null,
        smtpSecure,
        username: username.trim() || null,
        password: password || null,
      };
      const saved = initial
        ? await getAPI().updateAccount(initial.id, input)
        : await getAPI().addAccount(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Display name" required>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Personal"
            className={inputClass}
          />
        </FormField>
        <FormField label="Email address" required>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
        </FormField>
        <FormField label="Username">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Usually your email address"
            className={inputClass}
          />
        </FormField>
        <FormField label={initial ? 'New password (optional)' : 'Password'}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={initial ? 'Leave blank to keep current' : 'Stored encrypted'}
            className={inputClass}
          />
        </FormField>
      </div>

      <h3 className="mt-6 text-[13px] font-semibold">Incoming server (IMAP)</h3>
      <div className="mt-2 grid grid-cols-[1fr_110px_auto] items-end gap-3">
        <FormField label="Host">
          <input
            type="text"
            value={imapHost}
            onChange={(e) => setImapHost(e.target.value)}
            placeholder="imap.example.com"
            className={inputClass}
          />
        </FormField>
        <FormField label="Port">
          <input
            type="number"
            value={imapPort}
            onChange={(e) => setImapPort(e.target.value)}
            className={inputClass}
          />
        </FormField>
        <label className="flex items-center gap-1.5 pb-2 text-[12px] text-text-secondary">
          <input type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} />
          SSL
        </label>
      </div>

      <h3 className="mt-5 text-[13px] font-semibold">Outgoing server (SMTP)</h3>
      <div className="mt-2 grid grid-cols-[1fr_110px_auto] items-end gap-3">
        <FormField label="Host">
          <input
            type="text"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            placeholder="smtp.example.com"
            className={inputClass}
          />
        </FormField>
        <FormField label="Port">
          <input
            type="number"
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
            className={inputClass}
          />
        </FormField>
        <label className="flex items-center gap-1.5 pb-2 text-[12px] text-text-secondary">
          <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
          SSL
        </label>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div>
          <div className="text-[12px] text-text-secondary">Account color</div>
          <div className="mt-1.5">
            <ColorDots value={color} onChange={setColor} colors={ACCOUNT_COLORS} />
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-[12px] text-danger">{error}</p>}

      <div className="mt-6 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Connect account'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:text-text"
        >
          Cancel
        </button>
      </div>
      <p className="mt-3 text-[12px] text-text-tertiary">
        Your password is encrypted with your operating system's credential store and never leaves this device.
      </p>
    </form>
  );
}

const inputClass =
  'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent';

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-text-secondary">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}
