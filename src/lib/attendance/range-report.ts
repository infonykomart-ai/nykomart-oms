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
// 2026-10-02 (TeamOffice parity round 2) — the report types that were
// "intentionally absent" above now exist, all riding this same engine:
//   - Department: a stamped column on EVERY row type (+ filter upstream
//     in range-report-data.ts) off the departments entity (employees.department_id).
//   - Location Report: per-day site per employee — attendance.store_id's
//     store name when set, else the Web-Punch GPS fix, else "—".
//   - GPS Report: punch-wise coordinates with a Google Maps link
//     (attendance.punch_in/out_lat,lng — captured best-effort by the Web
//     Punch buttons; server-side paths never have coords, render "—").
//   - Leave Report: leave days (paid/unpaid split + leave-type breakdown)
//     plus Approved/Pending/Rejected request counts for the period.
//   - COFF Report: compensatory-off credit DERIVED, not stored — days
//     actually worked on your weekly-off/holiday (explicit status wins in
//     categorizeMonth, so a Present on Sunday is visible here) minus
//     Leave days under a leave type whose name matches COFF/Comp Off.
//     There is no COFF state in DayCategory by design; this report is the
//     whole representation of the concept.
import { categorizeMonth, type DayCategory } from "./payroll";
import { EXPECTED_WORK_MINUTES } from "./work-hours";
import { istDayOfWeek } from "./ist-date";
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
  | "mis_punch"
  | "location"
  | "gps"
  | "leave"
  | "coff"
  | "source"
  | "dept_rollup"
  | "hours";

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
  { key: "location", label: "Location Report (day-wise store / GPS)" },
  { key: "gps", label: "GPS Report (punch-wise coordinates)" },
  { key: "leave", label: "Leave Report (days + requests)" },
  { key: "coff", label: "COFF Report (week-off/holiday work credit)" },
  { key: "source", label: "Punch Source Summary (Web / Manual / Import)" },
  { key: "dept_rollup", label: "Department Rollup (totals per department)" },
  { key: "hours", label: "Working Hours Summary (total / avg / OT)" },
];

// 2026-10-02 — the "Other Report" menu entry (TeamOffice's miscellaneous
// bucket) = the three report types that don't fit the per-employee day
// lists above. All three still ride this engine + the shared filters.
export const OTHER_REPORT_TYPES: { key: RangeReportKey; label: string }[] = [
  { key: "source", label: "Punch Source Summary (Web / Manual / Import)" },
  { key: "dept_rollup", label: "Department Rollup (totals per department)" },
  { key: "hours", label: "Working Hours Summary (total / avg / OT)" },
];

