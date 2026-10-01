// 2026-10-01 — TeamOffice screenshot round 2 (Daily Report / Periodic
// Report / Yearly Report pages): the RANGE sibling of monthly-report.ts.
// monthly-report.ts answers "for this calendar month, per employee";
// this answers "for ANY date range [startDate..endDate], per employee" —
// the same report shapes (performance summary, day-wise rows, IN/OUT,
// Absent, Late IN, Early IN/OUT, Overtime, Half Day, Mis Punch), measured
// with the SAME shift anchors (9:30 start / 18:30 end / 9:45 Late cutoff)
// and the SAME categorizeMonth() classification the Monthly Report, the
// Attendance Admin team summary and the Salary pipeline already use — so
// a Daily report can never disagree with the Monthly one about the same
// punch.
//
// Daily Report = range of exactly 1 day; Yearly Report = the FY range
// (Apr 1 → Mar 31) with the Performance summary — all three pages are
// thin wrappers around buildRangeReport() below.
//
// Departments / GPS / COFF are still intentionally absent (same "Not
// built" reasoning as monthly-report.ts — this schema has no department,
// no GPS capture and no COFF concept to report on).
import { categorizeMonth, type DayCategory } from "./payroll";
import { EXPECTED_WORK_MINUTES } from "./work-hours";
import {
  OFFICE_START_MIN,
  OFFICE_END_MIN,
  fmtDate,
  istMinutesOfDay,
  istTimeLabel,
  weekdayLabel,
  type AttendanceRow,
  type ReportColumnDef,
  type ReportEmployee,
  type ReportRow,
} from "./monthly-report";

export type RangeReportKey =
  | "day"
  | "performance"
  | "present"
  | "inout"
  | "absent"
  | "late_in"
  | "early_in"
  | "early_out"
  | "overtime"
  | "half_day"
  | "mis_punch";

export const RANGE_REPORT_TYPES: { key: RangeReportKey; label: string }[] = [
  { key: "day", label: "Day Performance (per employee, with Late IN / Early OUT)" },
  { key: "performance", label: "Performance Summary (totals per employee)" },
  { key: "present", label: "Present Report" },
  { key: "inout", label: "IN/OUT Report" },
  { key: "absent", label: "Absent Report" },
  { key: "late_in", label: "Late IN Report" },
  { key: "early_in", label: "Early IN Report" },
  { key: "early_out", label: "Early OUT Report" },
  { key: "overtime", label: "Over Time Report" },
  { key: "half_day", label: "Half Day Report" },
  { key: "mis_punch", label: "Mis Punch Report (IN but no OUT)" },
];

const YEARLY_TYPES: { key: RangeReportKey; label: string }[] = [
  { key: "performance", label: "Yearly Performance Report" },
];

export function yearlyReportTypes(): { key: RangeReportKey; label: string }[] {
  return YEARLY_TYPES;
}

/** "HH:MM" from minutes-since-midnight — TeamOffice renders late/early as 00:10 / 03:51. */
function hhmm(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function monthChunks(startDate: string, endDate: string): { year: number; month: number }[] {
  const chunks: { year: number; month: number }[] = [];
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7));
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    chunks.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return chunks;
}

