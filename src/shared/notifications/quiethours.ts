/**
 * Quiet-hours maths for reminder delivery (spec §6.7).
 *
 * Pure and timezone-local on purpose: quiet hours are a wall-clock window in
 * the user's own time ("do not disturb between 22:00 and 08:00"), so they must
 * be evaluated against local time, not UTC.
 */

export interface QuietHours {
  enabled: boolean;
  /** "HH:mm" local wall-clock start. */
  start: string;
  /** "HH:mm" local wall-clock end. */
  end: string;
}

function parseHHmm(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * True when `at` falls inside the quiet window.
 *
 * Handles windows that cross midnight (22:00 → 08:00) as well as same-day
 * windows (01:00 → 06:00). An unparsable or empty window (start === end) is
 * treated as "quiet hours off" rather than as all-day silence, so a typo in
 * settings can never suppress every reminder.
 */
export function isWithinQuietHours(at: Date, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;
  const start = parseHHmm(quiet.start);
  const end = parseHHmm(quiet.end);
  if (!start || !end) return false;

  const startMin = start.hours * 60 + start.minutes;
  const endMin = end.hours * 60 + end.minutes;
  if (startMin === endMin) return false;

  const now = minutesOfDay(at);
  return startMin < endMin
    ? now >= startMin && now < endMin
    : now >= startMin || now < endMin;
}

/**
 * The next moment at or after `at` when delivery is allowed. Returns `at`
 * unchanged when quiet hours are not active.
 */
export function nextAllowedTime(at: Date, quiet: QuietHours): Date {
  if (!isWithinQuietHours(at, quiet)) return at;
  const end = parseHHmm(quiet.end);
  if (!end) return at;

  const result = new Date(at);
  result.setHours(end.hours, end.minutes, 0, 0);
  // Crossing midnight: the window ends tomorrow morning.
  if (result.getTime() <= at.getTime()) result.setDate(result.getDate() + 1);
  return result;
}
