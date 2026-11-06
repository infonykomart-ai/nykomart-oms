"use server";

// 2026-11-06 — Attendance Admin controls for the biometric bridge. Device
// tokens are generated server-side and returned ONCE; only their SHA-256 hash
// and last four characters are stored. Mapping/shift/correction writes are
// capability-checked and company-scoped on every call.
import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { istTimeToInstant } from "@/lib/attendance/ist-date";
import { applyPunch } from "@/lib/biometric/process";
import { DEFAULT_SHIFT, shiftMetrics } from "@/lib/biometric/attendance";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createBiometricDevice(input: {
  companyId: string;
  name: string;
  vendor?: string;
  model?: string;
  mode?: "PUSH" | "PULL";
  endpointUrl?: string;
}): Promise<Result<{ deviceId: string; deviceKey: string; token: string }>> {
  const employee = await requireCapability("attendance_admin");
  if (!input.companyId || !employee.companyIds.includes(input.companyId)) return { ok: false, error: "You do not have access to this company." };
  if (!input.name?.trim()) return { ok: false, error: "Device name is required." };
  // No pull worker ships with the OMS: pretending to support PULL would create
  // a device that never syncs. The HTTP push endpoint is the supported path;
  // hardware that cannot push keeps using the Excel import.
  if (input.mode === "PULL") {
    return { ok: false, error: "Pull mode needs a device-specific adapter. Use HTTP push, or the TeamOffice Excel import." };
  }

  const supabase = createServiceRoleClient();
  const token = `bio_${randomBytes(24).toString("base64url")}`;
  const deviceKey = `BIO-${randomBytes(6).toString("hex").toUpperCase()}`;
  const { data, error } = await supabase
    .from("biometric_devices")
    .insert({
      company_id: input.companyId,
      device_key: deviceKey,
      name: input.name.trim().slice(0, 120),
      vendor: input.vendor?.trim() || null,
      model: input.model?.trim() || null,
      mode: "PUSH",
      endpoint_url: input.endpointUrl?.trim() || null,
      api_key_hash: hash(token),
      api_key_last4: token.slice(-4),
      created_by: employee.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the device." };

  await logAudit(supabase, {
    companyId: input.companyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "biometric.device_created",
    entityType: "biometric_device",
    entityId: data.id,
    entityLabel: input.name,
  });
  revalidatePath("/dashboard/attendance/biometric");
  return { ok: true, data: { deviceId: data.id, deviceKey, token } };
}

export async function rotateBiometricToken(deviceId: string): Promise<Result<{ token: string }>> {
  const employee = await requireCapability("attendance_admin");
  const supabase = createServiceRoleClient();
  const { data: device } = await supabase.from("biometric_devices").select("id, company_id, name").eq("id", deviceId).maybeSingle();
  if (!device || !employee.companyIds.includes(device.company_id)) return { ok: false, error: "Device not found." };
  const token = `bio_${randomBytes(24).toString("base64url")}`;
  const { error } = await supabase
    .from("biometric_devices")
    .update({ api_key_hash: hash(token), api_key_last4: token.slice(-4), updated_at: new Date().toISOString() })
    .eq("id", device.id);
  if (error) return { ok: false, error: error.message };
  await logAudit(supabase, {
    companyId: device.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "biometric.token_rotated",
    entityType: "biometric_device",
    entityId: device.id,
    entityLabel: device.name,
  });
  revalidatePath("/dashboard/attendance/biometric");
  return { ok: true, data: { token } };
}

export async function setBiometricDeviceActive(deviceId: string, active: boolean): Promise<Result> {
  const employee = await requireCapability("attendance_admin");
  const supabase = createServiceRoleClient();
  const { data: device } = await supabase.from("biometric_devices").select("id, company_id, name").eq("id", deviceId).maybeSingle();
  if (!device || !employee.companyIds.includes(device.company_id)) return { ok: false, error: "Device not found." };
  const { error } = await supabase.from("biometric_devices").update({ active, updated_at: new Date().toISOString() }).eq("id", device.id);
  if (error) return { ok: false, error: error.message };
  await logAudit(supabase, {
    companyId: device.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: active ? "biometric.device_enabled" : "biometric.device_disabled",
    entityType: "biometric_device",
    entityId: device.id,
    entityLabel: device.name,
  });
  revalidatePath("/dashboard/attendance/biometric");
  return { ok: true };
}

export async function saveBiometricShift(input: {
  companyId: string;
  id?: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayMinutes: number;
  overtimeAfterMinutes: number;
  active?: boolean;
}): Promise<Result> {
  const employee = await requireCapability("attendance_admin");
  if (!input.companyId || !employee.companyIds.includes(input.companyId)) return { ok: false, error: "You do not have access to this company." };
  if (!input.name?.trim()) return { ok: false, error: "Shift name is required." };
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(input.startTime) || !time.test(input.endTime)) return { ok: false, error: "Start/end time must be HH:MM (24h)." };
  // The shift engine is a same-day policy; an end <= start would calculate
  // negative working hours. Overnight shifts need a dedicated policy first.
  if (input.endTime <= input.startTime) return { ok: false, error: "Shift end must be after start (overnight shifts are not supported yet)." };
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));

  const supabase = createServiceRoleClient();
  const fields = {
    company_id: input.companyId,
    name: input.name.trim().slice(0, 80),
    start_time: input.startTime,
    end_time: input.endTime,
    grace_minutes: clamp(input.graceMinutes, 0, 240),
    half_day_minutes: clamp(input.halfDayMinutes, 1, 1440),
    overtime_after_minutes: clamp(input.overtimeAfterMinutes, 0, 1440),
    active: input.active ?? true,
  };
  const { data: saved, error } = input.id
    ? await supabase.from("attendance_shifts").update(fields).eq("id", input.id).eq("company_id", input.companyId).select("id").maybeSingle()
    : await supabase.from("attendance_shifts").upsert(fields, { onConflict: "company_id,name" }).select("id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!saved) return { ok: false, error: "Shift not found in this company." };
  await logAudit(supabase, {
    companyId: input.companyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: input.id ? "biometric.shift_updated" : "biometric.shift_created",
    entityType: "attendance_shift",
    entityId: saved.id,
    entityLabel: fields.name,
    changes: { start: fields.start_time, end: fields.end_time, grace: fields.grace_minutes },
  });
  revalidatePath("/dashboard/attendance/biometric");
  return { ok: true };
}

