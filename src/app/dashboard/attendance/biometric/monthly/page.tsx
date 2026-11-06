import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST, daysInMonth } from "@/lib/attendance/ist-date";
import { categorizeMonth } from "@/lib/attendance/payroll";
import { ExportBar } from "@/components/export-bar";

export const dynamic = "force-dynamic";

type Summary = {
  employee: string;
  code: string;
  department: string;
  workingDays: number;
  present: number;
  absent: number;
  halfDays: number;
  late: number;
  early: number;
  overtime: number;
  missing: number;
  hours: number;
  verified: number;
};

const COLUMN_DEFS: [keyof Summary, string][] = [
  ["employee", "Employee"],
  ["code", "Code"],
  ["department", "Department"],
  ["workingDays", "Working Days"],
  ["present", "Present"],
  ["absent", "Absent"],
  ["halfDays", "Half Days"],
  ["late", "Late"],
  ["early", "Early Departure"],
  ["overtime", "Overtime (min)"],
  ["missing", "Missing Punches"],
  ["hours", "Total Hours"],
  ["verified", "Biometric Verified"],
];
const COLUMNS = COLUMN_DEFS.map(([key, label]) => ({ key, label, value: (row: Summary) => row[key] }));

const DEPARTMENT_COLUMNS = COLUMNS.filter((c) => c.key !== "employee" && c.key !== "code");

