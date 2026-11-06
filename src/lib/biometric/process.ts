// 2026-11-06 — biometric punch ingestion/processing.
//
// The device (or its middleware) POSTs a punch to /api/biometric/punch with a
// per-device bearer token. This module authenticates the device, deduplicates
// the raw event, maps the device employee, and writes the authoritative
// attendance time. OMS web punches are never overwritten silently: their
// timestamps are preserved in oms_punch_in/oms_punch_out before the biometric
// value becomes authoritative.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { istDateFromInstant } from "@/lib/attendance/ist-date";
import {
  DEFAULT_SHIFT,
  istTimeValue,
  resolveDirection,
  shiftMetrics,
  type PunchDirection,
  type ShiftRule,
} from "./attendance";

type ServiceClient = SupabaseClient<Database>;

export type PunchInput = {
  deviceKey: string;
  token: string;
  deviceEmployeeId: string;
  punchAt: string;
  direction?: PunchDirection;
  sourceEventId?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

export type PunchResult =
  | {
      ok: true;
      status: "Processed" | "Duplicate" | "Unmapped";
      eventId: string;
      attendanceId?: string;
      direction?: "IN" | "OUT";
    }
  | { ok: false; error: string; httpStatus: number };

function isIsoInstant(value: string): boolean {
  // A timezone is mandatory. "2026-11-06T09:31" would be interpreted in the
  // server's timezone (UTC on hosting) and silently shift the punch by 5h30m.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(new Date(value).getTime());
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function shiftRule(row: {
  start_time: string;
  end_time: string;
  grace_minutes: number;
  half_day_minutes: number;
  overtime_after_minutes: number;
} | null): ShiftRule {
  if (!row) return DEFAULT_SHIFT;
  return {
    name: "configured",
    start: row.start_time,
    end: row.end_time,
    graceMinutes: row.grace_minutes,
    halfDayMinutes: row.half_day_minutes,
    overtimeAfterMinutes: row.overtime_after_minutes,
  };
}

/**
 * Process one punch. Authentication + dedupe happen here (not in the route)
 * so a retry/background job can reuse exactly the same path.
 */
export async function processBiometricPunch(supabase: ServiceClient, input: PunchInput): Promise<PunchResult> {
  const deviceKey = input.deviceKey?.trim();
  const token = input.token?.trim();
  const deviceEmployeeId = input.deviceEmployeeId?.trim();
  if (!deviceKey || !token || !deviceEmployeeId) {
    return { ok: false, error: "deviceKey, token and deviceEmployeeId are required.", httpStatus: 400 };
  }
  if (!isIsoInstant(input.punchAt)) {
    return { ok: false, error: "punchAt must be an ISO date-time with a timezone (e.g. 2026-11-06T09:31:00+05:30).", httpStatus: 400 };
  }
  if (deviceKey.length > 100 || deviceEmployeeId.length > 100) {
    return { ok: false, error: "Invalid device/employee identifier.", httpStatus: 400 };
  }

  const { data: device, error: deviceError } = await supabase
    .from("biometric_devices")
    .select("id, company_id, api_key_hash, active")
    .eq("device_key", deviceKey)
    .maybeSingle();
  if (deviceError || !device || !device.active) {
    return { ok: false, error: "Device authentication failed.", httpStatus: 401 };
  }
  const hashed = await hashToken(token);
  if (!constantTimeEqual(hashed, device.api_key_hash)) {
    return { ok: false, error: "Device authentication failed.", httpStatus: 401 };
  }

  const punchAt = new Date(input.punchAt).toISOString();
  const direction: PunchDirection = input.direction ?? "AUTO";

  // Claim the raw event FIRST. The unique keys are the duplicate guard — a
  // device retry or two overlapping sync jobs cannot process the same punch
  // twice, even if they race past this insert by a millisecond.
  const { data: event, error: insertError } = await supabase
    .from("biometric_punch_events")
    .insert({
      company_id: device.company_id,
      device_id: device.id,
      device_employee_id: deviceEmployeeId,
      punch_at: punchAt,
      direction,
      source_event_id: input.sourceEventId?.trim() || null,
      raw_payload: input.rawPayload ?? null,
      status: "Failed",
      error: "Processing",
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505" || /duplicate key/i.test(insertError.message)) {
      const bySource = input.sourceEventId?.trim()
        ? await supabase
            .from("biometric_punch_events")
            .select("id")
            .eq("device_id", device.id)
            .eq("source_event_id", input.sourceEventId.trim())
            .maybeSingle()
        : { data: null };
      const existing =
        bySource.data ??
        (
          await supabase
            .from("biometric_punch_events")
            .select("id")
            .eq("device_id", device.id)
            .eq("device_employee_id", deviceEmployeeId)
            .eq("punch_at", punchAt)
            .maybeSingle()
        ).data;
      return {
        ok: true,
        status: "Duplicate",
        eventId: existing?.id ?? "",
      };
    }
    return { ok: false, error: "Could not store the punch event.", httpStatus: 500 };
  }

  return applyPunch(supabase, {
    eventId: event.id,
    companyId: device.company_id,
    deviceId: device.id,
    deviceEmployeeId,
    punchAt,
    direction,
  });
}

/**
 * Apply an already-claimed event (or retry a previously failed one). The event
 * row is updated — never duplicated — and attendance receives the same
 * authoritative values on every retry.
 */
export async function applyPunch(
  supabase: ServiceClient,
  args: {
    eventId: string;
    companyId: string;
    deviceId: string;
    deviceEmployeeId: string;
    punchAt: string;
    direction: PunchDirection;
  }
): Promise<PunchResult> {
  const fail = async (message: string, status: "Failed" | "Unmapped" = "Failed") => {
    await supabase.from("biometric_punch_events").update({ status, error: message }).eq("id", args.eventId);
    return {
      ok: false as const,
      // Mapping errors are useful to the device; database/config errors are not.
      error: status === "Unmapped" ? message : "Could not process the punch.",
      httpStatus: status === "Unmapped" ? 422 : 500,
    };
  };

  const { data: mapping, error: mapError } = await supabase
    .from("biometric_employee_map")
    .select("id, employee_id, shift_id, active")
    .eq("device_id", args.deviceId)
    .eq("device_employee_id", args.deviceEmployeeId)
    .maybeSingle();
  if (mapError) return fail(mapError.message);
  if (!mapping || !mapping.active) {
    return fail(`No active OMS employee is mapped to device employee ${args.deviceEmployeeId}.`, "Unmapped");
  }

  const attendanceDate = istDateFromInstant(args.punchAt);
  const { data: existing, error: attendanceError } = await supabase
    .from("attendance")
    .select(
      "id, punch_in, punch_out, oms_punch_in, oms_punch_out, source, biometric_in_at, biometric_out_at, punch_in_lat, punch_in_lng, punch_out_lat, punch_out_lng"
    )
    .eq("employee_id", mapping.employee_id)
    .eq("attendance_date", attendanceDate)
    .maybeSingle();
  if (attendanceError) return fail(attendanceError.message);

  const shiftRow = mapping.shift_id
    ? (
        await supabase
          .from("attendance_shifts")
          .select("start_time, end_time, grace_minutes, half_day_minutes, overtime_after_minutes")
          .eq("id", mapping.shift_id)
          .maybeSingle()
      ).data
    : (
        await supabase
          .from("attendance_shifts")
          .select("start_time, end_time, grace_minutes, half_day_minutes, overtime_after_minutes")
          .eq("company_id", args.companyId)
          .eq("active", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
      ).data;
  const effectiveShift = shiftRule(shiftRow ?? null);

  const direction = resolveDirection(
    args.direction,
    args.punchAt,
    {
      punchIn: existing?.biometric_in_at ?? null,
      punchOut: existing?.biometric_out_at ?? null,
    },
    effectiveShift
  );

  let biometricIn = existing?.biometric_in_at ?? null;
  let biometricOut = existing?.biometric_out_at ?? null;
  // Compare instants, not strings: PostgREST may return +00:00 while the
  // incoming punch is normalised to a trailing Z, and lexical comparison
  // would then disagree for the same moment.
  const punchMs = new Date(args.punchAt).getTime();
  if (direction === "IN") {
    biometricIn = biometricIn == null || punchMs < new Date(biometricIn).getTime() ? args.punchAt : biometricIn;
  } else {
    biometricOut = biometricOut == null || punchMs > new Date(biometricOut).getTime() ? args.punchAt : biometricOut;
  }

  const metrics = shiftMetrics(biometricIn, biometricOut, effectiveShift);

  const verification =
    biometricIn && biometricOut
      ? "Biometric Verified"
      : biometricIn
        ? "Missing OUT"
        : biometricOut
          ? "Missing IN"
          : "Pending Verification";
  const missingPunch: "IN" | "OUT" | null =
    biometricIn && !biometricOut ? "OUT" : !biometricIn && biometricOut ? "IN" : null;

  // Preserve a web/manual punch exactly once, before biometric becomes the
  // authoritative time source for that side.
  const omsIn =
    existing?.oms_punch_in ??
    (existing && existing.source !== "Biometric" && existing.punch_in ? existing.punch_in : null);
  const omsOut =
    existing?.oms_punch_out ??
    (existing && existing.source !== "Biometric" && existing.punch_out ? existing.punch_out : null);

  const fields = {
    employee_id: mapping.employee_id,
    company_id: args.companyId,
    attendance_date: attendanceDate,
    punch_in: biometricIn,
    punch_out: biometricOut,
    source: "Biometric" as const,
    attendance_verification: verification,
    biometric_device_id: args.deviceId,
    biometric_in_at: biometricIn,
    biometric_out_at: biometricOut,
    oms_punch_in: omsIn,
    oms_punch_out: omsOut,
    device_punch_in: biometricIn ? istTimeValue(biometricIn) : null,
    device_punch_out: biometricOut ? istTimeValue(biometricOut) : null,
    device_status: metrics.status,
    late_minutes: metrics.lateMinutes,
    early_departure_minutes: metrics.earlyDepartureMinutes,
    overtime_minutes: metrics.overtimeMinutes,
    missing_punch: missingPunch,
    biometric_synced_at: new Date().toISOString(),
    remark: "Biometric punch — device time is authoritative.",
  };

  const attendanceId = existing
    ? (
        await supabase
          .from("attendance")
          .update(fields)
          .eq("id", existing.id)
          .select("id")
          .single()
      ).data?.id
    : (
        await supabase
          .from("attendance")
          .insert({ ...fields, entered_by_employee_id: null })
          .select("id")
          .single()
      ).data?.id;

  if (!attendanceId) return fail("Could not write the attendance row.");

  await supabase
    .from("biometric_punch_events")
    .update({
      employee_id: mapping.employee_id,
      mapping_id: mapping.id,
      status: "Processed",
      error: null,
      attendance_id: attendanceId,
    })
    .eq("id", args.eventId);

  await supabase
    .from("biometric_devices")
    .update({ last_event_at: args.punchAt, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", args.deviceId);

  return { ok: true, status: "Processed", eventId: args.eventId, attendanceId, direction };
}
