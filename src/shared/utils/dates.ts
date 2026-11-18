/** Pure date helpers shared by the renderer and the main process. */

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function addCalendarDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** Adds `days` working days (Mon–Fri), skipping weekends. */
export function addWorkingDays(d: Date, days: number): Date {
  let x = new Date(d);
  let remaining = days;
  while (remaining > 0) {
    x = addCalendarDays(x, 1);
    const day = x.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return x;
}

/**
 * User date/time preferences (Settings → General). `auto` follows the OS
 * locale; the explicit options force a 12/24-hour clock and a short or long
 * date style.
 */
export interface DatePrefs {
  dateFormat?: 'auto' | 'short' | 'long';
  timeFormat?: 'auto' | '12h' | '24h';
}

function timeOptions(prefs: DatePrefs): Intl.DateTimeFormatOptions {
  if (prefs.timeFormat === '24h') return { hour: '2-digit', minute: '2-digit', hour12: false };
  if (prefs.timeFormat === '12h') return { hour: 'numeric', minute: '2-digit', hour12: true };
  return { hour: 'numeric', minute: '2-digit' };
}

function dateOptions(prefs: DatePrefs, long: boolean): Intl.DateTimeFormatOptions {
  if (prefs.dateFormat === 'long' || (prefs.dateFormat === 'auto' && long)) {
    return { year: 'numeric', month: 'long', day: 'numeric' };
  }
  if (prefs.dateFormat === 'short') return { year: '2-digit', month: 'numeric', day: 'numeric' };
  return long
    ? { year: 'numeric', month: 'long', day: 'numeric' }
    : { month: 'short', day: 'numeric' };
}

/** Compact label for message lists: "09:41", "Yesterday", "Mon", "12 Nov". */
export function formatRelative(
  iso: string,
  now: Date = new Date(),
  prefs: DatePrefs = {},
): string {
  const d = new Date(iso);
  if (isSameDay(d, now)) {
    return d.toLocaleTimeString([], timeOptions(prefs));
  }
  if (isSameDay(d, addCalendarDays(now, -1))) return 'Yesterday';
  if (d.getTime() > addCalendarDays(now, -6).getTime()) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], dateOptions(prefs, false));
}

/** Full label for reading panes: "Mon, Nov 17, 09:41". */
export function formatFullDate(iso: string, prefs: DatePrefs = {}): string {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    ...dateOptions(prefs, true),
    ...timeOptions(prefs),
  });
}

