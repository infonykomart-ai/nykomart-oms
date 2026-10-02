// 2026-10-02 — TeamOffice's calendar-style "Month Summary" sheet: one
// employee × one month rendered as a WALL CALENDAR (Mon-first grid, every
// day cell carrying its status badge + IN/OUT times), plus a totals strip
// (Present/Late/Half/Leave/Absent/Week Off/Holiday + work hours) and a
// day-wise table for export/print.
//
// Classification is the SAME categorizeMonth() the Monthly Report,
// Payroll and every range report use — a printed sheet can never
// disagree with the payroll screen about the same day. The whole sheet
// (header + calendar + table) sits inside one PrintArea so 🖨️ PDF/Print
// and the ExportBar's exports cover exactly what's on screen.
import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST, daysInMonth, istDayOfWeek } from "@/lib/attendance/ist-date";
import { categorizeMonth, type DayCategory } from "@/lib/attendance/payroll";
import { istTimeLabel, fmtDate, weekdayLabel, type AttendanceRow } from "@/lib/attendance/monthly-report";
import { ExportBar } from "@/components/export-bar";
import { PrintArea } from "@/components/print-view";

// Status badge shown inside each calendar cell — short enough for a
// 7-column grid, colour-coded for the quick "kaun kahan hai" scan.
const STATUS_BADGE: Record<DayCategory, { label: string; cls: string }> = {
  Present: { label: "P", cls: "border-green-200 bg-green-50 text-green-700" },
  Late: { label: "L", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  "Half Day": { label: "HD", cls: "border-yellow-200 bg-yellow-50 text-yellow-700" },
  Leave: { label: "Lv", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  Absent: { label: "A", cls: "border-red-200 bg-red-50 text-red-600" },
  "Week Off": { label: "WO", cls: "border-slate-200 bg-slate-100 text-slate-500" },
  Holiday: { label: "H", cls: "border-purple-200 bg-purple-50 text-purple-700" },
  Future: { label: "", cls: "border-slate-100 bg-white text-slate-300" },
};

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function MonthSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const authed = await requireCapability("attendance_admin");
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name, weekly_off_days").in("id", authed.companyIds);
  const selectedCompanyId =
    typeof sp.company === "string" && authed.companyIds.includes(sp.company) ? sp.company : authed.currentCompanyId;
  const selectedCompany = (companies ?? []).find((c) => c.id === selectedCompanyId) ?? companies?.[0];

  const today = todayIST();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  // `${month}-31` is invalid for 5 of 12 months — use the real last day
  // (same fix as every other month-range query in this app).
  const monthEnd = `${month}-${String(daysInMonth(year, monthNum)).padStart(2, "0")}`;

  const [{ data: employees }, { data: departments }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, employee_code, department_id, date_of_joining")
      .eq("company_id", selectedCompanyId)
      .eq("active", true)
      .order("name"),
    // 2026-10-02b — resolve department_id -> name for the sheet header.
    supabase.from("departments").select("id, name").eq("company_id", selectedCompanyId),
  ]);
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const employeeList = employees ?? [];
  const employee =
    employeeList.find((e) => e.id === sp.employee) ??
    employeeList[0] ??
    null;

  const [{ data: attendanceRaw }, { data: holidays }] = await Promise.all([
    employee
      ? supabase
          .from("attendance")
          .select("employee_id, attendance_date, punch_in, punch_out, work_hours, status")
          .eq("employee_id", employee.id)
          .gte("attendance_date", monthStart)
          .lte("attendance_date", monthEnd)
      : Promise.resolve({ data: [] as AttendanceRow[] }),
    supabase
      .from("holidays")
      .select("holiday_date")
      .or(`company_id.eq.${selectedCompanyId},company_id.is.null`)
      .gte("holiday_date", monthStart)
      .lte("holiday_date", monthEnd),
  ]);

  const attendanceByDate = new Map<string, AttendanceRow>();
  for (const r of (attendanceRaw ?? []) as AttendanceRow[]) attendanceByDate.set(r.attendance_date, r);

  const weeklyOffDays = (selectedCompany?.weekly_off_days as number[] | undefined) ?? [0];
  const holidayDates = new Set((holidays ?? []).map((h) => h.holiday_date));

  const days = employee
    ? categorizeMonth({
        year,
        month: monthNum,
        weeklyOffDays,
        holidayDates,
        attendanceByDate: new Map(Array.from(attendanceByDate.entries()).map(([d, r]) => [d, { status: r.status }])),
        todayStr: today,
        joinDate: employee.date_of_joining,
      })
    : [];

  const counts: Record<DayCategory, number> = {
    Holiday: 0, "Week Off": 0, Present: 0, Late: 0, "Half Day": 0, Leave: 0, Absent: 0, Future: 0,
  };
  let workHours = 0;
  for (const d of days) {
    counts[d.category]++;
    const att = attendanceByDate.get(d.date);
    if (att?.work_hours != null && (d.category === "Present" || d.category === "Late" || d.category === "Half Day")) {
      workHours += att.work_hours;
    }
  }

  // Mon-first grid: 1st of the month → column 0..6 (Mon=0 .. Sun=6).
  const firstDow = istDayOfWeek(`${month}-01`); // 0=Sun..6=Sat
  const leadingBlanks = (firstDow + 6) % 7;

  // Day-wise rows feed the ExportBar (CSV/Excel/Word) — the SAME data the
  // calendar renders, so an export can never differ from the printed sheet.
  const tableRows = days.map((d) => {
    const att = attendanceByDate.get(d.date);
    return {
      date: fmtDate(d.date),
      day: weekdayLabel(d.date),
      status: d.category as string | number | null,
      punch_in: istTimeLabel(att?.punch_in ?? null),
      punch_out: istTimeLabel(att?.punch_out ?? null),
      work_hours: att?.work_hours ?? null,
    };
  });
  const exportColumns = [
    { key: "date", label: "Date", value: (r: (typeof tableRows)[number]) => r.date },
    { key: "day", label: "Day", value: (r: (typeof tableRows)[number]) => r.day },
    { key: "status", label: "Status", value: (r: (typeof tableRows)[number]) => r.status },
    { key: "punch_in", label: "IN", value: (r: (typeof tableRows)[number]) => r.punch_in },
    { key: "punch_out", label: "OUT", value: (r: (typeof tableRows)[number]) => r.punch_out },
    { key: "work_hours", label: "Work Hrs", value: (r: (typeof tableRows)[number]) => r.work_hours },
  ];
  const title = `Month Summary — ${employee?.name ?? "—"} — ${month}`;
  const filenameBase = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const sheetHeader = (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{employee?.name ?? "No employees"}</h2>
        <p className="text-xs text-slate-500">
          {employee?.employee_code ? `Code ${employee.employee_code}` : "—"}
          {employee?.department_id && departmentName.get(employee.department_id)
            ? ` · ${departmentName.get(employee.department_id)}`
            : ""} · {selectedCompany?.name ?? "—"} ·{" "}
          {new Date(Date.UTC(year, monthNum - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {(Object.keys(STATUS_BADGE) as DayCategory[])
          .filter((k) => k !== "Future")
          .map((k) => (
            <span key={k} className={`rounded border px-1.5 py-0.5 font-medium ${STATUS_BADGE[k].cls}`}>
              {STATUS_BADGE[k].label} = {k}
            </span>
          ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">📒 Month Summary (Calendar Sheet)</h1>
          <p className="text-sm text-slate-500">
            Ek employee ka poora mahina calendar grid me — status badge + IN/OUT per day, totals strip, Print/PDF aur export ke saath.
          </p>
        </div>
        <Link
          href="/dashboard/attendance/admin"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Attendance Admin
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Company</label>
          <select name="company" defaultValue={selectedCompanyId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Employee</label>
          <select name="employee" defaultValue={employee?.id ?? ""} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {employeeList.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.employee_code ? ` (${e.employee_code})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Month</label>
          <input type="month" name="month" defaultValue={month} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
        >
          📒 Show Sheet
        </button>
      </form>

      <ExportBar title={title} filenameBase={filenameBase} columns={exportColumns} rows={tableRows} printAreaId="month-summary-print-area" />

      <PrintArea id="month-summary-print-area">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {sheetHeader}

          {/* Totals strip — the row TeamOffice's sheet prints under the
              calendar. Work Hrs counts Present/Late/Half Day days only. */}
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            {(
              [
                ["Present", counts.Present], ["Late", counts.Late], ["Half Day", counts["Half Day"]],
                ["Leave", counts.Leave], ["Absent", counts.Absent], ["Week Off", counts["Week Off"]],
                ["Holiday", counts.Holiday],
              ] as [DayCategory, number][]
            ).map(([label, n]) => (
              <span key={label} className={`rounded border px-2 py-1 font-medium ${STATUS_BADGE[label].cls}`}>
                {label}: {n}
              </span>
            ))}
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-700">
              Work Hrs: {Math.round(workHours * 100) / 100}
            </span>
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-700">
              Total Days: {days.length}
            </span>
          </div>

          {/* Mon-first calendar grid. */}
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_HEADERS.map((w) => (
              <div key={w} className="px-1 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {w}
              </div>
            ))}
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {days.map((d) => {
              const att = attendanceByDate.get(d.date);
              const badge = STATUS_BADGE[d.category];
              const dayNum = Number(d.date.slice(8, 10));
              return (
                <div key={d.date} className={`min-h-[64px] rounded-lg border p-1.5 ${badge.cls}`}>
                  <div className="flex items-start justify-between">
                    <span className="text-[11px] font-semibold text-slate-600">{dayNum}</span>
                    {badge.label && (
                      <span className="rounded bg-white/70 px-1 text-[10px] font-bold">{badge.label}</span>
                    )}
                  </div>
                  {(d.category === "Present" || d.category === "Late" || d.category === "Half Day") && (
                    <div className="mt-1 space-y-0.5 text-[10px] leading-tight text-slate-600">
                      <div>IN {istTimeLabel(att?.punch_in ?? null)}</div>
                      <div>OUT {istTimeLabel(att?.punch_out ?? null)}</div>
                      {att?.work_hours != null && <div>{att.work_hours}h</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Day-wise table under the calendar — what the CSV/Excel export
            mirrors 1:1. */}
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Date</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Day</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">IN</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">OUT</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Work Hrs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tableRows.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-1.5">{r.date}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{r.day}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{r.status}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{r.punch_in}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{r.punch_out}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{r.work_hours ?? "—"}</td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    No employees / no data for this selection.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PrintArea>
    </div>
  );
}
