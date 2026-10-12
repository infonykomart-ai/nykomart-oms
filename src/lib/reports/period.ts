// 2026-10-12 — report period resolution. One place that answers "what date
// range does 'Monthly' mean today", so every report on the hub agrees instead
// of each page inventing its own window.
//
// All arithmetic runs on plain "YYYY-MM-DD" strings as seen in IST (the
// company's business timezone) — timestamps are stored in UTC and only
// converted at the edges, per the schema's own rule. Month/FY maths reuses
// daysInMonth + FY_START_MONTH from the existing fy-date module, so the
// "year" on this report is the same Indian financial year (Apr–Mar) every
// dated document in this app already uses.
//
// previousPeriod() gives the immediately-preceding window of the SAME shape,
// which is what the report's period-over-period comparison reads.

import { addDaysToDateStr, daysInMonth, istDayOfWeek } from "../attendance/ist-date";
import { FY_START_MONTH } from "../fy-date";

export type PeriodKey =
  | "daily"
  | "weekly"
  | "monthly"
  | "six_month"
  | "rolling_six"
  | "yearly"
  | "custom";

export type ResolvedPeriod = {
  key: PeriodKey;
  label: string;
  /** inclusive "YYYY-MM-DD" */
  from: string;
  /** inclusive "YYYY-MM-DD" */
  to: string;
};

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "six_month", label: "FY Half-Year" },
  { key: "rolling_six", label: "Rolling 6 Months" },
  { key: "yearly", label: "Yearly (FY)" },
  { key: "custom", label: "Custom Range" },
];

const pad = (n: number) => String(n).padStart(2, "0");

function monthStart(dateStr: string): string {
  return `${dateStr.slice(0, 8)}01`;
}

function monthEnd(dateStr: string): string {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}

/** Shifts a date string by whole months (can be negative). */
function shiftMonth(dateStr: string, months: number): string {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

/** First day of the FY (Apr 1) containing the given date. */
function fyStart(dateStr: string): string {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  return m >= FY_START_MONTH ? `${y}-${pad(FY_START_MONTH)}-01` : `${y - 1}-${pad(FY_START_MONTH)}-01`;
}

/** Last day of the FY (Mar 31) that the given FY start belongs to. */
function fyEndOf(fyStartDate: string): string {
  const y = Number(fyStartDate.slice(0, 4)) + 1;
  const endMonth = FY_START_MONTH - 1; // March
  return `${y}-${pad(endMonth)}-${pad(daysInMonth(y, endMonth))}`;
}

/** First day of the FY half (Apr–Sep / Oct–Mar) containing the given date. */
function fyHalfStart(dateStr: string): string {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const h1 = FY_START_MONTH; // April
  const h2 = FY_START_MONTH + 6; // October
  if (m >= h1 && m < h2) return `${y}-${pad(h1)}-01`;
  if (m >= h2) return `${y}-${pad(h2)}-01`;
  return `${y - 1}-${pad(h2)}-01`; // Jan–Mar belongs to the previous FY's H2
}

/** Monday (IST) of the week containing the given date. */
function weekStart(dateStr: string): string {
  const dow = istDayOfWeek(dateStr); // 0=Sun..6=Sat
  const backToMonday = dow === 0 ? 6 : dow - 1;
  return addDaysToDateStr(dateStr, -backToMonday);
}

export function resolvePeriod(
  key: PeriodKey,
  opts: { today: string; from?: string; to?: string }
): ResolvedPeriod {
  const today = opts.today;

  switch (key) {
    case "daily":
      return { key, label: "Daily", from: today, to: today };

    case "weekly": {
      const start = weekStart(today);
      return { key, label: "Weekly", from: start, to: addDaysToDateStr(start, 6) };
    }

    case "monthly":
      return { key, label: "Monthly", from: monthStart(today), to: monthEnd(today) };

    case "six_month": {
      const start = fyHalfStart(today);
      return { key, label: "FY Half-Year", from: start, to: monthEnd(shiftMonth(start, 5)) };
    }

    case "rolling_six":
      // Last 6 calendar months ending today — the rolling flavour, as opposed
      // to six_month's fixed FY halves.
      return { key, label: "Rolling 6 Months", from: monthStart(shiftMonth(today, -5)), to: today };

    case "yearly": {
      const start = fyStart(today);
      return { key, label: "Yearly (FY)", from: start, to: fyEndOf(start) };
    }

    case "custom": {
      const from = opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from) ? opts.from : monthStart(today);
      const to = opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to) ? opts.to : today;
      // Guard against a reversed range silently returning nothing.
      return from <= to
        ? { key, label: "Custom Range", from, to }
        : { key, label: "Custom Range", from: to, to: from };
    }
  }
}

/**
 * The window immediately before `p`, same length and shape — used for the
 * "vs previous period" figures. For custom ranges the previous window is the
 * same number of days ending the day before `from` (clamped at 1 day).
 *
 * Takes no "today": every previous window is derived from `p.from` alone.
 */
export function previousPeriod(p: ResolvedPeriod): ResolvedPeriod {
  switch (p.key) {
    case "daily": {
      const to = addDaysToDateStr(p.from, -1);
      return { key: "daily", label: "Previous Day", from: to, to };
    }
    case "weekly": {
      const to = addDaysToDateStr(p.from, -1);
      return { key: "weekly", label: "Previous Week", from: addDaysToDateStr(to, -6), to };
    }
    case "monthly": {
      const prev = shiftMonth(p.from, -1);
      return { key: "monthly", label: "Previous Month", from: monthStart(prev), to: monthEnd(prev) };
    }
    case "six_month": {
      const start = fyHalfStart(addDaysToDateStr(p.from, -1));
      return {
        key: "six_month",
        label: "Previous FY Half",
        from: start,
        to: monthEnd(shiftMonth(start, 5)),
      };
    }
    case "rolling_six": {
      const end = addDaysToDateStr(p.from, -1);
      return {
        key: "rolling_six",
        label: "Previous Rolling 6M",
        from: monthStart(shiftMonth(end, -5)),
        to: end,
      };
    }
    case "yearly": {
      const start = fyStart(addDaysToDateStr(p.from, -1));
      return { key: "yearly", label: "Previous FY", from: start, to: fyEndOf(start) };
    }
    case "custom": {
      const days = dayCount(p);
      const to = addDaysToDateStr(p.from, -1);
      return { key: "custom", label: "Previous Range", from: addDaysToDateStr(to, -(days - 1)), to };
    }
  }
  // Unreachable — every PeriodKey is handled above.
  return { ...p, label: `Previous ${p.label}` };
}

/** Inclusive day count of a period. */
export function dayCount(p: ResolvedPeriod): number {
  const ms = new Date(`${p.to}T12:00:00Z`).getTime() - new Date(`${p.from}T12:00:00Z`).getTime();
  const days = Math.round(ms / 86_400_000) + 1;
  return Number.isFinite(days) && days > 0 ? days : 1;
}

/** "2026-10-01 – 2026-10-12" style label, for filters chips and exports. */
export function formatRange(p: ResolvedPeriod): string {
  return p.from === p.to ? p.from : `${p.from} → ${p.to}`;
}

/** Every "YYYY-MM-DD" inside the period, in order — drives the trend chart. */
export function datesInRange(p: ResolvedPeriod, cap = 400): string[] {
  const out: string[] = [];
  let cursor = p.from;
  while (cursor <= p.to && out.length < cap) {
    out.push(cursor);
    cursor = addDaysToDateStr(cursor, 1);
  }
  return out;
}
