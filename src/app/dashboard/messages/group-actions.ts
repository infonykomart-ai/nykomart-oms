"use server";

// Group Messaging (2026-09-02) — "massaging group banane ka option hona
// chahiye". Parallel system to direct_messages/actions.ts (untouched) —
// see db/schema.sql's conversations/conversation_members/
// conversation_messages section for the full schema rationale.
//
// Same established pattern as every write in this app: identity is
// resolved server-side via getAuthedEmployee() FIRST, then every write
// goes through the service-role client (bypasses RLS) — the checks in
// this file ARE the real access-control gate, not the DB's RLS (which
// exists mainly to scope the browser's own real-time subscription — see
// schema comment). No capability gate — open to every signed-in employee,
// same as direct_messages/My Profile.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ATTACHMENT_BUCKET = "message-attachments";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // keep in sync with direct_messages/actions.ts + next.config.ts
const MAX_GROUP_NAME_LENGTH = 80;
const MIN_GROUP_MEMBERS = 2; // creator + at least 1 other — a "group" of 1 isn't a group

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  sender_employee_id: string;
  body: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size_bytes: number | null;
  created_at: string;
};

const MESSAGE_COLUMNS = "id, conversation_id, sender_employee_id, body, attachment_name, attachment_mime, attachment_size_bytes, created_at";

async function assertMember(conversationId: string, employeeId: string): Promise<{ error: string | null }> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.from("conversation_members").select("employee_id").eq("conversation_id", conversationId).eq("employee_id", employeeId).maybeSingle();
  return data ? { error: null } : { error: "You're not a member of this group." };
}

export async function createGroupConversation(
  name: string,
  memberEmployeeIds: string[]
): Promise<{ error: string | null; conversationId: string | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const trimmedName = name.trim().slice(0, MAX_GROUP_NAME_LENGTH);
  if (!trimmedName) return { error: "Give the group a name.", conversationId: null };

  const uniqueMemberIds = Array.from(new Set(memberEmployeeIds.filter((id) => id && id !== employee.id)));
  if (uniqueMemberIds.length < MIN_GROUP_MEMBERS - 1) {
    return { error: `Pick at least ${MIN_GROUP_MEMBERS - 1} other people for a group.`, conversationId: null };
  }

  const { data: validMembers } = await supabase.from("employees").select("id").in("id", uniqueMemberIds).eq("active", true);
  const validIds = new Set((validMembers ?? []).map((m) => m.id));
  const filteredMemberIds = uniqueMemberIds.filter((id) => validIds.has(id));
  if (filteredMemberIds.length < MIN_GROUP_MEMBERS - 1) {
    return { error: "Couldn't find those employees — they may no longer be active.", conversationId: null };
  }

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .insert({ name: trimmedName, created_by_employee_id: employee.id })
    .select("id")
    .single();
  if (convError || !conversation) return { error: convError?.message ?? "Could not create group.", conversationId: null };

  const memberRows = [employee.id, ...filteredMemberIds].map((id) => ({
    conversation_id: conversation.id,
    employee_id: id,
    added_by_employee_id: employee.id,
  }));
  const { error: memberError } = await supabase.from("conversation_members").insert(memberRows);
  if (memberError) {
    // Roll back the orphaned conversation rather than leaving a group with
    // no members anyone can ever see or clean up (RLS would hide it from
    // everyone, including its own creator).
    await supabase.from("conversations").delete().eq("id", conversation.id);
    return { error: memberError.message, conversationId: null };
  }

  revalidatePath("/dashboard");
  return { error: null, conversationId: conversation.id };
}

