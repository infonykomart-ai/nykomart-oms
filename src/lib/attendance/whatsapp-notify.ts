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
// 2026-09-30 — "sabhi employe ke whatsaap no update hai lekin kisi ke msg
// gaya hai kisi ke nahi esa kyu check karo": only SOME employees received
// their punch confirmation. Code-audit found three real holes, now fixed:
//   1. BAD NUMBERS SILENTLY SENT AS-IS — the old normalizer only prefixed
//      "91" to exactly-10-digit values and passed ANYTHING else through
//      unchanged. A number stored the way Indians actually type them —
//      with a leading 0 ("09876543210"), a 0+91 prefix ("091..."), or a
//      double country code ("9191987654321 0" → 13 digits) — went to
//      Whapi in that broken shape and Whapi rejected it, invisibly.
//      normalizeWhatsappNumber() now: strips ALL leading zeros (no valid
//      Indian number starts with one), then maps 10 digits → 91+10 and
//      accepts a 91-prefixed 12-digit number; anything else is rejected
//      BEFORE the API call. Previously-saved numbers of those shapes now
//      send correctly — no data fix needed for the common cases.
//   2. ERRORS SWALLOWED — sendWhatsAppText returned bare `res.ok` and
//      ignored Whapi's error JSON, so every rejection left zero trace.
//      It now parses Whapi's error body (same best-effort extraction as
//      the order route's callWhapi) and notifyEmployee console.errors the
//      exact failure per employee — visible in Vercel's Runtime Logs.
//   3. SKIPS INVISIBLE — a missing WHAPI_TOKEN, or a blank/unfixable
//      whatsapp_no, also skipped silently. Both now console.warn with the
//      employee id (and the raw stored value for the number case), so
//      "kisi ke kyu nahi gaya" is answerable from logs instead of guesswork.
//
// STILL BY DESIGN (the by-far-most-likely reason someone didn't get a
// message on a given day): the message fires ONLY on a punch that actually
// got recorded. recordPunchIn returns early when that employee already has
// a punch-in row for the IST day (including one recorded BEFORE this
// feature deployed), and recordPunchOut returns early when there's no
// punch-in row or the punch-out is already set — no repeat message, no
// message for a punch that never happened. An employee who punched in
// before the deploy simply had nothing left for the notification to attach
// to. Whapi's own panel (panel.whapi.cloud → channel) is still the
// authoritative delivery log.
//
// Contract (identical to notifyCompanion's): called AFTER the real write
// already succeeded, wrapped so it can NEVER throw, with a hard 5s abort
// timeout so a slow Whapi call can never stretch the employee's punch
// request. A missing token, a missing/blank whatsapp_no, or any send
// failure is skipped (and now LOGGED) — attendance itself must never block
// or error over a notification. (No retry: Whapi's free sandbox is
// ~150 msg/day shared with the order-photo notifications; failures are
// logged, not retried, to keep the punch path fast and the quota honest.)
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
// 2026-09-30 — normalizer extracted to src/lib/whatsapp/normalize.ts so the
// admin Employees page's validity badges / one-click Test button and the
// Team Directory's wa.me links validate numbers the EXACT same way this
// sender does (they used to disagree — part of why partial delivery was so
// hard to diagnose).
import { normalizeWhatsappNumber } from "@/lib/whatsapp/normalize";

const WHAPI_BASE_URL = "https://gate.whapi.cloud";
const SEND_TIMEOUT_MS = 5_000;

type SendResult = { ok: true } | { ok: false; error: string };

async function sendWhatsAppText(token: string, to: string, body: string): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`${WHAPI_BASE_URL}/messages/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, body }),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    // Best-effort error extraction — Whapi's exact error JSON shape isn't
    // fully documented (same approach as the order route's callWhapi):
    // surface whatever message-ish field exists, fall back to HTTP status.
    const json = (await res.json().catch(() => null)) as
      | { error?: { message?: string } | string; detail?: string; message?: string; title?: string }
      | null;
    const error =
      (typeof json?.error === "string" ? json.error : json?.error?.message) ||
      json?.detail ||
      json?.message ||
      json?.title ||
      res.statusText ||
      `HTTP ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    // AbortController abort surfaces as a TimeoutError/DOMException — name
    // it clearly instead of an empty catch.
    return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? "timeout after 5s" : "network error reaching Whapi" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 2026-09-30 — admin "Test" send, used by the one-click Test button on the
 * Employees page (employeeWhatsappActions): fires a REAL Whapi message to
 * the employee's number as stored RIGHT NOW and returns exactly what
 * happened — so "kisi ke nahi gaya" stops being guesswork. Unlike the
 * punch notifications this is allowed to surface errors to the admin, and
 * deliberately does NOT log skips/failures here (the caller renders them
 * verbatim; double-logging a number in the response AND console would
 * just duplicate noise).
 */
