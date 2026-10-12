// 2026-10-12 — the ONE place the Performance & KPIs report is assembled.
//
// Both consumers call this: the report page (screen) and
// /api/performance-report-pdf (the downloadable file). Same queries, same KPI
// engine, same IST bucketing — so "the PDF must match the dashboard" is true
// by construction rather than by two people remembering to keep two copies in
// sync.
//
// SCOPE (also stated on the page itself):
//   • tasks      — by created_at, i.e. work ASSIGNED during the period
//   • work logs  — by log_date
//   • overdue    — point-in-time (as of `today`, IST), not a period filter

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { istDateFromInstant, addDaysToDateStr } from "../attendance/ist-date";
import { buildPeriodKpis, type PeriodKpis, type TaskForKpi, type WorkLogForKpi } from "./kpi";
import { dayCount, type ResolvedPeriod } from "./period";

export type TrendPoint = { date: string; assigned: number; completed: number };

export type EmployeePerfRow = {
  id: string;
  name: string;
  designation: string;
  active: boolean;
  assigned: number;
  completed: number;
  completionRate: number | null;
  inProgress: number;
  pending: number;
  cancelled: number;
  overdue: number;
  onTimeRate: number | null;
  completedLate: number;
  avgTurnaroundHours: number | null;
  taskHours: number | null;
  logs: number;
  submittedLogs: number;
  draftLogs: number;
  plannedQty: number;
  actualQty: number;
  achievementRate: number | null;
};

export type PerformanceReportData = {
  employeeRows: EmployeePerfRow[];
  summary: PeriodKpis;
  previous: PeriodKpis;
  trend: TrendPoint[];
  /** headcount of the company (active + inactive) — the table's row count */
  staffCount: number;
};

const TASK_COLS =
  "id, company_id, assigned_to_employee_id, status, priority, deadline, created_at, completed_at, time_spent_seconds";
const LOG_COLS =
  "id, employee_id, company_id, log_date, work_status, target_qty, qty_done, estimated_time_minutes, time_spent_seconds, submitted_at";

/** Row shapes for the two selects above — declared rather than derived, since
 *  `(typeof x)[number]` can't index a possibly-null Supabase result. */
type TaskRow = {
  id: string;
  company_id: string;
  assigned_to_employee_id: string;
  status: string;
  priority: string;
  deadline: string | null;
  created_at: string;
  completed_at: string | null;
  time_spent_seconds: number | null;
};
type LogRow = {
  id: string;
  employee_id: string;
  company_id: string;
  log_date: string;
  work_status: string | null;
  target_qty: string | null;
  qty_done: string | null;
  estimated_time_minutes: number | null;
  time_spent_seconds: number;
  submitted_at: string | null;
};

const toTask = (r: TaskRow): TaskForKpi => ({
  id: r.id,
  status: r.status,
  priority: r.priority,
  deadline: r.deadline,
  created_at: r.created_at,
  completed_at: r.completed_at,
  time_spent_seconds: r.time_spent_seconds === null ? null : Number(r.time_spent_seconds),
});

const toLog = (r: LogRow): WorkLogForKpi => ({
  id: r.id,
  log_date: r.log_date,
  work_status: r.work_status,
  target_qty: r.target_qty,
  qty_done: r.qty_done,
  estimated_time_minutes: r.estimated_time_minutes === null ? null : Number(r.estimated_time_minutes),
  time_spent_seconds: Number(r.time_spent_seconds ?? 0),
  submitted_at: r.submitted_at,
});

/** IST day boundaries expressed as instants, so filtering a timestamptz
 *  column on a date range doesn't drift by half a day. */
const instantFrom = (p: ResolvedPeriod) => `${p.from}T00:00:00+05:30`;
const instantTo = (p: ResolvedPeriod) => `${p.to}T23:59:59.999+05:30`;

