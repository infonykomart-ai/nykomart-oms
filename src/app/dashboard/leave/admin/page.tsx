import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { computeLeaveBalance } from "@/lib/attendance/leave-balance";
import { LeaveApprovalRow, type CoverageRow } from "./leave-approval-row";
import { LeaveTypesPanel } from "./leave-types-panel";

// 2026-08-12 (round 8): "MD ADMIN KO YE POWER HO KI MERI ABSENCE ME WORK
// KON KAREGA USKO ASSING KARNE PAR AUTO MATIC ROLE ME ACTIN HO JAYE" — the
// MD/Admin side: approve/reject every leave request for the selected
// company, and once approved, assign who covers which store (that
// assignment itself is the access grant — see actions.ts/
// require-capability.ts). Reads via the service-role client for the two
// brand-new tables, same RLS-vs-service-role lesson as every other new
// table this project.
export default async function LeaveAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const admin = await requireCapability("leave_admin");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name").in("id", admin.companyIds);
  const selectedCompanyId =
    typeof sp.company === "string" && admin.companyIds.includes(sp.company) ? sp.company : admin.currentCompanyId;

  const today = todayIST();
  const leaveYear = Number(today.slice(0, 4));
  const yearStart = `${leaveYear}-01-01`;
  const yearEnd = `${leaveYear}-12-31`;

  const [{ data: requests }, { data: teamEmployees }, { data: stores }, { data: leaveTypesRaw }] = await Promise.all([
    finSupabase
      .from("leave_requests")
      .select("id, employee_id, from_date, to_date, reason, status, requested_at, decision_remark, leave_type_id")
      .eq("company_id", selectedCompanyId)
      .order("requested_at", { ascending: false })
      .limit(100),
    supabase.from("employees").select("id, name, date_of_joining").eq("company_id", selectedCompanyId).eq("active", true).order("name"),
    supabase.from("stores").select("id, name").eq("company_id", selectedCompanyId).order("name"),
    // 2026-09-11 (Payroll Phase 2): ALL leave types (including inactive) so
    // the management panel and past-request name lookups both work — only
    // active ones get offered to employees on the request form itself.
    finSupabase
      .from("leave_types")
      .select("id, name, code, paid, annual_accrual_days, accrual_frequency, carry_forward_cap, active")
      .eq("company_id", selectedCompanyId)
      .order("name"),
  ]);

  const leaveTypes = leaveTypesRaw ?? [];
  const leaveTypeName = new Map(leaveTypes.map((t) => [t.id, t.code ? `${t.name} (${t.code})` : t.name]));

  // Team leave-balance table — one row per active employee, one column per
  // PAID leave type, for the current leave year. Same live-derived
  // convention as the employee's own "My Leave Balance" panel.
  let balanceTable: { employeeId: string; employeeName: string; balances: Map<string, number> }[] = [];
  const paidLeaveTypes = leaveTypes.filter((t) => t.paid && t.active);
  if (paidLeaveTypes.length > 0 && (teamEmployees ?? []).length > 0) {
    const employeeIds = (teamEmployees ?? []).map((e) => e.id);
    const typeIds = paidLeaveTypes.map((t) => t.id);
    const [{ data: adjustmentsRaw }, { data: usedRowsRaw }] = await Promise.all([
      finSupabase
        .from("leave_balance_adjustments")
        .select("employee_id, leave_type_id, adjustment_days")
        .in("employee_id", employeeIds)
        .eq("leave_year", leaveYear)
        .in("leave_type_id", typeIds),
      finSupabase
        .from("attendance")
        .select("employee_id, leave_type_id")
        .in("employee_id", employeeIds)
        .eq("status", "Leave")
        .eq("leave_unpaid", false)
        .in("leave_type_id", typeIds)
        .gte("attendance_date", yearStart)
        .lte("attendance_date", yearEnd),
    ]);
    const adjustmentKey = (empId: string, typeId: string) => `${empId}|${typeId}`;
    const adjustmentByKey = new Map<string, number>();
    for (const a of adjustmentsRaw ?? []) {
      const key = adjustmentKey(a.employee_id, a.leave_type_id);
      adjustmentByKey.set(key, (adjustmentByKey.get(key) ?? 0) + Number(a.adjustment_days));
    }
    const usedByKey = new Map<string, number>();
    for (const r of usedRowsRaw ?? []) {
      if (!r.leave_type_id) continue;
      const key = adjustmentKey(r.employee_id, r.leave_type_id);
      usedByKey.set(key, (usedByKey.get(key) ?? 0) + 1);
    }
    balanceTable = (teamEmployees ?? []).map((e) => {
      const balances = new Map<string, number>();
      for (const t of paidLeaveTypes) {
        const key = adjustmentKey(e.id, t.id);
        balances.set(
          t.id,
          computeLeaveBalance({
            leaveType: { annual_accrual_days: Number(t.annual_accrual_days), accrual_frequency: t.accrual_frequency as "Monthly" | "Upfront" },
            leaveYear,
            asOfDateStr: today,
            joinDate: e.date_of_joining,
            adjustmentDaysTotal: adjustmentByKey.get(key) ?? 0,
            usedDays: usedByKey.get(key) ?? 0,
          })
        );
      }
      return { employeeId: e.id, employeeName: e.name, balances };
    });
  }

  // Requesters might not all be in teamEmployees (e.g. since deactivated,
  // or the request predates a company switch) — resolve names for exactly
  // the employee_ids actually present in the fetched requests.
  const requesterIds = Array.from(new Set((requests ?? []).map((r) => r.employee_id)));
  const { data: requesters } =
    requesterIds.length > 0 ? await supabase.from("employees").select("id, name").in("id", requesterIds) : { data: [] as { id: string; name: string }[] };
  const requesterName = new Map((requesters ?? []).map((e) => [e.id, e.name]));

  const approvedIds = (requests ?? []).filter((r) => r.status === "Approved").map((r) => r.id);
  const { data: coverageRaw } =
    approvedIds.length > 0
      ? await finSupabase
          .from("leave_coverage_assignments")
          .select("id, leave_request_id, covering_employee_id, store_id, from_date, to_date")
          .in("leave_request_id", approvedIds)
      : { data: [] as { id: string; leave_request_id: string; covering_employee_id: string; store_id: string; from_date: string; to_date: string }[] };

  const coveringIds = Array.from(new Set((coverageRaw ?? []).map((c) => c.covering_employee_id)));
  const coverageStoreIds = Array.from(new Set((coverageRaw ?? []).map((c) => c.store_id)));
  const [{ data: coveringEmployees }, { data: coverageStores }] = await Promise.all([
    coveringIds.length > 0 ? supabase.from("employees").select("id, name").in("id", coveringIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    coverageStoreIds.length > 0 ? supabase.from("stores").select("id, name").in("id", coverageStoreIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const coveringEmployeeName = new Map((coveringEmployees ?? []).map((e) => [e.id, e.name]));
  const coverageStoreName = new Map((coverageStores ?? []).map((s) => [s.id, s.name]));

  const coverageByRequest = new Map<string, CoverageRow[]>();
  for (const c of coverageRaw ?? []) {
    const list = coverageByRequest.get(c.leave_request_id) ?? [];
    list.push({
      id: c.id,
      covering_employee_name: coveringEmployeeName.get(c.covering_employee_id) ?? "—",
      store_name: coverageStoreName.get(c.store_id) ?? "—",
      from_date: c.from_date,
      to_date: c.to_date,
    });
    coverageByRequest.set(c.leave_request_id, list);
  }

  // Pending first (needs action), then everything else newest-first
  // (already the query's own order).
  const sorted = [...(requests ?? [])].sort((a, b) => {
    if (a.status === "Pending" && b.status !== "Pending") return -1;
    if (a.status !== "Pending" && b.status === "Pending") return 1;
    return 0;
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">✋ Leave Approvals</h1>
        <p className="mt-1 text-sm text-slate-500">Approve/reject leave requests, and assign who covers the store while someone&apos;s away.</p>
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

      <div className="space-y-3">
        {sorted.map((r) => (
          <LeaveApprovalRow
            key={r.id}
            requestId={r.id}
            employeeName={requesterName.get(r.employee_id) ?? "—"}
            fromDate={r.from_date}
            toDate={r.to_date}
            reason={r.reason}
            status={r.status}
            requestedAt={r.requested_at}
            decisionRemark={r.decision_remark}
            leaveTypeName={r.leave_type_id ? leaveTypeName.get(r.leave_type_id) ?? null : null}
            employees={teamEmployees ?? []}
            stores={stores ?? []}
            coverage={coverageByRequest.get(r.id) ?? []}
          />
        ))}
        {sorted.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">No leave requests for this company yet.</p>
        )}
      </div>

      {balanceTable.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-700">📊 Team Leave Balances — {leaveYear}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400">
                  <th className="py-1 pr-3">Employee</th>
                  {paidLeaveTypes.map((t) => (
                    <th key={t.id} className="px-2">{t.code ?? t.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {balanceTable.map((row) => (
                  <tr key={row.employeeId} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 font-medium text-slate-800">{row.employeeName}</td>
                    {paidLeaveTypes.map((t) => {
                      const bal = row.balances.get(t.id) ?? 0;
                      return (
                        <td key={t.id} className={`px-2 ${bal > 0 ? "text-green-700" : "text-red-600"}`}>
                          {bal}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6">
        <LeaveTypesPanel leaveTypes={leaveTypes} employees={teamEmployees ?? []} currentYear={leaveYear} />
      </div>
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
