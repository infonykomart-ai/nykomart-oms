// 2026-09-23 — "apne oms me bhi report chahiye" (a TeamOffice biometric
// attendance software screenshot — Monthly Report with Month Performance /
// IN-OUT / Absent / Late In / Early In / Early OUT / Overtime / Half Day /
// GPS Approve-Pending-Rejected / COFF / Mis Punch / Special report types,
// filtered by Company/Department/Employee, exported PDF/Excel): this
// module builds the equivalent report TYPES we can actually derive from
// OUR OWN attendance data — see the "Not built" note at the bottom for
// the ones that need data this system doesn't capture at all (GPS, COFF,
// Department) rather than silently mimicking TeamOffice's exact list.
//
// Reuses categorizeMonth()/summarizeCategories() (payroll.ts) for the
// Present/Late/Half Day/Leave/Absent/Holiday/Week Off classification —
// same derivation already used by the Salary report and the Attendance
// Admin team summary, so this can never disagree with those about what a
// given day counted as. Report types that need actual punch TIMES (IN/OUT,
// Early In/Out, Overtime, Mis Punch) additionally read the raw attendance
// row for that date.
import { categorizeMonth, type DayCategory } from "./payroll";
import { EXPECTED_WORK_MINUTES } from "./work-hours";

export type ReportKey =
  | "summary"
  | "datewise"
  | "inout"
  | "absent"
  | "late_in"
  | "early_in"
  | "early_out"
  | "overtime"
  | "half_day"
  | "mis_punch";

export const REPORT_TYPES: { key: ReportKey; label: string }[] = [
  { key: "summary", label: "Month Summary" },
  { key: "datewise", label: "Month Datewise Performance" },
  { key: "inout", label: "Month IN/OUT Report" },
  { key: "absent", label: "Month Absent Report" },
  { key: "late_in", label: "Month Late In Report" },
  { key: "early_in", label: "Month Early In Report" },
  { key: "early_out", label: "Month Early OUT Report" },
  { key: "overtime", label: "Month Overtime Report" },
  { key: "half_day", label: "Month Half Day Report" },
  { key: "mis_punch", label: "Month Mis Punch Report" },
];

export type ReportRow = Record<string, string | number | null>;
export type ReportColumnDef = { key: string; label: string };

export type AttendanceRow = {
  employee_id: string;
  attendance_date: string;
  punch_in: string | null;
  punch_out: string | null;
  work_hours: number | null;
  status: DayCategory | null;
};

export type ReportEmployee = {
  id: string;
  name: string;
  employee_code: string | null;
  company_id: string;
  company_name: string;
  date_of_joining: string | null;
};

const OFFICE_START_MIN = 9 * 60 + 30; // 9:30 AM
const OFFICE_END_MIN = 18 * 60 + 30; // 6:30 PM

// Converts a timestamptz instant to IST minutes-since-midnight / a
// "h:mm AM/PM" label — small local helpers rather than pulling in a date
// library, same convention as ist-date.ts's own istShiftedNow() trick.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istMinutesOfDay(iso: string): number {
  const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
function istTimeLabel(iso: string | null): string {
  if (!iso) return "—";
  const mins = istMinutesOfDay(iso);
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}
function weekdayLabel(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
}
function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

