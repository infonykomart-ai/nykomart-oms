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
// Setup: TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME (needed to build
// the t.me deep link the employee presses Start on), plus — 2026-10-01 —
// the optional destination switch TELEGRAM_ATTENDANCE_MODE=group with
// TELEGRAM_ATTENDANCE_CHAT_ID=<group chat id> to post every punch to ONE
// shared Telegram group (employee name prefixed) instead of per-employee
// DMs: group mode needs no per-employee connect step at all. Default
// (unset) = personal DM per employee, unchanged.
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
// 2026-10-05 — "same error not resolve yet": TWO things were silently
// breaking the live connect: (1) connectEmployeeTelegram hard-required the
// TELEGRAM_BOT_USERNAME ENV var even though connect never needs the handle
// (getUpdates only needs the token) — PR #7 had made the handle optional
// for the deep link via getMe, but this function still bailed before ever
// reading the queue; (2) Telegram desktop does NOT pre-fill the deep-link
// payload, so people end up typing a plain "/start" (no <employee id>) —
// the strict match can never hit that. Fix: accept a payload-less "/start"
// as a FALLBACK only when it is FRESH (last 15 min), private, non-bot,
// there is exactly ONE such candidate chat, and that chat id is not
// already saved on a DIFFERENT employee's row — so the wrong-person risk
// above still cannot happen. Best-effort deleteWebhook also runs when
// getUpdates fails/looks empty, in case an externally-registered webhook
// is draining the queue.
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

// 2026-10-01 — destination MODE, chosen purely by env config (no schema
// change, no admin table): "dm" (default — a personal DM per employee,
// exactly the flow verified in the 21-check E2E run) or "group" (one
// shared Telegram group/company chat — every punch posted there prefixed
// with the employee's name, so NO per-employee connect/Start step is
// needed at all; the bot must simply be a member of that group).
//
//   TELEGRAM_ATTENDANCE_MODE=group
//   TELEGRAM_ATTENDANCE_CHAT_ID=-1001234567890   (the group's chat id)
//
// Anything else, or a missing group id, falls back to "dm" — an unset or
// typo'd config can never silently redirect messages to nowhere.
export function telegramAttendanceMode(): "dm" | "group" {
  const mode = (process.env.TELEGRAM_ATTENDANCE_MODE ?? "").trim().toLowerCase();
  const groupId = (process.env.TELEGRAM_ATTENDANCE_CHAT_ID ?? "").trim();
  return mode === "group" && groupId ? "group" : "dm";
}

function attendanceGroupId(): string | null {
  if (telegramAttendanceMode() !== "group") return null;
  return (process.env.TELEGRAM_ATTENDANCE_CHAT_ID ?? "").trim() || null;
}

// 2026-10-03 — "TELEGRAM_BOT_USERNAME is not set on the server — ask admin
// to set it, then reload": the Attendance connect card AND the Employees
// page's copy-link button both need the bot's @handle to build the t.me
// deep link, but only TELEGRAM_BOT_TOKEN had been configured on the live
// site — a second env var nobody had set was blocking the whole connect
// flow. The handle is PUBLIC bot data, so resolve it from the token via
// getMe instead: env still wins when set (zero network), otherwise one
// 4s call per server instance, cached forever after success. Failures
// (bad token, Telegram blip) cache a negative result for 60s and return
// null — every caller keeps its "ask admin" fallback, nothing ever throws.
let cachedBotUsername: string | null | undefined;
let botUsernameRetryAfter = 0;