// 2026-10-02 — Leave Report input: one row per leave_requests entry
// overlapping the selected range (the loader pre-filters the overlap).
export type RangeLeaveRequest = {
  employee_id: string;
  from_date: string;
  to_date: string;
  status: string; // leave_request_status: Pending / Approved / Rejected
  leave_type_id: string | null;
};

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
  storeNamesById = new Map<string, string>(),
  leaveTypeNamesById = new Map<string, string>(),
  leaveRequestsByEmployee = new Map<string, RangeLeaveRequest[]>(),
}: {
  reportKey: RangeReportKey;
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string; // YYYY-MM-DD, inclusive
  employees: ReportEmployee[];
  attendanceRows: AttendanceRow[];
  holidayDatesByCompany: Map<string, Set<string>>;
  weeklyOffDaysByCompany: Map<string, number[]>;
  todayStr: string;
  /** location report: attendance.store_id → store name. */
  storeNamesById?: Map<string, string>;
  /** coff/leave reports: leave_types.id → name (for breakdowns/COFF matching). */
  leaveTypeNamesById?: Map<string, string>;
  /** leave report: employee → leave_requests already overlapping [startDate..endDate]. */
  leaveRequestsByEmployee?: Map<string, RangeLeaveRequest[]>;
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
  // 2026-10-02 — Department Rollup accumulates ACROSS employees, so its
  // rows are emitted once after the employee loop, grouped by department.
  const deptRollup = new Map<
    string,
    {
      employees: number;
      present: number;
      late: number;
      half_day: number;
      leave: number;
      absent: number;
      week_off: number;
      holiday: number;
      work_hours: number;
    }
  >();

  for (const emp of employees) {
    // 2026-10-02 — every row pushed below belongs to THIS employee: stamp
    // the Department column once per employee instead of at each push
    // site (a forgotten site would silently drop it).
    const rowStart = rows.length;
    const stampDepartment = () => {
      for (let i = rowStart; i < rows.length; i++) rows[i].department = emp.department;
    };
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
      stampDepartment();
      continue;
    }

    // 2026-10-02 — "Other Report" trio. Punch Source Summary: where the
    // punches in this range came from (Web Punch vs manual button vs the
    // TeamOffice import) + how many had a GPS fix captured.
    if (reportKey === "source") {
      let punchRows = 0;
      let webPunch = 0;
      let manualEntry = 0;
      let teamImport = 0;
      let gpsDays = 0;
      for (const d of days) {
        const att = attByDate.get(d.date);
        if (!att) continue;
        punchRows++;
        const src = att.source ?? "—";
        if (src === "Web Punch") webPunch++;
        else if (src === "Manual Entry") manualEntry++;
        else if (src === "TeamOffice Import") teamImport++;
        if (att.punch_in_lat != null || att.punch_out_lat != null) gpsDays++;
      }
      rows.push({
        employee: emp.name,
        employee_code: emp.employee_code,
        company: emp.company_name,
        punch_rows: punchRows,
        web_punch: webPunch,
        manual_entry: manualEntry,
        team_import: teamImport,
        gps_days: gpsDays,
      });
      stampDepartment();
      continue;
    }

    // 2026-10-02 — Working Hours Summary: total/average hours actually
    // recorded, OT (same >15-min-over-expected rule the Overtime report
    // uses) and "short days" (worked but ≥15 min under expected).
    if (reportKey === "hours") {
      let workedDays = 0;
      let totalHours = 0;
      let otMinutes = 0;
      let shortDays = 0;
      for (const d of days) {
        const att = attByDate.get(d.date);
        const worked = d.category === "Present" || d.category === "Late" || d.category === "Half Day";
        if (!worked || att?.work_hours == null) continue;
        workedDays++;
        totalHours += att.work_hours;
        const delta = Math.round(att.work_hours * 60 - EXPECTED_WORK_MINUTES);
        if (delta > 0) otMinutes += delta;
        else if (delta < -15) shortDays++;
      }
      rows.push({
        employee: emp.name,
        employee_code: emp.employee_code,
        company: emp.company_name,
        worked_days: workedDays,
        total_hours: Math.round(totalHours * 100) / 100,
        avg_hours: workedDays ? Math.round((totalHours / workedDays) * 100) / 100 : 0,
        ot_hours: Math.round((otMinutes / 60) * 100) / 100,
        short_days: shortDays,
      });
      stampDepartment();
      continue;
    }

    // 2026-10-02 — Department Rollup: fold this employee's day counts into
    // their department's bucket (NULL department groups under "—"); rows
    // are pushed after the loop below.
    if (reportKey === "dept_rollup") {
      const key = emp.department ?? "—";
      let acc = deptRollup.get(key);
      if (!acc) {
        acc = { employees: 0, present: 0, late: 0, half_day: 0, leave: 0, absent: 0, week_off: 0, holiday: 0, work_hours: 0 };
        deptRollup.set(key, acc);
      }
      acc.employees++;
      for (const d of days) {
        if (d.category === "Present") acc.present++;
        else if (d.category === "Late") acc.late++;
        else if (d.category === "Half Day") acc.half_day++;
        else if (d.category === "Leave") acc.leave++;
        else if (d.category === "Absent") acc.absent++;
        else if (d.category === "Week Off") acc.week_off++;
        else if (d.category === "Holiday") acc.holiday++;
        const att = attByDate.get(d.date);
        if (att?.work_hours != null && (d.category === "Present" || d.category === "Late" || d.category === "Half Day")) {
          acc.work_hours += att.work_hours;
        }
      }
      continue;
    }

    // 2026-10-02 — COFF (compensatory off): per-employee summary over the
    // range. Earned = actually worked (Present/Late/Half Day) on a
    // weekly-off day or a holiday; availed = Leave days under a leave type
    // named COFF/Comp Off. Balance can legitimately go negative when more
    // was availed than earned — shown as-is, not clamped, so the record
    // stays honest.
    if (reportKey === "coff") {
      const weeklyOff = weeklyOffDaysByCompany.get(emp.company_id) ?? [];
      const holidays = holidayDatesByCompany.get(emp.company_id) ?? new Set<string>();
      const weekOffDates: string[] = [];
      const holidayDates: string[] = [];
      let availed = 0;
      for (const d of days) {
        const att = attByDate.get(d.date);
        const worked = d.category === "Present" || d.category === "Late" || d.category === "Half Day";
        if (worked && weeklyOff.includes(istDayOfWeek(d.date))) weekOffDates.push(fmtDate(d.date));
        else if (worked && holidays.has(d.date)) holidayDates.push(fmtDate(d.date));
        if (d.category === "Leave") {
          const typeName = (att?.leave_type_id && leaveTypeNamesById.get(att.leave_type_id)) || "";
          if (/coff|comp/i.test(typeName)) availed++;
        }
      }
      const earned = weekOffDates.length + holidayDates.length;
      rows.push({
        employee: emp.name,
        employee_code: emp.employee_code,
        department: emp.department,
        company: emp.company_name,
        week_off_worked: weekOffDates.length,
        week_off_dates: weekOffDates.join(", ") || "—",
        holiday_worked: holidayDates.length,
        holiday_dates: holidayDates.join(", ") || "—",
        earned,
        availed,
        balance: earned - availed,
      });
      continue;
    }

    // 2026-10-02 — Leave Report: per-employee summary for the range.
    // leave_days comes from categorizeMonth's Leave category (explicit
    // attendance status — the same source payroll deducts from), the
    // paid/unpaid split + type breakdown from that day's attendance row,
    // and the request counts from leave_requests overlapping the range.
    if (reportKey === "leave") {
      let paidDays = 0;
      let unpaidDays = 0;
      const byType = new Map<string, number>();
      for (const d of days) {
        if (d.category !== "Leave") continue;
        const att = attByDate.get(d.date);
        if (att?.leave_unpaid) unpaidDays++;
        else paidDays++;
        const typeName = (att?.leave_type_id && leaveTypeNamesById.get(att.leave_type_id)) || "Unspecified";
        byType.set(typeName, (byType.get(typeName) ?? 0) + 1);
      }
      let approved = 0;
      let pending = 0;
      let rejected = 0;
      for (const req of leaveRequestsByEmployee.get(emp.id) ?? []) {
        if (req.status === "Approved") approved++;
        else if (req.status === "Pending") pending++;
        else rejected++;
      }
      rows.push({
        employee: emp.name,
        employee_code: emp.employee_code,
        department: emp.department,
        company: emp.company_name,
        leave_days: paidDays + unpaidDays,
        paid_days: paidDays,
        unpaid_days: unpaidDays,
        leave_types: Array.from(byType, ([name, n]) => `${name}: ${n}`).join(", ") || "—",
        approved_req: approved,
        pending_req: pending,
        rejected_req: rejected,
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
      } else if (reportKey === "location" && att) {
        // 2026-10-02 — Location Report: which site was this employee at
        // that day. Store name wins when attendance.store_id is set; else
        // the Web-Punch GPS fix; else "—" (server-side punches/import have
        // neither). Only days WITH an attendance row are listed — a day
        // nobody punched has no location to report.
        const gps =
          att.punch_in_lat != null && att.punch_in_lng != null
            ? `📍 ${att.punch_in_lat.toFixed(5)}, ${att.punch_in_lng.toFixed(5)}`
            : att.punch_out_lat != null && att.punch_out_lng != null
              ? `📍 ${att.punch_out_lat.toFixed(5)}, ${att.punch_out_lng.toFixed(5)}`
              : null;
        const location = (att.store_id && storeNamesById.get(att.store_id)) || gps || "—";
        rows.push({
          date: fmtDate(d.date),
          day: weekdayLabel(d.date),
          employee: emp.name,
          employee_code: emp.employee_code,
          department: emp.department,
          company: emp.company_name,
          status: d.category,
          location,
          punch_in: istTimeLabel(att.punch_in ?? null),
          punch_out: istTimeLabel(att.punch_out ?? null),
          source: att.source ?? "—",
        });
      } else if (reportKey === "gps" && att?.punch_in) {
        // 2026-10-02 — GPS Report: one row per punch, coordinates + a
        // Google Maps deep link (IN fix preferred, OUT fix as fallback).
        // Rows without coords still list ("—" + no link) so this doubles
        // as an audit of punches missing a location.
        const inGps =
          att.punch_in_lat != null && att.punch_in_lng != null
            ? `${att.punch_in_lat.toFixed(5)}, ${att.punch_in_lng.toFixed(5)}`
            : null;
        const outGps =
          att.punch_out_lat != null && att.punch_out_lng != null
            ? `${att.punch_out_lat.toFixed(5)}, ${att.punch_out_lng.toFixed(5)}`
            : null;
        const link = inGps ?? outGps;
        rows.push({
          date: fmtDate(d.date),
          employee: emp.name,
          employee_code: emp.employee_code,
          department: emp.department,
          company: emp.company_name,
          status: d.category,
          punch_in: istTimeLabel(att.punch_in),
          in_gps: inGps ?? "—",
          punch_out: istTimeLabel(att.punch_out ?? null),
          out_gps: outGps ?? "—",
          // 2026-10-02c — review workflow state, decided on the GPS
          // Approvals screen ('None' = nothing to review).
          gps_status: att.gps_status ?? "None",
          map: link ? `https://maps.google.com/?q=${encodeURIComponent(link)}` : "—",
        });
      }
    }
    stampDepartment();
  }

  // 2026-10-02 — Department Rollup rows are GROUPED (one per department,
  // sorted by name), not per employee — emitted once here, outside any
  // stampDepartment window.
  if (reportKey === "dept_rollup") {
    for (const [dept, acc] of Array.from(deptRollup).sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({
        department: dept,
        employees: acc.employees,
        present: acc.present,
        late: acc.late,
        half_day: acc.half_day,
        leave: acc.leave,
        absent: acc.absent,
        week_off: acc.week_off,
        holiday: acc.holiday,
        work_hours: Math.round(acc.work_hours * 100) / 100,
      });
    }
  }

  return { columns: rangeColumnsFor(reportKey), rows };
}

