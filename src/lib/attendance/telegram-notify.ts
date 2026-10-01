// 2026-09-30 — "EMPLOYEE KO JO MSG WHATSAPP SE THA USKO WHATSAPP KI JAGAH
// TELEGRAM SE CONNECT KARO DIRECT TELEGRAM PAR MSG JAYE": replaces
// whatsapp-notify.ts (now deleted) as the punch in/out confirmation channel.
// Destination = a personal Telegram DM to THAT employee's own chat id
// (employees.telegram_chat_id), NOT the order-photo group — WhatsApp is
// switched OFF for this flow entirely (user's explicit choice: "WhatsApp:
// Band — sirf Telegram").
//
// Same single-choke-point reasoning as the old WhatsApp sender: every
// punch path (login-hook auto punch, logout-hook punch-out, manual
// Attendance-page buttons) goes through recordPunchIn/recordPunchOut
// (src/lib/attendance/punch.ts), so calling from there covers every path
// exactly once per day.
//
// Delivery: Telegram Bot API `sendMessage`, plain text, NO parse_mode —
// same rule as src/app/api/telegram-send-order/route.ts's header: free
// text (names, "Late (recorded after the 9:45 AM cut-off)") can break
// Telegram's Markdown/HTML parsers with a hard 400, and plain text always
// sends. The bot token is the SAME shared TELEGRAM_BOT_TOKEN the order
// route uses — no new signup; only the destination chat differs (a private
// DM instead of the company group).
//
// Setup (see .env.example): TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME
// (needed to build the t.me deep link the employee presses Start on).
//
// Connect flow (self-serve, attendance page): the employee opens
// https://t.me/<botusername>?start=<employee_id> and presses Start — the
// bot receives "/start <employee_id>" in its getUpdates queue;
// connectEmployeeTelegram() below reads that exact payload back out and
// stores message.from.id (private chat only, never a bot) into
// employees.telegram_chat_id for the CALLING employee's own row. Strict
// payload matching on purpose: a loose "latest private message" heuristic
// could save SOMEONE ELSE's chat id if two employees clicked around the
// same time — a wrong chat id silently DMs the wrong person.
//
// Contract (identical to whatsapp-notify.ts's): called AFTER the real
// write already succeeded, wrapped so it can NEVER throw, with a hard 5s
// abort timeout so a slow Telegram call can never stretch the employee's
// punch request. A missing token, a missing/NULL telegram_chat_id (not
// connected), or any send failure is skipped — and LOGGED with the
// employee id — so "kisi ke msg nahi gaya" is answerable from Vercel
// Runtime Logs, never guesswork. Attendance itself must never block or
// error over a notification. (No retry: keeps the punch path fast.)
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const SEND_TIMEOUT_MS = 5_000;

type SendResult = { ok: true } | { ok: false; error: string };

