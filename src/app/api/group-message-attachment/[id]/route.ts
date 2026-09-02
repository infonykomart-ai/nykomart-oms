import { NextResponse } from "next/server";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Same gated-download-proxy pattern as /api/message-attachment (1:1) — see
// that route's header comment. The only difference is the ownership check:
// here it's "is the requester a member of this message's conversation"
// instead of "is the requester this message's own sender/recipient".
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (err) {
    if (err instanceof UnauthorizedError) return new NextResponse("Not signed in.", { status: 401 });
    throw err;
  }

  const { id } = await params;
  const supabase = createServiceRoleClient();
  const { data: message, error } = await supabase
    .from("conversation_messages")
    .select("conversation_id, attachment_path, attachment_name, attachment_mime")
    .eq("id", id)
    .maybeSingle();

  if (error) return new NextResponse(error.message, { status: 500 });
  if (!message || !message.attachment_path) return new NextResponse("Not found.", { status: 404 });

  const { data: membership } = await supabase
    .from("conversation_members")
    .select("employee_id")
    .eq("conversation_id", message.conversation_id)
    .eq("employee_id", employee.id)
    .maybeSingle();
  if (!membership) return new NextResponse("Forbidden.", { status: 403 });

  const { data: blob, error: downloadError } = await supabase.storage.from("message-attachments").download(message.attachment_path);
  if (downloadError || !blob) return new NextResponse("Could not load attachment.", { status: 502 });

  const buffer = Buffer.from(await blob.arrayBuffer());
  const name = (message.attachment_name ?? "attachment").replace(/"/g, "");
  const isImage = (message.attachment_mime ?? "").startsWith("image/");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": message.attachment_mime ?? "application/octet-stream",
      "Content-Disposition": `${isImage ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
