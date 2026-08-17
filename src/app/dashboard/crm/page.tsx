import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";

// CRM Overview (round 11) — rebuild of the old Apps Script system's
// getCrmDashboardData()/getAlerts_() (see claude/hr-attendance-crm-notes.md
// for the old design this is modeled on: order-status counts, today's
// attendance breakdown, a capped list of concrete data-quality checks) +
// the P&L Dashboard (old: 100% live-formula sheet, ported to
// pl_dashboard_by_company_view/pl_dashboard_by_month_view in
// db/schema.sql SECTION 12 — this page is the first thing to actually
// query those views). Also includes a "Quick Find" (PO/RF/RG/buyer/contact
// search, capped 20) — in the old system this sat on every Dashboard page;
// here it's only on this one screen for now (scope call, flagged rather
// than silently different — see delivery notes).
export default async function CrmOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const employee = await requireCapability("crm_dashboard");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const today = todayIST();

  // 2026-08-17 fix — same bug/fix as Party Ledger / Bill Payment /
  // Statements: order-status counts, today's attendance, alerts and Quick
  // Find used to scope to `employee.companyIds` (every company this login
  // can access) instead of the currently selected company. "P&L by
  // Company" (plByCompany) is left scoped to `companyIds` deliberately —
  // it's a one-row-per-company COMPARISON table by design
  // (`pl_dashboard_by_company_view` is `GROUP BY company`), so narrowing
  // it to a single company would defeat the point of that specific
  // widget. "P&L by Month" (plByMonth) has no company_id column at all —
  // `pl_dashboard_by_month_view` aggregates `sale_profit_ledger` straight
  // to month with no per-company breakdown in the view itself, so it
  // can't be scoped without a schema/view change; flagged, not fixed here.
  const [
    { data: orderStatusRows },
    { data: attendanceRows },
    { data: alerts },
    { data: plByCompany },
    { data: plByMonth },
    quickFindResult,
  ] = await Promise.all([
    supabase.from("orders").select("status").eq("company_id", employee.currentCompanyId),
    finSupabase.from("attendance").select("status").eq("company_id", employee.currentCompanyId).eq("attendance_date", today),
    finSupabase.from("data_quality_alerts_view").select("order_id, ref_no, alert_type, detail").eq("company_id", employee.currentCompanyId).limit(50),
    finSupabase.from("pl_dashboard_by_company_view").select("company_id, company_name, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct").in("company_id", employee.companyIds),
    finSupabase.from("pl_dashboard_by_month_view").select("month, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct").limit(24),
    query
      ? supabase
          .from("orders")
          .select("id, ref_no, company_id, buyer_name_address, contact_no, marketplace_order_no, status")
          .eq("company_id", employee.currentCompanyId)
          .or(`ref_no.ilike.%${query}%,buyer_name_address.ilike.%${query}%,contact_no.ilike.%${query}%,marketplace_order_no.ilike.%${query}%`)
          .limit(20)
      : Promise.resolve({ data: [] as { id: string; ref_no: string; company_id: string; buyer_name_address: string | null; contact_no: string | null; marketplace_order_no: string | null; status: string }[] }),
  ]);

  const orderStatusCounts = new Map<string, number>();
  for (const o of orderStatusRows ?? []) {
    orderStatusCounts.set(o.status, (orderStatusCounts.get(o.status) ?? 0) + 1);
  }
  const ORDER_STATUSES = ["Pending", "Confirmed", "In Production", "Dispatched", "Delivered", "Hold", "Cancelled", "Returned"];

  const attendanceCounts = new Map<string, number>();
  for (const a of attendanceRows ?? []) {
    if (a.status) attendanceCounts.set(a.status, (attendanceCounts.get(a.status) ?? 0) + 1);
  }
  const ATTENDANCE_STATUSES = ["Present", "Absent", "Late", "Half Day", "Week Off", "Leave", "Holiday"];

  const quickFindRows = "data" in quickFindResult ? quickFindResult.data ?? [] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">📊 CRM Overview</h1>
        <p className="mt-1 text-sm text-slate-500">Company-wide order/attendance snapshot, data-quality alerts, and the P&amp;L Dashboard.</p>
      </div>

      <form method="GET" className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="mb-1 block text-xs font-medium text-slate-500">Quick Find — PO/RF/RG No., buyer name, contact no., or marketplace order no.</label>
        <div className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="e.g. PO-0001 or a buyer name"
            className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">Search</button>
        </div>
        {query && (
          <div className="mt-3 space-y-1 text-sm">
            {quickFindRows.length === 0 && <p className="text-slate-400">No matches.</p>}
            {quickFindRows.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
                <span className="font-medium text-slate-800">{o.ref_no}</span>
                <span className="text-slate-500">{o.buyer_name_address ?? "—"}</span>
                <span className="text-slate-400">{o.contact_no ?? "—"}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{o.status}</span>
              </div>
            ))}
          </div>
        )}
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Orders by Status</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ORDER_STATUSES.map((s) => (
              <div key={s} className="rounded-lg bg-slate-50 p-3 text-center">
                <div className="text-xl font-bold text-slate-900">{orderStatusCounts.get(s) ?? 0}</div>
                <div className="text-xs text-slate-500">{s}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Today&apos;s Attendance ({today})</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ATTENDANCE_STATUSES.map((s) => (
              <div key={s} className="rounded-lg bg-slate-50 p-3 text-center">
                <div className="text-xl font-bold text-slate-900">{attendanceCounts.get(s) ?? 0}</div>
                <div className="text-xs text-slate-500">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Data Quality Alerts ({(alerts ?? []).length} of up to 50)</h2>
        <div className="space-y-1 text-xs">
          {(alerts ?? []).length === 0 && <p className="text-slate-400">No alerts. 🎉</p>}
          {(alerts ?? []).map((a, i) => (
            <div key={`${a.order_id}-${i}`} className="flex items-start gap-2 border-b border-slate-100 py-1.5 last:border-0">
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">{a.alert_type}</span>
              <span className="text-slate-600">{a.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">P&amp;L by Company</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Company</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Sale Value (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Expenses (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Net Earn</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Profit %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(plByCompany ?? []).map((r) => (
                <tr key={r.company_id}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{r.company_name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{Number(r.total_sale_value_inr ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{Number(r.total_expenses_inr ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{Number(r.net_earn ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{(Number(r.profit_pct ?? 0) * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">P&amp;L by Month (most recent 24)</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Month</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Sale Value (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Expenses (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Net Earn</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Profit %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(plByMonth ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No Sale &amp; Profit Ledger data yet — import via CSV Upload.</td></tr>
              )}
              {(plByMonth ?? []).map((r) => (
                <tr key={r.month}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{r.month}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{Number(r.total_sale_value_inr ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{Number(r.total_expenses_inr ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{Number(r.net_earn ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{(Number(r.profit_pct ?? 0) * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