export async function saveBiometricMapping(input: {
  id?: string;
  deviceId: string;
  employeeId: string;
  deviceEmployeeId: string;
  shiftId?: string | null;
  active?: boolean;
}): Promise<Result> {
  const employee = await requireCapability("attendance_admin");
  const supabase = createServiceRoleClient();
  const { data: device } = await supabase.from("biometric_devices").select("id, company_id").eq("id", input.deviceId).maybeSingle();
  if (!device || !employee.companyIds.includes(device.company_id)) return { ok: false, error: "Device not found." };
  const { data: mappedEmployee } = await supabase.from("employees").select("id, company_id").eq("id", input.employeeId).maybeSingle();
  if (!mappedEmployee || mappedEmployee.company_id !== device.company_id) {
    return { ok: false, error: "Employee must belong to the device's company." };
  }
  const deviceEmployeeId = input.deviceEmployeeId.trim();
  if (!deviceEmployeeId) return { ok: false, error: "Biometric employee ID is required." };
  if (input.shiftId) {
    const { data: shift } = await supabase.from("attendance_shifts").select("id, company_id").eq("id", input.shiftId).maybeSingle();
    if (!shift || shift.company_id !== device.company_id) return { ok: false, error: "Shift does not belong to the device's company." };
  }

  const fields = {
    company_id: device.company_id,
    device_id: device.id,
    employee_id: mappedEmployee.id,
    device_employee_id: deviceEmployeeId.slice(0, 100),
    shift_id: input.shiftId || null,
    active: input.active ?? true,
    created_by: employee.id,
    updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = input.id
    ? await supabase.from("biometric_employee_map").update(fields).eq("id", input.id).eq("device_id", device.id).select("id").maybeSingle()
    : await supabase.from("biometric_employee_map").insert(fields).select("id").maybeSingle();
  if (error) {
    if (error.code === "23505" || /duplicate key/i.test(error.message)) {
      return { ok: false, error: "That biometric ID or employee is already mapped on this device. One person can only have one mapping per device." };
    }
    return { ok: false, error: error.message };
  }
  if (!saved) return { ok: false, error: "Mapping not found for this device." };
  await logAudit(supabase, {
    companyId: device.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: input.id ? "biometric.mapping_updated" : "biometric.mapping_created",
    entityType: "biometric_employee_map",
    entityId: saved.id,
    entityLabel: deviceEmployeeId,
    changes: { device_id: device.id, employee_id: mappedEmployee.id },
  });
  revalidatePath("/dashboard/attendance/biometric");
  return { ok: true };
}

export async function setBiometricMappingActive(id: string, active: boolean): Promise<Result> {
  const employee = await requireCapability("attendance_admin");
  const supabase = createServiceRoleClient();
  const { data: row } = await supabase.from("biometric_employee_map").select("id, company_id, device_employee_id").eq("id", id).maybeSingle();
  if (!row || !employee.companyIds.includes(row.company_id)) return { ok: false, error: "Mapping not found." };
  const { error } = await supabase.from("biometric_employee_map").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logAudit(supabase, {
    companyId: row.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: active ? "biometric.mapping_enabled" : "biometric.mapping_disabled",
    entityType: "biometric_employee_map",
    entityId: row.id,
    entityLabel: row.device_employee_id,
  });
  revalidatePath("/dashboard/attendance/biometric");
  return { ok: true };
}

export async function retryBiometricEvent(eventId: string): Promise<Result> {
  const employee = await requireCapability("attendance_admin");
  const supabase = createServiceRoleClient();
  const { data: event } = await supabase
    .from("biometric_punch_events")
    .select("id, company_id, device_id, device_employee_id, punch_at, direction, status")
    .eq("id", eventId)
    .maybeSingle();
  if (!event || !employee.companyIds.includes(event.company_id)) return { ok: false, error: "Event not found." };
  if (event.status === "Processed") return { ok: false, error: "This event was already processed successfully." };
  await supabase.from("biometric_punch_events").update({ status: "Failed", error: "Retrying" }).eq("id", event.id);
  const result = await applyPunch(supabase, {
    eventId: event.id,
    companyId: event.company_id,
    deviceId: event.device_id,
    deviceEmployeeId: event.device_employee_id,
    punchAt: event.punch_at,
    direction: event.direction,
  });
  await logAudit(supabase, {
    companyId: event.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "biometric.event_retried",
    entityType: "biometric_punch_event",
    entityId: event.id,
    entityLabel: `${event.device_employee_id} · ${event.punch_at}`,
    changes: { success: result.ok, error: result.ok ? null : result.error },
  });
  revalidatePath("/dashboard/attendance/biometric");
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export async function resolveBiometricAttendance(input: {
  employeeId: string;
  attendanceDate: string;
  inTime: string;
  outTime: string;
  reason: string;
}): Promise<Result> {
  const employee = await requireCapability("attendance_admin");
  if (!input.reason?.trim()) return { ok: false, error: "A correction reason is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.attendanceDate)) return { ok: false, error: "Invalid attendance date." };
  const punchIn = input.inTime ? istTimeToInstant(input.attendanceDate, input.inTime) : null;
  const punchOut = input.outTime ? istTimeToInstant(input.attendanceDate, input.outTime) : null;
  if (input.inTime && !punchIn) return { ok: false, error: "IN time must be HH:MM (24h)." };
  if (input.outTime && !punchOut) return { ok: false, error: "OUT time must be HH:MM (24h)." };
  if (!punchIn && !punchOut) return { ok: false, error: "Enter at least one corrected punch." };
  if (punchIn && punchOut && new Date(punchOut).getTime() <= new Date(punchIn).getTime()) {
    return { ok: false, error: "OUT time must be after IN time." };
  }

  const supabase = createServiceRoleClient();
  const { data: emp } = await supabase.from("employees").select("id, company_id").eq("id", input.employeeId).maybeSingle();
  if (!emp || !employee.companyIds.includes(emp.company_id)) return { ok: false, error: "Employee not found." };

  const { data: existing } = await supabase
    .from("attendance")
    .select("id, punch_in, punch_out, oms_punch_in, oms_punch_out, source")
    .eq("employee_id", emp.id)
    .eq("attendance_date", input.attendanceDate)
    .maybeSingle();

  // Correct against the employee's mapped shift, not the hard-coded office
  // default — otherwise a 06:00–15:00 shift would be marked late every day.
  const { data: mapping } = await supabase
    .from("biometric_employee_map")
    .select("shift_id")
    .eq("employee_id", emp.id)
    .eq("active", true)
    .not("shift_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: shiftRow } = mapping?.shift_id
    ? await supabase
        .from("attendance_shifts")
        .select("start_time, end_time, grace_minutes, half_day_minutes, overtime_after_minutes")
        .eq("id", mapping.shift_id)
        .maybeSingle()
    : { data: null };
  const metrics = shiftMetrics(
    punchIn,
    punchOut,
    shiftRow
      ? {
          name: "configured",
          start: shiftRow.start_time,
          end: shiftRow.end_time,
          graceMinutes: shiftRow.grace_minutes,
          halfDayMinutes: shiftRow.half_day_minutes,
          overtimeAfterMinutes: shiftRow.overtime_after_minutes,
        }
      : DEFAULT_SHIFT
  );
  const missingPunch: "IN" | "OUT" | null = punchIn && !punchOut ? "OUT" : !punchIn && punchOut ? "IN" : null;
  const fields = {
    employee_id: emp.id,
    company_id: emp.company_id,
    attendance_date: input.attendanceDate,
    punch_in: punchIn,
    punch_out: punchOut,
    status: metrics.status,
    source: "Manual Entry" as const,
    attendance_verification: "Manual Override",
    missing_punch: missingPunch,
    device_status: metrics.status,
    late_minutes: metrics.lateMinutes,
    early_departure_minutes: metrics.earlyDepartureMinutes,
    overtime_minutes: metrics.overtimeMinutes,
    oms_punch_in: existing?.oms_punch_in ?? (existing?.source !== "Biometric" ? existing?.punch_in : null) ?? null,
    oms_punch_out: existing?.oms_punch_out ?? (existing?.source !== "Biometric" ? existing?.punch_out : null) ?? null,
    entered_by_employee_id: employee.id,
    remark: `Manual override: ${input.reason.trim().slice(0, 500)}`,
  };
  const { data: saved, error } = existing
    ? await supabase.from("attendance").update(fields).eq("id", existing.id).select("id").maybeSingle()
    : await supabase.from("attendance").insert(fields).select("id").maybeSingle();
  if (error) return { ok: false, error: error.message };

  await logAudit(supabase, {
    companyId: emp.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "biometric.attendance_corrected",
    entityType: "attendance",
    entityId: saved?.id ?? existing?.id ?? null,
    entityLabel: `${input.attendanceDate} — ${input.inTime || "—"} to ${input.outTime || "—"}`,
    changes: {
      reason: input.reason.trim(),
      previous_source: existing?.source ?? null,
      previous_punch_in: existing?.punch_in ?? null,
      previous_punch_out: existing?.punch_out ?? null,
      punch_in: punchIn,
      punch_out: punchOut,
    },
  });
  revalidatePath("/dashboard/attendance/biometric");
  revalidatePath("/dashboard/attendance");
  return { ok: true };
}
