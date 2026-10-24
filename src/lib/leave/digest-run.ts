// 2026-10-24 — the RUNNABLE half of the daily leave digest, split out of the
// /api/cron/leave-digest route so the SAME code can be invoked from two places:
//
//   1. the route itself (external scheduler / manual test, `?dry=1`),
//   2. the existing 03:00 UTC tracking cron (/api/cron/poll-fedex-tracking),
//      which calls it right after the courier poll — this project's vercel.json
//      is at Vercel Hobby's hard cap of two crons, so "start the digest" had no
//      third slot to go in. Riding along with the daily tracking cron is what
//      makes the digest actually fire every morning without an external
//      scheduler.
//
// Nothing new is stored: it reads today's Approved leave_requests (the same
// rows the Leave page's "On Leave" board reads) and only sends Telegram.
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { sendTelegramToChat } from "@/lib/attendance/telegram-notify";
import { todayIST } from "@/lib/attendance/ist-date";
import { buildLeaveDigest, type OnLeavePerson } from "./digest";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

type LeaveRow = {
  id: string;
  employee_id: string;
  company_id: string;
  from_date: string;
  to_date: string;
  /** Optional: db/2026-09-11-leave-types-and-balances.sql — absent on an un-migrated DB. */
  leave_type_id?: string | null;
};

export type DigestRecipient = { label: string; chatId: string };

export type LeaveDigestRun = {
  date: string;
  onLeaveCount: number;
  onLeave: string[];
  recipientSource: "env" | "leave_admins" | "none";
  text: string;
  sent: number;
  failed: { to: string; ok: false; error?: string }[];
  /** "Name <chatId>" for every resolved recipient (shown by ?dry=1). */
  wouldSendTo: string[];
  /** True when skipEmpty suppressed a zero-leave message. */
  skipped: boolean;
  error: string | null;
  note?: string;
};

/**
 * Everyone who was on approved leave TODAY (IST), with names and company, plus
 * the leave-type names when that optional migration has been applied.
 */
export async function loadOnLeaveToday(
  supabase: ServiceClient,
  today: string
): Promise<{ people: OnLeavePerson[]; error: string | null }> {
  // "*" rather than a column list: leave_type_id is optional
  // (db/2026-09-11-leave-types-and-balances.sql). Naming it explicitly would
  // make this whole query fail — and the digest silently stop — on a database
  // where that file has not been run; with "*" the type is simply missing and
  // the message goes out without the type tag.
  const { data: leaves, error } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("status", "Approved")
    .lte("from_date", today)
    .gte("to_date", today)
    .order("from_date", { ascending: true });

  if (error) return { people: [], error: error.message };
  const rows = (leaves ?? []) as LeaveRow[];
  if (rows.length === 0) return { people: [], error: null };

  const employeeIds = Array.from(new Set(rows.map((r) => r.employee_id)));
  const companyIds = Array.from(new Set(rows.map((r) => r.company_id)));

  const [{ data: employees }, { data: companies }] = await Promise.all([
    supabase.from("employees").select("id, name").in("id", employeeIds),
    supabase.from("companies").select("id, name").in("id", companyIds),
  ]);

  const employeeName = new Map((employees ?? []).map((e) => [e.id, e.name]));
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));

  // Leave Type is optional — a missing table must not fail the digest (the
  // names are the important part); the Schema Status card reports the file.
  const typeIds = Array.from(new Set(rows.map((r) => r.leave_type_id).filter((v): v is string => !!v)));
  let leaveTypeName = new Map<string, string>();
  if (typeIds.length > 0) {
    try {
      const { data: types } = await supabase.from("leave_types").select("id, name").in("id", typeIds);
      leaveTypeName = new Map((types ?? []).map((t) => [t.id, t.name]));
    } catch {
      // optional table — see comment above
    }
  }

  return {
    people: rows.map((r) => ({
      name: employeeName.get(r.employee_id) ?? "—",
      company: companyName.get(r.company_id) ?? "",
      from: r.from_date,
      to: r.to_date,
      type: r.leave_type_id ? leaveTypeName.get(r.leave_type_id) ?? null : null,
    })),
    error: null,
  };
}

