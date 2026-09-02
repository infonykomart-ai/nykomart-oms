"use server";

// Messenger popup (2026-09-02) — read-only data for the bottom-right
// popup/split-panel (src/components/messages/messenger-popup.tsx). Purely
// additive: does not change direct_messages/actions.ts or
// messages/page.tsx's existing full-page behavior at all.
//
// Deliberately separate from that full page's own fetch pattern: the full
// page loads a signed-in employee's ENTIRE message history at once because
// that's the one place per session it's actually all rendered. Doing that
// again in dashboard/layout.tsx (which runs on EVERY page) would be a real
// performance regression — so the popup instead fetches lightweight
// PREVIEWS (most recent message per thread/group, capped) up front, and
// loads a specific thread's full history only when that thread is actually
// opened (getDirectThreadMessages / getGroupThreadMessages below).
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { ConversationMessage } from "./group-actions";
import type { DirectMessage } from "./actions";

const PREVIEW_SCAN_LIMIT = 300; // recent messages scanned to build "latest per thread" previews — see header comment

export type ConversationPreview = {
  kind: "direct" | "group";
  // For "direct": the OTHER employee's id. For "group": the conversation id.
  id: string;
  title: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  hasUnread: boolean;
  memberCount?: number; // group only
};

export async function getConversationPreviews(): Promise<ConversationPreview[]> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const [{ data: recentDirect }, { data: myMemberships }, { data: employees }] = await Promise.all([
    supabase
      .from("direct_messages")
      .select("id, sender_employee_id, recipient_employee_id, body, attachment_name, created_at, read_at")
      .or(`sender_employee_id.eq.${employee.id},recipient_employee_id.eq.${employee.id}`)
      .order("created_at", { ascending: false })
      .limit(PREVIEW_SCAN_LIMIT),
    supabase.from("conversation_members").select("conversation_id, last_read_at, joined_at").eq("employee_id", employee.id),
    supabase.from("employees").select("id, name").eq("active", true),
  ]);

  const employeeName = new Map((employees ?? []).map((e) => [e.id, e.name]));

  // --- 1:1 previews: latest message per counterpart, from the capped scan ---
  const directPreviewByCounterpart = new Map<string, ConversationPreview>();
  for (const m of recentDirect ?? []) {
    const counterpartId = m.sender_employee_id === employee.id ? m.recipient_employee_id : m.sender_employee_id;
    if (directPreviewByCounterpart.has(counterpartId)) continue; // already have the latest (scan is newest-first)
    const isUnread = m.recipient_employee_id === employee.id && m.read_at === null;
    directPreviewByCounterpart.set(counterpartId, {
      kind: "direct",
      id: counterpartId,
      title: employeeName.get(counterpartId) ?? "Unknown",
      lastMessageAt: m.created_at,
      lastMessagePreview: m.body ?? (m.attachment_name ? `📎 ${m.attachment_name}` : ""),
      hasUnread: isUnread,
    });
  }

  // --- Group previews: latest message per conversation I'm in ---
  const myConversationIds = (myMemberships ?? []).map((m) => m.conversation_id);
  const lastReadByConversation = new Map((myMemberships ?? []).map((m) => [m.conversation_id, m.last_read_at ?? m.joined_at]));
  const groupPreviews: ConversationPreview[] = [];
  if (myConversationIds.length > 0) {
    const [{ data: conversations }, { data: recentGroupMessages }, { data: memberCounts }] = await Promise.all([
      supabase.from("conversations").select("id, name").in("id", myConversationIds),
      supabase
        .from("conversation_messages")
        .select("id, conversation_id, sender_employee_id, body, attachment_name, created_at")
        .in("conversation_id", myConversationIds)
        .order("created_at", { ascending: false })
        .limit(PREVIEW_SCAN_LIMIT),
      supabase.from("conversation_members").select("conversation_id").in("conversation_id", myConversationIds),
    ]);
    const conversationName = new Map((conversations ?? []).map((c) => [c.id, c.name]));
    const memberCountByConversation = new Map<string, number>();
    for (const r of memberCounts ?? []) memberCountByConversation.set(r.conversation_id, (memberCountByConversation.get(r.conversation_id) ?? 0) + 1);

    type GroupPreviewMessage = { conversation_id: string; sender_employee_id: string; body: string | null; attachment_name: string | null; created_at: string };
    const latestByConversation = new Map<string, GroupPreviewMessage>();
    for (const m of recentGroupMessages ?? []) {
      if (!latestByConversation.has(m.conversation_id)) latestByConversation.set(m.conversation_id, m);
    }

    for (const convId of myConversationIds) {
      const last = latestByConversation.get(convId);
      const lastReadAt = lastReadByConversation.get(convId) ?? "1970-01-01T00:00:00Z";
      const hasUnread = !!last && last.sender_employee_id !== employee.id && last.created_at > lastReadAt;
      groupPreviews.push({
        kind: "group",
        id: convId,
        title: conversationName.get(convId) ?? "Group",
        lastMessageAt: last?.created_at ?? "1970-01-01T00:00:00Z",
        lastMessagePreview: last ? (last.body ?? (last.attachment_name ? `📎 ${last.attachment_name}` : "")) : "No messages yet",
        hasUnread,
        memberCount: memberCountByConversation.get(convId) ?? 1,
      });
    }
  }

  return [...Array.from(directPreviewByCounterpart.values()), ...groupPreviews].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
}

