// 2026-10-12 — KPI calculation engine for the reporting system.
//
// One place where every performance number on /dashboard/reports/performance
// (and its exports) is derived, instead of each report hand-computing its own
// percentages. The formulas are the standard set the owner asked to bring in:
//
//   Task completion rate    = Completed tasks / Assigned tasks × 100
//   Target achievement      = Actual output / Planned output × 100
//   On-time completion rate = Completed by deadline / Tasks due × 100
//   Overdue tasks           = Past deadline and still incomplete
//   Avg turnaround time     = Total processing time / Completed items
//
// FOUR RULES this module enforces everywhere, because getting them wrong is
// how dashboards start lying to people:
//
//  1. NO SILENT ZEROES. Every rate comes back `number | null`; null means
//     "not enough data to say" and renders as "—", never as 0%. A day where
//     nobody was assigned anything is not a 0% completion day.
//  2. CANCELLED WORK IS EXCLUDED, not counted as failure. It is reported on
//     its own line instead of diluting the rate.
//  3. NO DOUBLE COUNTING. Rows are de-duplicated by id before any maths, so
//     a joined query that fans out can't inflate a total.
//  4. QUALITY, TIMELINESS AND OUTPUT STAY SEPARATE. Three different numbers,
//     never blended into one "score" — a fast worker who needs revisions and
//     a slow worker who doesn't are not comparable by a single figure.
//
// The input shapes below mirror the REAL columns in db/schema.sql
// (`tasks` and `daily_work_logs`) — nothing here invents fields the tables
// don't have. Where the schema genuinely has no data for a formula (see
// targetAchievementKpis's notes on target_qty/qty_done being free text) the
// function says so by returning null rather than guessing.

import { istDateFromInstant } from "../attendance/ist-date";

// -----------------------------------------------------------------------------
// Types (mirrors of the real table columns, kept structural so the engine can
// be unit-tested with plain objects and doesn't need a Supabase client).
// -----------------------------------------------------------------------------

export type TaskForKpi = {
  id: string;
  status: string; // tasks.status — 'Pending' | 'In Progress' | 'Done'
  priority: string; // tasks.priority
  deadline: string | null; // tasks.deadline — "YYYY-MM-DD"
  created_at: string; // ISO instant
  completed_at: string | null; // ISO instant
  time_spent_seconds: number | null;
};

export type WorkLogForKpi = {
  id: string;
  log_date: string; // "YYYY-MM-DD"
  work_status: string | null; // 'Pending' | 'In Progress' | 'Completed' | 'Next Day Carry On' | 'Carried Forward'
  target_qty: string | null; // TEXT in the schema — parsed defensively
  qty_done: string | null; // TEXT in the schema — parsed defensively
  estimated_time_minutes: number | null;
  time_spent_seconds: number;
  submitted_at: string | null;
};

/** Task status meaning "work is finished". */
export const TASK_DONE_STATUS = "Done";

/**
 * Statuses excluded from completion maths and counted separately. The schema
 * has no cancelled value today — the rule exists so the day one is added the
 * engine is already correct, rather than quietly treating cancelled work as a
 * failure.
 *
 * Stored lowercase: comparisons happen after .toLowerCase() (a status typed
 * "cancelled" vs "Cancelled" must not slip through the exclusion).
 */
export const TASK_CANCELLED_STATUSES = ["cancelled", "canceled"];

/** Case/whitespace-insensitive status check. */
export function isCancelledStatus(status: string | null | undefined): boolean {
  return TASK_CANCELLED_STATUSES.includes((status ?? "").trim().toLowerCase());
}

/** Case/whitespace-insensitive "is this finished" check. */
export function isDoneStatus(status: string | null | undefined, completedAt: string | null): boolean {
  return (status ?? "").trim().toLowerCase() === TASK_DONE_STATUS.toLowerCase() || !!completedAt;
}

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

/**
 * A percentage that is `null` when the denominator says nothing — zero,
 * negative or not a number. NEVER NaN / Infinity / a misleading 0.
 */
export function ratioPct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** De-duplicates by `id`, keeping the first occurrence. */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * daily_work_logs.target_qty / qty_done are TEXT (free-form: "120", "120 pcs",
 * "2 sets"). Pull the first number out of them; null when there isn't one.
 * Comma thousand separators are stripped first so "1,250" is 1250 and not 1.
 */
