import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { MyProfileClient } from "./my-profile-form";
import { getTwoFactorStatus } from "./two-factor-actions";

// 2026-09-12 — FedEx-style "My Profile" redesign. History: 2026-08-12
// "My Profile" — self-service edit of one's own personal-info fields, open
// to any signed-in employee (no capability gate, matching the user's
// "sabhi ko"). Read via the service-role client for consistency with the
// rest of this session's newer reads/writes (RLS policies here haven't been
// specifically re-verified for a plain self-select), but the query itself
// is hard-scoped to the caller's own id either way.
//
// Redesign: identity header + sectioned view/edit blocks (Personal, Family,
// Statutory & Bank, Login & Security) per the FedEx reference the owner
// supplied; the employee query now also selects the 2026-09-11 payroll
// statutory/bank columns so the new Statutory & Bank section can display
// and edit them.
export default async function MyProfilePage() {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const [{ data: me }, { data: role }, { data: company }, twoFactorStatus] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, name, email, designation, employee_code, date_of_joining, whatsapp_no, gender, marital_status, dob, anniversary_date, photo_url, family_contact_1_name, family_contact_1_relation, family_contact_1_number, family_contact_2_name, family_contact_2_relation, family_contact_2_number, pan_number, uan_number, pf_number, esi_number, bank_account_holder_name, bank_account_no, bank_ifsc, bank_name"
      )
      .eq("id", employee.id)
      .single(),
    supabase.from("roles").select("name").eq("id", employee.roleId).single(),
    supabase.from("companies").select("name").eq("id", employee.homeCompanyId).single(),
    getTwoFactorStatus(),
  ]);

  if (!me) {
    return <p className="text-sm text-red-600">Could not load your profile.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <MyProfileClient
        me={me}
        roleName={role?.name ?? ""}
        companyName={company?.name ?? ""}
        twoFactorStatus={twoFactorStatus}
      />
    </div>
  );
}
