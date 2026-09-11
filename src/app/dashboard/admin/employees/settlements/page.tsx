import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { InitiateSettlementForm } from "./initiate-settlement-form";

// 2026-09-11 (Payroll Phase 4 — final phase) — Full & Final Settlement
// list: start a new one, see what's in progress, browse settled history.
// Full reference-number + line-item detail lives on the per-settlement
// page (./[id]/page.tsx) — this index is deliberately just a picker/list.
export default async function SettlementsPage({
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

  const [{ data: activeEmployees }, { data: settlementsRaw }] = await Promise.all([
    supabase.from("employees").select("id, name").eq("company_id", selectedCompanyId).eq("active", true).order("name"),
    finSupabase
      .from("employee_settlements")
      .select("id, employee_id, separation_type, status, last_working_day, initiated_at, payment_date")
      .eq("company_id", selectedCompanyId)
      .order("initiated_at", { ascending: false })
      .limit(200),
  ]);

  const settlements = settlementsRaw ?? [];
  const employeeIds = Array.from(new Set(settlements.map((s) => s.employee_id)));
  const { data: employeesForNames } =
    employeeIds.length > 0 ? await supabase.from("employees").select("id, name").in("id", employeeIds) : { data: [] as { id: string; name: string }[] };
  const employeeName = new Map((employeesForNames ?? []).map((e) => [e.id, e.name]));

  const inProgress = settlements.filter((s) => s.status !== "Paid");
  const history = settlements.filter((s) => s.status === "Paid");
  const inProgressEmployeeIds = new Set(inProgress.map((s) => s.employee_id));
  const eligibleEmployees = (activeEmployees ?? []).filter((e) => !inProgressEmployeeIds.has(e.id));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🧾 Full &amp; Final Settlement</h1>
        <p className="mt-1 text-sm text-slate-500">
          For resignation/termination — notice shortfall, leave encashment, a gratuity estimate, and outstanding
          advances are all shown as reference numbers on the settlement page; every actual amount is a line item you
          add yourself.
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
        <div className="lg:col-span-1">
          <InitiateSettlementForm employees={eligibleEmployees} />
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">In Progress</h2>
            <div className="space-y-2">
              {inProgress.map((s) => (
                <SettlementRow key={s.id} settlement={s} employeeName={employeeName.get(s.employee_id) ?? "—"} />
              ))}
              {inProgress.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Nothing in progress.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">History (Paid)</h2>
            <div className="space-y-2">
              {history.map((s) => (
                <SettlementRow key={s.id} settlement={s} employeeName={employeeName.get(s.employee_id) ?? "—"} />
              ))}
              {history.length === 0 && <p className="py-4 text-center text-xs text-slate-400">No settlements paid yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettlementRow({
  settlement,
  employeeName,
}: {
  settlement: {
    id: string;
    separation_type: string;
    status: string;
    last_working_day: string;
    initiated_at: string;
    payment_date: string | null;
  };
  employeeName: string;
}) {
  const statusClass =
    settlement.status === "Paid"
      ? "bg-green-50 text-green-700"
      : settlement.status === "Finalized"
        ? "bg-blue-50 text-blue-700"
        : "bg-amber-50 text-amber-700";
  return (
    <Link
      href={`/dashboard/admin/employees/settlements/${settlement.id}`}
      className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50"
    >
      <div>
        <span className="font-medium text-slate-800">{employeeName}</span>
        <span className="ml-2 text-xs text-slate-400">
          {settlement.separation_type} · Last day {settlement.last_working_day}
          {settlement.payment_date ? ` · Paid ${settlement.payment_date}` : ""}
        </span>
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>{settlement.status}</span>
    </Link>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
