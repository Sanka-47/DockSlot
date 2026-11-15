import { format, isValid, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const INVALID_DATE_FALLBACK = '—';

function toValidDate(date: string | Date): Date | null {
  const parsed = typeof date === 'string' ? parseISO(date) : date;
  return isValid(parsed) ? parsed : null;
}

/**
 * Formats an instant in the requested IANA time zone. Invalid dates, invalid
 * patterns, and invalid time-zone identifiers return a safe fallback instead of
 * throwing during render.
 */
export const formatDateTime = (
  date: string | Date,
  pattern: string = 'PPpp',
  timeZone?: string,
  fallback: string = INVALID_DATE_FALLBACK,
): string => {
  if (!date) return '';
  const parsed = toValidDate(date);
  if (!parsed) return fallback;

  try {
    return timeZone ? formatInTimeZone(parsed, timeZone, pattern) : format(parsed, pattern);
  } catch {
    return fallback;
  }
};

/**
 * Returns a `YYYY-MM-DD` key in the given time zone. Invalid dates and zones
 * return the supplied fallback so callers can decide how to degrade.
 */
export const formatDateKey = (
  date: string | Date,
  timeZone?: string,
  fallback: string = '',
): string => {
  const parsed = toValidDate(date);
  if (!parsed) return fallback;

  try {
    return timeZone
      ? formatInTimeZone(parsed, timeZone, 'yyyy-MM-dd')
      : format(parsed, 'yyyy-MM-dd');
  } catch {
    return fallback;
  }
};

/**
 * Converts a warehouse-local wall-clock value (`YYYY-MM-DDTHH:mm`) into a UTC
 * ISO instant. Returns null for malformed values or invalid zones.
 */
export const localDateTimeToUtc = (dateTimeLocal: string, timeZone: string): string | null => {
  if (!dateTimeLocal || !timeZone) return null;

  try {
    const utc = fromZonedTime(dateTimeLocal, timeZone);
    return isValid(utc) ? utc.toISOString() : null;
  } catch {
    return null;
  }
};
