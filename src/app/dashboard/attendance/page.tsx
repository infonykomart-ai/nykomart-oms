import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST, addDaysToDateStr, daysInMonth } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories, type DayCategory } from "@/lib/attendance/payroll";
import { carryOverPendingDailyLogs } from "@/lib/attendance/carry-over";
import { materializeWorkPlanTemplatesForToday } from "@/lib/attendance/work-plan-templates";
import { formatDuration } from "@/lib/attendance/timer";
import { EXPECTED_WORK_MINUTES, ANOMALY_THRESHOLD_MINUTES, OFFICE_START_LABEL, OFFICE_END_LABEL, formatHM, compareToExpected, type WorkHoursVerdict } from "@/lib/attendance/work-hours";
import {
  attendanceScore,
  leaveScore,
  workEfficiencyScore,
  businessImpactScoreSelf,
  compositeScore,
  growthPct,
} from "@/lib/performance/score";
import { PunchButtons } from "./punch-buttons";
import { DailyReportForm } from "./daily-report-form";
import { RecentReportsList } from "./recent-reports-list";
import { IncompleteWorkSection, type IncompleteLogRow } from "./incomplete-work-section";
import { MyRecurringWorkForm, type MyRecurringItemRow } from "./my-recurring-work-form";
import { AssignTaskForm } from "../tasks/assign-task-form";
import { TaskList, type TaskRow } from "../tasks/task-list";
import { AssignedByMeList, type AssignedTaskRow } from "../tasks/assigned-by-me-list";

const CATEGORY_BADGE: Record<DayCategory, string> = {
  Present: "bg-green-100 text-green-700",
  Late: "bg-amber-100 text-amber-700",
  "Half Day": "bg-amber-100 text-amber-700",
  Leave: "bg-sky-100 text-sky-700",
  Absent: "bg-red-100 text-red-700",
  Holiday: "bg-purple-100 text-purple-700",
  "Week Off": "bg-slate-100 text-slate-500",
  Future: "bg-slate-50 text-slate-300",
};