/**
 * Where the digest goes: LEAVE_DIGEST_CHAT_ID when configured (may be several
 * comma-separated ids), else the Telegram-DM'd employees holding leave_admin.
 */
export async function resolveLeaveDigestRecipients(
  supabase: ServiceClient
): Promise<{ recipients: DigestRecipient[]; source: "env" | "leave_admins" | "none"; note?: string }> {
  const fromEnv = (process.env.LEAVE_DIGEST_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return { recipients: fromEnv.map((chatId) => ({ label: `configured chat ${chatId}`, chatId })), source: "env" };
  }

  const { data: roleCaps, error: capError } = await supabase
    .from("role_capabilities")
    .select("role_id")
    .eq("capability_code", "leave_admin");
  if (capError) return { recipients: [], source: "none", note: `Could not read leave_admin roles: ${capError.message}` };

  const roleIds = Array.from(new Set((roleCaps ?? []).map((r) => r.role_id)));
  if (roleIds.length === 0) {
    return { recipients: [], source: "none", note: "No role holds the leave_admin capability." };
  }

  const { data: admins, error: adminError } = await supabase
    .from("employees")
    .select("id, name, telegram_chat_id")
    .in("role_id", roleIds)
    .eq("active", true)
    .not("telegram_chat_id", "is", null);
  if (adminError) {
    // telegram_chat_id is from db/2026-09-30c-employee-telegram-chat-id.sql —
    // if that file is not applied, say so instead of silently sending nothing.
    return {
      recipients: [],
      source: "none",
      note: /telegram_chat_id/i.test(adminError.message)
        ? "employees.telegram_chat_id nahi hai — db/2026-09-30c-employee-telegram-chat-id.sql run karein (ya LEAVE_DIGEST_CHAT_ID env set karein)."
        : adminError.message,
    };
  }

  const seen = new Set<string>();
  const recipients: DigestRecipient[] = [];
  for (const a of admins ?? []) {
    const chatId = (a.telegram_chat_id ?? "").trim();
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    recipients.push({ label: a.name, chatId });
  }
  return {
    recipients,
    source: recipients.length > 0 ? "leave_admins" : "none",
    note: recipients.length === 0 ? "Koi leave_admin ka Telegram connected nahi hai — LEAVE_DIGEST_CHAT_ID set karein." : undefined,
  };
}

/**
 * Builds and sends today's leave digest. Never throws: a failure is returned so
 * the caller (cron route / tracking cron) can report it without failing the
 * other work it was doing.
 */
export async function runLeaveDigest(
  supabase: ServiceClient,
  opts: { skipEmpty?: boolean; dry?: boolean } = {}
): Promise<LeaveDigestRun> {
  const today = todayIST();
  const { people, error } = await loadOnLeaveToday(supabase, today);
  if (error) {
    return {
      date: today,
      onLeaveCount: 0,
      onLeave: [],
      recipientSource: "none",
      text: "",
      sent: 0,
      failed: [],
      wouldSendTo: [],
      skipped: false,
      error: `Could not read leave_requests: ${error}`,
    };
  }

  const text = buildLeaveDigest(people, today);
  const { recipients, source, note } = await resolveLeaveDigestRecipients(supabase);
  const base = {
    date: today,
    onLeaveCount: people.length,
    onLeave: people.map((p) => p.name),
    recipientSource: source,
    text,
    sent: 0,
    failed: [] as { to: string; ok: false; error?: string }[],
    wouldSendTo: recipients.map((r) => `${r.label} <${r.chatId}>`),
    skipped: false,
    error: null as string | null,
    note,
  };

  if (opts.skipEmpty && people.length === 0) return { ...base, skipped: true };
  if (opts.dry) return base;
  if (recipients.length === 0) {
    return { ...base, note: note ?? "No digest recipient configured." };
  }

  const failed: { to: string; ok: false; error?: string }[] = [];
  let sent = 0;
  for (const r of recipients) {
    const result = await sendTelegramToChat(r.chatId, text);
    if (result.ok) sent += 1;
    else failed.push({ to: r.label, ok: false, error: result.error });
  }
  return { ...base, sent, failed };
}
