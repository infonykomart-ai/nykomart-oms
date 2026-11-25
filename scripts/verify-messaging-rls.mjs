// 2026-11-25 — Functional check of the group-messaging RLS fix.
//
// Verifies the 2026-09-19 policy change by USING the database as two real
// employees through PostgREST and real Realtime, not by reading pg_policies:
//
//   member     -> can SELECT conversations / members / messages for their own
//                 conversation, and RECEIVES Realtime INSERTs for it;
//   non-member -> gets zero rows from the same queries, receives zero Realtime
//                 events, and its writes are rejected by RLS.
//
// Sessions are real: an admin magic-link hashed token is exchanged with
// verifyOtp, so the JWT carries a genuine `sub` and RLS evaluates auth.uid()
// exactly as it does for the browser.
//
// The write/Realtime legs need a real INSERT, so they use a throwaway
// conversation that is deleted in `finally` (cascade removes its members and
// messages). The existing conversations are only ever read.
//
// Requirements: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY in .env.local (the last one is only used to mint
// sessions and clean up). Prints no tokens and no message bodies.
//
// Usage: node scripts/verify-messaging-rls.mjs

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";

if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

// A conversation that already exists, with its known shape.
const CONVERSATION_ID = "abc605b7-31b4-4c91-87ca-2f1c401aee9c"; // group "123"
const EXPECTED = { conversations: 1, members: 2, messages: 11 };

const MEMBER_EMAIL = "gajanand@abc.com";
const NON_MEMBER_EMAIL = "ajay.lohra@abc.com";

function loadEnv(path) {
  if (!fs.existsSync(path)) return {};
  const out = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const env = loadEnv(".env.local");
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", URL],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE],
].filter(([, v]) => !v).map(([k]) => k);

