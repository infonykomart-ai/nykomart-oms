// 2026-10-01 — shared server-side data loader for the Daily / Periodic /
// Yearly attendance report pages (thin wrappers around
// buildRangeReport). One loader instead of three near-identical page
// bodies, so company/employee scoping, holiday/weekly-off merging and the
// attendance query can never drift apart between them.
//
// The attendance fetch is PAGED (.range 1000 at a time) on purpose: a
// Yearly range (365 days × N employees) blows straight past PostgREST's
// default 1000-row cap, and a silently truncated year report would be
// worse than no report at all.
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { buildRangeReport, type RangeReportKey, type RangeLeaveRequest } from "@/lib/attendance/range-report";
import type { AttendanceRow, ReportColumnDef, ReportEmployee, ReportRow } from "@/lib/attendance/monthly-report";
import type { requireCapability } from "@/lib/auth/require-capability";

type AuthedEmployee = Awaited<ReturnType<typeof requireCapability>>;

export type RangeScope = {
  reportKey: RangeReportKey;
  companyScope: "all" | "few";
  effectiveCompanyIds: string[];
  requestedCompanyIds: string[];
  employeeScope: "all" | "few";
  requestedEmployeeIds: string[];
  // 2026-10-02 — TeamOffice parity: Department filter (free-text
  // employees.department). "" = all departments.
  department: string;
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validDate(s: unknown, fallback: string): string {
  return typeof s === "string" && DATE_RE.test(s) ? s : fallback;
}

// 2026-10-02 — extended for the Location/GPS/Leave/COFF report types:
// store/source + the four punch-geo columns + the leave day's type/paid
// flag. The day-level report types ignore the extras.
const ATT_SELECT =
  "employee_id, attendance_date, punch_in, punch_out, work_hours, status, store_id, source, punch_in_lat, punch_in_lng, punch_out_lat, punch_out_lng, leave_type_id, leave_unpaid, gps_status";
const PAGE = 1000;

async function fetchAttendancePaged(
  empIds: string[],
  startDate: string,
  endDate: string
): Promise<{ rows: AttendanceRow[]; error: string | null }> {
  const supabase = await createClient();
  const rows: AttendanceRow[] = [];
  for (let from = 0; from <= 9000; from += PAGE) {
    const { data, error } = await supabase
      .from("attendance")
      .select(ATT_SELECT)
      .in("employee_id", empIds)
      .gte("attendance_date", startDate)
      .lte("attendance_date", endDate)
      .order("attendance_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { rows: [], error: error.message };
    rows.push(...((data ?? []) as AttendanceRow[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

/**
 * Loads everything the range report needs and returns both the render
 * props and the filter-panel props. `sp` is the page's searchParams.
 */
export async function loadRangeReport({
  authed,
  sp,
  startDate,
  endDate,
  reportKey,
}: {
  authed: AuthedEmployee;
  sp: { [key: string]: string | string[] | undefined };
  startDate: string;
  endDate: string;
  reportKey: RangeReportKey;
}): Promise<{
  error: string | null;
  companies: { id: string; name: string }[];
  allEmployees: { id: string; name: string; company_id: string }[];
  departments: string[];
  scope: RangeScope;
  columns: ReportColumnDef[];
  rows: ReportRow[];
}> {
  const supabase = await createClient();

  const companyScope: "all" | "few" = sp.companyScope === "few" ? "few" : "all";
  const requestedCompanyIds = typeof sp.companyIds === "string" && sp.companyIds ? sp.companyIds.split(",").filter(Boolean) : [];
  // Never trust the query string beyond this employee's own accessible
  // companies (employee_company_access) — same defensive filter the rest
  // of the app applies to any company id coming from searchParams.
  const effectiveCompanyIds =
    companyScope === "few" && requestedCompanyIds.length > 0
      ? requestedCompanyIds.filter((id) => authed.companyIds.includes(id))
      : authed.companyIds;

  const { data: companiesRaw } = await supabase.from("companies").select("id, name, weekly_off_days").in("id", effectiveCompanyIds);
  const companies = (companiesRaw ?? []).map((c) => ({ id: c.id, name: c.name }));
  // 2026-10-02b — department master: resolves employees.department_id to a
  // name for the Department column AND feeds the filter dropdown (an empty
  // list here = no departments defined yet for these companies).
  const { data: departmentsRaw } = effectiveCompanyIds.length
    ? await supabase.from("departments").select("id, name").in("company_id", effectiveCompanyIds)
    : { data: [] as { id: string; name: string }[] };
  const departmentNameById = new Map((departmentsRaw ?? []).map((d) => [d.id, d.name]));
  const weeklyOffDaysByCompany = new Map<string, number[]>(
    (companiesRaw ?? []).map((c) => [c.id, (c.weekly_off_days as number[] | null) ?? []])
  );

  const { data: employeesRaw } = effectiveCompanyIds.length
    ? await supabase
        .from("employees")
        .select("id, name, employee_code, company_id, date_of_joining, department_id")
        .in("company_id", effectiveCompanyIds)
        .eq("active", true)
        .order("name")
    : { data: [] };
  const allEmployeesRaw = employeesRaw ?? [];

  const employeeScope: "all" | "few" = sp.employeeScope === "few" ? "few" : "all";
  const requestedEmployeeIds = typeof sp.employeeIds === "string" && sp.employeeIds ? sp.employeeIds.split(",").filter(Boolean) : [];
  const effectiveEmployeeIdSet = employeeScope === "few" && requestedEmployeeIds.length > 0 ? new Set(requestedEmployeeIds) : null;
  // 2026-10-02 — Department filter: exact, case-insensitive match on the
  // resolved department NAME (structured departments entity; ""/absent =
  // no filter). Applied AFTER
  // the company/employee scope so the checkbox counts stay truthful.
  const department = typeof sp.department === "string" ? sp.department.trim() : "";
  const departmentLower = department.toLowerCase();
  // Resolved department NAME per employee (2026-10-02b: structured entity).
  const resolveDepartment = (departmentId: string | null): string | null =>
    (departmentId && departmentNameById.get(departmentId)) || null;

  const companyNameMap = new Map(companies.map((c) => [c.id, c.name]));
  const reportEmployees: ReportEmployee[] = allEmployeesRaw
    .filter((e) => effectiveEmployeeIdSet === null || effectiveEmployeeIdSet.has(e.id))
    .filter((e) => !departmentLower || (resolveDepartment(e.department_id) ?? "").trim().toLowerCase() === departmentLower)
    .map((e) => ({
      id: e.id,
      name: e.name,
      employee_code: e.employee_code,
      company_id: e.company_id,
      company_name: companyNameMap.get(e.company_id) ?? "—",
      date_of_joining: e.date_of_joining,
      department: resolveDepartment(e.department_id),
    }));

  // Filter dropdown options: every department defined for the accessible
  // companies (sorted, deduped by name across companies).
  const departments = Array.from(new Set((departmentsRaw ?? []).map((d) => d.name.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

  const scope: RangeScope = {
    reportKey,
    companyScope,
    effectiveCompanyIds,
    requestedCompanyIds,
    employeeScope,
    requestedEmployeeIds,
    department,
  };

  const employeeIdsForQuery = reportEmployees.map((e) => e.id);
  const [attResult, { data: companyHolidaysRaw }, { data: globalHolidaysRaw }, { data: storesRaw }, { data: leaveTypesRaw }, { data: leaveRequestsRaw }] = await Promise.all([
    employeeIdsForQuery.length
      ? fetchAttendancePaged(employeeIdsForQuery, startDate, endDate)
      : Promise.resolve({ rows: [] as AttendanceRow[], error: null }),
    effectiveCompanyIds.length
      ? supabase.from("holidays").select("company_id, holiday_date").in("company_id", effectiveCompanyIds).gte("holiday_date", startDate).lte("holiday_date", endDate)
      : Promise.resolve({ data: [] as { company_id: string | null; holiday_date: string }[] }),
    supabase.from("holidays").select("holiday_date").is("company_id", null).gte("holiday_date", startDate).lte("holiday_date", endDate),
    // 2026-10-02 — only what the selected report type actually reads:
    // Location → store names; Leave/COFF → leave type names; Leave alone
    // → leave requests overlapping the range. Extra queries for other
    // report types would just be wasted round-trips.
    reportKey === "location" && effectiveCompanyIds.length
      ? supabase.from("stores").select("id, name").in("company_id", effectiveCompanyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    (reportKey === "leave" || reportKey === "coff") && effectiveCompanyIds.length
      ? supabase.from("leave_types").select("id, name").in("company_id", effectiveCompanyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    reportKey === "leave" && effectiveCompanyIds.length
      ? supabase
          .from("leave_requests")
          .select("employee_id, from_date, to_date, status, leave_type_id")
          .in("company_id", effectiveCompanyIds)
          .lte("from_date", endDate)
          .gte("to_date", startDate)
      : Promise.resolve({ data: [] as RangeLeaveRequest[] }),
  ]);

  const base = {
    companies,
    allEmployees: allEmployeesRaw.map((e) => ({ id: e.id, name: e.name, company_id: e.company_id })),
    departments,
    scope,
  };
  if (attResult.error) return { error: `Could not load attendance: ${attResult.error}`, columns: [], rows: [], ...base };

  const globalHolidayDates = new Set((globalHolidaysRaw ?? []).map((h) => h.holiday_date));
  const holidayDatesByCompany = new Map<string, Set<string>>();
  for (const c of companiesRaw ?? []) holidayDatesByCompany.set(c.id, new Set(globalHolidayDates));
  for (const h of companyHolidaysRaw ?? []) {
    if (!h.company_id) continue;
    holidayDatesByCompany.get(h.company_id)?.add(h.holiday_date);
  }

  const { columns, rows } = buildRangeReport({
    reportKey,
    startDate,
    endDate,
    employees: reportEmployees,
    attendanceRows: attResult.rows,
    holidayDatesByCompany,
    weeklyOffDaysByCompany,
    // categorizeMonth needs IST "today" (days after it = Future, not
    // Absent) — todayIST() is the same IST clock every other page uses.
    todayStr: todayIST(),
    storeNamesById: new Map((storesRaw ?? []).map((s) => [s.id, s.name])),
    leaveTypeNamesById: new Map((leaveTypesRaw ?? []).map((t) => [t.id, t.name])),
    leaveRequestsByEmployee: groupLeaveRequests(leaveRequestsRaw ?? []),
  });

  return { error: null, columns, rows, ...base };
}

function groupLeaveRequests(reqs: RangeLeaveRequest[]): Map<string, RangeLeaveRequest[]> {
  const byEmployee = new Map<string, RangeLeaveRequest[]>();
  for (const r of reqs) {
    const list = byEmployee.get(r.employee_id) ?? [];
    list.push(r);
    byEmployee.set(r.employee_id, list);
  }
  return byEmployee;
}