export function buildMonthlyReport({
  reportKey,
  year,
  month,
  employees,
  attendanceRows,
  holidayDatesByCompany,
  weeklyOffDaysByCompany,
  todayStr,
}: {
  reportKey: ReportKey;
  year: number;
  month: number; // 1-12
  employees: ReportEmployee[];
  attendanceRows: AttendanceRow[];
  holidayDatesByCompany: Map<string, Set<string>>;
  weeklyOffDaysByCompany: Map<string, number[]>;
  todayStr: string;
}): { columns: ReportColumnDef[]; rows: ReportRow[] } {
  // employee_id -> date -> attendance row, for O(1) lookups per employee/date.
  const byEmployeeDate = new Map<string, Map<string, AttendanceRow>>();
  for (const row of attendanceRows) {
    let m = byEmployeeDate.get(row.employee_id);
    if (!m) {
      m = new Map();
      byEmployeeDate.set(row.employee_id, m);
    }
    m.set(row.attendance_date, row);
  }

  const rows: ReportRow[] = [];

  for (const emp of employees) {
    const attByDate = byEmployeeDate.get(emp.id) ?? new Map<string, AttendanceRow>();
    const categorized = categorizeMonth({
      year,
      month,
      weeklyOffDays: weeklyOffDaysByCompany.get(emp.company_id) ?? [],
      holidayDates: holidayDatesByCompany.get(emp.company_id) ?? new Set(),
      attendanceByDate: new Map(Array.from(attByDate.entries()).map(([d, r]) => [d, { status: r.status }])),
      todayStr,
      joinDate: emp.date_of_joining,
    });

    if (reportKey === "summary") {
      const counts: Record<DayCategory, number> = {
        Holiday: 0, "Week Off": 0, Present: 0, Late: 0, "Half Day": 0, Leave: 0, Absent: 0, Future: 0,
      };
      for (const d of categorized) counts[d.category]++;
      rows.push({
        employee: emp.name,
        employee_code: emp.employee_code,
        company: emp.company_name,
        present: counts.Present,
        late: counts.Late,
        half_day: counts["Half Day"],
        leave: counts.Leave,
        absent: counts.Absent,
        holiday: counts.Holiday,
        week_off: counts["Week Off"],
        total_days: categorized.length,
      });
      continue;
    }

    for (const d of categorized) {
      const att = attByDate.get(d.date);

      if (reportKey === "datewise") {
        rows.push({
          date: fmtDate(d.date), day: weekdayLabel(d.date), employee: emp.name, company: emp.company_name,
          status: d.category, punch_in: istTimeLabel(att?.punch_in ?? null), punch_out: istTimeLabel(att?.punch_out ?? null),
          work_hours: att?.work_hours ?? null,
        });
      } else if (reportKey === "inout") {
        if (d.category === "Holiday" || d.category === "Week Off" || d.category === "Future") continue;
        rows.push({
          date: fmtDate(d.date), employee: emp.name, company: emp.company_name, status: d.category,
          punch_in: istTimeLabel(att?.punch_in ?? null), punch_out: istTimeLabel(att?.punch_out ?? null),
          work_hours: att?.work_hours ?? null,
        });
      } else if (reportKey === "absent" && d.category === "Absent") {
        rows.push({ date: fmtDate(d.date), day: weekdayLabel(d.date), employee: emp.name, employee_code: emp.employee_code, company: emp.company_name });
      } else if (reportKey === "half_day" && d.category === "Half Day") {
        rows.push({ date: fmtDate(d.date), day: weekdayLabel(d.date), employee: emp.name, employee_code: emp.employee_code, company: emp.company_name });
      } else if (reportKey === "late_in" && d.category === "Late" && att?.punch_in) {
        rows.push({
          date: fmtDate(d.date), employee: emp.name, company: emp.company_name,
          punch_in: istTimeLabel(att.punch_in), minutes_late: Math.max(0, istMinutesOfDay(att.punch_in) - OFFICE_START_MIN),
        });
      } else if (reportKey === "early_in" && att?.punch_in && (d.category === "Present" || d.category === "Late")) {
        const mins = istMinutesOfDay(att.punch_in);
        if (mins < OFFICE_START_MIN) {
          rows.push({ date: fmtDate(d.date), employee: emp.name, company: emp.company_name, punch_in: istTimeLabel(att.punch_in), minutes_early: OFFICE_START_MIN - mins });
        }
      } else if (reportKey === "early_out" && att?.punch_out) {
        const mins = istMinutesOfDay(att.punch_out);
        if (mins < OFFICE_END_MIN) {
          rows.push({ date: fmtDate(d.date), employee: emp.name, company: emp.company_name, punch_out: istTimeLabel(att.punch_out), minutes_early: OFFICE_END_MIN - mins });
        }
      } else if (reportKey === "overtime" && att?.work_hours != null) {
        const extraMinutes = Math.round(att.work_hours * 60 - EXPECTED_WORK_MINUTES);
        if (extraMinutes > 15) {
          rows.push({
            date: fmtDate(d.date), employee: emp.name, company: emp.company_name,
            punch_in: istTimeLabel(att.punch_in), punch_out: istTimeLabel(att.punch_out),
            work_hours: att.work_hours, overtime_minutes: extraMinutes,
          });
        }
      } else if (reportKey === "mis_punch" && att?.punch_in && !att.punch_out && d.date < todayStr) {
        rows.push({ date: fmtDate(d.date), employee: emp.name, company: emp.company_name, punch_in: istTimeLabel(att.punch_in) });
      }
    }
  }

  return { columns: columnsFor(reportKey), rows };
}

