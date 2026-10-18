import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';

/**
 * Validates whether a given string is a valid IANA time zone identifier.
 */
export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates whether a date string is in valid YYYY-MM-DD calendar format.
 */
export function isValidDateString(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const dateObj = new Date(year, month - 1, day);
  return (
    dateObj.getFullYear() === year &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  );
}

/**
 * Maps JavaScript's native Date.getDay() (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 * to the standard 1–7 convention (1 = Monday, ..., 7 = Sunday) used in operating_hours tables.
 */
export function mapJsDayToIsoDay(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Determines the day of the week for a specific calendar date in the warehouse's IANA timezone,
 * returning the 1–7 standard (1 = Monday, ..., 7 = Sunday).
 */
export function getDayOfWeekInTimeZone(dateStr: string, timeZone: string): number {
  // Use noon (12:00:00) in the given timezone to avoid midnight DST transitions
  const localNoon = fromZonedTime(`${dateStr} 12:00:00`, timeZone);
  const zonedDate = toZonedTime(localNoon, timeZone);
  return mapJsDayToIsoDay(zonedDate.getDay());
}

/**
 * Parses "HH:mm" time string into total minutes from start of day.
 * Supports "24:00" = 1440 minutes.
 */
export function timeStringToMinutes(timeStr: string): number {
  const [hours, minutes = 0] = timeStr.split(':').map((part) => parseInt(part, 10));
  return hours * 60 + minutes;
}

/**
 * Converts total minutes from start of day into "HH:mm" string.
 * E.g., 1440 minutes becomes "24:00".
 */
export function minutesToTimeString(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Resolves an operating window ("openTime" -> "closeTime") into minutes from midnight.
 *
 * A close time at or before the open time means the window ends on the following
 * day, not that it is empty:
 *   - "24:00" is already 1440 minutes, so 00:00-24:00 stays a full day.
 *   - "00:00" used as a close time means midnight ending the day, so an
 *     08:00-00:00 shift becomes 08:00-24:00 instead of an empty window.
 *   - Overnight shifts such as 22:00-06:00 become 22:00-30:00.
 *
 * Returning minutes beyond 1440 lets callers keep generating slots that roll
 * past midnight (see `zonedDateAndTimeToUtc`).
 */
export function resolveOperatingWindowMinutes(
  openTime: string,
  closeTime: string
): { openMin: number; closeMin: number } {
  const openMin = timeStringToMinutes(openTime);
  let closeMin = timeStringToMinutes(closeTime);

  if (closeMin <= openMin) {
    closeMin += 1440;
  }

  return { openMin, closeMin };
}

/**
 * Generates all discrete time slot intervals [start, end] between openTime and closeTime
 * for a given slot length in minutes.
 *
 * Handles 24/7 and midnight-closing facilities where closeTime is "24:00" or "00:00",
 * as well as overnight windows (e.g. 22:00-06:00). Interval strings past midnight keep
 * counting upwards ("25:30" = 01:30 the following day) so callers can resolve them to
 * the correct UTC instant with `zonedDateAndTimeToUtc`.
 *
 * E.g., openTime: "00:00", closeTime: "24:00", slotLengthMinutes: 60
 * generates 24 full-cycle intervals: [{ start: "00:00", end: "01:00" }, ..., { start: "23:00", end: "24:00" }].
 */
export function generateTimeIntervals(
  openTime: string,
  closeTime: string,
  slotLengthMinutes: number
): Array<{ start: string; end: string }> {
  if (!Number.isFinite(slotLengthMinutes) || slotLengthMinutes <= 0) return [];

  const { openMin, closeMin } = resolveOperatingWindowMinutes(openTime, closeTime);
  const intervals: Array<{ start: string; end: string }> = [];

  let currentStartMin = openMin;

  while (currentStartMin + slotLengthMinutes <= closeMin) {
    const currentEndMin = currentStartMin + slotLengthMinutes;
    intervals.push({
      start: minutesToTimeString(currentStartMin),
      end: minutesToTimeString(currentEndMin),
    });
    currentStartMin = currentEndMin;
  }

  return intervals;
}

/**
 * Normalizes an interval boundary produced by `generateTimeIntervals` to a
 * time-of-day string in 00:00-23:59. Boundaries past midnight ("25:30") wrap to
 * the next day's equivalent ("01:30") for display in API responses.
 */
export function normalizeTimeOfDay(timeStr: string): string {
  const totalMinutes = timeStringToMinutes(timeStr);
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  return minutesToTimeString(minutesInDay);
}

/**
 * Converts a localized calendar date and "HH:mm" time in a given IANA timezone into a UTC Date object.
 * Correctly handles "24:00" (midnight ending the day) and boundaries past midnight produced by
 * overnight windows ("25:30" = 01:30 on the following day).
 */
export function zonedDateAndTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [hoursStr, minutesStr = '00'] = timeStr.split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);

  // Boundaries past 24:00 belong to a later calendar day (overnight shifts).
  const dayOffset = Math.floor(hours / 24);
  const hoursInDay = ((hours % 24) + 24) % 24;

  let targetDateStr = dateStr;
  if (dayOffset !== 0) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const targetDate = new Date(Date.UTC(year, month - 1, day + dayOffset));
    targetDateStr = targetDate.toISOString().slice(0, 10);
  }

  const normalizedTime = `${String(hoursInDay).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  return fromZonedTime(`${targetDateStr} ${normalizedTime}`, timeZone);
}

/**
 * Returns the exact UTC start and end bounds of a calendar day in the given IANA timezone.
 * Start: 00:00:00 of target date.
 * End: 00:00:00 of the following day (representing 24:00 of target date).
 */
export function getZonedDayBounds(dateStr: string, timeZone: string): { startOfDayUtc: Date; endOfDayUtc: Date } {
  const startOfDayUtc = fromZonedTime(`${dateStr} 00:00:00`, timeZone);
  const [year, month, day] = dateStr.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDateStr = nextDate.toISOString().slice(0, 10);
  const endOfDayUtc = fromZonedTime(`${nextDateStr} 00:00:00`, timeZone);
  return { startOfDayUtc, endOfDayUtc };
}

/**
 * Formats a Date object or UTC timestamp into a string formatted in the target timezone.
 */
export function formatZonedTime(
  date: Date | string | number,
  timeZone: string,
  formatStr: string = "yyyy-MM-dd'T'HH:mm:ssXXX"
): string {
  return formatInTimeZone(date, timeZone, formatStr);
}

// Re-export date-fns-tz utility
export { formatInTimeZone, fromZonedTime, toZonedTime };
