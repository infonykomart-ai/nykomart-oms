import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories, type DayCategory } from "@/lib/attendance/payroll";
import { carryOverPendingDailyLogs } from "@/lib/attendance/carry-over";
import { formatDuration } from "@/lib/attendance/timer";
import { EXPECTED_WORK_MINUTES, ANOMALY_THRESHOLD_MINUTES, OFFICE_START_LABEL, OFFICE_END_LABEL, formatHM, compareToExpected } from "@/lib/attendance/work-hours";
import { PunchButtons } from "./punch-buttons";
import { DailyReportForm } from "./daily-report-form";
import { RecentReportsList } from "./recent-reports-list";
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
  const viewDate = typeof sp.viewDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.viewDate) ? sp.viewDate : null;

  // "AGAR KOI KAAM NEXT DAY KE LIYE MARK KIYA HAI TO VO AGALE DIN
  // AUTOMATIC PENDING ME DIKH JAYE" — copy forward any still-pending
  // "Next Day Carry On" rows from before today, BEFORE reading today's
  // logs below, so a freshly carried-over row shows up immediately.
  await carryOverPendingDailyLogs(dwlSupabase, employee.id, today);

  const [{ data: todayRow }, { data: monthRows }, { data: company }, { data: holidays }, { data: emp }, { data: recentLogs }, { data: viewDateLogs }] =
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
        .select("id, log_date, category, description, target_qty, qty_done, work_status, remark_sku, updated_at, time_spent_seconds, estimated_time_minutes, carried_from_log_id, submitted_at")
        .eq("employee_id", employee.id)
        .order("log_date", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(30),
      // 2026-08-12 (round 6): "employe kabhi bhi dekhna chahe to date
      // chose kar ke dekh sake ki kab kya kaam kiya" — a separate,
      // on-demand fetch for whatever date the employee picks below (not
      // limited to the last-30-rows window `recentLogs` covers).
      viewDate
        ? dwlSupabase
            .from("daily_work_logs")
            .select("id, log_date, category, description, target_qty, qty_done, work_status, remark_sku, updated_at, time_spent_seconds, estimated_time_minutes, carried_from_log_id, submitted_at")
            .eq("employee_id", employee.id)
            .eq("log_date", viewDate)
            .not("submitted_at", "is", null)
            .order("submitted_at", { ascending: true })
        : Promise.resolve({ data: null }),
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

  const todaysLogs = (recentLogs ?? []).filter((l) => l.log_date === today);
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

      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-700">📝 Daily Work Report</h2>
        <p className="mt-1 text-xs text-slate-500">
          Auto-saves as you type — safe to refresh, nothing typed is lost. Logout also flushes any pending change.
        </p>
      </div>
      <DailyReportForm todayLogs={todaysLogs} recentLogs={recentLogs ?? []} today={today} />

      <div className="mt-6">
        <RecentReportsList logs={submittedTodaysLogs} />
      </div>

      {/* 2026-08-12 (round 6): "employe kabhi bhi dekhna chahe to date
          chose kar ke dekh sake ki kab kya kaam kiya" — pick any past date
          and see that day's submitted reports, not just today's. */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">📅 Report History</h2>
        <form method="get" className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
            <input
              type="date"
              name="viewDate"
              defaultValue={viewDate ?? ""}
              max={today}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
            View
          </button>
        </form>
        {viewDate ? (
          (viewDateLogs ?? []).length === 0 ? (
            <p className="text-xs text-slate-400">No submitted reports on {viewDate}.</p>
          ) : (
            <div className="space-y-1.5">
              {(viewDateLogs ?? []).map((l) => (
                <div key={l.id} className="rounded border border-slate-100 px-2.5 py-1.5 text-xs">
                  <span className="font-medium text-slate-800">{l.category ?? "—"}</span>
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{l.work_status ?? "—"}</span>
                  <span className="ml-2 text-amber-700">Consumed {formatDuration(l.time_spent_seconds)}</span>
                  <p className="mt-0.5 text-slate-600">{l.description}</p>
                </div>
              ))}
            </div>
          )
        ) : (
          <p className="text-xs text-slate-400">Pick a date to see what you worked on that day.</p>
        )}
      </div>

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
