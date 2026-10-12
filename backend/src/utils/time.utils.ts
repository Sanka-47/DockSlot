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
 * Determines the day of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 * for a specific calendar date in the warehouse's IANA timezone.
 */
export function getDayOfWeekInTimeZone(dateStr: string, timeZone: string): number {
  // Use noon (12:00:00) in the given timezone to avoid midnight DST transitions
  const localNoon = fromZonedTime(`${dateStr} 12:00:00`, timeZone);
  const zonedDate = toZonedTime(localNoon, timeZone);
  return zonedDate.getDay();
}

/**
 * Parses "HH:mm" time string into total minutes from start of day.
 */
export function timeStringToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map((part) => parseInt(part, 10));
  return hours * 60 + minutes;
}

/**
 * Converts total minutes from start of day into "HH:mm" string.
 */
export function minutesToTimeString(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Generates all discrete time slot intervals [start, end] between openTime and closeTime
 * for a given slot length in minutes.
 * E.g., openTime: "08:00", closeTime: "10:00", slotLengthMinutes: 30
 * returns: [{ start: "08:00", end: "08:30" }, { start: "08:30", end: "09:00" }, ...]
 */
export function generateTimeIntervals(
  openTime: string,
  closeTime: string,
  slotLengthMinutes: number
): Array<{ start: string; end: string }> {
  if (slotLengthMinutes <= 0) return [];

  let currentStartMin = timeStringToMinutes(openTime);
  const closeMin = timeStringToMinutes(closeTime);
  const intervals: Array<{ start: string; end: string }> = [];

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
 * Converts a localized calendar date and "HH:mm" time in a given IANA timezone into a UTC Date object.
 */
export function zonedDateAndTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const normalizedTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return fromZonedTime(`${dateStr} ${normalizedTime}`, timeZone);
}

/**
 * Returns the exact UTC start and end bounds of a calendar day in the given IANA timezone.
 */
export function getZonedDayBounds(dateStr: string, timeZone: string): { startOfDayUtc: Date; endOfDayUtc: Date } {
  const startOfDayUtc = fromZonedTime(`${dateStr} 00:00:00`, timeZone);
  const endOfDayUtc = fromZonedTime(`${dateStr} 23:59:59.999`, timeZone);
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