// 2026-11-06 — employee + department monthly summary. Present/absent/half-day
// classification comes from the SAME categorizeMonth() used by payroll and
// the existing monthly report, so biometric days cannot disagree with salary.
export default async function BiometricMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("attendance_admin");
  const sp = await searchParams;
  const today = todayIST();
  const monthCandidate = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null;
  const month = monthCandidate && Number(monthCandidate.slice(5, 7)) >= 1 && Number(monthCandidate.slice(5, 7)) <= 12
    ? monthCandidate
    : today.slice(0, 7);
  const [year, monthNum] = month.split("-").map(Number);
  const requestedCompany = typeof sp.company === "string" ? sp.company : "";
  const companyId = requestedCompany && employee.companyIds.includes(requestedCompany) ? requestedCompany : employee.currentCompanyId;

  const supabase = createServiceRoleClient();
  const [{ data: companies }, { data: employees }, { data: departments }] = await Promise.all([
    supabase.from("companies").select("id, name, weekly_off_days").in("id", employee.companyIds).order("name"),
    supabase
      .from("employees")
      .select("id, name, employee_code, department_id, date_of_joining")
      .eq("company_id", companyId)
      .eq("active", true)
      .order("name"),
    supabase.from("departments").select("id, name").eq("company_id", companyId),
  ]);

  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth(year, monthNum)).padStart(2, "0")}`;
  const employeeIds = (employees ?? []).map((e) => e.id);
  const { data: attendance } = employeeIds.length
    ? await supabase
        .from("attendance")
        .select(
          "employee_id, attendance_date, punch_in, punch_out, work_hours, status, attendance_verification, late_minutes, early_departure_minutes, overtime_minutes, missing_punch"
        )
        .in("employee_id", employeeIds)
        .gte("attendance_date", monthStart)
        .lte("attendance_date", monthEnd)
    : { data: [] };
  const [{ data: companyHolidays }, { data: globalHolidays }] = await Promise.all([
    supabase.from("holidays").select("holiday_date").eq("company_id", companyId).gte("holiday_date", monthStart).lte("holiday_date", monthEnd),
    supabase.from("holidays").select("holiday_date").is("company_id", null).gte("holiday_date", monthStart).lte("holiday_date", monthEnd),
  ]);
  const holidayDates = new Set([...(companyHolidays ?? []), ...(globalHolidays ?? [])].map((h) => h.holiday_date));
  const weeklyOffDays = (companies ?? []).find((c) => c.id === companyId)?.weekly_off_days ?? [];
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const byEmployee = new Map<string, typeof attendance>();
  for (const row of attendance ?? []) {
    const list = byEmployee.get(row.employee_id) ?? [];
    list.push(row);
    byEmployee.set(row.employee_id, list);
  }

  const summaries: Summary[] = (employees ?? []).map((emp) => {
    const rows = byEmployee.get(emp.id) ?? [];
    const categorized = categorizeMonth({
      year,
      month: monthNum,
      weeklyOffDays: (weeklyOffDays as number[] | null) ?? [],
      holidayDates,
      attendanceByDate: new Map(rows.map((r) => [r.attendance_date, { status: r.status }])),
      todayStr: today,
      joinDate: emp.date_of_joining,
    });
    const workingDays = categorized.filter((d) => d.category !== "Week Off" && d.category !== "Holiday" && d.category !== "Future").length;
    const present = categorized.filter((d) => d.category === "Present" || d.category === "Late" || d.category === "Half Day").length;
    const absent = categorized.filter((d) => d.category === "Absent").length;
    const halfDays = categorized.filter((d) => d.category === "Half Day").length;
    return {
      employee: emp.name,
      code: emp.employee_code ?? "—",
      department: emp.department_id ? (departmentName.get(emp.department_id) ?? "—") : "—",
      workingDays,
      present,
      absent,
      halfDays,
      late: rows.filter((r) => (r.late_minutes ?? 0) > 0 || r.status === "Late").length,
      early: rows.filter((r) => (r.early_departure_minutes ?? 0) > 0).length,
      overtime: rows.reduce((s, r) => s + (r.overtime_minutes ?? 0), 0),
      missing: rows.filter((r) => r.missing_punch != null).length,
      hours: Math.round(rows.reduce((s, r) => s + Number(r.work_hours ?? 0), 0) * 100) / 100,
      verified: rows.filter((r) => r.attendance_verification === "Biometric Verified").length,
    };
  });

  const departmentMap = new Map<string, Summary>();
  for (const s of summaries) {
    const current = departmentMap.get(s.department) ?? {
      employee: s.department,
      code: "",
      department: s.department,
      workingDays: 0,
      present: 0,
      absent: 0,
      halfDays: 0,
      late: 0,
      early: 0,
      overtime: 0,
      missing: 0,
      hours: 0,
      verified: 0,
    };
    current.workingDays += s.workingDays;
    current.present += s.present;
    current.absent += s.absent;
    current.halfDays += s.halfDays;
    current.late += s.late;
    current.early += s.early;
    current.overtime += s.overtime;
    current.missing += s.missing;
    current.hours = Math.round((current.hours + s.hours) * 100) / 100;
    current.verified += s.verified;
    departmentMap.set(s.department, current);
  }
  const departmentSummaries = Array.from(departmentMap.values());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Biometric Monthly Attendance — {month}</h1>
          <p className="text-sm text-slate-500">
            Employee and department summary. Classification uses the same payroll rules as the existing monthly report;
            verification counts only days backed by both biometric punches.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/dashboard/attendance/biometric" className="text-teal-700 hover:underline">← Daily dashboard</Link>
          <Link href="/dashboard/attendance/admin/monthly-report" className="text-slate-500 hover:underline">Existing monthly report</Link>
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div>
          <label htmlFor="bm-month" className="mb-1 block text-xs font-medium text-slate-600">Month</label>
          <input id="bm-month" type="month" name="month" defaultValue={month} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="bm-company" className="mb-1 block text-xs font-medium text-slate-600">Company</label>
          <select id="bm-company" name="company" defaultValue={companyId} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            {(companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white">Show</button>
      </form>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Employee-wise</h2>
          <ExportBar title={`Biometric monthly attendance — ${month}`} filenameBase={`biometric-monthly-${month}`} columns={COLUMNS} rows={summaries} printAreaId="biometric-monthly-print" />
        </div>
        <div id="biometric-monthly-print" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[1000px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>{COLUMNS.map((c) => <th key={c.key} className="px-3 py-2">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summaries.map((s) => (
                <tr key={`${s.code}-${s.employee}`}>
                  <td className="px-3 py-2 font-medium text-slate-800">{s.employee}</td>
                  <td className="px-3 py-2 text-slate-500">{s.code}</td>
                  <td className="px-3 py-2 text-slate-500">{s.department}</td>
                  <td className="px-3 py-2">{s.workingDays}</td>
                  <td className="px-3 py-2 text-emerald-700">{s.present}</td>
                  <td className="px-3 py-2 text-rose-700">{s.absent}</td>
                  <td className="px-3 py-2">{s.halfDays}</td>
                  <td className="px-3 py-2">{s.late}</td>
                  <td className="px-3 py-2">{s.early}</td>
                  <td className="px-3 py-2">{s.overtime}</td>
                  <td className="px-3 py-2">{s.missing}</td>
                  <td className="px-3 py-2">{s.hours.toFixed(2)}</td>
                  <td className="px-3 py-2">{s.verified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Department-wise</h2>
          <ExportBar title={`Biometric department summary — ${month}`} filenameBase={`biometric-departments-${month}`} columns={DEPARTMENT_COLUMNS} rows={departmentSummaries} printAreaId="biometric-dept-print" />
        </div>
        <div id="biometric-dept-print" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Department</th><th className="px-3 py-2">Working Days</th><th className="px-3 py-2">Present</th><th className="px-3 py-2">Absent</th><th className="px-3 py-2">Half Days</th><th className="px-3 py-2">Late</th><th className="px-3 py-2">Early</th><th className="px-3 py-2">Overtime (min)</th><th className="px-3 py-2">Missing Punches</th><th className="px-3 py-2">Total Hours</th><th className="px-3 py-2">Verified</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {departmentSummaries.map((d) => (
                <tr key={d.department}>
                  <td className="px-3 py-2 font-medium text-slate-800">{d.department}</td>
                  <td className="px-3 py-2">{d.workingDays}</td>
                  <td className="px-3 py-2">{d.present}</td>
                  <td className="px-3 py-2">{d.absent}</td>
                  <td className="px-3 py-2">{d.halfDays}</td>
                  <td className="px-3 py-2">{d.late}</td>
                  <td className="px-3 py-2">{d.early}</td>
                  <td className="px-3 py-2">{d.overtime}</td>
                  <td className="px-3 py-2">{d.missing}</td>
                  <td className="px-3 py-2">{d.hours.toFixed(2)}</td>
                  <td className="px-3 py-2">{d.verified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