export async function buildPerformanceReport(
  supabase: SupabaseClient<Database>,
  opts: { companyId: string; period: ResolvedPeriod; previous: ResolvedPeriod; today: string }
): Promise<PerformanceReportData> {
  const { companyId, period, previous, today } = opts;

  const [
    { data: staffRows },
    { data: taskRows },
    { data: logRows },
    { data: prevTaskRows },
    { data: prevLogRows },
  ] = await Promise.all([
    // Inactive employees are INCLUDED on purpose: their past work must still
    // show in history, it just isn't assignable going forward.
    supabase.from("employees").select("id, name, designation, active").eq("company_id", companyId).order("name"),
    supabase
      .from("tasks")
      .select(TASK_COLS)
      .eq("company_id", companyId)
      .gte("created_at", instantFrom(period))
      .lte("created_at", instantTo(period))
      .order("created_at", { ascending: true })
      .limit(5000),
    supabase
      .from("daily_work_logs")
      .select(LOG_COLS)
      .eq("company_id", companyId)
      .gte("log_date", period.from)
      .lte("log_date", period.to)
      .limit(5000),
    supabase
      .from("tasks")
      .select(TASK_COLS)
      .eq("company_id", companyId)
      .gte("created_at", instantFrom(previous))
      .lte("created_at", instantTo(previous))
      .order("created_at", { ascending: true })
      .limit(5000),
    supabase
      .from("daily_work_logs")
      .select(LOG_COLS)
      .eq("company_id", companyId)
      .gte("log_date", previous.from)
      .lte("log_date", previous.to)
      .limit(5000),
  ]);

  const staff = staffRows ?? [];
  const tasks = (taskRows ?? []).map(toTask);
  const logs = (logRows ?? []).map(toLog);

  const summary = buildPeriodKpis(tasks, logs, today);
  const previousKpis = buildPeriodKpis((prevTaskRows ?? []).map(toTask), (prevLogRows ?? []).map(toLog), today);

  // Per-employee roll-up — everyone gets a row, including people with no
  // activity (they read as 0 / "—", which is more honest than dropping them).
  const tasksByStaff = new Map<string, TaskForKpi[]>();
  for (const r of taskRows ?? []) {
    // Group on the RAW row (it carries assigned_to_employee_id); TaskForKpi
    // is intentionally minimal and has no such field.
    const list = tasksByStaff.get(r.assigned_to_employee_id) ?? [];
    list.push(toTask(r));
    tasksByStaff.set(r.assigned_to_employee_id, list);
  }
  const logsByStaff = new Map<string, WorkLogForKpi[]>();
  for (const r of logRows ?? []) {
    const list = logsByStaff.get(r.employee_id) ?? [];
    list.push(toLog(r));
    logsByStaff.set(r.employee_id, list);
  }

  const employeeRows: EmployeePerfRow[] = staff.map((e) => {
    const k = buildPeriodKpis(tasksByStaff.get(e.id) ?? [], logsByStaff.get(e.id) ?? [], today);
    return {
      id: e.id,
      name: e.name,
      designation: e.designation ?? "",
      active: e.active,
      assigned: k.tasks.assigned,
      completed: k.tasks.completed,
      completionRate: k.tasks.completionRatePct,
      inProgress: k.tasks.inProgress,
      pending: k.tasks.pending,
      cancelled: k.tasks.cancelled,
      overdue: k.onTime.overdue,
      onTimeRate: k.onTime.onTimeRatePct,
      completedLate: k.onTime.completedLate,
      avgTurnaroundHours: k.turnaround.avgHours,
      taskHours: k.taskHours,
      logs: k.submission.logged,
      submittedLogs: k.submission.submitted,
      draftLogs: k.submission.draft,
      plannedQty: k.target.plannedQty,
      actualQty: k.target.actualQty,
      achievementRate: k.target.achievementRatePct,
    };
  });

  // Daily trend across the period, bucketed by IST day (a task finished at
  // 1am IST belongs to that IST day, not to the previous UTC one).
  const assignedByDay = new Map<string, number>();
  const completedByDay = new Map<string, number>();
  for (const t of tasks) {
    const day = istDateFromInstant(t.created_at);
    assignedByDay.set(day, (assignedByDay.get(day) ?? 0) + 1);
    if (t.completed_at) {
      const cday = istDateFromInstant(t.completed_at);
      completedByDay.set(cday, (completedByDay.get(cday) ?? 0) + 1);
    }
  }

  const trend: TrendPoint[] = [];
  if (dayCount(period) <= 120) {
    let cursor = period.from;
    while (cursor <= period.to) {
      trend.push({ date: cursor, assigned: assignedByDay.get(cursor) ?? 0, completed: completedByDay.get(cursor) ?? 0 });
      cursor = addDaysToDateStr(cursor, 1);
    }
  }

  return { employeeRows, summary, previous: previousKpis, trend, staffCount: staff.length };
}