export async function sendGroupMessage(conversationId: string, formData: FormData): Promise<{ error: string | null; message: ConversationMessage | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const membership = await assertMember(conversationId, employee.id);
  if (membership.error) return { error: membership.error, message: null };

  const body = String(formData.get("body") || "").trim();
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!body && !hasFile) return { error: "Write a message or attach a file.", message: null };

  let attachment: { path: string; name: string; mime: string; size: number } | null = null;
  if (hasFile) {
    const f = file as File;
    if (f.size > MAX_ATTACHMENT_BYTES) return { error: "File is too large — max 10MB.", message: null };
    const safeName = f.name.replace(/[^\w.\- ]/g, "_").slice(0, 150);
    // "group/" prefix keeps these visually/physically separate from 1:1
    // attachments in the same shared bucket — purely organizational, the
    // real access boundary is the ownership check in the download route.
    const path = `group/${conversationId}/${randomUUID()}-${safeName}`;
    const buffer = Buffer.from(await f.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, buffer, {
      contentType: f.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadError) return { error: `Could not upload attachment: ${uploadError.message}`, message: null };
    attachment = { path, name: f.name, mime: f.type || "application/octet-stream", size: f.size };
  }

  const { data, error } = await supabase
    .from("conversation_messages")
    .insert({
      conversation_id: conversationId,
      sender_employee_id: employee.id,
      body: body || null,
      attachment_path: attachment?.path ?? null,
      attachment_name: attachment?.name ?? null,
      attachment_mime: attachment?.mime ?? null,
      attachment_size_bytes: attachment?.size ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) return { error: error?.message ?? "Could not send message.", message: null };

  // Sending counts as having read up to now — same "you've obviously seen
  // your own message" logic as direct_messages implicitly has via read_at
  // only ever being set on the RECIPIENT's copy.
  await supabase.from("conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", conversationId).eq("employee_id", employee.id);

  revalidatePath("/dashboard");
  return { error: null, message: data };
}

export async function markGroupConversationRead(conversationId: string): Promise<{ error: string | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("employee_id", employee.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { error: null };
}

export async function addGroupMembers(conversationId: string, newMemberEmployeeIds: string[]): Promise<{ error: string | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const membership = await assertMember(conversationId, employee.id);
  if (membership.error) return { error: membership.error };

  const uniqueIds = Array.from(new Set(newMemberEmployeeIds.filter(Boolean)));
  if (uniqueIds.length === 0) return { error: "Pick at least one person to add." };

  const { data: existing } = await supabase.from("conversation_members").select("employee_id").eq("conversation_id", conversationId);
  const existingIds = new Set((existing ?? []).map((m) => m.employee_id));
  const toAdd = uniqueIds.filter((id) => !existingIds.has(id));
  if (toAdd.length === 0) return { error: null }; // already all members — nothing to do, not an error

  const { error } = await supabase.from("conversation_members").insert(
    toAdd.map((id) => ({ conversation_id: conversationId, employee_id: id, added_by_employee_id: employee.id }))
  );
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { error: null };
}

// "Remove another member" is deliberately not implemented this round —
// kept out rather than guessing a permission model (who's allowed to
// remove whom) that wasn't asked for. Leaving is always self-only.
export async function leaveGroupConversation(conversationId: string): Promise<{ error: string | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("conversation_members").delete().eq("conversation_id", conversationId).eq("employee_id", employee.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { error: null };
}

export async function renameGroupConversation(conversationId: string, newName: string): Promise<{ error: string | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const membership = await assertMember(conversationId, employee.id);
  if (membership.error) return { error: membership.error };

  const trimmedName = newName.trim().slice(0, MAX_GROUP_NAME_LENGTH);
  if (!trimmedName) return { error: "Group name can't be empty." };

  const { error } = await supabase.from("conversations").update({ name: trimmedName }).eq("id", conversationId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { error: null };
}

// Same "hard delete, sender-only, both sides" convention as
// direct_messages/actions.ts's deleteMessage — see that file's comment.
export async function deleteGroupMessage(messageId: string): Promise<{ error: string | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const { data: message, error: fetchError } = await supabase
    .from("conversation_messages")
    .select("sender_employee_id, attachment_path")
    .eq("id", messageId)
    .maybeSingle();
  if (fetchError) return { error: fetchError.message };
  if (!message) return { error: null };
  if (message.sender_employee_id !== employee.id) return { error: "You can only unsend your own messages." };

  if (message.attachment_path) {
    const { error: removeError } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([message.attachment_path]);
    if (removeError) console.error("deleteGroupMessage: failed to remove attachment", removeError);
  }

  const { error } = await supabase.from("conversation_messages").delete().eq("id", messageId).eq("sender_employee_id", employee.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { error: null };
}
