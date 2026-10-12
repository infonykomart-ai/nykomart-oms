import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST, istDateFromInstant } from "@/lib/attendance/ist-date";
import { buildPeriodKpis, type PeriodKpis, type TaskForKpi, type WorkLogForKpi } from "@/lib/reports/kpi";
import {
  PERIOD_OPTIONS,
  resolvePeriod,
  previousPeriod,
  formatRange,
  dayCount,
  type PeriodKey,
  type ResolvedPeriod,
} from "@/lib/reports/period";
import { PerformanceReportClient, type EmployeePerfRow, type TrendPoint } from "./performance-report-client";

// 2026-10-12 — Performance & KPIs report. The reporting system previously
// covered money (Orders, Purchase Bills, Party Ledger, Outstanding, Salary…)
// but had no single screen answering "how did the team actually perform over
// this period". This is that screen, built on two new shared modules rather
// than page-local maths:
//
//   src/lib/reports/kpi.ts     — every formula, once, unit-testable
//   src/lib/reports/period.ts  — what "Weekly / Monthly / FY Half" means, in IST
//
// SCOPE RULE (stated in the UI too, because a number without a definition is
// a rumour): the period selects TASKS BY created_at — i.e. work assigned
// during the period — and DAILY WORK LOGS BY log_date. Overdue is the one
// point-in-time measure: among this period's tasks, how many are past their
// deadline and still not Done as of today (IST). It is not a period filter,
// because a task from two weeks ago that nobody finished is still overdue.
//
// Capability: the same `reports` capability as every other hub report — this
// is a read-only team-performance view, not a payroll or HR-admin screen.
export default async function PerformanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", employee.companyIds)
    .order("name");

  const companyId =
    typeof sp.company === "string" && employee.companyIds.includes(sp.company)
      ? sp.company
      : employee.currentCompanyId;

  const today = todayIST();
  const periodKey: PeriodKey =
    typeof sp.period === "string" && PERIOD_OPTIONS.some((o) => o.key === sp.period)
      ? (sp.period as PeriodKey)
      : "monthly";

  const period = resolvePeriod(periodKey, {
    today,
    from: typeof sp.from === "string" ? sp.from : undefined,
    to: typeof sp.to === "string" ? sp.to : undefined,
  });
  const prev = previousPeriod(period);

  // IST day boundaries expressed as instants, so filtering a timestamptz
  // column on a date range doesn't drift by half a day.
  const IST = "+05:30";
  const instantFrom = (p: ResolvedPeriod) => `${p.from}T00:00:00${IST}`;
  const instantTo = (p: ResolvedPeriod) => `${p.to}T23:59:59.999${IST}`;

  const TASK_COLS =
    "id, company_id, assigned_to_employee_id, status, priority, deadline, created_at, completed_at, time_spent_seconds";
  const LOG_COLS =
    "id, employee_id, company_id, log_date, work_status, target_qty, qty_done, estimated_time_minutes, time_spent_seconds, submitted_at";

  // Explicit row shapes for the two selects above (declared here rather than
  // derived with `(typeof x)[number]`, which can't index a possibly-null
  // Supabase result type).
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

  const [
    { data: staffRows },
    { data: taskRows },
    { data: logRows },
    { data: prevTaskRows },
    { data: prevLogRows },
  ] = await Promise.all([
    // Inactive employees are INCLUDED on purpose: their past work must still
    // show up in history, it just won't be assignable going forward.
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
      .gte("created_at", instantFrom(prev))
      .lte("created_at", instantTo(prev))
      .order("created_at", { ascending: true })
      .limit(5000),
    supabase
      .from("daily_work_logs")
      .select(LOG_COLS)
      .eq("company_id", companyId)
      .gte("log_date", prev.from)
      .lte("log_date", prev.to)
      .limit(5000),
  ]);

  const staff = staffRows ?? [];

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

  const tasks = (taskRows ?? []).map(toTask);
  const logs = (logRows ?? []).map(toLog);
  const prevTasks = (prevTaskRows ?? []).map(toTask);
  const prevLogs = (prevLogRows ?? []).map(toLog);

  const summary: PeriodKpis = buildPeriodKpis(tasks, logs, today);
  const previous: PeriodKpis = buildPeriodKpis(prevTasks, prevLogs, today);

  // Per-employee roll-up — one row each, including people with no activity
  // (they show as 0 / —, which is more honest than silently dropping them).
  const tasksByStaff = new Map<string, TaskForKpi[]>();
  for (const r of taskRows ?? []) {
    // Group on the RAW row (it carries assigned_to_employee_id), mapping to
    // the KPI shape on the way in — TaskForKpi is intentionally minimal.
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
    const eTasks = tasksByStaff.get(e.id) ?? [];
    const eLogs = logsByStaff.get(e.id) ?? [];
    const k = buildPeriodKpis(eTasks, eLogs, today);
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

  // Daily trend across the period: assigned vs completed, by IST day.
  const dayCountInPeriod = dayCount(period);
  const assignedByDay = new Map<string, number>();
  const completedByDay = new Map<string, number>();
  for (const t of tasks) {
    // created_at / completed_at are UTC instants; bucket them by the IST day
    // the report is scoped to, not by the raw UTC date (which would shift
    // work done before ~5:30am IST onto the previous day).
    const day = istDateFromInstant(t.created_at);
    assignedByDay.set(day, (assignedByDay.get(day) ?? 0) + 1);
    if (t.completed_at) {
      const cday = istDateFromInstant(t.completed_at);
      completedByDay.set(cday, (completedByDay.get(cday) ?? 0) + 1);
    }
  }

  const trend: TrendPoint[] = [];
  if (dayCountInPeriod <= 120) {
    let cursor = period.from;
    while (cursor <= period.to) {
      trend.push({
        date: cursor,
        assigned: assignedByDay.get(cursor) ?? 0,
        completed: completedByDay.get(cursor) ?? 0,
      });
      const d = new Date(`${cursor}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      cursor = d.toISOString().slice(0, 10);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📈 Performance &amp; KPIs</h1>
          <p className="mt-1 text-sm text-slate-500">
            Team output, timeliness and report discipline for {formatRange(period)} —{" "}
            {summary.tasks.assigned} task{summary.tasks.assigned === 1 ? "" : "s"} assigned,{" "}
            {summary.submission.logged} work-log entr{summary.submission.logged === 1 ? "y" : "ies"}.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <PerformanceReportClient
        companies={companies ?? []}
        employeeRows={employeeRows}
        summary={summary}
        previous={previous}
        trend={trend}
        periodLabel={period.label}
        periodFrom={period.from}
        periodTo={period.to}
        prevLabel={prev.label}
        prevFrom={prev.from}
        prevTo={prev.to}
        currentFilters={{
          companyId,
          period: periodKey,
          from: period.from,
          to: period.to,
        }}
      />
    </div>
  );
}
