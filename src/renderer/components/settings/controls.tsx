import type { ReactNode } from 'react';

/** Reusable settings controls — section titles, descriptions, separators,
 *  and inline controls. No cards (spec §11). */

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="max-w-2xl">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-[12px] text-text-secondary">{description}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Row({
  label,
  description,
  pending,
  children,
}: {
  label: string;
  description?: string;
  /**
   * Set when the value is stored but the subsystem that consumes it does not
   * exist yet. Stating this beats shipping a control that silently does
   * nothing (spec §20 rule 9).
   */
  pending?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-border py-3">
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {description && <div className="mt-0.5 text-[12px] text-text-secondary">{description}</div>}
        {pending && <div className="mt-0.5 text-[11px] text-text-tertiary">{pending}</div>}
      </div>
      {/* The group label associates the row's text with its inline control,
          so screen readers (and tests) can find the control by its setting. */}
      <div className="shrink-0" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-border-strong'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-text outline-none focus:border-accent disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-56 rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-text outline-none placeholder:text-text-tertiary focus:border-accent disabled:opacity-50"
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
}) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] transition-colors ${
            value === o.value
              ? 'bg-surface-hover font-medium text-text'
              : 'text-text-secondary hover:text-text'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorDots({
  value,
  onChange,
  colors,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: string[];
}) {
  return (
    <span className="flex items-center gap-1.5">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          title={color}
          className={`h-5 w-5 rounded-full transition-transform ${
            value === color ? 'ring-2 ring-text ring-offset-2 ring-offset-bg' : 'hover:scale-110'
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[12px] leading-relaxed text-text-tertiary">{children}</p>;
}
