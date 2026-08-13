import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { MyProfileForm } from "./my-profile-form";

// 2026-08-12: "My Profile" — self-service edit of one's own personal-info
// fields, open to any signed-in employee (no capability gate, matching the
// user's "sabhi ko" — "everyone"). Read via the service-role client for
// consistency with the rest of this session's newer reads/writes (RLS
// policies here haven't been specifically re-verified for a plain
// self-select), but the query itself is hard-scoped to the caller's own id
// either way.
export default async function MyProfilePage() {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const [{ data: me }, { data: role }, { data: company }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, name, email, designation, employee_code, date_of_joining, whatsapp_no, gender, marital_status, dob, anniversary_date, photo_url, family_contact_1_name, family_contact_1_relation, family_contact_1_number, family_contact_2_name, family_contact_2_relation, family_contact_2_number"
      )
      .eq("id", employee.id)
      .single(),
    supabase.from("roles").select("name").eq("id", employee.roleId).single(),
    supabase.from("companies").select("name").eq("id", employee.homeCompanyId).single(),
  ]);

  if (!me) {
    return <p className="text-sm text-red-600">Could not load your profile.</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">My Profile</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Update your own personal details below. Access-related fields (role, company, login, employee code,
          designation, joining date) can only be changed by an Admin/MD — contact them if any of that needs updating.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-slate-400">Name: </span>
            <span className="font-medium text-slate-800">{me.name}</span>
          </div>
          <div>
            <span className="text-slate-400">Email: </span>
            <span className="font-medium text-slate-800">{me.email ?? "—"}</span>
          </div>
          <div>
            <span className="text-slate-400">Designation: </span>
            <span className="font-medium text-slate-800">{me.designation ?? "—"}</span>
          </div>
          <div>
            <span className="text-slate-400">Role: </span>
            <span className="font-medium text-slate-800">{role?.name ?? "—"}</span>
          </div>
          <div>
            <span className="text-slate-400">Employee Code: </span>
            <span className="font-medium text-slate-800">{me.employee_code ?? "—"}</span>
          </div>
          <div>
            <span className="text-slate-400">Company: </span>
            <span className="font-medium text-slate-800">{company?.name ?? "—"}</span>
          </div>
          <div>
            <span className="text-slate-400">Date of Joining: </span>
            <span className="font-medium text-slate-800">{me.date_of_joining ?? "—"}</span>
          </div>
        </div>
      </div>

      <MyProfileForm defaults={me} />
    </div>
  );
}
