// 2026-09-29 — "JIS JIS EMPLOYE KA WHATSAAP PAR AUTO MSG CHALA JAYE KI
// ATTENDANCE LAG GYI HAI YA PUNCH LAG GAYA HAI ENGLISH ME EK ACHA SA MSG
// JAYE LOGIN OR LOGOUT KA": every successful Punch In / Punch Out sends a
// polite English confirmation to THAT EMPLOYEE'S OWN WhatsApp number
// (employees.whatsapp_no) — the login-hook auto punch, the logout-hook
// punch-out, and the manual Attendance-page buttons all go through
// recordPunchIn/recordPunchOut (src/lib/attendance/punch.ts), so calling
// from there covers every path exactly once.
//
// Delivery channel: Whapi.Cloud — the same WhatsApp-Web-session-as-a-REST-
// API service the order-photo notifications already use (see
// src/app/api/whapi-send-order/route.ts for that history: the official
// Cloud API can't do what this business needs, and the user signed up for
// Whapi themselves). Reuses the SAME WHAPI_TOKEN env var — no new
// credentials, no new signup. The `to` here is an individual chat id
// (E.164 digits, e.g. "919876543210"), unlike the order route's group id
// ("...@g.us"); Whapi's /messages/text accepts both.
//
// Contract (identical to notifyCompanion's): called AFTER the real write
// already succeeded, wrapped so it can NEVER throw, with a hard 5s abort
// timeout so a slow Whapi call can never stretch the employee's punch
// request. A missing token, a missing/blank whatsapp_no, or any send
// failure is silently skipped — attendance itself must never block or
// error over a notification. (Deliberate v1 trade-off: no retry/no log of
// delivery failures; Whapi's own panel shows the channel's message log.)
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const WHAPI_BASE_URL = "https://gate.whapi.cloud";
const SEND_TIMEOUT_MS = 5_000;

/** E.164 digits Whapi expects for a 1:1 chat ("9198XXXXXXXXXX"). */
function normalizeWhatsappNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 10) return null;
  // Bare 10-digit numbers are stored without the country code — assume
  // India (the business's whole roster), matching how wa.me links in the
  // Team Directory already normalize.
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

async function sendWhatsAppText(token: string, to: string, body: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`${WHAPI_BASE_URL}/messages/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, body }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const IST = "Asia/Kolkata";
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });
}
function fmtDuration(fromIso: string, toIso: string): string {
  const mins = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function footer(): string {
  return "— Automated message from Nykomart OMS. Please do not reply.";
}

/**
 * Fire-and-forget both ways: the caller awaits this (so Vercel doesn't
 * freeze the function mid-send), but this function itself never throws
 * and never takes longer than one 5s Whapi call.
 */
async function notifyEmployee(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  message: string
): Promise<void> {
  try {
    const token = process.env.WHAPI_TOKEN;
    if (!token) return; // WhatsApp automation not configured — skip silently.

    const { data: employee } = await supabase
      .from("employees")
      .select("whatsapp_no")
      .eq("id", employeeId)
      .maybeSingle();
    const to = employee?.whatsapp_no ? normalizeWhatsappNumber(employee.whatsapp_no) : null;
    if (!to) return; // No number on record — nothing to send to.

    await sendWhatsAppText(token, to, message);
  } catch {
    // Never block or fail the caller's real punch over this.
  }
}

/** Punch In confirmation — status is "Present" or "Late" (punch.ts's cutoff logic). */
export async function notifyPunchInWhatsapp(params: {
  supabase: SupabaseClient<Database>;
  employeeId: string;
  status: "Present" | "Late";
  punchInAtIso: string;
}): Promise<void> {
  const { supabase, employeeId, status, punchInAtIso } = params;
  const statusLine =
    status === "Late"
      ? "• Status: Late (recorded after the 9:45 AM cut-off)"
      : "• Status: Present";
  await notifyEmployee(
    supabase,
    employeeId,
    [
      "✅ Attendance Marked — Nykomart OMS",
      "",
      "Hello,",
      "",
      "Your attendance has been recorded successfully.",
      `• Date: ${fmtDay(punchInAtIso)}`,
      `• Punch In: ${fmtTime(punchInAtIso)} (IST)`,
      statusLine,
      "",
      "Wish you a productive day ahead!",
      "",
      footer(),
    ].join("\n")
  );
}

/** Punch Out confirmation — includes the day's total work duration. */
export async function notifyPunchOutWhatsapp(params: {
  supabase: SupabaseClient<Database>;
  employeeId: string;
  punchInAtIso: string | null;
  punchOutAtIso: string;
}): Promise<void> {
  const { supabase, employeeId, punchInAtIso, punchOutAtIso } = params;
  await notifyEmployee(
    supabase,
    employeeId,
    [
      "🕘 Punch Out Recorded — Nykomart OMS",
      "",
      "Hello,",
      "",
      "Your punch out has been recorded successfully.",
      `• Date: ${fmtDay(punchOutAtIso)}`,
      `• Punch Out: ${fmtTime(punchOutAtIso)} (IST)`,
      ...(punchInAtIso ? [`• Work Duration: ${fmtDuration(punchInAtIso, punchOutAtIso)}`] : []),
      "",
      "Thank you for your work today. See you tomorrow!",
      "",
      footer(),
    ].join("\n")
  );
}
