// 2026-10-24 — the RUNNABLE half of the overdue-payables digest, split out of
// /api/cron/overdue-digest so the same code runs from two places:
//
//   1. the route itself (external scheduler / manual test, `?dry=1`),
//   2. the existing 03:00 UTC tracking cron (/api/cron/poll-fedex-tracking),
//      right after the courier poll — this project's vercel.json already uses
//      Vercel Hobby's two cron slots, so a third entry would block every future
//      deploy. Riding along with the daily tracking cron is what makes the
//      digest actually go out every morning (08:30 IST) with no extra setup.
//
// Same calculation as the Payables Ageing report (src/lib/parties/ageing.ts), so
// the screen and the Telegram message can never show different figures.
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { sendTelegramToChat } from "@/lib/attendance/telegram-notify";
import { todayIST } from "@/lib/attendance/ist-date";
import { loadAgeing, type AgeingResult } from "./ageing";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Recipient = { label: string; chatId: string };

export type OverdueDigestRun = {
  date: string;
  overdue: number;
  total: number;
  text: string;
  sent: number;
  failed: { to: string; ok: false; error?: string }[];
  recipients: string[];
  /** "Name <chatId>" for every resolved recipient (shown by ?dry=1). */
  wouldSendTo: string[];
  skipped: boolean;
  error: string | null;
  note?: string;
};

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildOverdueDigest(result: AgeingResult, today: string): string {
  const t = result.totals;
  const overdue = t.d1_30 + t.d31_60 + t.d61_90 + t.d90plus;
  if (overdue <= 0.005) {
    return `✅ *Payables — ${today}*\n\nNo overdue bills. Total payable ₹${money(t.total)} (everything is still within its due date).`;
  }
  const lines = result.top.map(
    (r, i) => `${i + 1}. ${r.partyName} (${r.companyName}) — ₹${money(r.total)}${r.oldestDays > 0 ? ` · ${r.oldestDays} days` : ""}`
  );
  return [
    `💳 *Payables overdue — ${today}*`,
    "",
    `Overdue: ₹${money(overdue)}`,
    `Total payable: ₹${money(t.total)} (not due ₹${money(t.notDue)})`,
    `90+ days: ₹${money(t.d90plus)} · 61-90: ₹${money(t.d61_90)} · 31-60: ₹${money(t.d31_60)} · 1-30: ₹${money(t.d1_30)}`,
    "",
    "*Most pending:*",
    ...lines,
    "",
    "Detail: Reports → Payables Ageing",
  ].join("\n");
}

/** OVERDUE_DIGEST_CHAT_ID (comma-separated) when set, else every Telegram-connected admin. */
export async function resolveOverdueDigestRecipients(
  supabase: ServiceClient
): Promise<{ recipients: Recipient[]; note?: string }> {
  const fromEnv = (process.env.OVERDUE_DIGEST_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return { recipients: fromEnv.map((chatId) => ({ label: `configured chat ${chatId}`, chatId })) };
  }

  const { data: roleCaps, error: capError } = await supabase
    .from("role_capabilities")
    .select("role_id")
    .eq("capability_code", "permissions_admin");
  if (capError) return { recipients: [], note: `Could not read permissions_admin roles: ${capError.message}` };
  const roleIds = Array.from(new Set((roleCaps ?? []).map((r) => r.role_id)));
  if (roleIds.length === 0) return { recipients: [], note: "No role holds permissions_admin." };

  const { data: admins, error: adminError } = await supabase
    .from("employees")
    .select("name, telegram_chat_id")
    .in("role_id", roleIds)
    .eq("active", true)
    .not("telegram_chat_id", "is", null);
  if (adminError) {
    return {
      recipients: [],
      note: /telegram_chat_id/i.test(adminError.message)
        ? "employees.telegram_chat_id is missing — run db/2026-09-30c-employee-telegram-chat-id.sql (or set OVERDUE_DIGEST_CHAT_ID)."
        : adminError.message,
    };
  }

  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const a of admins ?? []) {
    const chatId = (a.telegram_chat_id ?? "").trim();
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    recipients.push({ label: a.name, chatId });
  }
  return {
    recipients,
    note: recipients.length === 0 ? "No admin has Telegram connected — set OVERDUE_DIGEST_CHAT_ID." : undefined,
  };
}

/**
 * Builds and sends the overdue digest for every company. Never throws — a
 * failure is returned so the caller can report it without failing the rest of
 * its work.
 */
export async function runOverdueDigest(
  supabase: ServiceClient,
  opts: { skipEmpty?: boolean; dry?: boolean } = {}
): Promise<OverdueDigestRun> {
  const today = todayIST();
  const { data: companies, error: companyError } = await supabase.from("companies").select("id");
  if (companyError) {
    return {
      date: today,
      overdue: 0,
      total: 0,
      text: "",
      sent: 0,
      failed: [],
      recipients: [],
      wouldSendTo: [],
      skipped: false,
      error: `Could not read companies: ${companyError.message}`,
    };
  }

  const ageing = await loadAgeing(
    supabase,
    (companies ?? []).map((c) => c.id),
    today
  );
  if (ageing.error) {
    return {
      date: today,
      overdue: 0,
      total: 0,
      text: "",
      sent: 0,
      failed: [],
      recipients: [],
      wouldSendTo: [],
      skipped: false,
      error: `Could not read bills: ${ageing.error}`,
    };
  }

  const text = buildOverdueDigest(ageing, today);
  const t = ageing.totals;
  const overdue = t.d1_30 + t.d31_60 + t.d61_90 + t.d90plus;
  const { recipients, note } = await resolveOverdueDigestRecipients(supabase);
  const base = {
    date: today,
    overdue,
    total: t.total,
    text,
    sent: 0,
    failed: [] as { to: string; ok: false; error?: string }[],
    recipients: recipients.map((r) => r.label),
    wouldSendTo: recipients.map((r) => `${r.label} <${r.chatId}>`),
    skipped: false,
    error: null as string | null,
    note,
  };

  if (opts.skipEmpty && overdue <= 0.005) return { ...base, skipped: true };
  if (opts.dry) return base;
  if (recipients.length === 0) {
    return { ...base, note: note ?? "No Telegram recipient available." };
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