async function sendTelegramText(token: string, chatId: string, text: string): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const form = new URLSearchParams({ chat_id: chatId, text });
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (res.ok && json?.ok) return { ok: true };
    return { ok: false, error: json?.description || res.statusText || `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.name === "TimeoutError" ? "timeout after 5s" : "network error reaching Telegram",
    };
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
 * and never takes longer than one 5s Telegram call. Every skip and every
 * failure is logged with the employee id.
 */
async function notifyEmployee(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  message: string
): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn(`[telegram] punch notification skipped — TELEGRAM_BOT_TOKEN not set (employee ${employeeId})`);
      return;
    }

    const { data: employee, error } = await supabase
      .from("employees")
      .select("telegram_chat_id")
      .eq("id", employeeId)
      .maybeSingle();
    if (error) {
      console.error(`[telegram] punch notification skipped — DB lookup failed for employee ${employeeId}: ${error.message}`);
      return;
    }

    const chatId = employee?.telegram_chat_id;
    if (!chatId || !chatId.trim()) {
      console.warn(
        `[telegram] punch notification skipped — employee ${employeeId} has no telegram_chat_id (not connected yet — Attendance page → Connect Telegram)`
      );
      return;
    }

    const result = await sendTelegramText(token, chatId.trim(), message);
    if (!result.ok) {
      console.error(`[telegram] punch notification FAILED for employee ${employeeId} (chat ${chatId}): ${result.error}`);
    }
    // Success is intentionally not logged — Telegram's own chat is the delivery log.
  } catch (err) {
    // Never block or fail the caller's real punch over this — but leave a trace.
    console.error(`[telegram] punch notification crashed for employee ${employeeId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Punch In confirmation — status is "Present" or "Late" (punch.ts's cutoff logic). */
export async function notifyPunchInTelegram(params: {
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
export async function notifyPunchOutTelegram(params: {
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

/**
 * Admin "Test" send (Employees page) AND the employee's own Test button
 * on the Attendance page — fires a REAL Telegram DM to the chat id as
 * stored RIGHT NOW and returns exactly what happened, so "kisi ke nahi
 * gaya" stops being guesswork. Allowed to surface errors to the caller
 * (the UI renders them verbatim) — deliberately does NOT log here to
 * avoid double-reporting the same message.
 */
export async function sendTestTelegram(params: {
  supabase: SupabaseClient<Database>;
  employeeId: string;
}): Promise<{ ok: boolean; error?: string; to?: string }> {
  const { supabase, employeeId } = params;
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured on the server — Telegram sending is off." };

    const { data: employee, error } = await supabase
      .from("employees")
      .select("telegram_chat_id")
      .eq("id", employeeId)
      .maybeSingle();
    if (error) return { ok: false, error: `DB lookup failed: ${error.message}` };
    const chatId = employee?.telegram_chat_id;
    if (!chatId || !chatId.trim()) {
      return { ok: false, error: "Telegram not connected yet — open the Connect link on the Attendance page and press Start in the bot first." };
    }

    const result = await sendTelegramText(
      token,
      chatId.trim(),
      [
        "✅ Test Message — Nykomart OMS",
        "",
        "This is a test confirmation that Telegram alerts are working for your account.",
        "You'll receive automatic messages here when your attendance is marked (punch in / punch out).",
        "",
        footer(),
      ].join("\n")
    );
    if (!result.ok) return { ok: false, error: `Telegram rejected the message (chat ${chatId.trim()}): ${result.error}`, to: chatId.trim() };
    return { ok: true, to: chatId.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type ConnectResult = { ok: boolean; error?: string; chatId?: string };

/**
 * Self-serve connect: reads the bot's getUpdates queue for a "/start
 * <employee_id>" message sent by THIS employee (the payload comes from the
 * Attendance page's deep link t.me/<bot>?start=<employee_id>), verifies it
 * is a private chat from a non-bot account, and saves message.from.id to
 * the employee's own row. Strictly scoped: can only ever write to
 * employeeId's row; the payload must match exactly or nothing is saved.
 */
export async function connectEmployeeTelegram(params: {
  supabase: SupabaseClient<Database>;
  employeeId: string;
}): Promise<ConnectResult> {
  const { supabase, employeeId } = params;
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured on the server — ask admin to set it." };
    if (!process.env.TELEGRAM_BOT_USERNAME) {
      return { ok: false, error: "TELEGRAM_BOT_USERNAME is not configured on the server — ask admin to set it." };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    let updates: {
      message?: {
        text?: string;
        chat?: { type?: string };
        from?: { id?: number; is_bot?: boolean };
      };
    }[] = [];
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: controller.signal });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: typeof updates; description?: string } | null;
      if (!res.ok || !json?.ok) {
        return { ok: false, error: `getUpdates failed: ${json?.description || res.statusText || `HTTP ${res.status}`}` };
      }
      updates = json.result ?? [];
    } catch {
      return { ok: false, error: "Could not reach Telegram (timeout) — try again in a moment." };
    } finally {
      clearTimeout(timer);
    }

    const expectedText = `/start ${employeeId}`;
    const match = updates.find(
      (u) =>
        u.message?.text === expectedText &&
        u.message?.chat?.type === "private" &&
        u.message?.from &&
        u.message.from.is_bot !== true &&
        typeof u.message.from.id === "number"
    );
    const chatId = match?.message?.from?.id;
    if (!chatId) {
      return {
        ok: false,
        error:
          "No Start message found from you yet — open the Connect link above, press Start inside the bot chat, then click Connect again.",
      };
    }

    // Own-row write only (defense in depth: employeeId is the caller's own id).
    const { error } = await supabase
      .from("employees")
      .update({ telegram_chat_id: String(chatId) })
      .eq("id", employeeId);
    if (error) return { ok: false, error: `Could not save: ${error.message}` };
    return { ok: true, chatId: String(chatId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
