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
import { buildRangeReport, type RangeReportKey } from "@/lib/attendance/range-report";
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
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validDate(s: unknown, fallback: string): string {
  return typeof s === "string" && DATE_RE.test(s) ? s : fallback;
}

const ATT_SELECT = "employee_id, attendance_date, punch_in, punch_out, work_hours, status";
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
  const weeklyOffDaysByCompany = new Map<string, number[]>(
    (companiesRaw ?? []).map((c) => [c.id, (c.weekly_off_days as number[] | null) ?? []])
  );

  const { data: employeesRaw } = effectiveCompanyIds.length
    ? await supabase
        .from("employees")
        .select("id, name, employee_code, company_id, date_of_joining")
        .in("company_id", effectiveCompanyIds)
        .eq("active", true)
        .order("name")
    : { data: [] };
  const allEmployeesRaw = employeesRaw ?? [];

  const employeeScope: "all" | "few" = sp.employeeScope === "few" ? "few" : "all";
  const requestedEmployeeIds = typeof sp.employeeIds === "string" && sp.employeeIds ? sp.employeeIds.split(",").filter(Boolean) : [];
  const effectiveEmployeeIdSet = employeeScope === "few" && requestedEmployeeIds.length > 0 ? new Set(requestedEmployeeIds) : null;

  const companyNameMap = new Map(companies.map((c) => [c.id, c.name]));
  const reportEmployees: ReportEmployee[] = allEmployeesRaw
    .filter((e) => effectiveEmployeeIdSet === null || effectiveEmployeeIdSet.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      employee_code: e.employee_code,
      company_id: e.company_id,
      company_name: companyNameMap.get(e.company_id) ?? "—",
      date_of_joining: e.date_of_joining,
    }));

  const scope: RangeScope = {
    reportKey,
    companyScope,
    effectiveCompanyIds,
    requestedCompanyIds,
    employeeScope,
    requestedEmployeeIds,
  };

  const employeeIdsForQuery = reportEmployees.map((e) => e.id);
  const [attResult, { data: companyHolidaysRaw }, { data: globalHolidaysRaw }] = await Promise.all([
    employeeIdsForQuery.length
      ? fetchAttendancePaged(employeeIdsForQuery, startDate, endDate)
      : Promise.resolve({ rows: [] as AttendanceRow[], error: null }),
    effectiveCompanyIds.length
      ? supabase.from("holidays").select("company_id, holiday_date").in("company_id", effectiveCompanyIds).gte("holiday_date", startDate).lte("holiday_date", endDate)
      : Promise.resolve({ data: [] as { company_id: string | null; holiday_date: string }[] }),
    supabase.from("holidays").select("holiday_date").is("company_id", null).gte("holiday_date", startDate).lte("holiday_date", endDate),
  ]);

  const base = { companies, allEmployees: allEmployeesRaw.map((e) => ({ id: e.id, name: e.name, company_id: e.company_id })), scope };
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
  });

  return { error: null, columns, rows, ...base };
}
