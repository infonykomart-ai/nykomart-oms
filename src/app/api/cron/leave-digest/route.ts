// Leave daily digest — 2026-10-21.
//
// "abhi bell + 'On Leave' board sirf tab dikhta hai jab koi page khole.
// Telegram bot se har subah fixed time par message ja sakta hai: 'aaj 4 log
// leave par — Neelu, Rahul…'"
//
// WHAT: one cron hit sends TODAY's approved-leave list to Telegram, so nobody
// has to open the app to find out who is out. Nothing new is stored — it reads
// the same leave_requests rows the Leave page's "On Leave" board reads
// (status = Approved AND from_date <= today <= to_date, today in IST), which is
// also exactly the range that approval writes Attendance "Leave" for.
//
// WHO RECEIVES IT: LEAVE_DIGEST_CHAT_ID (comma-separated for more than one
// chat/group) when set — the natural choice for a "Management" group. When it
// is NOT set, the digest DMs every active employee whose role holds the
// leave_admin capability and who has connected Telegram (employees.
// telegram_chat_id), i.e. the people who can actually approve leave. It never
// broadcasts to all staff: a list of who is absent is not everyone's business.
//
// SCHEDULING — IMPORTANT: this project's vercel.json is already at Vercel
// Hobby's hard cap of 2 cron jobs (see the long explanation at the top of
// src/app/api/cron/poll-fedex-tracking/route.ts: exceeding it silently blocks
// EVERY future deployment). So this route is deliberately NOT added there.
// Schedule it instead with any external scheduler (cron-job.org, GitHub
// Actions schedule, an n8n flow...) as:
//     GET https://<deployment>/api/cron/leave-digest
//     Authorization: Bearer $CRON_SECRET
// e.g. every day at 08:30 IST. If the plan is ever upgraded and a slot frees
// up, add { "path": "/api/cron/leave-digest", "schedule": "30 3 * * *" }
// (03:30 UTC = 09:00 IST) to vercel.json — no code change needed.
//
// SECURITY: identical bearer-token pattern to the other two cron routes —
// only callable with `Authorization: Bearer $CRON_SECRET`.
//
// `?dry=1` builds and returns the exact message WITHOUT sending anything —
// so the schedule can be verified (and the wording checked) before the first
// real 08:30 broadcast. `?skipEmpty=1` sends nothing on a day with zero
// leaves; without it, "aaj koi leave par nahi hai" is still sent, which is
// what proves the job actually ran.

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { sendTelegramToChat } from "@/lib/attendance/telegram-notify";
// The message wording lives in src/lib/leave/digest.ts (pure, testable);
// this route only decides who is on leave and who receives it.
import { buildLeaveDigest, type OnLeavePerson } from "@/lib/leave/digest";

export const maxDuration = 60;

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

type Recipient = { label: string; chatId: string };

/**
 * Everyone who was on approved leave TODAY (IST), with names and company,
 * plus the leave-type names when that optional migration has been applied.
 * Read-only; no writes anywhere in this route.
 */
async function loadOnLeaveToday(
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

  // Leave Type is from db/2026-09-11-leave-types-and-balances.sql — an
  // OPTIONAL column/table in this app. A missing table must not fail the
  // digest (the names are the important part), so a failed lookup simply
  // means no type is printed. This is the same tolerant-fallback rule the
  // rest of the app follows; the Schema Status card reports the pending file.
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
 * comma-separated ids), else the Telegram-DM'd employees who hold leave_admin.
 * Deduped by chat id, so an admin listed twice is messaged once.
 */
async function resolveRecipients(supabase: ServiceClient): Promise<{ recipients: Recipient[]; source: "env" | "leave_admins" | "none"; note?: string }> {
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
    // telegram_chat_id itself is from db/2026-09-30c-employee-telegram-chat-id.sql —
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
  const recipients: Recipient[] = [];
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

async function run(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const skipEmpty = req.nextUrl.searchParams.get("skipEmpty") === "1";
  const today = todayIST();

  const { people, error } = await loadOnLeaveToday(supabase, today);
  if (error) {
    // 500: the digest genuinely did not run, and the scheduler should retry.
    return NextResponse.json({ error: `Could not read leave_requests: ${error}`, date: today }, { status: 500 });
  }

  const text = buildLeaveDigest(people, today);
  const { recipients, source, note } = await resolveRecipients(supabase);
  const base = { date: today, onLeaveCount: people.length, onLeave: people.map((p) => p.name), recipientSource: source, text };

  if (dryRun) {
    return NextResponse.json({
      ...base,
      dryRun: true,
      wouldSendTo: recipients.map((r) => `${r.label} <${r.chatId}>`),
      note,
    });
  }

  if (people.length === 0 && skipEmpty) {
    return NextResponse.json({ ...base, skipped: "no one on leave (skipEmpty=1)" });
  }

  if (recipients.length === 0) {
    return NextResponse.json({ ...base, sent: 0, note: note ?? "No digest recipient configured." }, { status: 200 });
  }

  const results: { to: string; ok: boolean; error?: string }[] = [];
  for (const r of recipients) {
    const result = await sendTelegramToChat(r.chatId, text);
    results.push(result.ok ? { to: r.label, ok: true } : { to: r.label, ok: false, error: result.error });
  }

  const sent = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ...base,
    sent,
    failed: results.filter((r) => !r.ok),
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}

// Same handler for POST — some external schedulers only offer POST. The body
// is ignored; auth and the ?dry=1 / ?skipEmpty=1 flags work identically.
export async function POST(req: NextRequest) {
  return run(req);
}