function columnsFor(reportKey: ReportKey): ReportColumnDef[] {
  switch (reportKey) {
    case "summary":
      return [
        { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" }, { key: "company", label: "Company" },
        { key: "present", label: "Present" }, { key: "late", label: "Late" }, { key: "half_day", label: "Half Day" },
        { key: "leave", label: "Leave" }, { key: "absent", label: "Absent" }, { key: "holiday", label: "Holiday" },
        { key: "week_off", label: "Week Off" }, { key: "total_days", label: "Total Days" },
      ];
    case "datewise":
      return [
        { key: "date", label: "Date" }, { key: "day", label: "Day" }, { key: "employee", label: "Employee" }, { key: "company", label: "Company" },
        { key: "status", label: "Status" }, { key: "punch_in", label: "Punch In" }, { key: "punch_out", label: "Punch Out" }, { key: "work_hours", label: "Work Hours" },
      ];
    case "inout":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "company", label: "Company" },
        { key: "status", label: "Status" }, { key: "punch_in", label: "Punch In" }, { key: "punch_out", label: "Punch Out" }, { key: "work_hours", label: "Work Hours" },
      ];
    case "absent":
    case "half_day":
      return [
        { key: "date", label: "Date" }, { key: "day", label: "Day" }, { key: "employee", label: "Employee" },
        { key: "employee_code", label: "Code" }, { key: "company", label: "Company" },
      ];
    case "late_in":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "company", label: "Company" },
        { key: "punch_in", label: "Punch In" }, { key: "minutes_late", label: "Minutes Late" },
      ];
    case "early_in":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "company", label: "Company" },
        { key: "punch_in", label: "Punch In" }, { key: "minutes_early", label: "Minutes Early" },
      ];
    case "early_out":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "company", label: "Company" },
        { key: "punch_out", label: "Punch Out" }, { key: "minutes_early", label: "Minutes Early" },
      ];
    case "overtime":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "company", label: "Company" },
        { key: "punch_in", label: "Punch In" }, { key: "punch_out", label: "Punch Out" }, { key: "work_hours", label: "Work Hours" }, { key: "overtime_minutes", label: "Overtime (min)" },
      ];
    case "mis_punch":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "company", label: "Company" }, { key: "punch_in", label: "Punch In (no Punch Out)" },
      ];
  }
}

// Not built this round — flagged, not silently skipped:
//  - Department filter/grouping: `employees` has no department field in
//    this schema at all (only role_id/designation) — TeamOffice's
//    Company/Department/Employee 3-level filter is Company/Employee here,
//    2 levels.
//  - GPS Approve/Pending/Rejected reports: this app's Web Punch has no GPS
//    capture anywhere (confirmed — no gps/location column on `attendance`),
//    so there is nothing to report on.
//  - COFF (Compensatory Off) report: not a concept this system tracks
//    (categorizeMonth's DayCategory has no COFF state).
//  - "Month Special Report": TeamOffice-specific, not a defined report
//    shape here to replicate.
