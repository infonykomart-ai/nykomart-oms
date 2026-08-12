import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { LeaveApprovalRow, type CoverageRow } from "./leave-approval-row";

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

  const [{ data: requests }, { data: teamEmployees }, { data: stores }] = await Promise.all([
    finSupabase
      .from("leave_requests")
      .select("id, employee_id, from_date, to_date, reason, status, requested_at, decision_remark")
      .eq("company_id", selectedCompanyId)
      .order("requested_at", { ascending: false })
      .limit(100),
    supabase.from("employees").select("id, name").eq("company_id", selectedCompanyId).eq("active", true).order("name"),
    supabase.from("stores").select("id, name").eq("company_id", selectedCompanyId).order("name"),
  ]);

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
            employees={teamEmployees ?? []}
            stores={stores ?? []}
            coverage={coverageByRequest.get(r.id) ?? []}
          />
        ))}
        {sorted.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">No leave requests for this company yet.</p>
        )}
      </div>
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
