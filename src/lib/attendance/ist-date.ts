// IST (India Standard Time, UTC+5:30) date/time helpers for attendance and
// payroll — every "what day is it" / "is this Late" / "which month" question
// in this module is answered in Asia/Kolkata terms, regardless of the
// server's own runtime timezone (Vercel functions run in UTC by default).
// Direct port of the old standalone "NYKO MART Work & Performance" Apps
// Script tool's own insistence on this (istPartsNow()/toISTDateStr()) —
// this app didn't have an IST helper anywhere yet, so it's added here
// rather than reusing `new Date().toISOString().slice(0,10)` (which is
// wrong for roughly the first ~5.5 hours of every IST calendar day).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Not a real moment in time (its epoch value is 5:30 ahead of "now") — only
// ever read back via the UTC-rendering accessors below, which is the whole
// trick: add the offset once, then read as if it were UTC.
function istShiftedNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/** "YYYY-MM-DD" for the current moment, as seen in IST. */
export function todayIST(): string {
  return istShiftedNow().toISOString().slice(0, 10);
}

/** "HH:MM" (24h) for the current moment, as seen in IST. */
export function nowISTTime(): string {
  return istShiftedNow().toISOString().slice(11, 16);
}

/** Full ISO instant — for storing in a timestamptz column. */
export function nowISOInstant(): string {
  return new Date().toISOString();
}

/**
 * 0=Sunday..6=Saturday for a plain "YYYY-MM-DD" IST calendar date — matches
 * companies.weekly_off_days' own numbering. Parsed as UTC-noon-on-that-date
 * to sidestep any local-timezone drift from Date's own string parsing.
 */
export function istDayOfWeek(dateStr: string): number {
  return new Date(dateStr + "T12:00:00Z").getUTCDay();
}

/** Number of calendar days in a given year/month (month is 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** All "YYYY-MM-DD" dates in a given year/month (month is 1-12), in order. */
export function datesInMonth(year: number, month: number): string[] {
  const n = daysInMonth(year, month);
  const mm = String(month).padStart(2, "0");
  return Array.from({ length: n }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Adds (or subtracts, for a negative `days`) whole calendar days to a
 * "YYYY-MM-DD" date string. Used by the Admin/MD Employee Performance view
 * (2026-08-12, round 6) to default a date-range picker to "last 7 days"
 * without pulling in a date library.
 */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