export async function sendTestWhatsapp(params: {
  supabase: SupabaseClient<Database>;
  employeeId: string;
}): Promise<{ ok: boolean; error?: string; to?: string }> {
  const { supabase, employeeId } = params;
  try {
    const token = process.env.WHAPI_TOKEN;
    if (!token) return { ok: false, error: "WHAPI_TOKEN is not configured on the server — WhatsApp sending is off." };

    const { data: employee, error } = await supabase
      .from("employees")
      .select("whatsapp_no")
      .eq("id", employeeId)
      .maybeSingle();
    if (error) return { ok: false, error: `DB lookup failed: ${error.message}` };
    const raw = employee?.whatsapp_no;
    if (!raw || !raw.trim()) return { ok: false, error: "No WhatsApp number on record — fill it in first." };

    const to = normalizeWhatsappNumber(raw);
    if (!to) {
      return {
        ok: false,
        error: `Stored number "${raw}" is not usable — expected 10 digits (98765...), 0-prefixed (0...), or 91-prefixed (91...).`,
      };
    }

    const result = await sendWhatsAppText(
      token,
      to,
      [
        "✅ Test Message — Nykomart OMS",
        "",
        "This is a test confirmation that WhatsApp alerts are working for your number.",
        "You'll receive automatic messages here when your attendance is marked (punch in / punch out).",
        "",
        footer(),
      ].join("\n")
    );
    if (!result.ok) return { ok: false, error: `Whapi rejected the message (to ${to}): ${result.error}`, to };
    return { ok: true, to };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
 * and never takes longer than one 5s Whapi call. Every skip and every
 * failure is logged with the employee id — a "kisi ke nahi gaya" report
 * is answerable from Vercel Runtime Logs, not guesswork.
 */
async function notifyEmployee(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  message: string
): Promise<void> {
  try {
    const token = process.env.WHAPI_TOKEN;
    if (!token) {
      console.warn(`[whatsapp] punch notification skipped — WHAPI_TOKEN not set (employee ${employeeId})`);
      return;
    }

    const { data: employee, error } = await supabase
      .from("employees")
      .select("whatsapp_no")
      .eq("id", employeeId)
      .maybeSingle();
    if (error) {
      console.error(`[whatsapp] punch notification skipped — DB lookup failed for employee ${employeeId}: ${error.message}`);
      return;
    }

    const raw = employee?.whatsapp_no;
    if (!raw || !raw.trim()) {
      console.warn(`[whatsapp] punch notification skipped — employee ${employeeId} has no whatsapp_no on record`);
      return;
    }
    const to = normalizeWhatsappNumber(raw);
    if (!to) {
      // Log the RAW value (server logs, never shown to employees) so the
      // fix is a 10-second edit in the Employees page instead of guessing.
      console.warn(
        `[whatsapp] punch notification skipped — employee ${employeeId} whatsapp_no "${raw}" is not a usable number (expected 10 digits, 0-prefixed, or 91-prefixed)`
      );
      return;
    }

    const result = await sendWhatsAppText(token, to, message);
    if (!result.ok) {
      console.error(`[whatsapp] punch notification FAILED for employee ${employeeId} (to ${to}): ${result.error}`);
    }
    // Success is intentionally not logged — Whapi's panel is the delivery log.
  } catch (err) {
    // Never block or fail the caller's real punch over this — but leave a
    // trace; total silence is what made the partial delivery a mystery.
    console.error(`[whatsapp] punch notification crashed for employee ${employeeId}: ${err instanceof Error ? err.message : String(err)}`);
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