export function parseQty(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[,  ]/g, "");
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// -----------------------------------------------------------------------------
// Task KPIs
// -----------------------------------------------------------------------------

export type CompletionKpis = {
  /** non-cancelled tasks, de-duplicated */
  assigned: number;
  completed: number;
  inProgress: number;
  pending: number;
  /** cancelled work — reported separately, never folded into the rate */
  cancelled: number;
  completionRatePct: number | null;
};

export function taskCompletionKpis(tasks: TaskForKpi[]): CompletionKpis {
  const rows = dedupeById(tasks);
  let assigned = 0;
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let cancelled = 0;

  for (const t of rows) {
    if (isCancelledStatus(t.status)) {
      cancelled++;
      continue;
    }
    assigned++;
    if (isDoneStatus(t.status, t.completed_at)) completed++;
    else if ((t.status ?? "").trim() === "In Progress") inProgress++;
    else pending++;
  }

  return { assigned, completed, inProgress, pending, cancelled, completionRatePct: ratioPct(completed, assigned) };
}

export type OnTimeKpis = {
  /** tasks carrying a deadline — the only ones timeliness can be judged on */
  dueTasks: number;
  completedOnTime: number;
  completedLate: number;
  /**
   * Finished, but with no completed_at timestamp, so they can't honestly be
   * scored either way. Surfaced rather than assumed on-time.
   */
  completedWithoutTimestamp: number;
  overdue: number;
  onTimeRatePct: number | null;
};

/**
 * Timeliness. `asOfISTDate` is the point-in-time for the overdue count
 * ("today", in IST) — overdue is a NOW measure, not a period measure: an
 * untouched task from last month is still overdue today.
 */
export function onTimeKpis(tasks: TaskForKpi[], asOfISTDate: string): OnTimeKpis {
  const rows = dedupeById(tasks);
  let dueTasks = 0;
  let completedOnTime = 0;
  let completedLate = 0;
  let completedWithoutTimestamp = 0;
  let overdue = 0;

  for (const t of rows) {
    if (isCancelledStatus(t.status)) continue;
    const deadline = t.deadline ?? null;
    const done = isDoneStatus(t.status, t.completed_at);
    if (done && !t.completed_at) completedWithoutTimestamp++;
    if (!deadline) continue;
    dueTasks++;
    if (done) {
      if (!t.completed_at) continue; // already counted above; not scoreable
      if (istDateFromInstant(t.completed_at) <= deadline) completedOnTime++;
      else completedLate++;
    } else if (deadline < asOfISTDate) {
      overdue++;
    }
  }

  // Denominator is only the tasks we can actually score (completed with a
  // timestamp), so "Done but no timestamp" never drags the rate down.
  const scorable = completedOnTime + completedLate;
  return {
    dueTasks,
    completedOnTime,
    completedLate,
    completedWithoutTimestamp,
    overdue,
    onTimeRatePct: ratioPct(completedOnTime, scorable),
  };
}

export type TurnaroundKpis = {
  completedWithTiming: number;
  /** mean hours from assigned to completed */
  avgHours: number | null;
  medianHours: number | null;
  /** completed with an impossible (negative) interval — data error, isolated */
  invalidIntervals: number;
};

/** Average turnaround: total processing time / completed items (hours). */
export function turnaroundKpis(tasks: TaskForKpi[]): TurnaroundKpis {
  const rows = dedupeById(tasks);
  const hours: number[] = [];
  let invalidIntervals = 0;

  for (const t of rows) {
    if (!t.completed_at) continue;
    const ms = new Date(t.completed_at).getTime() - new Date(t.created_at).getTime();
    if (!Number.isFinite(ms) || ms < 0) {
      invalidIntervals++;
      continue;
    }
    hours.push(ms / 3_600_000);
  }

  return {
    completedWithTiming: hours.length,
    avgHours: mean(hours) === null ? null : Math.round(mean(hours)! * 10) / 10,
    medianHours: median(hours) === null ? null : Math.round(median(hours)! * 10) / 10,
    invalidIntervals,
  };
}

// -----------------------------------------------------------------------------
// Daily work log KPIs (output / time)
// -----------------------------------------------------------------------------

export type TargetKpis = {
  logs: number;
  /** logs carrying a parseable target and a parseable output */
  withBoth: number;
  /** logs where a target was entered but the output could not be read */
  targetWithoutOutput: number;
  plannedQty: number;
  actualQty: number;
  achievementRatePct: number | null;
};

