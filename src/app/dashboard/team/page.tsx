import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { TeamDirectoryClient } from "./team-directory-client";

// 2026-09-29 — Team Directory (/dashboard/team): a VIEW-ONLY contact book
// of ACTIVE employees, gated by the new `team_directory` capability (MD +
// Admin seeded — see db/2026-09-29-team-directory.sql; grant more roles
// from the Roles & Permissions matrix). employee_admin holders get it
// implicitly via requireAnyCapability so admins never lose access even if
// the matrix tick is removed.
//
// Deliberately NARROW field set — this page is reachable by non-admin
// staff, so the select below must never grow bank/statutory/salary
// columns (that data stays behind the Employees admin page):
//   name, photo, designation, employee_code, role, company, email,
//   WhatsApp, date_of_joining. Nothing else.
export default async function TeamDirectoryPage() {
  await requireAnyCapability("team_directory", "employee_admin");
  const supabase = await createClient();

  const [employeesRaw, roles, companies] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, photo_url, designation, employee_code, email, whatsapp_no, date_of_joining, role_id, company_id")
      .eq("active", true)
      .order("name"),
    supabase.from("roles").select("id, name"),
    supabase.from("companies").select("id, name"),
  ]);

  const roleName = new Map((roles.data ?? []).map((r) => [r.id, r.name]));
  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]));

  const people = (employeesRaw.data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    photoUrl: e.photo_url,
    designation: e.designation,
    employeeCode: e.employee_code,
    email: e.email,
    whatsapp: e.whatsapp_no,
    joined: e.date_of_joining,
    role: roleName.get(e.role_id) ?? "—",
    company: companyName.get(e.company_id) ?? "—",
  }));

  return (
    <div className="pb-6">
      <TeamDirectoryClient people={people} />
    </div>
  );
}
