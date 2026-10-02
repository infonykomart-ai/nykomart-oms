import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { EmployeesHeader } from "./employees-header";
import { EmployeeForm } from "./employee-form";
import { EmployeeRowActions } from "./employee-row-actions";
// 2026-09-30 — per-row Telegram connection status + one-click Test send,
// see employee-telegram-cell.tsx (replaced the WhatsApp cell the same day
// punch notifications switched to Telegram DMs).
import { EmployeeTelegramCell } from "./employee-telegram-cell";
import Link from "next/link";

// 2026-09-29 — FedEx-style upgrade: the bare "Employees" h1 row became a
// card-style identity header for the whole ROSTER (Employee Roster, big
// count, photo strip, active/inactive split) — the same visual language
// the redesigned My Profile uses (see my-profile-form.tsx), plus the
// user's bulk-download buttons ("sabhi employe ka data ek sath download"):
// ⬇ Export All (Excel) and 📄 Directory PDF, both gated to this page's
// existing employee_admin capability (see export-actions.ts).
//
// The create-form + table + row-actions layout below is UNCHANGED — only
// the header block was replaced.
export default async function EmployeesAdminPage() {
  await requireCapability("employee_admin");
  const supabase = await createClient();
  // 2026-08-12 (round 7): "agar kisi ne advance liya hai to HR section se
  // connect hokar yaha reflact hona chahiye" — employee_advances is
  // brand-new this round (no RLS policy on it yet, same reasoning as the
  // salary page), so read it via the service-role client.
  const finSupabase = createServiceRoleClient();

  const [{ data: employees }, { data: roles }, { data: companies }, { data: stores }, { data: storeAccess }, { data: advances }, { data: documentsRaw }, { data: departments }] =
    await Promise.all([
      supabase
        .from("employees")
        .select(
          "id, name, email, active, designation, department_id, employee_code, company_id, role_id, date_of_joining, whatsapp_no, telegram_chat_id, gender, marital_status, dob, anniversary_date, photo_url, family_contact_1_name, family_contact_1_relation, family_contact_1_number, family_contact_2_name, family_contact_2_relation, family_contact_2_number, pan_number, uan_number, pf_number, esi_number, bank_account_holder_name, bank_account_no, bank_ifsc, bank_name, reports_to_employee_id"
        )
        .order("created_at", { ascending: false }),
      supabase.from("roles").select("id, name").order("name"),
      supabase.from("companies").select("id, name").eq("active", true).order("name"),
      // 2026-08-08: store-scoped Ad Spend — see employee-store-access-form.tsx.
      supabase.from("stores").select("id, name, company_id").order("name"),
      supabase.from("employee_store_access").select("employee_id, store_id"),
      finSupabase.from("employee_advances").select("employee_id, outstanding_amount").gt("outstanding_amount", 0),
      // 2026-09-11 (Payroll Phase 3) — see employee-documents-panel.tsx.
      finSupabase
        .from("employee_documents")
        .select("id, employee_id, doc_type, file_name, file_size, notes, uploaded_at")
        .order("uploaded_at", { ascending: false }),
      // 2026-10-02b — structured department master (all companies this
      // admin can see; per-company filtering happens at each usage).
      supabase.from("departments").select("id, name, company_id, active").order("name"),
    ]);

  const outstandingAdvanceByEmployee = new Map<string, number>();
  for (const a of advances ?? []) {
    const prev = outstandingAdvanceByEmployee.get(a.employee_id) ?? 0;
    outstandingAdvanceByEmployee.set(a.employee_id, prev + Number(a.outstanding_amount));
  }

  const roleName = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  // 2026-10-02b — resolve employees.department_id -> name for the table,
  // and group departments by company for the Edit Details select.
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const departmentsByCompany = new Map<string, { id: string; name: string }[]>();
  for (const d of departments ?? []) {
    const list = departmentsByCompany.get(d.company_id) ?? [];
    list.push({ id: d.id, name: d.name });
    departmentsByCompany.set(d.company_id, list);
  }
  const storeIdsByEmployee = new Map<string, string[]>();
  for (const row of storeAccess ?? []) {
    const list = storeIdsByEmployee.get(row.employee_id) ?? [];
    list.push(row.store_id);
    storeIdsByEmployee.set(row.employee_id, list);
  }

  // 2026-09-11 (Payroll Phase 3) — "Reports To" options are scoped to the
  // SAME company as the employee being edited (an org chart spanning
  // companies isn't meaningful here), excluding the employee themselves.
  const employeesByCompany = new Map<string, { id: string; name: string }[]>();
  for (const e of employees ?? []) {
    const list = employeesByCompany.get(e.company_id) ?? [];
    list.push({ id: e.id, name: e.name });
    employeesByCompany.set(e.company_id, list);
  }
  const documentsByEmployee = new Map<string, typeof documentsRaw>();
  for (const d of documentsRaw ?? []) {
    const list = documentsByEmployee.get(d.employee_id) ?? [];
    list.push(d);
    documentsByEmployee.set(d.employee_id, list);
  }

  // Header stats — computed once here, props-only from the client's view.
  const list = employees ?? [];
  const activeCount = list.filter((e) => e.active).length;

  return (
    <div className="pb-6">
      <EmployeesHeader
        total={list.length}
        activeCount={activeCount}
        inactiveCount={list.length - activeCount}
        photoUrls={list.map((e) => e.photo_url)}
      />

      {/* 2026-09-15 — "screen auto adjust hojaye": @lg: variants respond to
          THIS page's own width (DashboardMain is a CSS container), not the
          browser window — with the sidebar taking 240-288px the old
          window-based lg: breakpoint stacked the form over the table far
          too late on tablets. The table also scrolls horizontally below
          @3xl instead of clipping under overflow-hidden. */}
      <div className="mt-6 grid grid-cols-1 gap-6 @lg:grid-cols-3">
        <div className="@lg:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Department master</span>
            <Link
              href="/dashboard/admin/departments"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              🏢 Manage Departments
            </Link>
          </div>
          <EmployeeForm roles={roles ?? []} companies={companies ?? []} stores={stores ?? []} departments={departments ?? []} />
        </div>

        <div className="@lg:col-span-2">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Role / Company</th>
                  <th className="px-4 py-3">Telegram</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{e.name}</div>
                      <div className="text-xs text-slate-400">{e.email ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{roleName.get(e.role_id) ?? "—"}</div>
                      <div className="text-xs text-slate-400">{companyName.get(e.company_id) ?? "—"}</div>
                      {/* 2026-10-02b — resolved from the departments
                          master (structured entity, not free text). */}
                      <div className="text-xs text-slate-400">{(e.department_id && departmentName.get(e.department_id)) ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <EmployeeTelegramCell employeeId={e.id} raw={e.telegram_chat_id} botUsername={process.env.TELEGRAM_BOT_USERNAME ?? null} />
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
                        employeeName={e.name}
                        active={e.active}
                        details={e}
                        roleId={e.role_id}
                        roles={roles ?? []}
                        stores={stores ?? []}
                        currentStoreIds={storeIdsByEmployee.get(e.id) ?? []}
                        reportsToOptions={(employeesByCompany.get(e.company_id) ?? []).filter((o) => o.id !== e.id)}
                        departments={departmentsByCompany.get(e.company_id) ?? []}
                        documents={documentsByEmployee.get(e.id) ?? []}
                      />
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
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
