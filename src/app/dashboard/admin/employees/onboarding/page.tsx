import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { ChecklistManager } from "./checklist-manager";
import { EmployeeChecklistRow } from "./employee-checklist-row";

// 2026-09-11 (Payroll Phase 3) — Onboarding Checklist. A simple stage
// tracker (title + done/not-done + who/when), NOT a full e-signature
// pipeline — that needs a real e-sign provider this business doesn't have.
// Company-scoped, same picker pattern as Leave Approvals/Salary.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const admin = await requireCapability("employee_admin");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name").in("id", admin.companyIds).order("name");
  const selectedCompanyId =
    typeof sp.company === "string" && admin.companyIds.includes(sp.company) ? sp.company : admin.currentCompanyId;

  const [{ data: items }, { data: employees }] = await Promise.all([
    finSupabase
      .from("onboarding_checklist_items")
      .select("id, title, sort_order, active")
      .eq("company_id", selectedCompanyId)
      .order("sort_order")
      .order("title"),
    supabase
      .from("employees")
      .select("id, name, active, date_of_joining")
      .eq("company_id", selectedCompanyId)
      .order("date_of_joining", { ascending: false, nullsFirst: false }),
  ]);

  const activeItems = (items ?? []).filter((i) => i.active);
  const employeeIds = (employees ?? []).map((e) => e.id);
  const { data: progressRaw } =
    employeeIds.length > 0 && activeItems.length > 0
      ? await finSupabase
          .from("employee_onboarding_progress")
          .select("employee_id, checklist_item_id, completed_at")
          .in("employee_id", employeeIds)
          .in(
            "checklist_item_id",
            activeItems.map((i) => i.id)
          )
      : { data: [] as { employee_id: string; checklist_item_id: string; completed_at: string | null }[] };

  const progressByEmployee = new Map<string, { checklist_item_id: string; completed_at: string | null }[]>();
  for (const p of progressRaw ?? []) {
    const list = progressByEmployee.get(p.employee_id) ?? [];
    list.push(p);
    progressByEmployee.set(p.employee_id, list);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🧭 Onboarding</h1>
        <p className="mt-1 text-sm text-slate-500">
          A simple checklist per employee — not e-signatures or document generation, just tracking what&apos;s done.
        </p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Company</label>
          <select name="company" defaultValue={selectedCompanyId} className={selectClass}>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
          View
        </button>
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {(employees ?? []).map((e) => (
            <EmployeeChecklistRow
              key={e.id}
              employeeId={e.id}
              employeeName={e.name}
              active={e.active}
              items={activeItems.map((i) => ({ id: i.id, title: i.title }))}
              progress={progressByEmployee.get(e.id) ?? []}
            />
          ))}
          {(employees ?? []).length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">No employees in this company yet.</p>
          )}
        </div>
        <div className="lg:col-span-1">
          <ChecklistManager companyId={selectedCompanyId} items={items ?? []} />
        </div>
      </div>
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
