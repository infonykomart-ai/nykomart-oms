// 2026-11-06 — device-agnostic biometric punch webhook.
//
// POST /api/biometric/punch
// Authorization: Bearer <per-device token shown once in Attendance Admin>
// {
//   "deviceKey": "BIO-...",
//   "deviceEmployeeId": "EMP001",
//   "punchAt": "2026-11-06T09:31:00+05:30",
//   "direction": "IN" | "OUT" | "AUTO",
//   "eventId": "optional device-side unique id",
//   "raw": { ... optional device payload ... }
// }
//
// The token is hashed in the database; this route never logs it or returns
// device/mapping details to the caller. Real hardware that cannot POST HTTP
// can keep using the existing TeamOffice Excel import.
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { processBiometricPunch, type PunchInput } from "@/lib/biometric/process";
import type { PunchDirection } from "@/lib/biometric/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tooLarge(request: Request): boolean {
  const len = Number(request.headers.get("content-length") ?? 0);
  return Number.isFinite(len) && len > 32_000;
}

export async function POST(request: Request) {
  if (tooLarge(request)) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    // Content-Length is absent on a chunked request, so enforce the same cap
    // on the actual body before parsing it.
    if (text.length > 32_000) {
      return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
    }
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = bearer || (request.headers.get("x-biometric-token") ?? "").trim();

  const directionRaw = String(body.direction ?? "AUTO").toUpperCase();
  const direction: PunchDirection =
    directionRaw === "IN" || directionRaw === "OUT" ? directionRaw : "AUTO";

  // Never persist a token/secret that a device happens to echo inside `raw`.
  // The event log is visible to admins for troubleshooting, not a credential
  // store.
  const raw =
    body.raw && typeof body.raw === "object" && !Array.isArray(body.raw)
      ? Object.fromEntries(
          Object.entries(body.raw as Record<string, unknown>).filter(
            ([key]) => !/(token|secret|password|authorization|api[_-]?key)/i.test(key)
          )
        )
      : null;

  const input: PunchInput = {
    deviceKey: String(body.deviceKey ?? ""),
    token,
    deviceEmployeeId: String(body.deviceEmployeeId ?? ""),
    punchAt: String(body.punchAt ?? ""),
    direction,
    sourceEventId: body.eventId != null ? String(body.eventId) : null,
    rawPayload: raw,
  };

  try {
    const supabase = createServiceRoleClient();
    const result = await processBiometricPunch(supabase, input);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.httpStatus });
    }
    return NextResponse.json(
      { ok: true, status: result.status, eventId: result.eventId, direction: result.direction ?? null },
      { status: result.status === "Duplicate" ? 200 : result.status === "Unmapped" ? 202 : 200 }
    );
  } catch (error) {
    // Never leak stack traces or configuration to a device.
    console.error("[biometric] punch processing failed", error);
    return NextResponse.json({ ok: false, error: "Could not process the punch." }, { status: 500 });
  }
}
