import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { EmployeeForm } from "./employee-form";
import { EmployeeRowActions } from "./employee-row-actions";

export default async function EmployeesAdminPage() {
  await requireCapability("employee_admin");
  const supabase = await createClient();

  const [{ data: employees }, { data: roles }, { data: companies }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, email, active, designation, employee_code, company_id, role_id")
      .order("created_at", { ascending: false }),
    supabase.from("roles").select("id, name").order("name"),
    supabase.from("companies").select("id, name").eq("active", true).order("name"),
  ]);

  const roleName = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Employees</h1>
        <p className="mt-1 text-sm text-slate-500">
          Naya login banao, password reset karo, ya kisi employee ko deactivate karo — sab yahin se, Supabase
          dashboard me jaane ki zaroorat nahi.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <EmployeeForm roles={roles ?? []} companies={companies ?? []} />
        </div>

        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Naam</th>
                  <th className="px-4 py-3">Role / Company</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(employees ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{e.name}</div>
                      <div className="text-xs text-slate-400">{e.email ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{roleName.get(e.role_id) ?? "—"}</div>
                      <div className="text-xs text-slate-400">{companyName.get(e.company_id) ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          e.active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {e.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <EmployeeRowActions employeeId={e.id} active={e.active} />
                    </td>
                  </tr>
                ))}
                {(employees ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">
                      Abhi tak koi employee nahi hai.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
