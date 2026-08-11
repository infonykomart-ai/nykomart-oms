import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories, type DayCategory } from "@/lib/attendance/payroll";
import { PunchButtons } from "./punch-buttons";
import { DailyReportForm } from "./daily-report-form";

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
export default async function AttendancePage() {
  const employee = await requireCapability("attendance_punch");
  const supabase = await createClient();
  const today = todayIST();
  const [year, month] = today.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

  const [{ data: todayRow }, { data: monthRows }, { data: company }, { data: holidays }, { data: emp }, { data: recentLogs }] =
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
      supabase
        .from("daily_work_logs")
        .select("id, log_date, category, description, target_qty, qty_done, work_status, estimated_time, time_taken, remark_sku, updated_at")
        .eq("employee_id", employee.id)
        .order("log_date", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(30),
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

      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-700">📝 Daily Work Report</h2>
        <p className="mt-1 text-xs text-slate-500">
          Auto-saves as you type — safe to refresh, nothing typed is lost. Logout also flushes any pending change.
        </p>
      </div>
      <DailyReportForm todayLogs={todaysLogs} recentLogs={recentLogs ?? []} today={today} />
    </div>
  );
}