// 2026-08-11: "PERSENT/APSENT SELLERY STRACTURE HOLYDAY ... LOGIN KARTE HI
// PERSENT LAG JAYE ... EK REPORT KA SYSTEM BHI BANANA HAI". Attendance is
// auto-punched at login/logout (see src/lib/attendance/punch.ts + the login
// action + LogoutButton) — this page is the employee's own view: today's
// status with a manual backup button, this month's day-by-day record, and
// the Daily Work Report (auto-sync as you type, see daily-report-form.tsx).
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("attendance_punch");
  const supabase = await createClient();
  // 2026-08-12 (round 6): "submit ki report submit dikha raha hai lekin
  // admin panal me nahi dikh rahi, logout kar ke vaps login kar rahe to
  // vo report hat ja rahi" — ROOT CAUSE: same class of bug as the task
  // list (round 5). upsertDailyLog/submitDailyLog write via the
  // SERVICE ROLE client (bypasses RLS), but this page was reading
  // daily_work_logs via the anon/session client (subject to RLS) — a
  // fresh reload (a real logout+login, not just stale client cache) hits
  // whatever RLS state daily_work_logs actually has, and if it doesn't
  // have a working allow-policy the read silently comes back empty even
  // though the row is really there. Reading daily_work_logs via the
  // service-role client sidesteps that entirely — safe here because
  // every query below already scopes to .eq("employee_id", employee.id)
  // (own data only).
  const dwlSupabase = createServiceRoleClient();
  const today = todayIST();
  const [year, month] = today.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const sp = await searchParams;
  // 2026-09-02: "purane submited reports dekhne ka option ho" — replaced
  // the old single-date lookback with a proper From/To range picker,
  // mirroring the exact pattern Admin's own Employee Performance view
  // already uses (attendance/admin/page.tsx's perfFrom/perfTo) — same
  // component shape, same validation, so the two pages never drift apart
  // on what a "date range" control looks like. Defaults to the last 30
  // days rather than requiring a pick first.
  const histFromDefault = addDaysToDateStr(today, -29);
  const histFrom = typeof sp.histFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.histFrom) ? sp.histFrom : histFromDefault;
  const histTo = typeof sp.histTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.histTo) ? sp.histTo : today;
  // 2026-09-02: "agar employee back date me report submit kare to iska koi
  // option nahi hai" — the Daily Work Report form now lets an employee add/
  // edit an entry for any of the last 7 days (today included), not just
  // today. See actions.ts's own server-side validateLogDate for the
  // authoritative check — this is just the matching read-side window.
  const minBackdate = addDaysToDateStr(today, -6);
  // 2026-09-02: "My Performance" self-view — scoped to the current
  // calendar month, same as the "This Month So Far" attendance summary
  // directly above it on this page, so the two numbers are always talking
  // about the same period without a second month picker. See
  // src/lib/performance/score.ts for the shared formula both this
  // self-view and the admin/MD ranking view call into.
  const prevMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const prevMonthStart = `${prevMonth.y}-${String(prevMonth.m).padStart(2, "0")}-01`;
  const prevMonthEnd = `${prevMonth.y}-${String(prevMonth.m).padStart(2, "0")}-${String(daysInMonth(prevMonth.y, prevMonth.m)).padStart(2, "0")}`;

  // "AGAR KOI KAAM NEXT DAY KE LIYE MARK KIYA HAI TO VO AGALE DIN
  // AUTOMATIC PENDING ME DIKH JAYE" — copy forward any still-pending
  // "Next Day Carry On" rows from before today, BEFORE reading today's
  // logs below, so a freshly carried-over row shows up immediately.
  await carryOverPendingDailyLogs(dwlSupabase, employee.id, today);
  // 2026-09-04 — Daily Work Planner: same "run before reading today's
  // logs, plain function on the service-role client" pattern as
  // carryOverPendingDailyLogs above. Auto-inserts any still-missing fixed
  // item (role template matching employee.roleName, OR the employee's own
  // personal recurring item) as a normal 'Pending' row for today, tagged
  // source_template_id so DailyReportForm can badge it "🗂️ Template".
  await materializeWorkPlanTemplatesForToday(dwlSupabase, employee.id, employee.currentCompanyId, employee.roleName, today);

  const [{ data: todayRow }, { data: monthRows }, { data: company }, { data: holidays }, { data: emp }, { data: recentLogs }, { data: historyLogs }, { data: windowLogs }, { data: monthLogs }, { data: myRecurringItems }] =
    await Promise.all([
      supabase.from("attendance").select("*").eq("employee_id", employee.id).eq("attendance_date", today).maybeSingle(),
      supabase
        .from("attendance")
        .select("attendance_date, status")
        .eq("employee_id", employee.id)
        .gte("attendance_date", monthStart)
        .lte("attendance_date", today),
      supabase.from("companies").select("weekly_off_days").eq("id", employee.currentCompanyId).single(),
      supabase
        .from("holidays")
        .select("holiday_date, name")
        .or(`company_id.eq.${employee.currentCompanyId},company_id.is.null`)
        .gte("holiday_date", monthStart)
        .lte("holiday_date", `${year}-${String(month).padStart(2, "0")}-31`),
      supabase.from("employees").select("date_of_joining").eq("id", employee.id).single(),
      dwlSupabase
        .from("daily_work_logs")
        .select("id, log_date, category, description, target_qty, qty_done, work_status, remark_sku, updated_at, time_spent_seconds, estimated_time_minutes, carried_from_log_id, submitted_at, priority, carried_to_date, source_template_id")
        .eq("employee_id", employee.id)
        .order("log_date", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(30),
      // 2026-08-12 (round 6), extended 2026-09-02 into a real date-range
      // picker: "purane submited reports dekhne ka option ho" — every
      // submitted report between histFrom/histTo (default: last 30 days),
      // not limited to the last-30-ROWS window `recentLogs` covers (which
      // truncates by row count, not by date, so a busy month could hide
      // older days even within the same range).
      dwlSupabase
        .from("daily_work_logs")
        .select("id, log_date, category, description, target_qty, qty_done, work_status, remark_sku, updated_at, time_spent_seconds, estimated_time_minutes, carried_from_log_id, submitted_at, priority, carried_to_date")
        .eq("employee_id", employee.id)
        .gte("log_date", histFrom)
        .lte("log_date", histTo)
        .not("submitted_at", "is", null)
        .order("log_date", { ascending: false })
        .order("submitted_at", { ascending: true }),
      // 2026-09-02: the editable window for the Daily Work Report form
      // itself — today plus the last 6 days (backdate), so a not-yet-
      // submitted or already-submitted row from within that window still
      // shows up (and is still editable, if not yet submitted) after a
      // refresh. Separate from `recentLogs` above (which is a flat
      // most-recent-30 feed used for other things) so this is never
      // silently truncated by that unrelated limit.
      dwlSupabase
        .from("daily_work_logs")
        .select("id, log_date, category, description, target_qty, qty_done, work_status, remark_sku, updated_at, time_spent_seconds, estimated_time_minutes, carried_from_log_id, submitted_at, priority, carried_to_date, source_template_id")
        .eq("employee_id", employee.id)
        .gte("log_date", minBackdate)
        .lte("log_date", today)
        .order("log_date", { ascending: false })
        .order("updated_at", { ascending: false }),
      // 2026-09-02: "My Performance" self-view — every SUBMITTED report
      // this calendar month (uncapped by row count, unlike `recentLogs`),
      // used only for the work-report-efficiency score below.
      dwlSupabase
        .from("daily_work_logs")
        .select("log_date, time_spent_seconds")
        .eq("employee_id", employee.id)
        .gte("log_date", monthStart)
        .lte("log_date", today)
        .not("submitted_at", "is", null),
      // 2026-09-04 — Daily Work Planner: the employee's OWN personal
      // recurring items (scope='employee'), for MyRecurringWorkForm below.
      // Active AND inactive (inactive ones still show, greyed out, so the
      // employee can Reactivate rather than re-typing it).
      dwlSupabase
        .from("work_plan_templates")
        .select("id, category, description, target_qty, sort_order, active")
        .eq("scope", "employee")
        .eq("employee_id", employee.id)
        .order("sort_order"),
    ]);

  const attendanceByDate = new Map((monthRows ?? []).map((r) => [r.attendance_date, { status: r.status }]));
  const holidayDates = new Set((holidays ?? []).map((h) => h.holiday_date));
  const days = categorizeMonth({
    year,
    month,
    weeklyOffDays: (company?.weekly_off_days as number[] | undefined) ?? [0],
    holidayDates,
    attendanceByDate,
    todayStr: today,
    joinDate: emp?.date_of_joining ?? null,
  });
  const summary = summarizeCategories(days);
  const holidayNameByDate = new Map((holidays ?? []).map((h) => [h.holiday_date, h.name]));

  // Kept scoped to TODAY only for every stat below (Today's Work total,
  // Incomplete Work, My Recent Reports) — unaffected by the backdate
  // window added 2026-09-02, which only widens what the FORM itself shows/
  // edits (see `windowLogs` above, passed separately to DailyReportForm).
  const todaysLogs = (windowLogs ?? []).filter((l) => l.log_date === today);
  // 2026-08-11 (round 3): "submit karte hi khud ke kaam me add ho jaye" —
  // My Recent Reports only lists rows that were actually submitted, not
  // half-typed drafts. DailyReportForm below still gets the full
  // todaysLogs (drafts + submitted) so it can render both card types.
  const submittedTodaysLogs = todaysLogs.filter((l) => l.submitted_at !== null);

  // 2026-08-12 (round 6): "jo time bachta hai utna time report me dikhe ki
  // kitna ghante kaam kiya or kitna karna chahiye tha, agar koi kam kar
  // raha hai to uska bhi pata chal jayega" — sum of everything logged
  // today (draft + submitted, since a still-open row already reflects
  // real time spent) against the 8h15m office-hours-minus-breaks target.
  const todaysConsumedMinutes = todaysLogs.reduce((sum, l) => sum + Math.round((l.time_spent_seconds ?? 0) / 60), 0);
  const todaysWorkHours = compareToExpected(todaysConsumedMinutes);

  // 2026-09-01 — "Today's Work -> Carry Forward": Incomplete Work is
  // exactly the subset of today's (never-submitted, since Submit requires
  // Completed) draft rows still marked "Not Started" (this table's
  // existing "Pending" value) or "In Progress" — see
  // incomplete-work-section.tsx.
  const incompleteLogs: IncompleteLogRow[] = todaysLogs
    .filter((l) => l.work_status === "Pending" || l.work_status === "In Progress")
    .map((l) => ({
      id: l.id,
      category: l.category,
      description: l.description,
      workStatus: l.work_status as string,
      priority: l.priority || "Medium",
      estimatedTimeMinutes: l.estimated_time_minutes,
      timeSpentSeconds: l.time_spent_seconds,
    }));

  // 2026-09-04 — Daily Work Planner: the employee's own personal recurring
  // items, for MyRecurringWorkForm.
  const myRecurringItemRows: MyRecurringItemRow[] = (myRecurringItems ?? []).map((t) => ({
    id: t.id,
    category: t.category,
    description: t.description,
    targetQty: t.target_qty,
    sortOrder: t.sort_order,
    active: t.active,
  }));

  // 2026-09-02: "My Performance" self-view — own numbers only, this month.
  // Attendance/leave reuse the SAME `summary` shown in "This Month So Far"
  // just above (never a second, disagreeing count). Work-report efficiency
  // is built from `monthLogs` (every submitted report this month, grouped
  // by day into minutes -> compareToExpected verdict — the identical
  // function the "Today's Work" card above already uses).
  const monthDailyMinutes = new Map<string, number>();
  for (const l of monthLogs ?? []) {
    const mins = Math.round((l.time_spent_seconds ?? 0) / 60);
    monthDailyMinutes.set(l.log_date, (monthDailyMinutes.get(l.log_date) ?? 0) + mins);
  }
  const monthVerdicts: WorkHoursVerdict[] = Array.from(monthDailyMinutes.values()).map((mins) => compareToExpected(mins).verdict);
  const workingDaysThisMonth = summary.Present + summary.Late + summary["Half Day"];

  // Order value/growth — order-entry/sales staff only (see score.ts header
  // for why: `orders.entry_by_employee_id` is the only per-employee order
  // linkage the app has today). Self-view only ever uses the "Self" scoring
  // variant — never compared to any other employee's numbers.
  const hasOrderEntry = employee.capabilities.includes("order_entry");
  let myOrderValueThisMonth = 0;
  let myOrderGrowthPct: number | null = null;
  let myOrderCountThisMonth = 0;
  if (hasOrderEntry) {
    const [{ data: ordersThisMonth }, { data: ordersPrevMonth }] = await Promise.all([
      supabase.from("orders").select("order_value_usd").eq("entry_by_employee_id", employee.id).gte("order_date", monthStart).lte("order_date", today),
      supabase.from("orders").select("order_value_usd").eq("entry_by_employee_id", employee.id).gte("order_date", prevMonthStart).lte("order_date", prevMonthEnd),
    ]);
    myOrderCountThisMonth = (ordersThisMonth ?? []).length;
    myOrderValueThisMonth = (ordersThisMonth ?? []).reduce((sum, o) => sum + (o.order_value_usd ?? 0), 0);
    const prevValue = (ordersPrevMonth ?? []).reduce((sum, o) => sum + (o.order_value_usd ?? 0), 0);
    myOrderGrowthPct = growthPct(myOrderValueThisMonth, prevValue);
  }

  const myAttendanceScore = attendanceScore(summary);
  const myLeaveScore = leaveScore(summary.Leave);
  const myWorkEfficiencyScore = workEfficiencyScore(monthVerdicts, workingDaysThisMonth);
  const myBusinessImpactScore = hasOrderEntry ? businessImpactScoreSelf(myOrderGrowthPct) : undefined;
  const myCompositeScore = compositeScore({
    attendance: myAttendanceScore,
    leave: myLeaveScore,
    workEfficiency: myWorkEfficiencyScore,
    businessImpact: myBusinessImpactScore,
  });

  // 2026-09-02 (round 3): "jis employe ko jo store allot hai uske according
  // banadena tha" — Cost (store ad spend) vs. Value (store's order value),
  // using the existing Store Access assignment (Admin > Employees > Store
  // Access — the `employee_store_access` table), NOT `entry_by_employee_id`
  // above. Deliberately a SEPARATE panel from "My Performance", and
  // deliberately NOT folded into myCompositeScore: employee_store_access's
  // original purpose is Ad Spend module scoping, not an order-entry
  // linkage, and reusing it for a formula input the owner hasn't confirmed
  // yet would be guessing. Shown as its own informational panel instead,
  // for ANY employee with >=1 store assigned via Store Access, regardless
  // of role. Cost/value are for the WHOLE store (every order in it, not
  // just ones this employee personally entered) — the owner's own framing
  // ("jis employe ko jo store allot hai") is store-level, not order-level.
  // Clarified with the owner before building (AskUserQuestion, 2026-09-02):
  // separate panel (not folded into the existing score), store assignment
  // done by the owner via the existing Store Access UI (no new UI here),
  // and a store shared by >1 employee shows its FULL cost to each of them
  // with a "shared" note rather than guessing a split.
  const { data: myStoreAccess } = await supabase.from("employee_store_access").select("store_id").eq("employee_id", employee.id);
  const myStoreIds = Array.from(new Set((myStoreAccess ?? []).map((r) => r.store_id)));
  type MyStoreCostRow = { storeId: string; storeName: string; cost: number; value: number; sharedWithCount: number };
  let myStoreCostRows: MyStoreCostRow[] = [];
  if (myStoreIds.length > 0) {
    const [{ data: myStores }, { data: myStoreSpend }, { data: myStoreOrders }, { data: allAccessForMyStores }] = await Promise.all([
      supabase.from("stores").select("id, name").in("id", myStoreIds),
      supabase.from("store_ad_spend").select("store_id, spend_usd").in("store_id", myStoreIds).gte("spend_date", monthStart).lte("spend_date", today),
      supabase.from("orders").select("store_id, order_value_usd").in("store_id", myStoreIds).gte("order_date", monthStart).lte("order_date", today),
      supabase.from("employee_store_access").select("store_id").in("store_id", myStoreIds),
    ]);
    const storeNameById = new Map((myStores ?? []).map((s) => [s.id, s.name as string]));
    const costByStore = new Map<string, number>();
    for (const r of myStoreSpend ?? []) costByStore.set(r.store_id, (costByStore.get(r.store_id) ?? 0) + (r.spend_usd ?? 0));
    const valueByStore = new Map<string, number>();
    for (const r of myStoreOrders ?? []) valueByStore.set(r.store_id, (valueByStore.get(r.store_id) ?? 0) + (r.order_value_usd ?? 0));
    const accessCountByStore = new Map<string, number>();
    for (const r of allAccessForMyStores ?? []) accessCountByStore.set(r.store_id, (accessCountByStore.get(r.store_id) ?? 0) + 1);
    myStoreCostRows = myStoreIds.map((id) => ({
      storeId: id,
      storeName: storeNameById.get(id) ?? "Unknown store",
      cost: costByStore.get(id) ?? 0,
      value: valueByStore.get(id) ?? 0,
      sharedWithCount: Math.max(0, (accessCountByStore.get(id) ?? 1) - 1),
    }));
  }

  // 2026-08-11 (round 3): "task vala option isi page par show hona chahiye
  // usko alag se kyu banaya hai" — Task Assignment now renders directly on
  // this page instead of its own /dashboard/tasks route, gated on the same
  // task_management capability every role already has (see
  // db/schema.sql). Fetch is skipped entirely for anyone without it.
  const hasTaskManagement = employee.capabilities.includes("task_management");
  let myTaskRows: TaskRow[] = [];
  let assignedByMeRows: AssignedTaskRow[] = [];
  let taskEmployees: { id: string; name: string; companyName: string }[] = [];
  let taskWebsites: string[] = [];

  if (hasTaskManagement) {
    // 2026-08-11 (round 5): "sahil ne ajay ko task diya lekin dikh nahi
    // raha" — ROOT CAUSE FOUND: assignTask()'s INSERT runs on the SERVICE
    // ROLE client (bypasses RLS entirely), but these reads were running on
    // the anon/session client (`supabase`, subject to RLS). `tasks` is a
    // newer table than the last confirmed run of db/2026-08-08-enable-rls.sql
    // — if that blanket allow-policy was never re-applied to `tasks`,
    // RLS silently filters out every row for the `authenticated` role, so
    // the insert succeeds ("✓ Task assigned.") but every read of it comes
    // back empty, on BOTH the assigner's and assignee's page. Switched to
    // the service-role client for the `tasks` table specifically — safe
    // because this whole block is already gated on hasTaskManagement, and
    // each query still has its own explicit .eq("assigned_to/by_employee_id")
    // scoping, so bypassing RLS here doesn't widen what anyone can see.
    const taskSupabase = createServiceRoleClient();
    // 2026-08-11 (round 4): "KOI BHI KISI KO ASSIGN KAR SAKTA HAI PHIR
    // COMPANY CHAHE KOI BHI HO" — the Assign-To dropdown is explicitly NOT
    // scoped to employee.companyIds anymore: every active employee across
    // ALL 3 companies is selectable, regardless of which company(s) the
    // assigner themselves has access to. assignTask()'s own server-side
    // check was relaxed to match (see tasks/actions.ts).
    const [{ data: taskEmployeesData }, { data: allCompanies }, { data: stores }, { data: myTasks }, { data: assignedByMe }] = await Promise.all([
      supabase.from("employees").select("id, name, company_id").eq("active", true).order("name"),
      supabase.from("companies").select("id, name"),
      supabase.from("stores").select("name").in("company_id", employee.companyIds).eq("active", true).order("name"),
      taskSupabase
        .from("tasks")
        .select("id, website, category, priority, deadline, status, description, created_at, timer_started_at, time_spent_seconds, first_started_at, last_paused_at, assigned_by_employee_id")
        .eq("assigned_to_employee_id", employee.id)
        .order("status", { ascending: true })
        .order("created_at", { ascending: false }),
      taskSupabase
        .from("tasks")
        .select("id, category, priority, status, description, deadline, time_spent_seconds, timer_started_at, assigned_to_employee_id")
        .eq("assigned_by_employee_id", employee.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const employeeName = new Map((taskEmployeesData ?? []).map((e) => [e.id, e.name]));
    const companyName = new Map((allCompanies ?? []).map((c) => [c.id, c.name]));
    taskEmployees = (taskEmployeesData ?? [])
      .filter((e) => e.id !== employee.id)
      .map((e) => ({ id: e.id, name: e.name, companyName: companyName.get(e.company_id) ?? "—" }));
    taskWebsites = Array.from(new Set((stores ?? []).map((s) => s.name)));

    // assignTask() allows cross-company assignment, so fetch any
    // referenced employee id that isn't already covered — same pattern as
    // the old standalone /dashboard/tasks page. (Now largely redundant
    // since taskEmployeesData above already covers every active employee
    // company-wide, but kept as a defensive fallback for an inactive or
    // since-deleted employee that a task still references.)
    const missingIds = Array.from(
      new Set([
        ...(myTasks ?? []).map((t) => t.assigned_by_employee_id),
        ...(assignedByMe ?? []).map((t) => t.assigned_to_employee_id),
      ])
    ).filter((id) => !employeeName.has(id));
    if (missingIds.length) {
      const { data: extraEmployees } = await supabase.from("employees").select("id, name").in("id", missingIds);
      for (const e of extraEmployees ?? []) employeeName.set(e.id, e.name);
    }

    myTaskRows = (myTasks ?? []).map((t) => ({
      id: t.id,
      website: t.website,
      category: t.category,
      priority: t.priority,
      deadline: t.deadline,
      status: t.status,
      description: t.description,
      created_at: t.created_at,
      assignedByName: employeeName.get(t.assigned_by_employee_id) ?? "—",
      timerStartedAt: t.timer_started_at,
      timeSpentSeconds: t.time_spent_seconds,
      firstStartedAt: t.first_started_at,
      lastPausedAt: t.last_paused_at,
    }));

    assignedByMeRows = (assignedByMe ?? []).map((t) => ({
      id: t.id,
      category: t.category,
      priority: t.priority,
      status: t.status,
      description: t.description,
      deadline: t.deadline,
      assignedToName: employeeName.get(t.assigned_to_employee_id) ?? "—",
      timeSpentSeconds: t.time_spent_seconds,
      timerStartedAt: t.timer_started_at,
    }));
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🕒 Attendance &amp; Daily Report</h1>
        <p className="mt-1 text-sm text-slate-500">
          Punch in/out happens automatically on login/logout — the button below is a manual backup only.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Today — {today}</h2>
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <div>
              <div className="text-xs text-slate-400">Punch In</div>
              <div className="font-medium text-slate-900">
                {todayRow?.punch_in ? new Date(todayRow.punch_in).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Punch Out</div>
              <div className="font-medium text-slate-900">
                {todayRow?.punch_out ? new Date(todayRow.punch_out).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Status</div>
              <div className="font-medium text-slate-900">{todayRow?.status ?? "Not punched in yet"}</div>
            </div>
          </div>
          <PunchButtons punchedIn={!!todayRow?.punch_in} punchedOut={!!todayRow?.punch_out} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">This Month So Far</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {(["Present", "Late", "Half Day", "Leave", "Absent", "Holiday", "Week Off"] as DayCategory[]).map((cat) => (
              <span key={cat} className={`rounded-full px-2.5 py-1 font-medium ${CATEGORY_BADGE[cat]}`}>
                {cat}: {summary[cat]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Day by Day — {today.slice(0, 7)}</h2>
        <div className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <div
              key={d.date}
              title={holidayNameByDate.get(d.date) ?? d.category}
              className={`flex h-9 w-9 flex-col items-center justify-center rounded text-[10px] font-medium ${CATEGORY_BADGE[d.category]}`}
            >
              {d.date.slice(8, 10)}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <div className="text-xs text-slate-400">Today&apos;s Work (Time Consumed only — estimates are never counted)</div>
          <div className="text-lg font-semibold text-slate-900">{formatHM(todaysConsumedMinutes)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Expected ({OFFICE_START_LABEL}–{OFFICE_END_LABEL}, minus lunch &amp; tea)</div>
          <div className="text-lg font-semibold text-slate-500">{formatHM(EXPECTED_WORK_MINUTES)}</div>
        </div>
        <span
          className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${
            todaysWorkHours.verdict === "anomaly"
              ? "bg-red-600 text-white"
              : todaysWorkHours.verdict === "short"
                ? "bg-red-100 text-red-700"
                : todaysWorkHours.verdict === "on-track"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-green-100 text-green-700"
          }`}
        >
          {todaysWorkHours.verdict === "anomaly"
            ? `🚨 ${formatHM(todaysConsumedMinutes)} — looks wrong, check entries`
            : todaysWorkHours.verdict === "short"
              ? `⚠ ${formatHM(Math.abs(todaysWorkHours.deltaMinutes))} short`
              : todaysWorkHours.verdict === "on-track"
                ? "On track"
                : `+${formatHM(todaysWorkHours.deltaMinutes)} ahead`}
        </span>
      </div>
      {todaysWorkHours.verdict === "anomaly" && (
        <div className="-mt-3 mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-xs text-red-800">
          🚨 Today&apos;s total ({formatHM(todaysConsumedMinutes)}) is more than {formatHM(ANOMALY_THRESHOLD_MINUTES)} — that&apos;s past a normal
          full day. This usually means a typo in the Hours box below (e.g. 50 instead of 5) — please check and fix the Time Consumed on each row.
        </div>
      )}

      {/* 2026-09-01 — "Today's Work -> Carry Forward": placed right above
          the add-task form below, so anything still open surfaces before
          the employee starts adding more work for the day. */}
      <div className="mb-6">
        <IncompleteWorkSection logs={incompleteLogs} />
      </div>

      {/* 2026-09-04 — Daily Work Planner: personal recurring items, on top
          of whatever fixed role template Admin/HR already set up for this
          employee's role (see admin/work-plan-templates-panel.tsx). Both
          layers auto-appear in Today's Work every day (badged "🗂️
          Template" below) without re-typing them — collapsed by default
          since most days nobody needs to touch this list, only set it up
          once. */}
      <details className="mb-6 rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          🗂️ My Fixed / Recurring Work Items {myRecurringItemRows.filter((r) => r.active).length > 0 && `(${myRecurringItemRows.filter((r) => r.active).length} active)`}
        </summary>
        <div className="p-4 pt-0">
          <p className="mb-3 text-xs text-slate-500">
            Anything you add here shows up automatically in Today&apos;s Work every day, so you don&apos;t have to re-type it. This is on top of any fixed items your role already has (set up by Admin) — both apply together.
          </p>
          <MyRecurringWorkForm items={myRecurringItemRows} />
        </div>
      </details>

      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-700">📝 Daily Work Report</h2>
        <p className="mt-1 text-xs text-slate-500">
          Auto-saves as you type — safe to refresh, nothing typed is lost. Logout also flushes any pending change.
        </p>
      </div>
      <DailyReportForm editableLogs={windowLogs ?? []} recentLogs={recentLogs ?? []} today={today} minDate={minBackdate} />

      <div className="mt-6">
        <RecentReportsList logs={submittedTodaysLogs} />
      </div>

      {/* 2026-08-12 (round 6), extended 2026-09-02 into a real date-range
          picker: "purane submited reports dekhne ka option ho" — browse
          any past window of submitted reports, not just one date at a
          time (defaults to the last 30 days). Same From/To pattern as
          Admin's own Employee Performance picker below on the admin page. */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">📅 Report History</h2>
        <form method="get" className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
            <input type="date" name="histFrom" defaultValue={histFrom} max={today} className={dateInputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
            <input type="date" name="histTo" defaultValue={histTo} max={today} className={dateInputClass} />
          </div>
          <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
            View
          </button>
        </form>
        {(historyLogs ?? []).length === 0 ? (
          <p className="text-xs text-slate-400">No submitted reports between {histFrom} and {histTo}.</p>
        ) : (
          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {(historyLogs ?? []).map((l) => (
              <div key={l.id} className="rounded border border-slate-100 px-2.5 py-1.5 text-xs">
                <span className="font-medium text-slate-800">{l.log_date}</span>
                <span className="ml-2 text-slate-400">[{l.category ?? "—"}]</span>
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{l.work_status ?? "—"}</span>
                <span className="ml-2 text-amber-700">Consumed {formatDuration(l.time_spent_seconds)}</span>
                <p className="mt-0.5 text-slate-600">{l.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2026-09-02: "employe ko khud ki performance report dikhne lag
          jaye ki vo kaisa kaam kar raha hai progress kesi hai" — own
          numbers only, this month. No comparison to any other employee
          anywhere on this card — see src/lib/performance/score.ts header
          for the formula and that design choice. */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">📈 My Performance — {today.slice(0, 7)}</h2>
        <p className="mb-3 text-xs text-slate-500">
          Your own numbers this month only — never compared to anyone else. A simple weighted score
          out of 100 (attendance/punctuality, leave, work-report efficiency{hasOrderEntry ? ", and order value/growth" : ""}) — see the breakdown below.
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-16 flex-none items-center justify-center rounded-full border-4 border-amber-400 text-lg font-bold text-slate-900">
            {myCompositeScore}
          </div>
          <div className="flex flex-wrap gap-4">
            <Stat label="Attendance" value={`${myAttendanceScore}/100`} />
            <Stat label="Leave" value={`${myLeaveScore}/100`} />
            <Stat label="Work Efficiency" value={`${myWorkEfficiencyScore}/100`} />
            {hasOrderEntry && <Stat label="Order Value Growth" value={`${myBusinessImpactScore}/100`} />}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-2.5 py-1">
            {summary.Present} Present · {summary.Late} Late · {summary["Half Day"]} Half Day · {summary.Leave} Leave · {summary.Absent} Absent
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1">{monthVerdicts.length} reports submitted this month</span>
          {hasOrderEntry && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1">
              {myOrderCountThisMonth} orders · ${myOrderValueThisMonth.toFixed(0)} this month
              {myOrderGrowthPct !== null && (
                <>
                  {" "}
                  ({myOrderGrowthPct >= 0 ? "+" : ""}
                  {myOrderGrowthPct.toFixed(0)}% vs last month)
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {/* 2026-09-02 (round 3): "jis employe ko jo store allot hai uske
          according banadena tha" — cost vs. value for whichever store(s)
          Admin has assigned this employee via Store Access. Only renders
          if at least one store is assigned; see the data-fetch comment
          above for why this is a separate panel from "My Performance". */}
      {myStoreCostRows.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">💰 My Store — Cost vs Order Value ({today.slice(0, 7)})</h2>
          <p className="mb-3 text-xs text-slate-500">
            Ad spend vs. order value for the store(s) assigned to you (Admin &gt; Employees &gt; Store Access), this month.
          </p>
          <div className="flex flex-col gap-3">
            {myStoreCostRows.map((r) => (
              <div key={r.storeId} className="rounded-lg bg-slate-50 p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{r.storeName}</span>
                  {r.sharedWithCount > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      Shared with {r.sharedWithCount} other employee{r.sharedWithCount > 1 ? "s" : ""} — full store cost/value shown, not split
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                  <span>Ad Spend: ${r.cost.toFixed(0)}</span>
                  <span>Order Value: ${r.value.toFixed(0)}</span>
                  <span>
                    {r.cost > 0
                      ? `${(r.value / r.cost).toFixed(2)}x value per $ spent`
                      : r.value > 0
                        ? "No ad spend logged this month"
                        : "No ad spend or orders logged this month"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasTaskManagement && (
        <div className="mt-6">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-slate-700">📋 Tasks</h2>
            <p className="mt-1 text-xs text-slate-500">Assign work to anyone, and track your own tasks with a live timer.</p>
          </div>

          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Assign a Task</h3>
            <AssignTaskForm employees={taskEmployees} websites={taskWebsites} />
          </div>

          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">My Tasks</h3>
            <TaskList tasks={myTaskRows} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Tasks I Assigned</h3>
            <AssignedByMeList tasks={assignedByMeRows} />
          </div>
        </div>
      )}
    </div>
  );
}

const dateInputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
