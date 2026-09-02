import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST, addDaysToDateStr, daysInMonth } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories } from "@/lib/attendance/payroll";
import { formatDuration, liveElapsedSeconds } from "@/lib/attendance/timer";
import { EXPECTED_WORK_MINUTES, OFFICE_START_LABEL, OFFICE_END_LABEL, formatHM, compareToExpected, type WorkHoursVerdict } from "@/lib/attendance/work-hours";
import {
  attendanceScore,
  leaveScore,
  workEfficiencyScore,
  businessImpactScoreRanked,
  compositeScore,
  growthPct,
  topReasonFor,
} from "@/lib/performance/score";
import { HolidayForm } from "./holiday-form";
import { WeeklyOffForm } from "./weekly-off-form";
import { ManualAttendanceForm } from "./manual-attendance-form";
import { RemoveHolidayButton } from "./remove-holiday-button";
import { PendingWorkPanel, type PendingWorkGroup } from "./pending-work-panel";

// 2026-08-11: Attendance Admin — holiday calendar + weekly-off pattern per
// company, a team-wide monthly Present/Absent/Late/Leave/Holiday/Week Off
// summary (derived, no nightly job needed — see categorizeMonth), a manual
// correction form (missed punch, approved leave, one-off half day), and
// the team-wide Daily Work Report log. Company/store access itself (who
// can see which company at all) is unrelated existing infrastructure
// (employee_company_access) — this page only adds holiday/weekly-off
// config on top of it.
export default async function AttendanceAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("attendance_admin");
  const supabase = await createClient();
  // 2026-08-12 (round 6): "ajay ne report submit ki ... admin panal me
  // nahi dikh rahi" — same root cause as the `tasks` table fix above:
  // upsertDailyLog/submitDailyLog write daily_work_logs via the SERVICE
  // ROLE client, but this page's Team Daily Work Log query below was
  // reading it via the anon/session client (subject to RLS). Switched to
  // a service-role read here too — safe because the query keeps its own
  // explicit .eq("company_id", selectedCompanyId) scoping.
  const dwlSupabase = createServiceRoleClient();
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name, weekly_off_days").in("id", employee.companyIds);
  const selectedCompanyId = (typeof sp.company === "string" && employee.companyIds.includes(sp.company)) ? sp.company : employee.currentCompanyId;
  const selectedCompany = (companies ?? []).find((c) => c.id === selectedCompanyId) ?? companies?.[0];

  const today = todayIST();
  const monthParam = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [year, month] = monthParam.split("-").map(Number);
  const monthStart = `${monthParam}-01`;
  // `${monthParam}-31` is an invalid Postgres date for 5 of 12 months (Apr/
  // Jun/Sep/Nov have 30 days, Feb has 28/29) — a .lte(..., that invalid
  // string) silently errors and Supabase returns no rows, quietly making
  // the team summary/daily-log queries look empty for those months. Same
  // bug found and fixed this round in salary/actions.ts + salary/page.tsx.
  const monthEnd = `${monthParam}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  const [{ data: teamEmployees }, { data: attendanceRows }, { data: holidays }, { data: dailyLogs }, { data: pendingWorkRows }] = await Promise.all([
    supabase.from("employees").select("id, name, date_of_joining, role_id").eq("company_id", selectedCompanyId).eq("active", true).order("name"),
    supabase.from("attendance").select("employee_id, attendance_date, status").eq("company_id", selectedCompanyId).gte("attendance_date", monthStart).lte("attendance_date", monthEnd),
    supabase.from("holidays").select("id, holiday_date, name, company_id").or(`company_id.eq.${selectedCompanyId},company_id.is.null`).gte("holiday_date", monthStart).lte("holiday_date", monthEnd).order("holiday_date"),
    // 2026-08-11 (round 3): "md admin ke page par show ho jaye" — only
    // rows that have actually been submitted show here, not drafts still
    // being typed. See daily_work_logs.submitted_at.
    dwlSupabase
      .from("daily_work_logs")
      .select("id, log_date, employee_id, category, description, work_status, submitted_at, time_spent_seconds, estimated_time_minutes")
      .eq("company_id", selectedCompanyId)
      .gte("log_date", monthStart)
      .lte("log_date", monthEnd)
      .not("submitted_at", "is", null)
      .order("log_date", { ascending: false })
      .limit(200),
    // 2026-09-02: "pending work,next day carry on vala work sabhi employe
    // ki sheet par dikhnae sath me admin ko bhi dikhe ki kiska kitna kaam
    // baki hai" — every still-open (Pending / In Progress) row, team-wide,
    // NOT date-bound to the selected month (a lingering old Pending row is
    // still real open work regardless of which log_date it's stamped
    // with) — see PendingWorkPanel below. These rows are never submitted
    // by design (Submit requires Completed — see actions.ts), so
    // .is("submitted_at", null) is defense in depth, not the primary filter.
    dwlSupabase
      .from("daily_work_logs")
      .select("id, employee_id, log_date, category, description, work_status, priority, estimated_time_minutes")
      .eq("company_id", selectedCompanyId)
      .in("work_status", ["Pending", "In Progress"])
      .is("submitted_at", null)
      .order("log_date", { ascending: false })
      .limit(300),
  ]);

  const employeeName = new Map((teamEmployees ?? []).map((e) => [e.id, e.name]));
  const holidayDates = new Set((holidays ?? []).map((h) => h.holiday_date));

  // 2026-09-02: group pendingWorkRows by employee for PendingWorkPanel —
  // summary counts (Pending / In Progress) plus the full row list per
  // employee for the expand-to-detail view. Employees with zero open work
  // are simply absent from this list (nothing to show).
  const pendingByEmployee = new Map<string, PendingWorkGroup>();
  for (const r of pendingWorkRows ?? []) {
    let group = pendingByEmployee.get(r.employee_id);
    if (!group) {
      group = { employeeId: r.employee_id, employeeName: employeeName.get(r.employee_id) ?? "—", pendingCount: 0, inProgressCount: 0, rows: [] };
      pendingByEmployee.set(r.employee_id, group);
    }
    if (r.work_status === "In Progress") group.inProgressCount++;
    else group.pendingCount++;
    group.rows.push({
      id: r.id,
      logDate: r.log_date,
      category: r.category,
      description: r.description,
      workStatus: r.work_status,
      priority: r.priority || "Medium",
      estimatedTimeMinutes: r.estimated_time_minutes,
    });
  }
  const pendingWorkGroups = Array.from(pendingByEmployee.values()).sort((a, b) => (b.pendingCount + b.inProgressCount) - (a.pendingCount + a.inProgressCount));
  const weeklyOffDays = (selectedCompany?.weekly_off_days as number[] | undefined) ?? [0];

  const rowsByEmployee = new Map<string, Map<string, { status: string | null }>>();
  for (const r of attendanceRows ?? []) {
    if (!rowsByEmployee.has(r.employee_id)) rowsByEmployee.set(r.employee_id, new Map());
    rowsByEmployee.get(r.employee_id)!.set(r.attendance_date, { status: r.status });
  }

  const teamSummary = (teamEmployees ?? []).map((e) => {
    const days = categorizeMonth({
      year,
      month,
      weeklyOffDays,
      holidayDates,
      attendanceByDate: rowsByEmployee.get(e.id) ?? new Map(),
      todayStr: today,
      joinDate: e.date_of_joining,
    });
    return { employee: e, summary: summarizeCategories(days) };
  });

  // 2026-09-02: "Performance & Awards" team-wide ranking — HR/MD only
  // (performance_admin capability, deliberately more restrictive than
  // general attendance_admin — see capability-info.ts). Reuses
  // teamSummary's attendance/leave counts (already computed above, never a
  // second disagreeing count) plus a fresh, UNCAPPED month query for
  // work-report minutes — the `dailyLogs` query below is capped at 200
  // rows for the Team Daily Work Log display and would silently undercount
  // a busy team/month if reused here — and order value/growth for
  // order-entry/sales staff only (see score.ts header: the app has no
  // per-employee order data beyond who ENTERED it, `orders.entry_by_employee_id`).
  // This block NEVER decides or names a specific award — it only ranks
  // metrics and shows a short factual reason string; HR/MD make the actual
  // call (clarified with the owner before building this round).
  const hasPerformanceAdmin = employee.capabilities.includes("performance_admin");
  type RankedRow = {
    employeeId: string;
    name: string;
    attendance: number;
    leave: number;
    workEfficiency: number;
    businessImpact?: number;
    composite: number;
    orderCount: number;
    orderValue: number;
    orderGrowthPct: number | null;
    reason: string;
  };
  let performanceRanking: RankedRow[] = [];

  if (hasPerformanceAdmin) {
    const perfPrevMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    const perfPrevMonthStart = `${perfPrevMonth.y}-${String(perfPrevMonth.m).padStart(2, "0")}-01`;
    const perfPrevMonthEnd = `${perfPrevMonth.y}-${String(perfPrevMonth.m).padStart(2, "0")}-${String(daysInMonth(perfPrevMonth.y, perfPrevMonth.m)).padStart(2, "0")}`;

    const [{ data: orderEntryRoleRows }, { data: allMonthLogs }, { data: ordersThisMonth }, { data: ordersPrevMonth }] = await Promise.all([
      supabase.from("role_capabilities").select("role_id").eq("capability_code", "order_entry"),
      dwlSupabase
        .from("daily_work_logs")
        .select("employee_id, log_date, time_spent_seconds")
        .eq("company_id", selectedCompanyId)
        .gte("log_date", monthStart)
        .lte("log_date", monthEnd)
        .not("submitted_at", "is", null),
      supabase.from("orders").select("entry_by_employee_id, order_value_usd").eq("company_id", selectedCompanyId).gte("order_date", monthStart).lte("order_date", monthEnd),
      supabase.from("orders").select("entry_by_employee_id, order_value_usd").eq("company_id", selectedCompanyId).gte("order_date", perfPrevMonthStart).lte("order_date", perfPrevMonthEnd),
    ]);

    const orderEntryRoleIds = new Set((orderEntryRoleRows ?? []).map((r) => r.role_id));

    const minutesByEmployeeDate = new Map<string, Map<string, number>>();
    for (const l of allMonthLogs ?? []) {
      if (!minutesByEmployeeDate.has(l.employee_id)) minutesByEmployeeDate.set(l.employee_id, new Map());
      const m = minutesByEmployeeDate.get(l.employee_id)!;
      const mins = Math.round((l.time_spent_seconds ?? 0) / 60);
      m.set(l.log_date, (m.get(l.log_date) ?? 0) + mins);
    }

    const orderValueByEmployee = new Map<string, number>();
    const orderCountByEmployee = new Map<string, number>();
    for (const o of ordersThisMonth ?? []) {
      orderValueByEmployee.set(o.entry_by_employee_id, (orderValueByEmployee.get(o.entry_by_employee_id) ?? 0) + (o.order_value_usd ?? 0));
      orderCountByEmployee.set(o.entry_by_employee_id, (orderCountByEmployee.get(o.entry_by_employee_id) ?? 0) + 1);
    }
    const prevOrderValueByEmployee = new Map<string, number>();
    for (const o of ordersPrevMonth ?? []) {
      prevOrderValueByEmployee.set(o.entry_by_employee_id, (prevOrderValueByEmployee.get(o.entry_by_employee_id) ?? 0) + (o.order_value_usd ?? 0));
    }
    const maxOrderValueThisMonth = Math.max(0, ...Array.from(orderValueByEmployee.values()));

    performanceRanking = teamSummary
      .map(({ employee: e, summary: s }) => {
        const isOrderEntry = orderEntryRoleIds.has(e.role_id);
        const empMinutesByDate = minutesByEmployeeDate.get(e.id) ?? new Map<string, number>();
        const verdicts: WorkHoursVerdict[] = Array.from(empMinutesByDate.values()).map((mins) => compareToExpected(mins).verdict);
        const workingDays = s.Present + s.Late + s["Half Day"];

        const attendance = attendanceScore(s);
        const leave = leaveScore(s.Leave);
        const workEfficiency = workEfficiencyScore(verdicts, workingDays);

        let businessImpact: number | undefined;
        let orderValue = 0;
        let orderCount = 0;
        let orderGrowth: number | null = null;
        if (isOrderEntry) {
          orderValue = orderValueByEmployee.get(e.id) ?? 0;
          orderCount = orderCountByEmployee.get(e.id) ?? 0;
          orderGrowth = growthPct(orderValue, prevOrderValueByEmployee.get(e.id) ?? 0);
          businessImpact = businessImpactScoreRanked(orderValue, maxOrderValueThisMonth, orderGrowth);
        }

        const components = { attendance, leave, workEfficiency, businessImpact };
        const composite = compositeScore(components);
        return {
          employeeId: e.id,
          name: e.name,
          attendance,
          leave,
          workEfficiency,
          businessImpact,
          composite,
          orderCount,
          orderValue,
          orderGrowthPct: orderGrowth,
          reason: topReasonFor({ ...components, name: e.name }),
        };
      })
      .sort((a, b) => b.composite - a.composite);
  }

  // 2026-08-12 (round 6): "admin md ko power ho ki jo employee report
  // submit kar raha hai uski har weekly report dikhe or coustome date ka
  // option ho ki kis employe ne kya kaam kiya hai kitna kaam kiya hai,
  // uski performance kya hai" — per-employee report history + time-worked
  // totals over a date range, default last 7 days, with a custom
  // From/To override. Employee dropdown is scoped to teamEmployees
  // (selectedCompanyId's team), matching every other form on this page.
  // SECURITY: only ever accept a perfEmp id that's actually in this
  // admin's own selectedCompanyId team — every other query on this page is
  // scoped to selectedCompanyId (itself validated against
  // employee.companyIds above), and this must be too, otherwise an admin
  // scoped to one company could read any other employee's full report
  // history in ANY company just by editing ?perfEmp=<uuid> in the URL.
  const teamEmployeeIds = new Set((teamEmployees ?? []).map((e) => e.id));
  const perfEmployeeIdRaw = typeof sp.perfEmp === "string" ? sp.perfEmp : "";
  const perfEmployeeId = teamEmployeeIds.has(perfEmployeeIdRaw) ? perfEmployeeIdRaw : "";
  const perfFromDefault = addDaysToDateStr(today, -6);
  const perfFrom = typeof sp.perfFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.perfFrom) ? sp.perfFrom : perfFromDefault;
  const perfTo = typeof sp.perfTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.perfTo) ? sp.perfTo : today;

  const { data: perfLogsData } = perfEmployeeId
    ? await dwlSupabase
        .from("daily_work_logs")
        .select("id, log_date, category, description, work_status, time_spent_seconds, estimated_time_minutes, submitted_at")
        .eq("employee_id", perfEmployeeId)
        .gte("log_date", perfFrom)
        .lte("log_date", perfTo)
        .not("submitted_at", "is", null)
        .order("log_date", { ascending: false })
    : { data: null };
  const perfLogs = perfLogsData ?? [];

  const perfDailyMinutes = new Map<string, number>();
  for (const l of perfLogs) {
    const mins = Math.round((l.time_spent_seconds ?? 0) / 60);
    perfDailyMinutes.set(l.log_date, (perfDailyMinutes.get(l.log_date) ?? 0) + mins);
  }
  const perfDates = Array.from(perfDailyMinutes.keys()).sort().reverse();
  const perfTotalMinutes = Array.from(perfDailyMinutes.values()).reduce((a, b) => a + b, 0);
  const perfDaysWorked = perfDates.length;
  const perfAvgMinutes = perfDaysWorked ? Math.round(perfTotalMinutes / perfDaysWorked) : 0;

  // 2026-08-11 (round 3): "task vala option isi page par show hona chahiye
  // usko alag se kyu banaya hai" — the company-wide Task Reports view (Live
  // Now + All Tasks) now renders directly on Attendance Admin instead of
  // its own /dashboard/tasks/admin route, gated on task_admin (same 3
  // roles as attendance_admin — see db/schema.sql).
  const hasTaskAdmin = employee.capabilities.includes("task_admin");
  let tasks: { id: string; website: string | null; category: string | null; priority: string; deadline: string | null; status: string; description: string; created_at: string; timer_started_at: string | null; time_spent_seconds: number; assigned_by_employee_id: string; assigned_to_employee_id: string }[] = [];
  let liveNow: { id: string; description: string; timer_started_at: string | null; time_spent_seconds: number; assigned_to_employee_id: string; company_id: string }[] = [];

  if (hasTaskAdmin) {
    // 2026-08-11 (round 5): same root cause as attendance/page.tsx — reads
    // against `tasks` must use the service-role client, not the anon
    // session client, because RLS may not have a working policy on this
    // (newer) table yet. Safe here too: already gated on hasTaskAdmin,
    // and each query keeps its own explicit company scoping.
    const taskSupabase = createServiceRoleClient();
    const [{ data: tasksData }, { data: liveNowData }] = await Promise.all([
      taskSupabase
        .from("tasks")
        .select("id, website, category, priority, deadline, status, description, created_at, timer_started_at, time_spent_seconds, assigned_by_employee_id, assigned_to_employee_id")
        .eq("company_id", selectedCompanyId)
        .order("created_at", { ascending: false })
        .limit(200),
      // Live Now — across every company this login can see, not just the
      // selected one, so a company switch never hides someone who's mid-task.
      taskSupabase
        .from("tasks")
        .select("id, description, timer_started_at, time_spent_seconds, assigned_to_employee_id, company_id")
        .in("company_id", employee.companyIds)
        .not("timer_started_at", "is", null),
    ]);
    tasks = tasksData ?? [];
    liveNow = liveNowData ?? [];

    // assignTask() allows cross-company assignment, so an "Assigned By"
    // name or a Live Now name can reference an employee outside
    // selectedCompanyId entirely — fetch whatever's missing from the
    // teamEmployees-scoped map above.
    const missingIds = Array.from(
      new Set([
        ...tasks.map((t) => t.assigned_by_employee_id),
        ...tasks.map((t) => t.assigned_to_employee_id),
        ...liveNow.map((l) => l.assigned_to_employee_id),
      ])
    ).filter((id) => !employeeName.has(id));
    if (missingIds.length) {
      const { data: extraEmployees } = await supabase.from("employees").select("id, name").in("id", missingIds);
      for (const e of extraEmployees ?? []) employeeName.set(e.id, e.name);
    }
  }

  const taskNowMs = new Date().getTime();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🗓️ Attendance Admin</h1>
        <p className="mt-1 text-sm text-slate-500">Holiday calendar, weekly off, team attendance &amp; daily work reports.</p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Company</label>
          <select name="company" defaultValue={selectedCompanyId} className={selectClass}>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Month</label>
          <input type="month" name="month" defaultValue={monthParam} className={selectClass} />
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
          View
        </button>
      </form>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Holiday Calendar — {monthParam}</h2>
          <div className="mb-3 space-y-1.5">
            {(holidays ?? []).length === 0 && <p className="text-xs text-slate-400">No holidays added for this month.</p>}
            {(holidays ?? []).map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1.5 text-xs">
                <span>
                  <span className="font-medium text-slate-800">{h.holiday_date}</span> — {h.name}
                  {h.company_id === null && <span className="ml-1 text-slate-400">(all companies)</span>}
                </span>
                <RemoveHolidayButton id={h.id} />
              </div>
            ))}
          </div>
          <HolidayForm companyId={selectedCompanyId} companies={companies ?? []} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Weekly Off — {selectedCompany?.name}</h2>
          <WeeklyOffForm companyId={selectedCompanyId} currentDays={weeklyOffDays} />
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Team Attendance Summary — {monthParam}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="py-1 pr-3">Employee</th>
                <th className="px-2">Present</th>
                <th className="px-2">Late</th>
                <th className="px-2">Half Day</th>
                <th className="px-2">Leave</th>
                <th className="px-2">Absent</th>
                <th className="px-2">Holiday</th>
                <th className="px-2">Week Off</th>
              </tr>
            </thead>
            <tbody>
              {teamSummary.map(({ employee: e, summary }) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 font-medium text-slate-800">{e.name}</td>
                  <td className="px-2 text-green-700">{summary.Present}</td>
                  <td className="px-2 text-amber-700">{summary.Late}</td>
                  <td className="px-2 text-amber-700">{summary["Half Day"]}</td>
                  <td className="px-2 text-sky-700">{summary.Leave}</td>
                  <td className="px-2 text-red-700">{summary.Absent}</td>
                  <td className="px-2 text-purple-700">{summary.Holiday}</td>
                  <td className="px-2 text-slate-500">{summary["Week Off"]}</td>
                </tr>
              ))}
              {teamSummary.length === 0 && (
                <tr><td colSpan={8} className="py-3 text-center text-slate-400">No active employees in this company.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2026-09-02: "pending work,next day carry on vala work sabhi
          employe ki sheet par dikhnae sath me admin ko bhi dikhe ki kiska
          kitna kaam baki hai" */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">🔄 Pending / Carry-Forward Work — Team</h2>
        <p className="mb-3 text-xs text-slate-500">
          Every employee&apos;s still-open (Pending / In Progress) Daily Work Report items, regardless of which day they were logged on. Click Show to see the actual list for anyone.
        </p>
        <PendingWorkPanel groups={pendingWorkGroups} />
      </div>

      {/* 2026-09-02: "achi performance walo ke liye ... msg show hone lag
          jaye ki kis ko konsa award diya ja sakta hai ... sirf admin hr md
          ko hi dikhe" — HR/MD-only (performance_admin), ranked metrics
          only, never an automatic award name (clarified + chosen by the
          owner before building this). */}
      {hasPerformanceAdmin && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">🏆 Performance &amp; Awards — Team Ranking ({monthParam})</h2>
          <p className="mb-3 text-xs text-slate-500">
            Admin/MD only. A weighted score (0-100) per employee — attendance/punctuality, leave discipline, work-report
            efficiency, and (for order-entry/sales staff only) order value &amp; growth vs. last month. Ranked so YOU can
            decide who gets what — this never names or suggests a specific award itself.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400">
                  <th className="py-1 pr-3">#</th>
                  <th className="px-2">Employee</th>
                  <th className="px-2">Attendance</th>
                  <th className="px-2">Leave</th>
                  <th className="px-2">Work Efficiency</th>
                  <th className="px-2">Order Value (Growth)</th>
                  <th className="px-2">Score</th>
                  <th className="px-2">Why they rank here</th>
                </tr>
              </thead>
              <tbody>
                {performanceRanking.map((r, i) => (
                  <tr key={r.employeeId} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 font-medium text-slate-800">{i < 3 ? "🏆" : i + 1}</td>
                    <td className="px-2 font-medium text-slate-800">{r.name}</td>
                    <td className="px-2">{r.attendance}</td>
                    <td className="px-2">{r.leave}</td>
                    <td className="px-2">{r.workEfficiency}</td>
                    <td className="px-2">
                      {r.businessImpact === undefined ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <>
                          ${r.orderValue.toFixed(0)} ({r.orderCount})
                          {r.orderGrowthPct !== null && (
                            <span className={r.orderGrowthPct >= 0 ? "ml-1 text-green-700" : "ml-1 text-red-700"}>
                              {r.orderGrowthPct >= 0 ? "+" : ""}
                              {r.orderGrowthPct.toFixed(0)}%
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-2 font-semibold text-slate-900">{r.composite}</td>
                    <td className="px-2 text-slate-500">{r.reason}</td>
                  </tr>
                ))}
                {performanceRanking.length === 0 && (
                  <tr><td colSpan={8} className="py-3 text-center text-slate-400">No active employees in this company.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Manual Correction</h2>
        <p className="mb-3 text-xs text-slate-500">Missed punch, approved leave, or a one-off half day — sets/overrides that day&apos;s status directly.</p>
        <ManualAttendanceForm companyId={selectedCompanyId} employees={teamEmployees ?? []} today={today} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Team Daily Work Log — {monthParam}</h2>
        <div className="max-h-96 space-y-1.5 overflow-y-auto">
          {(dailyLogs ?? []).length === 0 && <p className="text-xs text-slate-400">No work reports logged this month.</p>}
          {(dailyLogs ?? []).map((l) => (
            <div key={l.id} className="rounded border border-slate-100 px-2 py-1.5 text-xs">
              <span className="font-medium text-slate-800">{l.log_date}</span>
              <span className="ml-2 text-slate-500">{employeeName.get(l.employee_id) ?? "—"}</span>
              <span className="ml-2 text-slate-400">[{l.category ?? "—"}]</span>
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{l.work_status ?? "—"}</span>
              {/* 2026-09-02: "task compleate ho gaya to vo daily report me
                  employe ko to dikh jata hai lekin admin ko show nahi
                  hota" — markTaskDone() (tasks/actions.ts) already
                  auto-inserts a submitted daily_work_logs row prefixed
                  "[Task] ..." whenever an assigned Task is marked Done, so
                  it was always technically included in this same feed —
                  it just blended in with no visual signal, easy to miss.
                  This badge is the fix: make a task-completion row
                  unmistakable at a glance instead of adding a second,
                  separate feed. */}
              {l.description?.startsWith("[Task]") && (
                <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700">📋 From Task</span>
              )}
              {l.estimated_time_minutes ? (
                <span className="ml-2 text-slate-400" title="Just an estimate — never counted in any total">
                  Est {formatDuration(l.estimated_time_minutes * 60)} (not counted)
                </span>
              ) : null}
              <span className="ml-2 text-amber-700">Consumed {formatDuration(l.time_spent_seconds)}</span>
              <p className="mt-0.5 text-slate-600">{l.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 2026-08-12 (round 6): "admin md ko power ho ki jo employee report
          submit kar raha hai uski har weekly report dikhe or coustome date
          ka option ho ki kis employe ne kya kaam kiya hai kitna kaam kiya
          hai, uski performance kya hai" */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">📊 Employee Performance</h2>
        <p className="mb-3 text-xs text-slate-500">
          Pick an employee and a date range (default: last 7 days) to see submitted reports and time worked vs. expected —{" "}
          {formatHM(EXPECTED_WORK_MINUTES)}/day, based on {OFFICE_START_LABEL}–{OFFICE_END_LABEL} minus a {" "}
          30-min lunch and 15-min tea break. All time figures below (Total Time, Avg/Working Day, Time Worked) are
          built only from what the employee entered as &quot;Time Consumed&quot; on each row — Estimated Time is
          never added into these numbers.
        </p>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="company" value={selectedCompanyId} />
          <input type="hidden" name="month" value={monthParam} />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Employee</label>
            <select name="perfEmp" defaultValue={perfEmployeeId} className={selectClass}>
              <option value="">— Select —</option>
              {(teamEmployees ?? []).map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
            <input type="date" name="perfFrom" defaultValue={perfFrom} max={today} className={selectClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
            <input type="date" name="perfTo" defaultValue={perfTo} max={today} className={selectClass} />
          </div>
          <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
            View
          </button>
        </form>

        {!perfEmployeeId ? (
          <p className="text-xs text-slate-400">Select an employee to see their performance.</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-4">
              <Stat label="Reports Submitted" value={String(perfLogs.length)} />
              <Stat label="Days Worked" value={String(perfDaysWorked)} />
              <Stat label="Total Time" value={formatHM(perfTotalMinutes)} />
              <Stat label="Avg / Working Day" value={formatHM(perfAvgMinutes)} />
              <Stat label="Expected / Day" value={formatHM(EXPECTED_WORK_MINUTES)} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="py-1 pr-3">Date</th>
                    <th className="px-2">Time Worked</th>
                    <th className="px-2">Expected</th>
                    <th className="px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {perfDates.map((d) => {
                    const mins = perfDailyMinutes.get(d) ?? 0;
                    const cmp = compareToExpected(mins);
                    return (
                      <tr key={d} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3 font-medium text-slate-800">{d}</td>
                        <td className="px-2 text-amber-700">{formatHM(mins)}</td>
                        <td className="px-2 text-slate-400">{formatHM(EXPECTED_WORK_MINUTES)}</td>
                        <td className="px-2">
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${
                              cmp.verdict === "anomaly"
                                ? "bg-red-600 text-white"
                                : cmp.verdict === "short"
                                  ? "bg-red-100 text-red-700"
                                  : cmp.verdict === "on-track"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-green-100 text-green-700"
                            }`}
                          >
                            {cmp.verdict === "anomaly"
                              ? `🚨 ${formatHM(mins)} — check entries`
                              : cmp.verdict === "short"
                                ? `${formatHM(Math.abs(cmp.deltaMinutes))} short`
                                : cmp.verdict === "on-track"
                                  ? "On track"
                                  : `+${formatHM(cmp.deltaMinutes)}`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {perfDates.length === 0 && (
                    <tr><td colSpan={4} className="py-3 text-center text-slate-400">No submitted reports in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold text-slate-600">Report Details</h3>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {perfLogs.map((l) => (
                  <div key={l.id} className="rounded border border-slate-100 px-2 py-1.5 text-xs">
                    <span className="font-medium text-slate-800">{l.log_date}</span>
                    <span className="ml-2 text-slate-400">[{l.category ?? "—"}]</span>
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{l.work_status ?? "—"}</span>
                    <span className="ml-2 text-amber-700">{formatDuration(l.time_spent_seconds)}</span>
                    <p className="mt-0.5 text-slate-600">{l.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {hasTaskAdmin && (
        <div className="mt-6">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-slate-900">📊 Task Reports</h2>
            <p className="mt-1 text-sm text-slate-500">Every employee&apos;s tasks and live timers, company-wide.</p>
          </div>

          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-amber-800">🟢 Live Now</h3>
            {liveNow.length === 0 && <p className="text-xs text-amber-700/70">No one is actively timing a task right now.</p>}
            <div className="space-y-1.5">
              {liveNow.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 rounded border border-amber-100 bg-white px-2.5 py-1.5 text-xs">
                  <span className="font-medium text-slate-800">{employeeName.get(t.assigned_to_employee_id) ?? "—"}</span>
                  <span className="flex-1 truncate text-slate-600">{t.description}</span>
                  <span className="font-semibold text-amber-800">
                    {formatDuration(liveElapsedSeconds({ timeSpentSeconds: t.time_spent_seconds, timerStartedAt: t.timer_started_at }, taskNowMs))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">All Tasks — {selectedCompany?.name}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="py-1 pr-3">Assigned To</th>
                    <th className="px-2">Assigned By</th>
                    <th className="px-2">Description</th>
                    <th className="px-2">Priority</th>
                    <th className="px-2">Status</th>
                    <th className="px-2">Deadline</th>
                    <th className="px-2">Time Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-3 font-medium text-slate-800">{employeeName.get(t.assigned_to_employee_id) ?? "—"}</td>
                      <td className="px-2 text-slate-500">{employeeName.get(t.assigned_by_employee_id) ?? "—"}</td>
                      <td className="max-w-xs truncate px-2 text-slate-600">{t.description}</td>
                      <td className="px-2">{t.priority}</td>
                      <td className="px-2">{t.status}</td>
                      <td className="px-2 text-slate-500">{t.deadline ?? "—"}</td>
                      <td className="px-2 text-amber-700">
                        {formatDuration(liveElapsedSeconds({ timeSpentSeconds: t.time_spent_seconds, timerStartedAt: t.timer_started_at }, taskNowMs))}
                        {t.timer_started_at && <span className="ml-1 text-green-600">●</span>}
                      </td>
                    </tr>
                  ))}
                  {tasks.length === 0 && (
                    <tr><td colSpan={7} className="py-3 text-center text-slate-400">No tasks for this company yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
