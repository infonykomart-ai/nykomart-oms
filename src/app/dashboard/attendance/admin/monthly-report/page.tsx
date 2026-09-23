import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST, daysInMonth } from "@/lib/attendance/ist-date";
import { buildMonthlyReport, REPORT_TYPES, type ReportKey, type ReportEmployee, type AttendanceRow } from "@/lib/attendance/monthly-report";
import { MonthlyReportFilters } from "./monthly-report-filters";
import { MonthlyReportResults } from "./monthly-report-results";

// 2026-09-23 — "apne oms me bhi to chahiye na report ... inme se jo apne ko
// chahiye": a TeamOffice biometric attendance software screenshot (Monthly
// Report: Month Performance / IN-OUT / Absent / Late In / Early In/Out /
// Overtime / GPS Approve-Pending-Rejected / COFF / Mis Punch / Special,
// filtered by Company/Department/Employee, PDF/Excel export) plus a second
// screenshot of TeamOffice's Report menu (Daily/Monthly/Periodic/Location/
// Leave/Salary/Yearly/Other Report) — user confirmed: build whichever of
// these we actually need in OUR OWN OMS, not a 1:1 clone. Leave Report and
// Salary Report already exist here (/dashboard/leave, /dashboard/salary);
// this adds the missing one — Monthly Report — as its own page, with the
// report TYPES this app's real attendance data can actually support (see
// monthly-report.ts's own "not built" note for GPS/COFF/Department, which
// this schema has no data for at all).
export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("attendance_admin");
  const supabase = await createClient();
  const sp = await searchParams;

  const today = todayIST();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [year, monthNum] = month.split("-").map(Number);

  const reportKey: ReportKey = REPORT_TYPES.some((r) => r.key === sp.report) ? (sp.report as ReportKey) : "summary";
  const reportLabel = REPORT_TYPES.find((r) => r.key === reportKey)!.label;

  const { data: companiesRaw } = await supabase.from("companies").select("id, name, weekly_off_days").in("id", employee.companyIds);
  const companies = companiesRaw ?? [];
  const weeklyOffDaysByCompany = new Map<string, number[]>(companies.map((c) => [c.id, (c.weekly_off_days as number[] | null) ?? []]));

  const companyScope: "all" | "few" = sp.companyScope === "few" ? "few" : "all";
  const requestedCompanyIds = typeof sp.companyIds === "string" && sp.companyIds ? sp.companyIds.split(",").filter(Boolean) : [];
  // Never trust the query string beyond this employee's own accessible
  // companies (employee_company_access) — same defensive filter the rest
  // of the app applies to any company id coming from searchParams.
  const effectiveCompanyIds =
    companyScope === "few" && requestedCompanyIds.length > 0
      ? requestedCompanyIds.filter((id) => employee.companyIds.includes(id))
      : employee.companyIds;

  const { data: employeesRaw } = effectiveCompanyIds.length
    ? await supabase
        .from("employees")
        .select("id, name, employee_code, company_id, date_of_joining")
        .in("company_id", effectiveCompanyIds)
        .eq("active", true)
        .order("name")
    : { data: [] };
  const allEmployees = employeesRaw ?? [];

  const employeeScope: "all" | "few" = sp.employeeScope === "few" ? "few" : "all";
  const requestedEmployeeIds = typeof sp.employeeIds === "string" && sp.employeeIds ? sp.employeeIds.split(",").filter(Boolean) : [];
  const effectiveEmployeeIdSet = employeeScope === "few" && requestedEmployeeIds.length > 0 ? new Set(requestedEmployeeIds) : null; // null = everyone in effectiveCompanyIds

  const companyNameMap = new Map(companies.map((c) => [c.id, c.name]));
  const reportEmployees: ReportEmployee[] = allEmployees
    .filter((e) => effectiveEmployeeIdSet === null || effectiveEmployeeIdSet.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      employee_code: e.employee_code,
      company_id: e.company_id,
      company_name: companyNameMap.get(e.company_id) ?? "—",
      date_of_joining: e.date_of_joining,
    }));

  const monthStart = `${month}-01`;
  // Same trap fixed previously in salary/admin's own month-range queries —
  // `${month}-31` is an invalid Postgres date for 5 of 12 months, which
  // silently errors and returns no rows rather than throwing.
  const monthEnd = `${month}-${String(daysInMonth(year, monthNum)).padStart(2, "0")}`;

  const employeeIdsForQuery = reportEmployees.map((e) => e.id);
  const [{ data: attendanceRaw }, { data: companyHolidaysRaw }, { data: globalHolidaysRaw }] = await Promise.all([
    employeeIdsForQuery.length
      ? supabase
          .from("attendance")
          .select("employee_id, attendance_date, punch_in, punch_out, work_hours, status")
          .in("employee_id", employeeIdsForQuery)
          .gte("attendance_date", monthStart)
          .lte("attendance_date", monthEnd)
      : Promise.resolve({ data: [] as AttendanceRow[] }),
    effectiveCompanyIds.length
      ? supabase.from("holidays").select("company_id, holiday_date").in("company_id", effectiveCompanyIds).gte("holiday_date", monthStart).lte("holiday_date", monthEnd)
      : Promise.resolve({ data: [] as { company_id: string | null; holiday_date: string }[] }),
    supabase.from("holidays").select("holiday_date").is("company_id", null).gte("holiday_date", monthStart).lte("holiday_date", monthEnd),
  ]);

  const globalHolidayDates = new Set((globalHolidaysRaw ?? []).map((h) => h.holiday_date));
  const holidayDatesByCompany = new Map<string, Set<string>>();
  for (const c of companies) holidayDatesByCompany.set(c.id, new Set(globalHolidayDates));
  for (const h of companyHolidaysRaw ?? []) {
    if (!h.company_id) continue;
    holidayDatesByCompany.get(h.company_id)?.add(h.holiday_date);
  }

  const { columns, rows } = buildMonthlyReport({
    reportKey,
    year,
    month: monthNum,
    employees: reportEmployees,
    attendanceRows: (attendanceRaw ?? []) as AttendanceRow[],
    holidayDatesByCompany,
    weeklyOffDaysByCompany,
    todayStr: today,
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Monthly Report</h1>
        <p className="text-sm text-slate-500">
          Attendance reports across your team — pick a report type, month, and company/employee scope, then Print/PDF, Excel, Word, Email, or WhatsApp it.
        </p>
      </div>

      <MonthlyReportFilters
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        employees={allEmployees.map((e) => ({ id: e.id, name: e.name, company_id: e.company_id }))}
        month={month}
        reportKey={reportKey}
        companyScope={companyScope}
        selectedCompanyIds={effectiveCompanyIds}
        employeeScope={employeeScope}
        selectedEmployeeIds={requestedEmployeeIds}
      />

      <MonthlyReportResults title={`${reportLabel} — ${month}`} columns={columns} rows={rows} />
    </div>
  );
}
