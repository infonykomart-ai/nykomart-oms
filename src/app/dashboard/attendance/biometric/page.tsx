import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { BiometricDashboard, type AttendanceRow, type EventRow, type MappingRow } from "./biometric-dashboard";

export const dynamic = "force-dynamic";

// 2026-11-06 — Biometric Attendance Dashboard. Reads are service-role after
// the attendance_admin gate; every query is company-scoped.
export default async function BiometricAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("attendance_admin");
  const sp = await searchParams;
  const requestedCompany = typeof sp.company === "string" ? sp.company : "";
  const companyId = requestedCompany && employee.companyIds.includes(requestedCompany) ? requestedCompany : employee.currentCompanyId;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIST();

  const supabase = createServiceRoleClient();
  const [{ data: companies }, { data: employees }, { data: departments }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase
      .from("employees")
      .select("id, name, email, employee_code, designation, department_id, active")
      .eq("company_id", companyId)
      .eq("active", true)
      .order("name"),
    supabase.from("departments").select("id, name").eq("company_id", companyId),
  ]);

  const employeeIds = (employees ?? []).map((e) => e.id);
  const [{ data: devices }, { data: shifts }, { data: mappings }, { data: attendance }, { data: events }] = await Promise.all([
    supabase.from("biometric_devices").select("id, name, vendor, model, mode, device_key, api_key_last4, active, last_event_at, last_sync_at").eq("company_id", companyId).order("name"),
    supabase.from("attendance_shifts").select("id, name, start_time, end_time, grace_minutes, half_day_minutes, overtime_after_minutes, active").eq("company_id", companyId).order("name"),
    supabase
      .from("biometric_employee_map")
      .select("id, device_id, employee_id, device_employee_id, shift_id, active, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    employeeIds.length
      ? supabase
          .from("attendance")
          .select(
            "id, employee_id, punch_in, punch_out, work_hours, status, source, attendance_verification, late_minutes, early_departure_minutes, overtime_minutes, missing_punch, oms_punch_in, oms_punch_out, biometric_in_at, biometric_out_at, remark"
          )
          .in("employee_id", employeeIds)
          .eq("attendance_date", date)
      : Promise.resolve({ data: [] as AttendanceRowQuery[] }),
    supabase
      .from("biometric_punch_events")
      .select("id, device_id, device_employee_id, employee_id, punch_at, direction, status, error, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const attendanceList = (attendance ?? []) as AttendanceRowQuery[];
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));
  const deviceById = new Map((devices ?? []).map((d) => [d.id, d.name]));
  const shiftById = new Map((shifts ?? []).map((s) => [s.id, s.name]));
  const attendanceByEmployee = new Map(attendanceList.map((a) => [a.employee_id, a]));

  const attendanceRows: AttendanceRow[] = (employees ?? []).map((emp) => {
    const row = attendanceByEmployee.get(emp.id);
    const verified = row?.attendance_verification === "Biometric Verified";
    const source = row?.source ?? "—";
    return {
      id: row?.id ?? `missing-${emp.id}`,
      employeeId: emp.id,
      employeeName: emp.name,
      employeeCode: emp.employee_code,
      department: emp.department_id ? (departmentName.get(emp.department_id) ?? null) : null,
      designation: emp.designation,
      punchIn: row?.punch_in ?? null,
      punchOut: row?.punch_out ?? null,
      workHours: row?.work_hours != null ? Number(row.work_hours) : null,
      status: row?.status ?? "Absent",
      source,
      verification: row?.attendance_verification ?? (source === "Web Punch" || source === "Manual Entry" ? "OMS Only" : "Pending Verification"),
      lateMinutes: row?.late_minutes ?? null,
      earlyDepartureMinutes: row?.early_departure_minutes ?? null,
      overtimeMinutes: row?.overtime_minutes ?? null,
      missingPunch: row?.missing_punch ?? null,
      omsIn: row?.oms_punch_in ?? null,
      omsOut: row?.oms_punch_out ?? null,
      biometricIn: row?.biometric_in_at ?? null,
      biometricOut: row?.biometric_out_at ?? null,
      remark: row?.remark ?? null,
      verified,
    };
  });

  const mappingRows: MappingRow[] = (mappings ?? []).map((m) => {
    const emp = employeeById.get(m.employee_id);
    return {
      id: m.id,
      deviceId: m.device_id,
      deviceName: deviceById.get(m.device_id) ?? "—",
      employeeId: m.employee_id,
      employeeName: emp?.name ?? "—",
      employeeEmail: emp?.email ?? null,
      employeeCode: emp?.employee_code ?? null,
      designation: emp?.designation ?? null,
      department: emp?.department_id ? (departmentName.get(emp.department_id) ?? null) : null,
      deviceEmployeeId: m.device_employee_id,
      shiftId: m.shift_id,
      shiftName: m.shift_id ? (shiftById.get(m.shift_id) ?? null) : null,
      active: m.active,
    };
  });

  const eventRows: EventRow[] = (events ?? []).map((e) => ({
    id: e.id,
    deviceName: deviceById.get(e.device_id) ?? "—",
    deviceEmployeeId: e.device_employee_id,
    employeeName: e.employee_id ? (employeeById.get(e.employee_id)?.name ?? null) : null,
    punchAt: e.punch_at,
    direction: e.direction,
    status: e.status,
    error: e.error,
    createdAt: e.created_at,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Biometric Attendance</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Device punches are deduplicated and take priority over OMS web punches. OMS logout never creates a physical
            OUT punch, and an OMS-only day stays unverified until biometric data or an authorised correction resolves it.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/dashboard/attendance/biometric/monthly?company=${companyId}`} className="text-teal-700 hover:underline">Monthly summary / export →</Link>
          <Link href="/dashboard/attendance/admin/import" className="text-slate-500 hover:underline">Excel fallback import</Link>
          <Link href="/dashboard/attendance/admin" className="text-slate-500 hover:underline">Attendance Admin</Link>
        </div>
      </div>

      <BiometricDashboard
        companyId={companyId}
        companies={companies ?? []}
        date={date}
        employees={(employees ?? []).map((e) => ({ id: e.id, name: e.name, email: e.email, employeeCode: e.employee_code }))}
        devices={(devices ?? []).map((d) => ({ ...d, last_event_at: d.last_event_at, last_sync_at: d.last_sync_at }))}
        shifts={(shifts ?? []).map((s) => ({ ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) }))}
        mappings={mappingRows}
        attendance={attendanceRows}
        events={eventRows}
      />
    </div>
  );
}

type AttendanceRowQuery = {
  id: string;
  employee_id: string;
  punch_in: string | null;
  punch_out: string | null;
  work_hours: number | null;
  status: "Present" | "Absent" | "Week Off" | "Half Day" | "Leave" | "Late" | "Holiday" | null;
  source: "Web Punch" | "TeamOffice Import" | "Manual Entry" | "Biometric";
  attendance_verification: string | null;
  late_minutes: number | null;
  early_departure_minutes: number | null;
  overtime_minutes: number | null;
  missing_punch: "IN" | "OUT" | null;
  oms_punch_in: string | null;
  oms_punch_out: string | null;
  biometric_in_at: string | null;
  biometric_out_at: string | null;
  remark: string | null;
};
