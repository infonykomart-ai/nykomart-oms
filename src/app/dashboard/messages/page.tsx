import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { MessagesClient } from "./messages-client";

// Direct Messaging (2026-08-14) — open to every signed-in employee, no
// capability gate (same as My Profile). Reads via the service-role client,
// same reasoning as every other newer page in this app: this must never
// come back silently empty because of an RLS policy gap, and the query
// itself is hard-scoped to the caller's own id either way (messages) or is
// non-sensitive roster data (employees/roles/companies).
export default async function MessagesPage() {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const [{ data: employeesRaw }, { data: roles }, { data: companies }, { data: messages }] = await Promise.all([
    supabase.from("employees").select("id, name, role_id, company_id, photo_url").eq("active", true).neq("id", employee.id).order("name"),
    supabase.from("roles").select("id, name"),
    supabase.from("companies").select("id, name"),
    supabase
      .from("direct_messages")
      .select(
        "id, sender_employee_id, recipient_employee_id, body, attachment_name, attachment_mime, attachment_size_bytes, created_at, read_at"
      )
      .or(`sender_employee_id.eq.${employee.id},recipient_employee_id.eq.${employee.id}`)
      .order("created_at", { ascending: true }),
  ]);

  const roleNameById = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const companyNameById = new Map((companies ?? []).map((c) => [c.id, c.name]));

  const employees = (employeesRaw ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    photo_url: e.photo_url,
    role_name: roleNameById.get(e.role_id) ?? "",
    company_name: companyNameById.get(e.company_id) ?? "",
  }));

  return (
    <div className="h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-slate-900">💬 Messages</h1>
        <p className="mt-1 text-sm text-slate-500">Message any teammate directly — text or a file/photo attachment.</p>
      </div>
      <MessagesClient meId={employee.id} employees={employees} initialMessages={messages ?? []} />
    </div>
  );
}
