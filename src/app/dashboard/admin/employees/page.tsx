import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { EmployeeForm } from "./employee-form";
import { EmployeeRowActions } from "./employee-row-actions";

export default async function EmployeesAdminPage() {
  await requireCapability("employee_admin");
  const supabase = await createClient();
  // 2026-08-12 (round 7): "agar kisi ne advance liya hai to HR section se
  // connect hokar yaha reflact hona chahiye" — employee_advances is
  // brand-new this round (no RLS policy on it yet, same reasoning as the
  // salary page), so read it via the service-role client.
  const finSupabase = createServiceRoleClient();

  const [{ data: employees }, { data: roles }, { data: companies }, { data: stores }, { data: storeAccess }, { data: advances }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, name, email, active, designation, employee_code, company_id, role_id, date_of_joining, whatsapp_no, gender, marital_status, dob, anniversary_date, photo_url, family_contact_1_name, family_contact_1_relation, family_contact_1_number, family_contact_2_name, family_contact_2_relation, family_contact_2_number"
      )
      .order("created_at", { ascending: false }),
    supabase.from("roles").select("id, name").order("name"),
    supabase.from("companies").select("id, name").eq("active", true).order("name"),
    // 2026-08-08: store-scoped Ad Spend — see employee-store-access-form.tsx.
    supabase.from("stores").select("id, name, company_id").order("name"),
    supabase.from("employee_store_access").select("employee_id, store_id"),
    finSupabase.from("employee_advances").select("employee_id, outstanding_amount").gt("outstanding_amount", 0),
  ]);

  const outstandingAdvanceByEmployee = new Map<string, number>();
  for (const a of advances ?? []) {
    const prev = outstandingAdvanceByEmployee.get(a.employee_id) ?? 0;
    outstandingAdvanceByEmployee.set(a.employee_id, prev + Number(a.outstanding_amount));
  }

  const roleName = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const storeIdsByEmployee = new Map<string, string[]>();
  for (const row of storeAccess ?? []) {
    const list = storeIdsByEmployee.get(row.employee_id) ?? [];
    list.push(row.store_id);
    storeIdsByEmployee.set(row.employee_id, list);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Employees</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a new login, reset a password, or deactivate an employee — all from here, no need to go into the
          Supabase dashboard.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <EmployeeForm roles={roles ?? []} companies={companies ?? []} stores={stores ?? []} />
        </div>

        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
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
                      {/* 2026-08-12: "advance liya hai to HR section se
                          connect hokar yaha reflact hona chahiye" — read
                          directly off employee_advances, same rows Salary
                          & Advances (/dashboard/salary) manages. */}
                      {(outstandingAdvanceByEmployee.get(e.id) ?? 0) > 0 && (
                        <div className="mt-1">
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Advance Due: ₹{outstandingAdvanceByEmployee.get(e.id)!.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <EmployeeRowActions
                        employeeId={e.id}
                        active={e.active}
                        details={e}
                        stores={stores ?? []}
                        currentStoreIds={storeIdsByEmployee.get(e.id) ?? []}
                      />
                    </td>
                  </tr>
                ))}
                {(employees ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">
                      No employees yet.
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
