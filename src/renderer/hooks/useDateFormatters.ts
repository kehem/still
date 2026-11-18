import { useMemo } from 'react';
import { formatFullDate, formatRelative, type DatePrefs } from '../../shared/utils/dates';
import { useSettings } from './useSettings';

/**
 * Date/time formatters bound to the user's General settings, so every list and
 * reading pane honours the configured date and time format.
 */
export function useDateFormatters() {
  const { settings } = useSettings();
  return useMemo(() => {
    const prefs: DatePrefs = {
      dateFormat: settings.dateFormat,
      timeFormat: settings.timeFormat,
    };
    return {
      relative: (iso: string) => formatRelative(iso, new Date(), prefs),
      full: (iso: string) => formatFullDate(iso, prefs),
    };
  }, [settings.dateFormat, settings.timeFormat]);
}