export function buildRangeReport({
  reportKey,
  startDate,
  endDate,
  employees,
  attendanceRows,
  holidayDatesByCompany,
  weeklyOffDaysByCompany,
  todayStr,
}: {
  reportKey: RangeReportKey;
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string; // YYYY-MM-DD, inclusive
  employees: ReportEmployee[];
  attendanceRows: AttendanceRow[];
  holidayDatesByCompany: Map<string, Set<string>>;
  weeklyOffDaysByCompany: Map<string, number[]>;
  todayStr: string;
}): { columns: ReportColumnDef[]; rows: ReportRow[] } {
  const byEmployeeDate = new Map<string, Map<string, AttendanceRow>>();
  for (const row of attendanceRows) {
    let m = byEmployeeDate.get(row.employee_id);
    if (!m) {
      m = new Map();
      byEmployeeDate.set(row.employee_id, m);
    }
    m.set(row.attendance_date, row);
  }

  const chunks = monthChunks(startDate, endDate);
  const rows: ReportRow[] = [];

  for (const emp of employees) {
    const attByDate = byEmployeeDate.get(emp.id) ?? new Map<string, AttendanceRow>();

    // Every in-range day for this employee, classified by the shared engine.
    const days: { date: string; category: DayCategory }[] = [];
    for (const { year, month } of chunks) {
      const categorized = categorizeMonth({
        year,
        month,
        weeklyOffDays: weeklyOffDaysByCompany.get(emp.company_id) ?? [],
        holidayDates: holidayDatesByCompany.get(emp.company_id) ?? new Set(),
        attendanceByDate: new Map(Array.from(attByDate.entries()).map(([d, r]) => [d, { status: r.status }])),
        todayStr,
        joinDate: emp.date_of_joining,
      });
      for (const d of categorized) {
        if (d.date >= startDate && d.date <= endDate) days.push({ date: d.date, category: d.category });
      }
    }

    if (reportKey === "performance") {
      const counts: Record<DayCategory, number> = {
        Holiday: 0, "Week Off": 0, Present: 0, Late: 0, "Half Day": 0, Leave: 0, Absent: 0, Future: 0,
      };
      let workHours = 0;
      let otMinutes = 0;
      for (const d of days) {
        counts[d.category]++;
        const att = attByDate.get(d.date);
        if (att?.work_hours != null && (d.category === "Present" || d.category === "Late" || d.category === "Half Day")) {
          workHours += att.work_hours;
          const extra = Math.round(att.work_hours * 60 - EXPECTED_WORK_MINUTES);
          if (extra > 0) otMinutes += extra;
        }
      }
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
        work_hours: Math.round(workHours * 100) / 100,
        ot_hours: Math.round((otMinutes / 60) * 100) / 100,
      });
      continue;
    }

    for (const d of days) {
      const att = attByDate.get(d.date);

      if (reportKey === "day") {
        const inMin = att?.punch_in ? istMinutesOfDay(att.punch_in) : null;
        const outMin = att?.punch_out ? istMinutesOfDay(att.punch_out) : null;
        const worked = d.category === "Present" || d.category === "Late" || d.category === "Half Day";
        rows.push({
          date: fmtDate(d.date),
          day: weekdayLabel(d.date),
          employee: emp.name,
          employee_code: emp.employee_code,
          company: emp.company_name,
          status: d.category,
          punch_in: istTimeLabel(att?.punch_in ?? null),
          punch_out: istTimeLabel(att?.punch_out ?? null),
          work_hours: att?.work_hours ?? null,
          late_in: worked && inMin !== null ? hhmm(Math.max(0, inMin - OFFICE_START_MIN)) : "—",
          early_out: worked && outMin !== null ? hhmm(Math.max(0, OFFICE_END_MIN - outMin)) : "—",
        });
      } else if (reportKey === "present") {
        if (d.category !== "Present" && d.category !== "Late") continue;
        rows.push({
          date: fmtDate(d.date),
          employee: emp.name,
          employee_code: emp.employee_code,
          status: d.category,
          punch_in: istTimeLabel(att?.punch_in ?? null),
          punch_out: istTimeLabel(att?.punch_out ?? null),
          work_hours: att?.work_hours ?? null,
        });
      } else if (reportKey === "inout") {
        if (d.category === "Holiday" || d.category === "Week Off" || d.category === "Future") continue;
        rows.push({
          date: fmtDate(d.date),
          employee: emp.name,
          company: emp.company_name,
          status: d.category,
          punch_in: istTimeLabel(att?.punch_in ?? null),
          punch_out: istTimeLabel(att?.punch_out ?? null),
          work_hours: att?.work_hours ?? null,
        });
      } else if (reportKey === "absent" && d.category === "Absent") {
        rows.push({ date: fmtDate(d.date), day: weekdayLabel(d.date), employee: emp.name, employee_code: emp.employee_code, company: emp.company_name });
      } else if (reportKey === "half_day" && d.category === "Half Day") {
        rows.push({ date: fmtDate(d.date), day: weekdayLabel(d.date), employee: emp.name, employee_code: emp.employee_code, company: emp.company_name });
      } else if (reportKey === "late_in" && d.category === "Late" && att?.punch_in) {
        rows.push({
          date: fmtDate(d.date),
          employee: emp.name,
          company: emp.company_name,
          punch_in: istTimeLabel(att.punch_in),
          minutes_late: Math.max(0, istMinutesOfDay(att.punch_in) - OFFICE_START_MIN),
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
            date: fmtDate(d.date),
            employee: emp.name,
            company: emp.company_name,
            punch_in: istTimeLabel(att.punch_in),
            punch_out: istTimeLabel(att.punch_out),
            work_hours: att.work_hours,
            overtime_minutes: extraMinutes,
          });
        }
      } else if (reportKey === "mis_punch" && att?.punch_in && !att.punch_out && d.date < todayStr) {
        rows.push({ date: fmtDate(d.date), employee: emp.name, company: emp.company_name, punch_in: istTimeLabel(att.punch_in) });
      }
    }
  }

  return { columns: rangeColumnsFor(reportKey), rows };
}

function rangeColumnsFor(reportKey: RangeReportKey): ReportColumnDef[] {
  switch (reportKey) {
    case "day":
      return [
        { key: "date", label: "Date" }, { key: "day", label: "Day" }, { key: "employee", label: "Employee" },
        { key: "employee_code", label: "Code" }, { key: "company", label: "Company" }, { key: "status", label: "Status" },
        { key: "punch_in", label: "IN" }, { key: "punch_out", label: "OUT" }, { key: "work_hours", label: "Work Hrs" },
        { key: "late_in", label: "Late IN" }, { key: "early_out", label: "Early OUT" },
      ];
    case "performance":
      return [
        { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" }, { key: "company", label: "Company" },
        { key: "present", label: "Present" }, { key: "late", label: "Late" }, { key: "half_day", label: "Half Day" },
        { key: "leave", label: "Leave" }, { key: "absent", label: "Absent" }, { key: "holiday", label: "Holiday" },
        { key: "week_off", label: "Week Off" }, { key: "work_hours", label: "Work Hrs" }, { key: "ot_hours", label: "OT Hrs" },
      ];
    case "present":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" },
        { key: "status", label: "Status" }, { key: "punch_in", label: "IN" }, { key: "punch_out", label: "OUT" },
        { key: "work_hours", label: "Work Hrs" },
      ];
    case "inout":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "company", label: "Company" },
        { key: "status", label: "Status" }, { key: "punch_in", label: "Punch In" }, { key: "punch_out", label: "Punch Out" },
        { key: "work_hours", label: "Work Hours" },
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
        { key: "punch_in", label: "Punch In" }, { key: "punch_out", label: "Punch Out" }, { key: "work_hours", label: "Work Hours" },
        { key: "overtime_minutes", label: "Overtime (min)" },
      ];
    case "mis_punch":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "company", label: "Company" },
        { key: "punch_in", label: "Punch In (no Punch Out)" },
      ];
  }
}