/**
 * Target achievement = actual output / planned output.
 *
 * target_qty and qty_done are TEXT columns holding whatever people typed, so
 * this is deliberately conservative: a log only contributes when BOTH ends
 * parse as a number. Logs with a target but no readable output are counted and
 * shown, not silently treated as zero output — otherwise a half-filled form
 * would look like a 0% day.
 */
export function targetAchievementKpis(workLogs: WorkLogForKpi[]): TargetKpis {
  const rows = dedupeById(workLogs);
  let withBoth = 0;
  let targetWithoutOutput = 0;
  let plannedQty = 0;
  let actualQty = 0;

  for (const l of rows) {
    const target = parseQty(l.target_qty);
    if (target === null) continue;
    const actual = parseQty(l.qty_done);
    if (actual === null) {
      targetWithoutOutput++;
      continue;
    }
    withBoth++;
    plannedQty += target;
    actualQty += actual;
  }

  return {
    logs: rows.length,
    withBoth,
    targetWithoutOutput,
    plannedQty: Math.round(plannedQty * 100) / 100,
    actualQty: Math.round(actualQty * 100) / 100,
    achievementRatePct: ratioPct(actualQty, plannedQty),
  };
}

export type SubmissionKpis = {
  logged: number;
  submitted: number;
  draft: number;
  /** share of logged work that was actually submitted as a report */
  submissionRatePct: number | null;
};

export function submissionKpis(workLogs: WorkLogForKpi[]): SubmissionKpis {
  const rows = dedupeById(workLogs);
  const submitted = rows.filter((l) => !!l.submitted_at).length;
  return {
    logged: rows.length,
    submitted,
    draft: rows.length - submitted,
    submissionRatePct: ratioPct(submitted, rows.length),
  };
}

export type TimeEstimateKpis = {
  /** logs with BOTH an estimate and recorded time */
  comparable: number;
  estimatedMinutes: number;
  actualMinutes: number;
  /** actual / estimated × 100 — 100 = exactly as planned, >100 = overran */
  timeUsedPct: number | null;
};

/**
 * Estimate vs actual time. Deliberately NOT called "efficiency": spending less
 * time than estimated is not automatically better work, and the spec is explicit
 * that timeliness and quality must not be blended.
 */
export function timeEstimateKpis(workLogs: WorkLogForKpi[]): TimeEstimateKpis {
  const rows = dedupeById(workLogs);
  let comparable = 0;
  let estimatedMinutes = 0;
  let actualMinutes = 0;

  for (const l of rows) {
    const est = l.estimated_time_minutes;
    if (!est || !Number.isFinite(est) || est <= 0) continue;
    const spent = l.time_spent_seconds;
    if (!Number.isFinite(spent)) continue;
    comparable++;
    estimatedMinutes += est;
    actualMinutes += spent / 60;
  }

  return {
    comparable,
    estimatedMinutes: Math.round(estimatedMinutes),
    actualMinutes: Math.round(actualMinutes),
    timeUsedPct: ratioPct(actualMinutes, estimatedMinutes),
  };
}

// -----------------------------------------------------------------------------
// Aggregate for a whole period (company / designation / one employee)
// -----------------------------------------------------------------------------

export type PeriodKpis = {
  tasks: CompletionKpis;
  onTime: OnTimeKpis;
  turnaround: TurnaroundKpis;
  target: TargetKpis;
  submission: SubmissionKpis;
  time: TimeEstimateKpis;
  /** total time_spent_seconds across tasks in scope */
  taskHours: number | null;
};

/**
 * Everything the KPI cards need for one slice of people over one period.
 * `asOfISTDate` only drives the overdue count.
 */
export function buildPeriodKpis(
  tasks: TaskForKpi[],
  workLogs: WorkLogForKpi[],
  asOfISTDate: string
): PeriodKpis {
  const t = dedupeById(tasks);
  const spentSeconds = t.reduce((s, x) => s + (Number.isFinite(x.time_spent_seconds) ? Number(x.time_spent_seconds) : 0), 0);
  return {
    tasks: taskCompletionKpis(t),
    onTime: onTimeKpis(t, asOfISTDate),
    turnaround: turnaroundKpis(t),
    target: targetAchievementKpis(workLogs),
    submission: submissionKpis(workLogs),
    time: timeEstimateKpis(workLogs),
    taskHours: t.length > 0 ? Math.round((spentSeconds / 3600) * 10) / 10 : null,
  };
}
