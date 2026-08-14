"use server";

// Direct Messaging (2026-08-14) — 1-to-1 chat between any two employees,
// text + an optional single file/image attachment. Open to every signed-in
// employee, no capability gate (matches "sabhi ko" — "everyone" — same
// pattern as My Profile / Tasks).
//
// Every write here goes through the service-role client AFTER this code
// has already verified identity via getAuthedEmployee() — same established
// pattern as every other Server Action in this app (see tasks/actions.ts).
// The sender is always the server-resolved current employee, never a
// client-supplied value, so there is no path to send "as" someone else
// even though the DB's own RLS policy (db/2026-08-14m-...sql) would also
// reject it.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ATTACHMENT_BUCKET = "message-attachments";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB — keep in sync with next.config.ts's serverActions.bodySizeLimit

export type DirectMessage = {
  id: string;
  sender_employee_id: string;
  recipient_employee_id: string;
  body: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size_bytes: number | null;
  created_at: string;
  read_at: string | null;
};

const MESSAGE_COLUMNS =
  "id, sender_employee_id, recipient_employee_id, body, attachment_name, attachment_mime, attachment_size_bytes, created_at, read_at";

export async function sendMessage(formData: FormData): Promise<{ error: string | null; message: DirectMessage | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const recipientId = String(formData.get("recipient_employee_id") || "");
  const body = String(formData.get("body") || "").trim();
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;

  if (!recipientId) return { error: "Choose who to message.", message: null };
  if (recipientId === employee.id) return { error: "You can't message yourself.", message: null };
  if (!body && !hasFile) return { error: "Write a message or attach a file.", message: null };

  const { data: recipient } = await supabase.from("employees").select("id").eq("id", recipientId).eq("active", true).maybeSingle();
  if (!recipient) return { error: "That employee wasn't found or isn't active.", message: null };

  let attachment: { path: string; name: string; mime: string; size: number } | null = null;
  if (hasFile) {
    const f = file as File;
    if (f.size > MAX_ATTACHMENT_BYTES) {
      return { error: "File is too large — max 10MB.", message: null };
    }
    const safeName = f.name.replace(/[^\w.\- ]/g, "_").slice(0, 150);
    const path = `${employee.id}/${randomUUID()}-${safeName}`;
    const buffer = Buffer.from(await f.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, buffer, {
      contentType: f.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadError) return { error: `Could not upload attachment: ${uploadError.message}`, message: null };
    attachment = { path, name: f.name, mime: f.type || "application/octet-stream", size: f.size };
  }

  const { data, error } = await supabase
    .from("direct_messages")
    .insert({
      sender_employee_id: employee.id,
      recipient_employee_id: recipientId,
      body: body || null,
      attachment_path: attachment?.path ?? null,
      attachment_name: attachment?.name ?? null,
      attachment_mime: attachment?.mime ?? null,
      attachment_size_bytes: attachment?.size ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error || !data) return { error: error?.message ?? "Could not send message.", message: null };

  revalidatePath("/dashboard/messages");
  return { error: null, message: data };
}

export async function markConversationRead(otherEmployeeId: string): Promise<{ error: string | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("direct_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("sender_employee_id", otherEmployeeId)
    .eq("recipient_employee_id", employee.id)
    .is("read_at", null);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/messages");
  return { error: null };
}