export async function getDirectThreadMessages(otherEmployeeId: string): Promise<DirectMessage[]> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("direct_messages")
    .select("id, sender_employee_id, recipient_employee_id, body, attachment_name, attachment_mime, attachment_size_bytes, created_at, read_at")
    .or(`and(sender_employee_id.eq.${employee.id},recipient_employee_id.eq.${otherEmployeeId}),and(sender_employee_id.eq.${otherEmployeeId},recipient_employee_id.eq.${employee.id})`)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function getGroupThreadMessages(conversationId: string): Promise<ConversationMessage[]> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const { data: membership } = await supabase.from("conversation_members").select("employee_id").eq("conversation_id", conversationId).eq("employee_id", employee.id).maybeSingle();
  if (!membership) return []; // not a member — nothing to show, matches RLS's own behavior for the realtime path

  const { data } = await supabase
    .from("conversation_messages")
    .select("id, conversation_id, sender_employee_id, body, attachment_name, attachment_mime, attachment_size_bytes, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

// Cheap re-check after a mark-read action (or any moment the popup wants
// to resync its badge with the DB) — 2 small count/RPC queries, not a full
// previews fetch. Kept separate from getConversationPreviews() so the
// common "just tell me the numbers" case stays cheap.
export async function getUnreadCounts(): Promise<{ direct: number; group: number }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const [{ count: direct }, { data: groupCount }] = await Promise.all([
    supabase.from("direct_messages").select("id", { count: "exact", head: true }).eq("recipient_employee_id", employee.id).is("read_at", null),
    supabase.rpc("get_unread_group_message_count", { p_employee_id: employee.id }),
  ]);
  return { direct: direct ?? 0, group: typeof groupCount === "number" ? groupCount : 0 };
}

export type GroupMemberInfo = { employeeId: string; name: string };

export async function getGroupMembers(conversationId: string): Promise<GroupMemberInfo[]> {
  const supabase = createServiceRoleClient();
  const { data: members } = await supabase.from("conversation_members").select("employee_id").eq("conversation_id", conversationId);
  const ids = (members ?? []).map((m) => m.employee_id);
  if (ids.length === 0) return [];
  const { data: employees } = await supabase.from("employees").select("id, name").in("id", ids);
  return (employees ?? []).map((e) => ({ employeeId: e.id, name: e.name }));
}
