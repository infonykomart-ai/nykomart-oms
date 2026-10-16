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

/** "YYYY-MM-DD" IST calendar date for an arbitrary instant (not just "now") — same istShiftedNow() trick, generalized. */
export function istDateFromInstant(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 2026-10-16 — Attendance Admin's Manual Correction: turns a date +
 * "HH:MM" picked in the UI into the exact instant stored in
 * attendance.punch_in / punch_out. IST has NO daylight saving, so a fixed
 * +05:30 offset IS the correct timezone for every date (same reasoning as
 * IST_OFFSET_MS above) — no local-timezone guessing, and the returned UTC
 * ISO string is what a timestamptz column wants.
 *
 * Returns null for anything that isn't a real date/time ("2026-02-31",
 * "25:99", empty) so callers can validate without duplicating the regexes.
 */
export function istInstantFromDateTime(dateStr: string, timeStr: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return null;
  const d = new Date(`${dateStr}T${timeStr}:00+05:30`);
  if (Number.isNaN(d.getTime())) return null;
  // JS Date NORMALIZES an out-of-range day ("2026-02-31" silently becomes
  // Mar 3) instead of failing, so a round-trip back to the IST calendar date
  // is what actually rejects a non-existent date here.
  if (istDateFromInstant(d.toISOString()) !== dateStr) return null;
  return d.toISOString();
}

// HH:MM (IST, 24h) after which a punch-in counts as Late instead of
// Present. Lives here (not in punch.ts) because the Manual Correction form
// is a CLIENT component and needs the same cutoff to suggest a status from
// the punch-in time the admin typed — punch.ts pulls in server-only
// Telegram/companion modules a client component must never import.
//
// 2026-09-02: "attendance 9:30 ke baad sabhi ko late dikhati hai punching
// time 9:20 se 9:45 am tak agar koi present karta hai to vo present
// dikhaye" — moved from 09:30 to 09:45. Anyone punching in AT or before
// 9:45 AM IST shows Present; only strictly after 9:45 shows Late.
export const LATE_CUTOFF_HHMM = "09:45";

/**
 * 2026-09-09 — splits a [startIso, endIso) stopped-timer interval into one
 * segment per IST calendar day it touches, e.g. a task timer left running
 * from 11pm to 1am IST produces 2 segments (yesterday's last hour, today's
 * first hour). Used by Task Assignment's timer (see tasks/actions.ts) to
 * credit task_daily_time_log correctly even across a midnight boundary —
 * every OTHER caller in this codebase (Daily Work Report, punch in/out) is
 * same-day by construction and never needs this, hence it lives alongside
 * the other IST helpers rather than duplicated locally.
 */
export function splitIntervalByISTDay(startIso: string, endIso: string): { logDate: string; seconds: number }[] {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!(end > start)) return [];
  const segments: { logDate: string; seconds: number }[] = [];
  let cursorReal = start;
  while (cursorReal < end) {
    const cursorShifted = cursorReal + IST_OFFSET_MS;
    const logDate = new Date(cursorShifted).toISOString().slice(0, 10);
    // Next IST midnight, expressed back in real (unshifted) instant terms.
    const nextMidnightShifted = Date.UTC(
      new Date(cursorShifted).getUTCFullYear(),
      new Date(cursorShifted).getUTCMonth(),
      new Date(cursorShifted).getUTCDate() + 1,
      0, 0, 0, 0
    );
    const nextMidnightReal = nextMidnightShifted - IST_OFFSET_MS;
    const segmentEndReal = Math.min(nextMidnightReal, end);
    const seconds = Math.max(0, Math.floor((segmentEndReal - cursorReal) / 1000));
    if (seconds > 0) segments.push({ logDate, seconds });
    cursorReal = segmentEndReal;
  }
  return segments;
}
