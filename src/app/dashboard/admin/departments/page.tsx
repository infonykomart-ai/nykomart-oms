// 2026-10-02b — Department master (TeamOffice parity; "Department as
// structured org entity"): one row per company per department, replacing
// the free-text employees.department column shipped earlier the same day.
// Employees pick a department from this list (Create Employee + Edit
// Details), and every attendance report joins it for the Department
// column/filter. Gated employee_admin (same capability as the Employees
// screen it feeds); rename/deactivate instead of delete so report history
// never points at a missing row.
import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { DepartmentForm } from "./department-form";
import { DepartmentRowActions } from "./department-row-actions";

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const authed = await requireCapability("employee_admin");
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name").in("id", authed.companyIds).order("name");
  const companyId =
    typeof sp.company === "string" && authed.companyIds.includes(sp.company) ? sp.company : authed.currentCompanyId;

  const [{ data: departments }, { data: employees }] = await Promise.all([
    supabase.from("departments").select("id, name, active").eq("company_id", companyId).order("name"),
    supabase.from("employees").select("department_id").eq("company_id", companyId).eq("active", true),
  ]);

  // Member count per department — "kitne bande is department me hain" is
  // the one number an admin needs before renaming/deactivating anything.
  const memberCount = new Map<string, number>();
  for (const e of employees ?? []) {
    if (!e.department_id) continue;
    memberCount.set(e.department_id, (memberCount.get(e.department_id) ?? 0) + 1);
  }
  const unassigned = (employees ?? []).filter((e) => !e.department_id).length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">🏢 Departments</h1>
          <p className="text-sm text-slate-500">
            Structured department master — yahin se add/rename/deactivate karo; Employees forms aur har attendance report isi se
            Department column/filter bharte hain.
          </p>
        </div>
        <Link
          href="/dashboard/admin/employees"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Employees
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Company</label>
          <select name="company" defaultValue={companyId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Show
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Add Department</h2>
          <DepartmentForm companyId={companyId} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Members</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(departments ?? []).map((d) => (
                <tr key={d.id} className={d.active ? "" : "opacity-60"}>
                  <td className="px-3 py-2">
                    <DepartmentRowActions id={d.id} name={d.name} active={d.active} />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{memberCount.get(d.id) ?? 0}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        d.active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {d.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
              {(departments ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-400">
                    No departments yet — add the first one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          {unassigned} active employee(s) in this company have no department assigned yet — set one from Employees → Edit Details.
        </p>
      </div>
    </div>
  );
}