function rangeColumnsFor(reportKey: RangeReportKey): ReportColumnDef[] {
  switch (reportKey) {
    case "day":
      return [
        { key: "date", label: "Date" }, { key: "day", label: "Day" }, { key: "employee", label: "Employee" },
        { key: "employee_code", label: "Code" }, { key: "department", label: "Department" }, { key: "company", label: "Company" }, { key: "status", label: "Status" },
        { key: "punch_in", label: "IN" }, { key: "punch_out", label: "OUT" }, { key: "work_hours", label: "Work Hrs" },
        { key: "late_in", label: "Late IN" }, { key: "early_out", label: "Early OUT" },
      ];
    case "performance":
      return [
        { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "present", label: "Present" }, { key: "late", label: "Late" }, { key: "half_day", label: "Half Day" },
        { key: "leave", label: "Leave" }, { key: "absent", label: "Absent" }, { key: "holiday", label: "Holiday" },
        { key: "week_off", label: "Week Off" }, { key: "work_hours", label: "Work Hrs" }, { key: "ot_hours", label: "OT Hrs" },
      ];
    case "present":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" },
        { key: "department", label: "Department" },
        { key: "status", label: "Status" }, { key: "punch_in", label: "IN" }, { key: "punch_out", label: "OUT" },
        { key: "work_hours", label: "Work Hrs" },
      ];
    case "inout":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "status", label: "Status" }, { key: "punch_in", label: "Punch In" }, { key: "punch_out", label: "Punch Out" },
        { key: "work_hours", label: "Work Hours" },
      ];
    case "absent":
    case "half_day":
      return [
        { key: "date", label: "Date" }, { key: "day", label: "Day" }, { key: "employee", label: "Employee" },
        { key: "employee_code", label: "Code" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
      ];
    case "late_in":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "punch_in", label: "Punch In" }, { key: "minutes_late", label: "Minutes Late" },
      ];
    case "early_in":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "punch_in", label: "Punch In" }, { key: "minutes_early", label: "Minutes Early" },
      ];
    case "early_out":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "punch_out", label: "Punch Out" }, { key: "minutes_early", label: "Minutes Early" },
      ];
    case "overtime":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "punch_in", label: "Punch In" }, { key: "punch_out", label: "Punch Out" }, { key: "work_hours", label: "Work Hours" },
        { key: "overtime_minutes", label: "Overtime (min)" },
      ];
    case "mis_punch":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "punch_in", label: "Punch In (no Punch Out)" },
      ];
    case "location":
      return [
        { key: "date", label: "Date" }, { key: "day", label: "Day" }, { key: "employee", label: "Employee" },
        { key: "employee_code", label: "Code" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "status", label: "Status" }, { key: "location", label: "Location" },
        { key: "punch_in", label: "Punch In" }, { key: "punch_out", label: "Punch Out" }, { key: "source", label: "Source" },
      ];
    case "gps":
      return [
        { key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" },
        { key: "department", label: "Department" }, { key: "company", label: "Company" }, { key: "status", label: "Status" },
        { key: "punch_in", label: "Punch In" }, { key: "in_gps", label: "In GPS" },
        { key: "punch_out", label: "Punch Out" }, { key: "out_gps", label: "Out GPS" },
        { key: "gps_status", label: "GPS Review" },
        { key: "map", label: "Map Link" },
      ];
    case "leave":
      return [
        { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "leave_days", label: "Leave Days" }, { key: "paid_days", label: "Paid" }, { key: "unpaid_days", label: "Unpaid" },
        { key: "leave_types", label: "Leave Types" },
        { key: "approved_req", label: "Approved Req" }, { key: "pending_req", label: "Pending Req" }, { key: "rejected_req", label: "Rejected Req" },
      ];
    case "coff":
      return [
        { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "week_off_worked", label: "Week Off Worked" }, { key: "week_off_dates", label: "Week Off Dates" },
        { key: "holiday_worked", label: "Holiday Worked" }, { key: "holiday_dates", label: "Holiday Dates" },
        { key: "earned", label: "COFF Earned" }, { key: "availed", label: "COFF Availed" }, { key: "balance", label: "Balance" },
      ];
    case "source":
      return [
        { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "punch_rows", label: "Punch Rows" }, { key: "web_punch", label: "Web Punch" },
        { key: "manual_entry", label: "Manual Entry" }, { key: "team_import", label: "TeamOffice Import" },
        { key: "gps_days", label: "GPS Captured" },
      ];
    case "dept_rollup":
      return [
        { key: "department", label: "Department" }, { key: "employees", label: "Employees" },
        { key: "present", label: "Present" }, { key: "late", label: "Late" }, { key: "half_day", label: "Half Day" },
        { key: "leave", label: "Leave" }, { key: "absent", label: "Absent" },
        { key: "week_off", label: "Week Off" }, { key: "holiday", label: "Holiday" }, { key: "work_hours", label: "Work Hrs" },
      ];
    case "hours":
      return [
        { key: "employee", label: "Employee" }, { key: "employee_code", label: "Code" }, { key: "department", label: "Department" }, { key: "company", label: "Company" },
        { key: "worked_days", label: "Worked Days" }, { key: "total_hours", label: "Total Hrs" },
        { key: "avg_hours", label: "Avg Hrs/Day" }, { key: "ot_hours", label: "OT Hrs" }, { key: "short_days", label: "Short Days" },
      ];
  }
}
