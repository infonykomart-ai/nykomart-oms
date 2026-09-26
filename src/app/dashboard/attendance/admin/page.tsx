import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { AutoRefresh } from "@/components/auto-refresh";
import { todayIST, addDaysToDateStr, daysInMonth } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories } from "@/lib/attendance/payroll";
import { formatDuration, liveElapsedSeconds, liveElapsedSecondsForToday } from "@/lib/attendance/timer";
import { EXPECTED_WORK_MINUTES, OFFICE_START_LABEL, OFFICE_END_LABEL, formatHM, compareToExpected, type WorkHoursVerdict } from "@/lib/attendance/work-hours";
import {
  attendanceScore,
  leaveScore,
  workEfficiencyScore,
  businessImpactScoreRanked,
  compositeScore,
  growthPct,
  topReasonFor,
  taskCompletionSummary,
} from "@/lib/performance/score";
import { HolidayForm } from "./holiday-form";
import { WeeklyOffForm } from "./weekly-off-form";
import { ManualAttendanceForm } from "./manual-attendance-form";
import { RemoveHolidayButton } from "./remove-holiday-button";
import { PendingWorkPanel, type PendingWorkGroup } from "./pending-work-panel";
import { WorkPlanTemplatesPanel, type WorkPlanTemplateRow } from "./work-plan-templates-panel";
import {
  Panel,
  StatTile,
  StatRow,
  Pill,
  PRIORITY_TONE,
  TASK_STATUS_TONE,
  tableWrapClass,
  tableClass,
  theadRowClass,
  thClass,
  tbodyRowClass,
  tdClass,
  numTdClass,
  emptyRowClass,
} from "./dashboard-ui";

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

  const [{ data: teamEmployees }, { data: attendanceRows }, { data: holidays }, { data: dailyLogs }, { data: pendingWorkRows }, { data: completionRows }, { data: roles }, { data: roleTemplates }] = await Promise.all([
    supabase.from("employees").select("id, name, date_of_joining, role_id").eq("company_id", selectedCompanyId).eq("active", true).order("name"),
    supabase.from("attendance").select("employee_id, attendance_date, status").eq("company_id", selectedCompanyId).gte("attendance_date", monthStart).lte("attendance_date", monthEnd),
    supabase.from("holidays").select("id, holiday_date, name, company_id").or(`company_id.eq.${selectedCompanyId},company_id.is.null`).gte("holiday_date", monthStart).lte("holiday_date", monthEnd).order("holiday_date"),
    // 2026-08-11 (round 3): "md admin ke page par show ho jaye" — only
    // rows that have actually been submitted show here, not drafts still
    // being typed. See daily_work_logs.submitted_at.
    dwlSupabase
      .from("daily_work_logs")
      .select("id, log_date, employee_id, category, description, work_status, submitted_at, time_spent_seconds, estimated_time_minutes, source_template_id")
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
    // 2026-09-04: "kitna kaam kiya hai kitna nahi" — Task Completion Rate
    // panel below. Deliberately its OWN uncapped query (not a reuse of
    // `dailyLogs` above, which is `.limit(200)`-capped for the Team Daily
    // Work Log display) — the same reasoning as the UNCAPPED `allMonthLogs`
    // query further down for performance ranking: a capped read would
    // silently under-count a busy team/month here too. Scoped to the same
    // selectedCompanyId/monthStart/monthEnd as every other query on this
    // page, submitted rows only (drafts still being typed shouldn't count
    // against/for anyone).
    dwlSupabase
      .from("daily_work_logs")
      .select("employee_id, work_status, target_qty, qty_done")
      .eq("company_id", selectedCompanyId)
      .gte("log_date", monthStart)
      .lte("log_date", monthEnd)
      .not("submitted_at", "is", null),
    // 2026-09-04 — Daily Work Planner: every role name, for the template
    // form's role dropdown.
    supabase.from("roles").select("id, name").order("name"),
    // 2026-09-04 — Daily Work Planner: every role-scope template (active
    // AND inactive — inactive ones still show in the panel, greyed out,
    // so Admin can Reactivate rather than having to re-type it) for the
    // currently selected company. Service-role read (dwlSupabase), same
    // "writes go via service role, so reads must too" reasoning as every
    // other daily_work_logs-adjacent query on this page.
    dwlSupabase
      .from("work_plan_templates")
      .select("id, role_name, category, description, target_qty, sort_order, active")
      .eq("company_id", selectedCompanyId)
      .eq("scope", "role")
      .order("role_name")
      .order("sort_order"),
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

  // 2026-09-04 — Daily Work Planner: role templates for WorkPlanTemplatesPanel.
  const workPlanTemplateRows: WorkPlanTemplateRow[] = (roleTemplates ?? []).map((t) => ({
    id: t.id,
    roleName: t.role_name ?? "—",
    category: t.category,
    description: t.description,
    targetQty: t.target_qty,
    sortOrder: t.sort_order,
    active: t.active,
  }));
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

  // 2026-09-04: Task Completion Rate — Team. Admin-only (gated by the same
  // attendance_admin capability as the rest of this page, not the more
  // restrictive performance_admin — this is raw completion data, not a
  // ranked/scored judgement of anyone). See taskCompletionSummary's doc
  // comment (score.ts) for why both the task-count % and the qty-based %
  // are always shown together.
  const completionLogsByEmployee = new Map<string, { work_status: string | null; target_qty: string | null; qty_done: string | null }[]>();
  for (const r of completionRows ?? []) {
    if (!completionLogsByEmployee.has(r.employee_id)) completionLogsByEmployee.set(r.employee_id, []);
    completionLogsByEmployee.get(r.employee_id)!.push(r);
  }
  const teamCompletion = teamSummary.map(({ employee: e }) => ({
    employeeId: e.id,
    name: e.name,
    ...taskCompletionSummary(completionLogsByEmployee.get(e.id) ?? []),
  }));

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

  // 2026-09-02 (round 3): "jis employe ko jo store allot hai uske according
  // banadena tha" — same Store Access reuse as the employee self-view (see
  // attendance/page.tsx's matching comment for the full rationale and the
  // 3 things clarified with the owner before building this: separate panel
  // from the ranking table above, store assignment done via the existing
  // Store Access UI, and a shared store shows its FULL cost to every
  // assigned employee with a note rather than a guessed split).
  type StoreCostRow = { employeeId: string; name: string; stores: { storeId: string; storeName: string; cost: number; value: number; sharedWithCount: number }[] };
  let storeCostRows: StoreCostRow[] = [];

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

    // Store Cost vs Order Value — scoped to this company's stores and this
    // company's active team (teamEmployees), same monthStart/monthEnd as
    // the ranking above. See the header comment above `storeCostRows` for
    // why this is a separate computation from businessImpact/orderValue.
    const { data: companyStores } = await supabase.from("stores").select("id, name").eq("company_id", selectedCompanyId);
    const companyStoreIds = (companyStores ?? []).map((s) => s.id);
    if (companyStoreIds.length > 0) {
      const [{ data: allStoreAccess }, { data: allStoreSpend }, { data: allStoreOrders }] = await Promise.all([
        supabase.from("employee_store_access").select("employee_id, store_id").in("store_id", companyStoreIds),
        supabase.from("store_ad_spend").select("store_id, spend_usd").in("store_id", companyStoreIds).gte("spend_date", monthStart).lte("spend_date", monthEnd),
        supabase.from("orders").select("store_id, order_value_usd").eq("company_id", selectedCompanyId).in("store_id", companyStoreIds).gte("order_date", monthStart).lte("order_date", monthEnd),
      ]);
      const storeNameById = new Map((companyStores ?? []).map((s) => [s.id, s.name as string]));
      const costByStore = new Map<string, number>();
      for (const r of allStoreSpend ?? []) costByStore.set(r.store_id, (costByStore.get(r.store_id) ?? 0) + (r.spend_usd ?? 0));
      const valueByStore = new Map<string, number>();
      for (const r of allStoreOrders ?? []) valueByStore.set(r.store_id, (valueByStore.get(r.store_id) ?? 0) + (r.order_value_usd ?? 0));
      const accessCountByStore = new Map<string, number>();
      const storeIdsByEmployee = new Map<string, string[]>();
      const activeTeamEmployeeIds = new Set(teamSummary.map(({ employee: e }) => e.id));
      for (const r of allStoreAccess ?? []) {
        accessCountByStore.set(r.store_id, (accessCountByStore.get(r.store_id) ?? 0) + 1);
        if (!activeTeamEmployeeIds.has(r.employee_id)) continue; // only this company's active team
        if (!storeIdsByEmployee.has(r.employee_id)) storeIdsByEmployee.set(r.employee_id, []);
        storeIdsByEmployee.get(r.employee_id)!.push(r.store_id);
      }
      const employeeNameById = new Map(teamSummary.map(({ employee: e }) => [e.id, e.name]));
      storeCostRows = Array.from(storeIdsByEmployee.entries()).map(([employeeId, storeIds]) => ({
        employeeId,
        name: employeeNameById.get(employeeId) ?? "Unknown",
        stores: storeIds.map((id) => ({
          storeId: id,
          storeName: storeNameById.get(id) ?? "Unknown store",
          cost: costByStore.get(id) ?? 0,
          value: valueByStore.get(id) ?? 0,
          sharedWithCount: Math.max(0, (accessCountByStore.get(id) ?? 1) - 1),
        })),
      }));
    }
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

  // 2026-09-26 — "6h17m + 30m00s + 1h34m yaha 8h21m banta hai lekin Time
  // Worked 8h22m dikha raha hai": this used to round EACH report's
  // time_spent_seconds to the nearest minute individually
  // (Math.round(seconds/60)) and THEN sum those rounded minutes per day.
  // formatDuration() (used for each row in "Report Details" below) instead
  // FLOORS seconds for display when hours/minutes are shown. A row whose
  // real duration was e.g. 6:17:35 therefore displayed as "6h 17m" (floor)
  // but contributed a rounded-up 378 minutes (6h18m-worth) to this day's
  // total — a silent 1-minute drift per row with a >=30s remainder, and it
  // compounds with more rows. Fix: sum the RAW seconds for each day first,
  // and round only once, at the very end, per day — matching how a human
  // adding up the row durations by hand would actually compute it.
  const perfDailySeconds = new Map<string, number>();
  for (const l of perfLogs) {
    perfDailySeconds.set(l.log_date, (perfDailySeconds.get(l.log_date) ?? 0) + (l.time_spent_seconds ?? 0));
  }
  const perfDailyMinutes = new Map<string, number>(
    Array.from(perfDailySeconds, ([date, secs]) => [date, Math.round(secs / 60)])
  );
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
  // 2026-09-26 — Employee Performance "Pending" section: "agar task
  // compleate nahi hua to vo work sheet me nahi aata, report pending show
  // honi chahiye" — markTaskDone() only writes a daily_work_logs row once
  // a task reaches Done (see actions.ts), so a still-open (Pending/In
  // Progress) assigned task was previously invisible on this whole page
  // until finished. This is that gap filled: a live snapshot of the
  // selected employee's own not-yet-Done tasks, so admin can see committed
  // time-so-far before it's finalized — same time_spent_seconds/
  // timer_started_at numbers already shown on Live Now/All Tasks below,
  // just filtered to one person. Deliberately never mixed into
  // perfTotalMinutes/perfAvgMinutes above — only a Done task's finalized
  // time counts there, same "Estimated Time never counted" rule already
  // stated on this panel.
  let perfPendingTasks: { id: string; description: string; category: string | null; priority: string; status: string; deadline: string | null; timer_started_at: string | null; time_spent_seconds: number }[] = [];
  // 2026-09-09 — today's (IST) committed task_daily_time_log seconds per
  // task id, keyed the same way as attendance/page.tsx's own
  // todaySecondsByTaskId — covers both the "All Tasks" table (selected
  // company) and "Live Now" (all companies this login can see).
  const todaySecondsByTaskId = new Map<string, number>();

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

    // 2026-09-09 — same "how much today, separate from lifetime total"
    // breakdown as the employee's own "My Tasks" view, now for admins too.
    // Genuinely dependent on tasks/liveNow's ids resolving first (same
    // "Promise.all only for independent queries" convention as elsewhere).
    const allTaskIds = Array.from(new Set([...tasks.map((t) => t.id), ...liveNow.map((l) => l.id)]));
    if (allTaskIds.length) {
      const { data: todayRows } = await taskSupabase
        .from("task_daily_time_log")
        .select("task_id, seconds_spent")
        .in("task_id", allTaskIds)
        .eq("log_date", todayIST());
      for (const r of todayRows ?? []) todaySecondsByTaskId.set(r.task_id, r.seconds_spent);
    }

    if (perfEmployeeId) {
      const { data: pendingTasksData } = await taskSupabase
        .from("tasks")
        .select("id, description, category, priority, status, deadline, timer_started_at, time_spent_seconds")
        .eq("assigned_to_employee_id", perfEmployeeId)
        .neq("status", "Done")
        .order("created_at", { ascending: false });
      perfPendingTasks = pendingTasksData ?? [];
    }
  }

  const taskNowMs = new Date().getTime();

  return (
    <div>
      {/* 2026-09-10 — near-live data sync (see src/components/auto-refresh.tsx). */}
      <AutoRefresh intervalMs={15000} />

      {/* 2026-09-26 — "UI professional bano jese fedex ups dhl me chalta
          hai": one dark title bar anchors the page the way a courier
          back-office console opens on a company/scope banner, instead of a
          bare page heading. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-lg">🗓️</span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Attendance Admin</h1>
            <p className="text-xs text-slate-300">
              {selectedCompany?.name ?? "—"} <span className="mx-1 text-slate-500">·</span> {monthParam}
            </p>
          </div>
        </div>
        {/* 2026-09-23 — "apne oms me bhi to chahiye na report": Month
            Summary/IN-OUT/Absent/Late In/Early In-Out/Overtime/Half Day/
            Mis Punch reports, filterable by company/employee, exportable
            to PDF/Excel/Word — see monthly-report/page.tsx. */}
        <Link
          href="/dashboard/attendance/admin/monthly-report"
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-400"
        >
          📊 Monthly Report
        </Link>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Company</label>
          <select name="company" defaultValue={selectedCompanyId} className={selectClass}>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Month</label>
          <input type="month" name="month" defaultValue={monthParam} className={selectClass} />
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600">
          View
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel icon="🎉" title={`Holiday Calendar — ${monthParam}`}>
          <div className="mb-3 space-y-1.5">
            {(holidays ?? []).length === 0 && <p className="text-xs text-slate-400">No holidays added for this month.</p>}
            {(holidays ?? []).map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs">
                <span>
                  <span className="font-medium text-slate-800">{h.holiday_date}</span> — {h.name}
                  {h.company_id === null && <span className="ml-1 text-slate-400">(all companies)</span>}
                </span>
                <RemoveHolidayButton id={h.id} />
              </div>
            ))}
          </div>
          <HolidayForm companyId={selectedCompanyId} companies={companies ?? []} />
        </Panel>

        <Panel icon="🛌" title={`Weekly Off — ${selectedCompany?.name}`}>
          <WeeklyOffForm companyId={selectedCompanyId} currentDays={weeklyOffDays} />
        </Panel>
      </div>

      {/* 2026-09-04 — Daily Work Planner: per-ROLE fixed/recurring
          templates. Materialized automatically into every matching-role
          employee's Today's Work each day (badged "🗂️ Template") — on top
          of whatever personal recurring items that employee has ALSO
          added themselves (self-managed, own attendance page). */}
      <Panel
        icon="🗂️"
        title={`Daily Work Planner — Fixed Items by Role (${selectedCompany?.name})`}
        description="Set a baseline list of work items every employee in a role should see automatically each day, without re-typing it — they still show up as normal Today's Work rows (editable, completable, carry-forward-able), just badged so it's clear where they came from. Each employee can also add their own personal recurring items on top, from their own Attendance page."
      >
        <WorkPlanTemplatesPanel companyId={selectedCompanyId} roles={roles ?? []} templates={workPlanTemplateRows} />
      </Panel>

      <Panel icon="📋" title={`Team Attendance Summary — ${monthParam}`} bodyClassName="p-0">
        <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead>
              <tr className={theadRowClass}>
                <th className={thClass}>Employee</th>
                <th className={thClass}>Present</th>
                <th className={thClass}>Late</th>
                <th className={thClass}>Half Day</th>
                <th className={thClass}>Leave</th>
                <th className={thClass}>Absent</th>
                <th className={thClass}>Holiday</th>
                <th className={thClass}>Week Off</th>
              </tr>
            </thead>
            <tbody>
              {teamSummary.map(({ employee: e, summary }) => (
                <tr key={e.id} className={tbodyRowClass}>
                  <td className={`${tdClass} font-medium text-slate-800`}>{e.name}</td>
                  <td className={numTdClass}><Pill tone="green">{summary.Present}</Pill></td>
                  <td className={numTdClass}><Pill tone="amber">{summary.Late}</Pill></td>
                  <td className={numTdClass}><Pill tone="amber">{summary["Half Day"]}</Pill></td>
                  <td className={numTdClass}><Pill tone="sky">{summary.Leave}</Pill></td>
                  <td className={numTdClass}><Pill tone="red">{summary.Absent}</Pill></td>
                  <td className={numTdClass}><Pill tone="purple">{summary.Holiday}</Pill></td>
                  <td className={numTdClass}><Pill tone="slate">{summary["Week Off"]}</Pill></td>
                </tr>
              ))}
              {teamSummary.length === 0 && (
                <tr><td colSpan={8} className={emptyRowClass}>No active employees in this company.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* 2026-09-02: "pending work,next day carry on vala work sabhi
          employe ki sheet par dikhnae sath me admin ko bhi dikhe ki kiska
          kitna kaam baki hai" */}
      <Panel
        icon="🔄"
        title="Pending / Carry-Forward Work — Team"
        description="Every employee's still-open (Pending / In Progress) Daily Work Report items, regardless of which day they were logged on. Click Show to see the actual list for anyone."
      >
        <PendingWorkPanel groups={pendingWorkGroups} />
      </Panel>

      {/* 2026-09-02: "achi performance walo ke liye ... msg show hone lag
          jaye ki kis ko konsa award diya ja sakta hai ... sirf admin hr md
          ko hi dikhe" — HR/MD-only (performance_admin), ranked metrics
          only, never an automatic award name (clarified + chosen by the
          owner before building this). */}
      {hasPerformanceAdmin && (
        <Panel
          icon="🏆"
          tone="accent"
          title={`Performance & Awards — Team Ranking (${monthParam})`}
          description="Admin/MD only. A weighted score (0-100) per employee — attendance/punctuality, leave discipline, work-report efficiency, and (for order-entry/sales staff only) order value & growth vs. last month. Ranked so YOU can decide who gets what — this never names or suggests a specific award itself."
          bodyClassName="p-0"
        >
          <div className={tableWrapClass}>
            <table className={tableClass}>
              <thead>
                <tr className={theadRowClass}>
                  <th className={thClass}>#</th>
                  <th className={thClass}>Employee</th>
                  <th className={thClass}>Attendance</th>
                  <th className={thClass}>Leave</th>
                  <th className={thClass}>Work Efficiency</th>
                  <th className={thClass}>Order Value (Growth)</th>
                  <th className={thClass}>Score</th>
                  <th className={thClass}>Why they rank here</th>
                </tr>
              </thead>
              <tbody>
                {performanceRanking.map((r, i) => (
                  <tr key={r.employeeId} className={tbodyRowClass}>
                    <td className={`${tdClass} font-medium text-slate-800`}>{i < 3 ? "🏆" : i + 1}</td>
                    <td className={`${tdClass} font-medium text-slate-800`}>{r.name}</td>
                    <td className={numTdClass}>{r.attendance}</td>
                    <td className={numTdClass}>{r.leave}</td>
                    <td className={numTdClass}>{r.workEfficiency}</td>
                    <td className={numTdClass}>
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
                    <td className={`${numTdClass} font-semibold text-slate-900`}>{r.composite}</td>
                    <td className={`${tdClass} text-slate-500`}>{r.reason}</td>
                  </tr>
                ))}
                {performanceRanking.length === 0 && (
                  <tr><td colSpan={8} className={emptyRowClass}>No active employees in this company.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* 2026-09-02 (round 3): "jis employe ko jo store allot hai uske
          according banadena tha" — cost vs. value per employee, for
          whichever store(s) each has assigned via Store Access. Same
          performance_admin gate as the ranking table above; only lists
          employees who actually have >=1 store assigned. */}
      {hasPerformanceAdmin && storeCostRows.length > 0 && (
        <Panel
          icon="💰"
          tone="accent"
          title={`Store Cost vs Order Value — ${monthParam}`}
          description="Ad spend vs. order value for each employee's assigned store(s) (Admin > Employees > Store Access). A store shared by more than one employee shows its full cost/value to each of them, flagged below — not split."
        >
          <div className="flex flex-col gap-3">
            {storeCostRows.map((row) => (
              <div key={row.employeeId} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div className="mb-1.5 text-sm font-medium text-slate-800">{row.name}</div>
                <div className="flex flex-col gap-1.5">
                  {row.stores.map((s) => (
                    <div key={s.storeId} className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">{s.storeName}</span>
                      <span className="tabular-nums">Ad Spend: ${s.cost.toFixed(0)}</span>
                      <span className="tabular-nums">Order Value: ${s.value.toFixed(0)}</span>
                      <span>
                        {s.cost > 0
                          ? `${(s.value / s.cost).toFixed(2)}x value per $ spent`
                          : s.value > 0
                            ? "No ad spend logged"
                            : "No ad spend or orders logged"}
                      </span>
                      {s.sharedWithCount > 0 && (
                        <Pill tone="amber">
                          Shared with {s.sharedWithCount} other{s.sharedWithCount > 1 ? "s" : ""}
                        </Pill>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        icon="✍️"
        title="Manual Correction"
        description="Missed punch, approved leave, or a one-off half day — sets/overrides that day's status directly."
      >
        <ManualAttendanceForm companyId={selectedCompanyId} employees={teamEmployees ?? []} today={today} />
      </Panel>

      <Panel icon="🧾" title={`Team Daily Work Log — ${monthParam}`}>
        <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
          {(dailyLogs ?? []).length === 0 && <p className="text-xs text-slate-400">No work reports logged this month.</p>}
          {(dailyLogs ?? []).map((l) => (
            <div key={l.id} className="rounded-lg border border-slate-100 px-3 py-2 text-xs transition hover:border-slate-200 hover:bg-slate-50/60">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{l.log_date}</span>
                <span className="text-slate-500">{employeeName.get(l.employee_id) ?? "—"}</span>
                <span className="text-slate-400">[{l.category ?? "—"}]</span>
                <Pill tone="slate">{l.work_status ?? "—"}</Pill>
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
                {l.description?.startsWith("[Task]") && <Pill tone="purple">📋 From Task</Pill>}
                {/* 2026-09-04 — Daily Work Planner: same "make the source
                    unmistakable at a glance" convention as the "From Task"
                    badge above, for a row auto-materialized from a fixed
                    role/personal template (see source_template_id). */}
                {l.source_template_id && <Pill tone="sky">🗂️ Template</Pill>}
                {l.estimated_time_minutes ? (
                  <span className="text-slate-400" title="Just an estimate — never counted in any total">
                    Est {formatDuration(l.estimated_time_minutes * 60)} (not counted)
                  </span>
                ) : null}
                <span className="font-medium tabular-nums text-amber-700">Consumed {formatDuration(l.time_spent_seconds)}</span>
              </div>
              <p className="mt-1 text-slate-600">{l.description}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* 2026-09-04: "kitna kaam kiya hai kitna nahi" — how much of the
          logged work actually got DONE, per employee, for the same
          Company/Month selected at the top of this page. Two numbers on
          purpose: task-count % (how many logged items are Completed) and
          qty-based % (sum qty_done / sum target_qty — weights bigger jobs
          more than small ones). See taskCompletionSummary in score.ts. */}
      <Panel
        icon="✅"
        title={`Task Completion Rate — Team (${monthParam})`}
        description={
          <>
            Of the Daily Work Report items each employee submitted this month: how many are marked Completed
            (task-count %), and how much of the committed quantity actually got done (qty-based %, sum of Qty Done ÷
            sum of Target Qty). &quot;—&quot; means there&apos;s nothing to calculate that % from yet (no reports, or no
            numeric target entered on any of them).
          </>
        }
        bodyClassName="p-0"
      >
        <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead>
              <tr className={theadRowClass}>
                <th className={thClass}>Employee</th>
                <th className={thClass}>Tasks Completed</th>
                <th className={thClass}>Task-Count %</th>
                <th className={thClass}>Qty Done / Target</th>
                <th className={thClass}>Qty %</th>
              </tr>
            </thead>
            <tbody>
              {teamCompletion.map((r) => (
                <tr key={r.employeeId} className={tbodyRowClass}>
                  <td className={`${tdClass} font-medium text-slate-800`}>{r.name}</td>
                  <td className={numTdClass}>
                    {r.completedTasks}/{r.totalTasks} done
                  </td>
                  <td className={`${numTdClass} font-semibold text-slate-900`}>
                    {r.taskCompletionPct === null ? <span className="text-slate-300">—</span> : `${r.taskCompletionPct}%`}
                  </td>
                  <td className={numTdClass}>
                    {r.qtySum} / {r.targetSum}
                  </td>
                  <td className={`${numTdClass} font-semibold text-slate-900`}>
                    {r.qtyCompletionPct === null ? <span className="text-slate-300">—</span> : `${r.qtyCompletionPct}%`}
                  </td>
                </tr>
              ))}
              {teamCompletion.length === 0 && (
                <tr><td colSpan={5} className={emptyRowClass}>No active employees in this company.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* 2026-08-12 (round 6): "admin md ko power ho ki jo employee report
          submit kar raha hai uski har weekly report dikhe or coustome date
          ka option ho ki kis employe ne kya kaam kiya hai kitna kaam kiya
          hai, uski performance kya hai" */}
      <Panel
        icon="📊"
        title="Employee Performance"
        description={
          <>
            Pick an employee and a date range (default: last 7 days) to see submitted reports and time worked vs.
            expected — {formatHM(EXPECTED_WORK_MINUTES)}/day, based on {OFFICE_START_LABEL}–{OFFICE_END_LABEL} minus a
            30-min lunch and 15-min tea break. All time figures below (Total Time, Avg/Working Day, Time Worked) are
            built only from what the employee entered as &quot;Time Consumed&quot; on each row — Estimated Time is
            never added into these numbers, and neither is any not-yet-Done task&apos;s time (see Pending Tasks below).
          </>
        }
      >
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
          <input type="hidden" name="company" value={selectedCompanyId} />
          <input type="hidden" name="month" value={monthParam} />
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Employee</label>
            <select name="perfEmp" defaultValue={perfEmployeeId} className={selectClass}>
              <option value="">— Select —</option>
              {(teamEmployees ?? []).map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">From</label>
            <input type="date" name="perfFrom" defaultValue={perfFrom} max={today} className={selectClass} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">To</label>
            <input type="date" name="perfTo" defaultValue={perfTo} max={today} className={selectClass} />
          </div>
          <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600">
            View
          </button>
        </form>

        {!perfEmployeeId ? (
          <p className="text-xs text-slate-400">Select an employee to see their performance.</p>
        ) : (
          <>
            <StatRow>
              <StatTile label="Reports Submitted" value={String(perfLogs.length)} />
              <StatTile label="Days Worked" value={String(perfDaysWorked)} />
              <StatTile label="Total Time" value={formatHM(perfTotalMinutes)} />
              <StatTile label="Avg / Working Day" value={formatHM(perfAvgMinutes)} />
              <StatTile label="Expected / Day" value={formatHM(EXPECTED_WORK_MINUTES)} />
            </StatRow>
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead>
                  <tr className={theadRowClass}>
                    <th className={thClass}>Date</th>
                    <th className={thClass}>Time Worked</th>
                    <th className={thClass}>Expected</th>
                    <th className={thClass}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {perfDates.map((d) => {
                    const mins = perfDailyMinutes.get(d) ?? 0;
                    const cmp = compareToExpected(mins);
                    return (
                      <tr key={d} className={tbodyRowClass}>
                        <td className={`${tdClass} font-medium text-slate-800`}>{d}</td>
                        <td className={`${numTdClass} font-medium text-amber-700`}>{formatHM(mins)}</td>
                        <td className={`${numTdClass} text-slate-400`}>{formatHM(EXPECTED_WORK_MINUTES)}</td>
                        <td className={tdClass}>
                          <Pill
                            tone={
                              cmp.verdict === "anomaly"
                                ? "redSolid"
                                : cmp.verdict === "short"
                                  ? "red"
                                  : cmp.verdict === "on-track"
                                    ? "amber"
                                    : "green"
                            }
                          >
                            {cmp.verdict === "anomaly"
                              ? `🚨 ${formatHM(mins)} — check entries`
                              : cmp.verdict === "short"
                                ? `${formatHM(Math.abs(cmp.deltaMinutes))} short`
                                : cmp.verdict === "on-track"
                                  ? "On track"
                                  : `+${formatHM(cmp.deltaMinutes)}`}
                          </Pill>
                        </td>
                      </tr>
                    );
                  })}
                  {perfDates.length === 0 && (
                    <tr><td colSpan={4} className={emptyRowClass}>No submitted reports in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Report Details</h3>
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {perfLogs.map((l) => (
                  <div key={l.id} className="rounded-lg border border-slate-100 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-800">{l.log_date}</span>
                      <span className="text-slate-400">[{l.category ?? "—"}]</span>
                      <Pill tone="green">{l.work_status ?? "—"}</Pill>
                      <span className="font-medium tabular-nums text-amber-700">{formatDuration(l.time_spent_seconds)}</span>
                    </div>
                    <p className="mt-1 text-slate-600">{l.description}</p>
                  </div>
                ))}
                {perfLogs.length === 0 && <p className="text-xs text-slate-400">Nothing submitted in this range yet.</p>}
              </div>
            </div>

            {/* 2026-09-26 — "task compleate nahi hua to report pending show
                honi chahiye": tasks assigned to this employee that are NOT
                yet Done — see the perfPendingTasks query above for the
                full rationale. Kept visually and numerically separate from
                Report Details above: this time is live and can still
                change, so it never feeds Total Time/Avg. */}
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Pending / In-Progress Tasks
                <span className="ml-1 font-normal normal-case text-slate-400">— not yet Done, time shown here isn&apos;t counted above</span>
              </h3>
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {perfPendingTasks.map((t) => (
                  <div key={t.id} className="rounded-lg border border-dashed border-amber-200 bg-amber-50/40 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={TASK_STATUS_TONE[t.status] ?? "slate"}>
                        {t.status}
                        {t.timer_started_at && <span className="text-green-600">●</span>}
                      </Pill>
                      {t.category && <span className="text-slate-400">[{t.category}]</span>}
                      <Pill tone={PRIORITY_TONE[t.priority] ?? "slate"}>{t.priority}</Pill>
                      {t.deadline && <span className="text-slate-400">Due {t.deadline}</span>}
                      <span className="font-medium tabular-nums text-amber-700">
                        {formatDuration(liveElapsedSeconds({ timeSpentSeconds: t.time_spent_seconds, timerStartedAt: t.timer_started_at }, taskNowMs))} so far
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600">{t.description}</p>
                  </div>
                ))}
                {perfPendingTasks.length === 0 && (
                  <p className="text-xs text-slate-400">No open (Pending / In Progress) tasks assigned to this employee right now.</p>
                )}
              </div>
            </div>
          </>
        )}
      </Panel>

      {hasTaskAdmin && (
        <>
          <Panel
            icon="🟢"
            tone="accent"
            title="Live Now"
            description="Everyone actively timing a task right now, across every company this login can see."
          >
            {liveNow.length === 0 && <p className="text-xs text-slate-400">No one is actively timing a task right now.</p>}
            <div className="space-y-1.5">
              {liveNow.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs">
                  <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-500" />
                  <span className="font-medium text-slate-800">{employeeName.get(t.assigned_to_employee_id) ?? "—"}</span>
                  <span className="flex-1 truncate text-slate-600">{t.description}</span>
                  <Pill tone="sky">
                    Today {formatDuration(liveElapsedSecondsForToday({ timerStartedAt: t.timer_started_at }, todaySecondsByTaskId.get(t.id) ?? 0, taskNowMs))}
                  </Pill>
                  <span className="font-semibold tabular-nums text-amber-800" title="Total time spent on this task across all days">
                    Total {formatDuration(liveElapsedSeconds({ timeSpentSeconds: t.time_spent_seconds, timerStartedAt: t.timer_started_at }, taskNowMs))}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel icon="🗒️" title={`All Tasks — ${selectedCompany?.name}`} bodyClassName="p-0">
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead>
                  <tr className={theadRowClass}>
                    <th className={thClass}>Assigned To</th>
                    <th className={thClass}>Assigned By</th>
                    <th className={thClass}>Description</th>
                    <th className={thClass}>Priority</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Deadline</th>
                    <th className={thClass}>Today</th>
                    <th className={thClass}>Total Time</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className={tbodyRowClass}>
                      <td className={`${tdClass} font-medium text-slate-800`}>{employeeName.get(t.assigned_to_employee_id) ?? "—"}</td>
                      <td className={`${tdClass} text-slate-500`}>{employeeName.get(t.assigned_by_employee_id) ?? "—"}</td>
                      <td className={`${tdClass} max-w-xs truncate text-slate-600`}>{t.description}</td>
                      <td className={tdClass}><Pill tone={PRIORITY_TONE[t.priority] ?? "slate"}>{t.priority}</Pill></td>
                      <td className={tdClass}><Pill tone={TASK_STATUS_TONE[t.status] ?? "slate"}>{t.status}</Pill></td>
                      <td className={`${tdClass} text-slate-500`}>{t.deadline ?? "—"}</td>
                      <td className={`${numTdClass} text-sky-700`}>
                        {formatDuration(liveElapsedSecondsForToday({ timerStartedAt: t.timer_started_at }, todaySecondsByTaskId.get(t.id) ?? 0, taskNowMs))}
                      </td>
                      <td className={`${numTdClass} text-amber-700`}>
                        {formatDuration(liveElapsedSeconds({ timeSpentSeconds: t.time_spent_seconds, timerStartedAt: t.timer_started_at }, taskNowMs))}
                        {t.timer_started_at && <span className="ml-1 text-green-600">●</span>}
                      </td>
                    </tr>
                  ))}
                  {tasks.length === 0 && (
                    <tr><td colSpan={8} className={emptyRowClass}>No tasks for this company yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
