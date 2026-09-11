import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { computeLeaveBalance } from "@/lib/attendance/leave-balance";
import { LeaveRequestForm } from "./leave-request-form";

// 2026-08-12 (round 8): "LEAVE REQUESST BHEJ DU APPLIATION KE SATH TO VO MD
// KE PASS APPROVAL KE LIYE CHLI JAYE" — every employee's own Leave screen:
// apply with a from/to date range + application text, and see the
// approval status of everything they've sent. Reads via the service-role
// client (see actions.ts's own comment — leave_requests/
// leave_coverage_assignments are brand-new tables, same RLS-vs-service-
// role lesson bitten repeatedly this project).
export default async function LeavePage() {
  const employee = await requireCapability("leave_management");
  const supabase = createServiceRoleClient();
  const today = todayIST();
  const leaveYear = Number(today.slice(0, 4));
  const yearStart = `${leaveYear}-01-01`;
  const yearEnd = `${leaveYear}-12-31`;

  const [{ data: myRequests }, { data: myCoverage }, { data: leaveTypesRaw }, { data: myProfile }] = await Promise.all([
    supabase
      .from("leave_requests")
      .select("id, from_date, to_date, reason, status, requested_at, decided_at, decision_remark")
      .eq("employee_id", employee.id)
      .order("requested_at", { ascending: false })
      .limit(50),
    // "MERE PASS ... ACCESS HAI" — the flip side: any store THIS login is
    // currently covering for someone else, active right now.
    supabase
      .from("leave_coverage_assignments")
      .select("id, store_id, from_date, to_date, remark")
      .eq("covering_employee_id", employee.id)
      .lte("from_date", today)
      .gte("to_date", today),
    // 2026-09-11 (Payroll Phase 2): real leave types, if this company has
    // set any up — an empty list here means no leave-type dropdown shows
    // on the form above (leave-request-form.tsx) and no balance panel
    // below, so a company that never configures leave types sees no change
    // at all from this round.
    supabase
      .from("leave_types")
      .select("id, name, code, paid, annual_accrual_days, accrual_frequency")
      .eq("company_id", employee.currentCompanyId)
      .eq("active", true)
      .order("name"),
    supabase.from("employees").select("date_of_joining").eq("id", employee.id).single(),
  ]);

  const leaveTypes = leaveTypesRaw ?? [];
  let myBalances: { id: string; name: string; code: string | null; paid: boolean; balance: number }[] = [];
  if (leaveTypes.length > 0) {
    const typeIds = leaveTypes.map((t) => t.id);
    const [{ data: adjustmentsRaw }, { data: usedRowsRaw }] = await Promise.all([
      supabase
        .from("leave_balance_adjustments")
        .select("leave_type_id, adjustment_days")
        .eq("employee_id", employee.id)
        .eq("leave_year", leaveYear)
        .in("leave_type_id", typeIds),
      supabase
        .from("attendance")
        .select("leave_type_id")
        .eq("employee_id", employee.id)
        .eq("status", "Leave")
        .eq("leave_unpaid", false)
        .in("leave_type_id", typeIds)
        .gte("attendance_date", yearStart)
        .lte("attendance_date", yearEnd),
    ]);
    const adjustmentByType = new Map<string, number>();
    for (const a of adjustmentsRaw ?? []) {
      adjustmentByType.set(a.leave_type_id, (adjustmentByType.get(a.leave_type_id) ?? 0) + Number(a.adjustment_days));
    }
    const usedByType = new Map<string, number>();
    for (const r of usedRowsRaw ?? []) {
      if (!r.leave_type_id) continue;
      usedByType.set(r.leave_type_id, (usedByType.get(r.leave_type_id) ?? 0) + 1);
    }
    myBalances = leaveTypes.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      paid: t.paid,
      balance: t.paid
        ? computeLeaveBalance({
            leaveType: { annual_accrual_days: Number(t.annual_accrual_days), accrual_frequency: t.accrual_frequency as "Monthly" | "Upfront" },
            leaveYear,
            asOfDateStr: today,
            joinDate: myProfile?.date_of_joining ?? null,
            adjustmentDaysTotal: adjustmentByType.get(t.id) ?? 0,
            usedDays: usedByType.get(t.id) ?? 0,
          })
        : 0,
    }));
  }

  const requestIds = (myRequests ?? []).map((r) => r.id);
  const coverageStoreIds = (myCoverage ?? []).map((c) => c.store_id);
  const allStoreIds = Array.from(new Set(coverageStoreIds));

  const [{ data: coverageForMine }, { data: stores }] = await Promise.all([
    // Approved requests of mine that already have coverage assigned — so I
    // can see who's covering my absence.
    requestIds.length > 0
      ? supabase
          .from("leave_coverage_assignments")
          .select("id, leave_request_id, covering_employee_id, store_id, from_date, to_date")
          .in("leave_request_id", requestIds)
      : Promise.resolve({ data: [] as { id: string; leave_request_id: string; covering_employee_id: string; store_id: string; from_date: string; to_date: string }[] }),
    allStoreIds.length > 0
      ? supabase.from("stores").select("id, name").in("id", allStoreIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const coveringEmployeeIds = Array.from(new Set((coverageForMine ?? []).map((c) => c.covering_employee_id)));
  const { data: coveringEmployees } =
    coveringEmployeeIds.length > 0
      ? await supabase.from("employees").select("id, name").in("id", coveringEmployeeIds)
      : { data: [] as { id: string; name: string }[] };

  const storeName = new Map((stores ?? []).map((s) => [s.id, s.name]));
  const employeeName = new Map((coveringEmployees ?? []).map((e) => [e.id, e.name]));
  const coverageByRequest = new Map<string, typeof coverageForMine>();
  for (const c of coverageForMine ?? []) {
    const list = coverageByRequest.get(c.leave_request_id) ?? [];
    list.push(c);
    coverageByRequest.set(c.leave_request_id, list);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🏖️ Leave</h1>
        <p className="mt-1 text-sm text-slate-500">Apply for leave, and track approval status.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-6">
          <LeaveRequestForm today={today} leaveTypes={leaveTypes.map((t) => ({ id: t.id, name: t.name, code: t.code, paid: t.paid }))} />

          {myBalances.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-2 text-sm font-semibold text-slate-700">📊 My Leave Balance — {leaveYear}</p>
              <ul className="space-y-1.5 text-sm">
                {myBalances.map((b) => (
                  <li key={b.id} className="flex items-center justify-between">
                    <span className="text-slate-600">
                      {b.name}
                      {b.code ? ` (${b.code})` : ""}
                    </span>
                    {b.paid ? (
                      <span className={`font-semibold ${b.balance > 0 ? "text-green-700" : "text-red-600"}`}>{b.balance} days</span>
                    ) : (
                      <span className="text-xs text-slate-400">Unpaid — no balance</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-400">
                Current published accrual convention (not a verified copy of this company&apos;s actual leave policy) —
                see the note on the Leave Approvals page.
              </p>
            </div>
          )}

          {allStoreIds.length > 0 && (
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
              <p className="mb-2 text-sm font-semibold text-teal-800">🔓 Active Coverage Access</p>
              <p className="mb-2 text-xs text-teal-700">You currently have temporary access to:</p>
              <ul className="space-y-1 text-sm text-teal-900">
                {(myCoverage ?? []).map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{storeName.get(c.store_id) ?? "—"}</span>
                    <span className="text-xs text-teal-600"> (until {c.to_date})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">My Leave Requests</h2>
            <div className="space-y-3">
              {(myRequests ?? []).map((r) => {
                const coverage = coverageByRequest.get(r.id) ?? [];
                return (
                  <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {r.from_date} → {r.to_date}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">{r.reason}</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    {r.status === "Rejected" && r.decision_remark && (
                      <p className="mt-2 text-xs text-red-700">MD/Admin remark: {r.decision_remark}</p>
                    )}
                    {coverage.length > 0 && (
                      <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
                        <p className="font-medium text-slate-500">Coverage while you&apos;re away:</p>
                        {coverage.map((c) => (
                          <p key={c.id}>
                            {employeeName.get(c.covering_employee_id) ?? "—"} → {storeName.get(c.store_id) ?? "—"} ({c.from_date} to {c.to_date})
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {(myRequests ?? []).length === 0 && (
                <p className="py-6 text-center text-sm text-slate-400">No leave requests yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "Approved"
      ? "bg-green-50 text-green-700"
      : status === "Rejected"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}