export async function resolveTelegramBotUsername(): Promise<string | null> {
  const fromEnv = (process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  if (fromEnv) return fromEnv;
  if (cachedBotUsername) return cachedBotUsername;
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) return null;
  if (Date.now() < botUsernameRetryAfter) return null; // recent failure — don't stall the page again
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: controller.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: { username?: string };
    } | null;
    const username = res.ok && json?.ok ? (json.result?.username ?? null) : null;
    if (username) {
      cachedBotUsername = username;
      return username;
    }
    botUsernameRetryAfter = Date.now() + 60_000;
    return null;
  } catch {
    botUsernameRetryAfter = Date.now() + 60_000;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
 *
 * 2026-10-03 — "Hello ke sath employee ka naam bhi to jana chahiye na":
 * the message is now a BUILDER that receives the employee's real name
 * (fetched once, right here) — every confirmation greets
 * "Hello <Name>," instead of a nameless "Hello,".
 */
async function notifyEmployee(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  buildMessage: (employeeName: string) => string
): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn(`[telegram] punch notification skipped — TELEGRAM_BOT_TOKEN not set (employee ${employeeId})`);
      return;
    }

    const { data: employee, error } = await supabase
      .from("employees")
      .select("telegram_chat_id, name")
      .eq("id", employeeId)
      .maybeSingle();
    if (error) {
      console.error(`[telegram] punch notification skipped — DB lookup failed for employee ${employeeId}: ${error.message}`);
      return;
    }

    const employeeName = employee?.name?.trim() || employeeId;
    const message = buildMessage(employeeName);

    // 2026-10-01 — GROUP mode: post to the shared group chat (employee
    // name prefixed so everyone knows whose punch it is); the employee's
    // own telegram_chat_id / connect step is irrelevant here.
    const groupId = attendanceGroupId();
    if (groupId) {
      const result = await sendTelegramText(token, groupId, `👤 ${employeeName}\n\n${message}`);
      if (!result.ok) {
        console.error(`[telegram] punch notification FAILED for employee ${employeeId} (group ${groupId}): ${result.error}`);
      }
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
  await notifyEmployee(supabase, employeeId, (name) =>
    [
      "✅ Attendance Marked — Nykomart OMS",
      "",
      `Hello ${name},`,
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
  await notifyEmployee(supabase, employeeId, (name) =>
    [
      "🕘 Punch Out Recorded — Nykomart OMS",
      "",
      `Hello ${name},`,
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
      .select("telegram_chat_id, name")
      .eq("id", employeeId)
      .maybeSingle();
    if (error) return { ok: false, error: `DB lookup failed: ${error.message}` };

    const testText = [
      "✅ Test Message — Nykomart OMS",
      "",
      `Hello ${employee?.name?.trim() || employeeId},`,
      "",
      "This is a test confirmation that Telegram alerts are working for your account.",
      "You'll receive automatic messages here when your attendance is marked (punch in / punch out).",
      "",
      footer(),
    ].join("\n");

    // GROUP mode: the test goes to the shared group, tagged with whose
    // test it is — proves the whole path (bot in group → send) end to end.
    const groupId = attendanceGroupId();
    if (groupId) {
      const result = await sendTelegramText(token, groupId, `🧪 Test for ${employee?.name ?? employeeId}\n\n${testText}`);
      if (!result.ok) return { ok: false, error: `Telegram rejected the message (group ${groupId}): ${result.error}`, to: groupId };
      return { ok: true, to: groupId };
    }

    const chatId = employee?.telegram_chat_id;
    if (!chatId || !chatId.trim()) {
      return { ok: false, error: "Telegram not connected yet — open the Connect link on the Attendance page and press Start in the bot first." };
    }

    const result = await sendTelegramText(token, chatId.trim(), testText);
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
 *
 * 2026-10-05 — plus a guarded fallback for a payload-less "/start" (see the
 * header comment): fresh ≤15 min, one distinct candidate only, chat id not
 * owned by another employee. Returns { ok: false } with NO error when
 * nobody's Start is queued yet — that's a waiting state, not a failure.
 */
export async function connectEmployeeTelegram(params: {
  supabase: SupabaseClient<Database>;
  employeeId: string;
}): Promise<ConnectResult> {
  const { supabase, employeeId } = params;
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured on the server — ask admin to set it." };
    // 2026-10-05 — the TELEGRAM_BOT_USERNAME env check that used to live
    // here is GONE: reading getUpdates needs only the token, and requiring
    // an optional env var meant connect failed on EVERY attempt while the
    // card's auto-poll hid that error behind its generic timeout message.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    type TgMessage = {
      text?: string;
      date?: number; // unix seconds — needed to ignore stale manual /starts
      chat?: { type?: string };
      from?: { id?: number; is_bot?: boolean };
    };
    let updates: { message?: TgMessage }[] = [];

    const fetchUpdates = async (): Promise<{ list: typeof updates; failed: string | null }> => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: controller.signal });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: typeof updates; description?: string } | null;
        if (!res.ok || !json?.ok) {
          return { list: [], failed: `getUpdates failed: ${json?.description || res.statusText || `HTTP ${res.status}`}` };
        }
        return { list: json.result ?? [], failed: null };
      } catch {
        return { list: [], failed: "Could not reach Telegram (timeout) — try again in a moment." };
      }
    };

    try {
      const first = await fetchUpdates();
      if (first.failed) {
        // 2026-10-05 — if a webhook is registered on this bot (nothing in
        // this repo ever sets one, but it can be set from outside), updates
        // are pushed there instead and getUpdates errors or drains. Remove
        // any webhook (pending updates are KEPT) and try once more.
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { signal: controller.signal }).catch(() => null);
        const retry = await fetchUpdates();
        if (retry.failed) return { ok: false, error: retry.failed };
        updates = retry.list;
      } else if (first.list.length === 0) {
        // Same defence for the silent variant (webhook set → queue looks
        // empty): clear it and re-read once before concluding "nobody
        // pressed Start yet".
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { signal: controller.signal }).catch(() => null);
        const retry = await fetchUpdates();
        updates = retry.failed ? [] : retry.list;
      } else {
        updates = first.list;
      }
    } finally {
      clearTimeout(timer);
    }

    // 1) STRICT — the deep-link payload "/start <employee_id>": identity is
    //    proven by the payload itself, so age doesn't matter.
    const expectedText = `/start ${employeeId}`;
    const match = updates.find(
      (u) =>
        u.message?.text === expectedText &&
        u.message?.chat?.type === "private" &&
        u.message?.from &&
        u.message.from.is_bot !== true &&
        typeof u.message.from.id === "number"
    );
    let chatId = match?.message?.from?.id;

    // 2) FALLBACK — a plain "/start" typed in the bot chat (no payload:
    //    Telegram desktop doesn't pre-fill the deep link's argument).
    //    Accepted only when ALL of these hold, so it can never attach the
    //    wrong person's chat id:
    //      • private chat, sender not a bot
    //      • text is exactly "/start" or "/start@<bot>" (no payload)
    //      • message is FRESH (last 15 min) — old manual /starts don't count
    //      • exactly ONE distinct candidate (2+ = refuse, ask for the
    //        personal deep link instead)
    //      • that chat id isn't already saved on ANOTHER employee's row
    if (typeof chatId !== "number") {
      const cutoff = Math.floor(Date.now() / 1000) - 15 * 60;
      const candidates: number[] = [];
      for (const u of updates) {
        const m = u.message;
        if (!m || m.chat?.type !== "private" || !m.from || m.from.is_bot === true || typeof m.from.id !== "number") continue;
        if (!/^\/start(@[A-Za-z0-9_]+)?$/.test((m.text ?? "").trim())) continue;
        if (typeof m.date !== "number" || m.date < cutoff) continue;
        if (!candidates.includes(m.from.id)) candidates.push(m.from.id);
      }
      if (candidates.length > 1) {
        return {
          ok: false,
          error:
            "Aur ek Telegram account se bhi plain Start aaya hai — galat connect hone se bachne ke liye ruka. Har employee apna personal 'Open Telegram & Start' link (Attendance page se) use kare, phir dobara Connect kare.",
        };
      }
      if (candidates.length === 1) {
        const candidate = String(candidates[0]);
        const { data: owner } = await supabase
          .from("employees")
          .select("id")
          .eq("telegram_chat_id", candidate)
          .neq("id", employeeId)
          .maybeSingle();
        if (!owner) chatId = candidates[0];
      }
    }

    if (!chatId) {
      // Not a FAILURE — nobody's (fresh) Start is in the queue yet. Return
      // no error so the connect card keeps showing its own polling/guidance
      // copy instead of a scary red string on every 2.5s attempt.
      return { ok: false };
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