if (missing.length) {
  console.error("Cannot run: these are empty or missing in .env.local:");
  for (const k of missing) console.error(`  - ${k}`);
  console.error("\nRLS can only be exercised through PostgREST/Realtime with a real JWT;");
  console.error("SQL cannot do it (the query role has BYPASSRLS). Fill these in and re-run.");
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** A client holding a genuine session for `email`, plus that employee's row. */
async function clientFor(email) {
  const { data: employee, error: empError } = await admin
    .from("employees")
    .select("id, auth_user_id, active")
    .eq("email", email)
    .maybeSingle();
  if (empError) throw new Error(`employee lookup(${email}): ${empError.message}`);
  if (!employee?.auth_user_id) throw new Error(`no auth user for ${email}`);

  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink(${email}): ${error.message}`);
  const hashed = data?.properties?.hashed_token;
  if (!hashed) throw new Error(`generateLink(${email}) returned no hashed_token`);

  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (verifyError) throw new Error(`verifyOtp(${email}): ${verifyError.message}`);
  const session = verified?.session;
  if (!session?.access_token) throw new Error(`no session for ${email}`);
  if (session.user.id !== employee.auth_user_id) throw new Error(`${email}: session sub does not match employees.auth_user_id`);

  client.realtime.setAuth(session.access_token);
  return { client, email, employeeId: employee.id, authUserId: employee.auth_user_id };
}

/** Row count visible through RLS (head:true — no bodies downloaded). */
async function count(client, table, apply = (q) => q) {
  const { count: n, error } = await apply(client.from(table).select("id", { count: "exact", head: true }));
  return error ? { error: `${error.code ?? ""} ${error.message}`.trim() } : { count: n ?? 0 };
}

function watchInserts(client, label) {
  const state = { status: "pending", received: [] };
  const channel = client.channel(label);
  const ready = new Promise((resolve) => {
    channel
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_messages" }, (payload) => {
        state.received.push(payload?.new ?? {});
      })
      .subscribe((status) => {
        state.status = status;
        if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) resolve(status);
      });
  });
  return { channel, ready, state };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fn()) return true;
    await sleep(150);
  }
  return false;
}

const member = await clientFor(MEMBER_EMAIL);
const outsider = await clientFor(NON_MEMBER_EMAIL);
let tempConversationId = null;

try {
  // ---- Member baseline: the fix must not have taken away real access ----
  const mConv = await count(member.client, "conversations");
  record("member sees their conversation", mConv.count === EXPECTED.conversations, `conversations=${mConv.count}`);
  const mMembers = await count(member.client, "conversation_members", (q) => q.eq("conversation_id", CONVERSATION_ID));
  record("member sees the conversation's members", mMembers.count === EXPECTED.members, `rows=${mMembers.count}`);
  const mMsgs = await count(member.client, "conversation_messages", (q) => q.eq("conversation_id", CONVERSATION_ID));
  record("member sees the conversation's messages", mMsgs.count === EXPECTED.messages, `rows=${mMsgs.count}`);

  // ---- Non-member: the exact reads that used to leak everything ----
  const oConv = await count(outsider.client, "conversations");
  record("non-member sees no conversations", oConv.count === 0, `conversations=${oConv.count}`);
  const oConvById = await count(outsider.client, "conversations", (q) => q.eq("id", CONVERSATION_ID));
  record("non-member cannot read that conversation by id", oConvById.count === 0, `rows=${oConvById.count}`);
  const oMembers = await count(outsider.client, "conversation_members");
  record("non-member sees no members (unfiltered)", oMembers.count === 0, `rows=${oMembers.count}`);
  const oMembersConv = await count(outsider.client, "conversation_members", (q) => q.eq("conversation_id", CONVERSATION_ID));
  record("non-member sees no members of that conversation", oMembersConv.count === 0, `rows=${oMembersConv.count}`);
  const oMsgs = await count(outsider.client, "conversation_messages");
  record("non-member sees no messages (unfiltered)", oMsgs.count === 0, `rows=${oMsgs.count}`);
  const oMsgsConv = await count(outsider.client, "conversation_messages", (q) => q.eq("conversation_id", CONVERSATION_ID));
  record("non-member sees no messages of that conversation", oMsgsConv.count === 0, `rows=${oMsgsConv.count}`);

  // ---- Throwaway conversation: a member by construction, so the positive
  //      control does not depend on any pre-existing row ----
  const { data: created, error: convError } = await admin
    .from("conversations")
    .insert({ name: "RLS verification (temporary)", created_by_employee_id: member.employeeId })
    .select("id")
    .single();
  if (convError || !created) throw new Error(`temp conversation: ${convError?.message}`);
  tempConversationId = created.id;

  const { error: membershipError } = await admin
    .from("conversation_members")
    .insert({ conversation_id: tempConversationId, employee_id: member.employeeId, added_by_employee_id: member.employeeId });
  if (membershipError) throw new Error(`temp membership: ${membershipError.message}`);

  const memberSeesTemp = await count(member.client, "conversations", (q) => q.eq("id", tempConversationId));
  record("member sees the new conversation", memberSeesTemp.count === 1, `rows=${memberSeesTemp.count}`);
  const outsiderSeesTemp = await count(outsider.client, "conversations", (q) => q.eq("id", tempConversationId));
  record("non-member cannot see the new conversation", outsiderSeesTemp.count === 0, `rows=${outsiderSeesTemp.count}`);

  // ---- Non-member writes must be rejected (the dropped blanket ALL policy) ----
  // sender is a valid employee, so a FK error would not be mistaken for RLS.
  const { error: insertError } = await outsider.client.from("conversation_messages").insert({
    conversation_id: tempConversationId,
    sender_employee_id: member.employeeId,
    body: "rls probe (must be rejected)",
  });
  record("non-member INSERT into messages is rejected", !!insertError, insertError ? `rejected: ${insertError.code}` : "INSERT SUCCEEDED");

  const { error: updateError, data: updated } = await outsider.client
    .from("conversations")
    .update({ name: "rls probe" })
    .eq("id", tempConversationId)
    .select("id");
  record(
    "non-member UPDATE of a conversation is rejected",
    !!updateError || (updated ?? []).length === 0,
    updateError ? `rejected: ${updateError.code}` : `rows_affected=${(updated ?? []).length}`
  );

  // ---- Realtime: the app's own badge subscription shape (no filter) ----
  const memberWatch = watchInserts(member.client, "verify-member-inserts");
  const outsiderWatch = watchInserts(outsider.client, "verify-outsider-inserts");
  const [memberStatus, outsiderStatus] = await Promise.all([memberWatch.ready, outsiderWatch.ready]);
  record("member Realtime channel subscribes", memberStatus === "SUBSCRIBED", `status=${memberStatus}`);
  record("non-member Realtime channel subscribes", outsiderStatus === "SUBSCRIBED", `status=${outsiderStatus}`);

  const { error: msgError } = await admin
    .from("conversation_messages")
    .insert({ conversation_id: tempConversationId, sender_employee_id: member.employeeId, body: "rls verification (temporary)" });
  if (msgError) throw new Error(`temp message: ${msgError.message}`);

  const memberGot = await waitFor(() => memberWatch.state.received.length > 0, 10_000);
  await sleep(2_000); // same window for the non-member channel to misbehave
  const outsiderGot = outsiderWatch.state.received.length > 0;

  record("member receives the new message over Realtime", memberGot, `events=${memberWatch.state.received.length}`);
  record(
    "member only receives events for their own conversation",
    memberWatch.state.received.length > 0 && memberWatch.state.received.every((r) => r.conversation_id === tempConversationId),
    `conversation_ids_ok=${memberWatch.state.received.length > 0 && memberWatch.state.received.every((r) => r.conversation_id === tempConversationId)}`
  );
  record("non-member receives no Realtime events", !outsiderGot, `events=${outsiderWatch.state.received.length}`);

  member.client.removeChannel(memberWatch.channel);
  outsider.client.removeChannel(outsiderWatch.channel);
} finally {
  if (tempConversationId) {
    await admin.from("conversations").delete().eq("id", tempConversationId);
    await admin.from("conversation_members").delete().eq("conversation_id", tempConversationId);
    await admin.from("conversation_messages").delete().eq("conversation_id", tempConversationId);
  }
}

// Cleanup: temp rows gone, production conversation still intact.
const [finalConv, finalMsgs] = await Promise.all([
  count(admin, "conversations"),
  count(admin, "conversation_messages", (q) => q.eq("conversation_id", CONVERSATION_ID)),
]);
record("cleanup: temp conversation removed", finalConv.count === EXPECTED.conversations, `conversations=${finalConv.count}`);
record("cleanup: production messages untouched", finalMsgs.count === EXPECTED.messages, `messages=${finalMsgs.count}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join("; "));
  process.exit(1);
}
