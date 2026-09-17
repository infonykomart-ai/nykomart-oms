import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";

// 2026-09-17 — "jo jo expense huye vo sab aane chahiye na jis se confirm
// ho ki kya kya kese kese ghataya jara": the single "Expenses (INR)"
// number is now hover-expandable into its 5 sources (courier, duty,
// purchase bills, Debit/Credit-Note adjustments shown negative, and the
// pre-orders CSV history). Data comes from the views' breakdown columns
// (db/2026-09-17-pl-expense-breakdown.sql) — pure display, nothing here
// recomputes. A tiny client island inside this otherwise server page
// (details/summary needs no JS but React must render it; "use client"
// scope comes via this shared component being imported by the server
// component below without a directive — React renders <details> as plain
// HTML, so no island is actually needed; kept as a plain function).
type PlRow = {
  expense_courier_inr?: number | null;
  expense_duty_inr?: number | null;
  expense_purchase_inr?: number | null;
  expense_purchase_adjustments_inr?: number | null;
  expense_washing_inr?: number | null;
  expense_historical_inr?: number | null;
  portal_fees_matched_inr?: number | null;
};

function PlExpenseBreakdown({ row }: { row: PlRow }) {
  // 2026-09-17 — the migration adds these columns to the views; until the
  // SQL file is run, Postgres answers the named .select() with a 42703
  // "column does not exist" error and the ENTIRE P&L comes back empty
  // (that's the blank tables screenshot). Gating the breakdown — and the
  // page's select list — on whether the view actually returned the column
  // keeps the tables rendering with the pre-migration data instead.
  if (row.expense_courier_inr === undefined) return null;
  const lines: Array<[string, number | null | undefined]> = [
    ["Courier (freight bills)", row.expense_courier_inr],
    ["Duty (duty bills)", row.expense_duty_inr],
    ["Purchase bills (GST-incl.)", row.expense_purchase_inr],
    ["Debit/Credit Note adjustments", row.expense_purchase_adjustments_inr],
    ["Washing chalans (auto)", row.expense_washing_inr],
    ["Old CSV history (pre-orders)", row.expense_historical_inr],
  ];
  return (
    <details className="group inline-block text-left">
      <summary className="ml-1 cursor-pointer list-none text-[10px] font-semibold text-sky-700 hover:text-sky-900">▾</summary>
      <div className="absolute z-10 mt-1 min-w-56 rounded-lg border border-slate-200 bg-white p-2 text-[11px] shadow-lg">
        {lines.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-0.5">
            <span className="text-slate-500">{label}</span>
            <span className={`font-medium ${Number(val ?? 0) < 0 ? "text-emerald-700" : "text-slate-800"}`}>
              {Number(val ?? 0).toFixed(2)}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-100 pt-1">
          <span className="text-slate-500">Matched portal fees (offset 25%)</span>
          <span className="font-medium text-slate-800">{Number(row.portal_fees_matched_inr ?? 0).toFixed(2)}</span>
        </div>
      </div>
    </details>
  );
}

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
  //
  // 2026-08-20 — Gap 4 (office/cash expenses, see
  // claude/five-gaps-implementation-plan-2026-08-20.md and
  // db/2026-08-20-internal-expenses.sql): both views gained
  // total_internal_expenses_inr + net_earn_after_overhead, sourced from the
  // new `internal_expenses` table. Deliberately kept as a SEPARATE line
  // from total_expenses_inr (which is per-order marketplace/shipping
  // expense from sale_profit_ledger) rather than merged into it — office
  // overhead and order-level expense are different things. plByMonth can
  // now also show a month with expenses but zero sales (e.g. rent paid in
  // a slow month), which plByMonth previously never surfaced at all.
  const [
    { data: orderStatusCountRows },
    { data: attendanceRows },
    { data: alerts },
    { data: plByCompany, error: plByCompanyErr },
    { data: plByMonth, error: plByMonthErr },
    quickFindResult,
    { data: buyerOrderRows },
  ] = await Promise.all([
    // 2026-08-17 perf fix — was `.select("status")` with no limit (every
    // order row for the company pulled just to count-by-status in Node).
    // get_order_status_counts() does the same GROUP BY in the database
    // instead, using idx_orders_status. See
    // db/2026-08-17-ebay-indexes-and-order-status-rpc.sql.
    supabase.rpc("get_order_status_counts", { p_company_id: employee.currentCompanyId }),
    finSupabase.from("attendance").select("status").eq("company_id", employee.currentCompanyId).eq("attendance_date", today),
    finSupabase.from("data_quality_alerts_view").select("order_id, ref_no, alert_type, detail").eq("company_id", employee.currentCompanyId).limit(50),
    finSupabase.from("pl_dashboard_by_company_view").select("company_id, company_name, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead, expense_courier_inr, expense_duty_inr, expense_purchase_inr, expense_purchase_adjustments_inr, expense_washing_inr, expense_historical_inr, portal_fees_matched_inr").in("company_id", employee.companyIds),
    finSupabase.from("pl_dashboard_by_month_view").select("month, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead, expense_courier_inr, expense_duty_inr, expense_purchase_inr, expense_purchase_adjustments_inr, expense_washing_inr, expense_historical_inr, portal_fees_matched_inr").limit(24),
    query
      ? supabase
          .from("orders")
          .select("id, ref_no, company_id, buyer_name_address, contact_no, marketplace_order_no, status")
          .eq("company_id", employee.currentCompanyId)
          .or(`ref_no.ilike.%${query}%,buyer_name_address.ilike.%${query}%,contact_no.ilike.%${query}%,marketplace_order_no.ilike.%${query}%`)
          .limit(20)      : Promise.resolve({ data: [] as { id: string; ref_no: string; company_id: string; buyer_name_address: string | null; contact_no: string | null; marketplace_order_no: string | null; status: string }[] }),
    // 2026-08-17 — Top Buyers (gap identified in an OMS-features audit:
    // "customer database" had no repeat-buyer view). Grouped in JS below
    // by contact_no (falling back to buyer_name_address when contact_no is
    // blank) since there's no separate customer table — buyer identity
    // only exists as free text on each order (see orders.buyer_name_address
    // comment in schema.sql). Same un-limited per-company select pattern
    // already used for Orders by Status above — flagged in the same
    // 2026-08-17 performance review as something to revisit once order
    // volume grows large enough to matter (not yet, at current volume).
    supabase.from("orders").select("buyer_name_address, contact_no, order_value_usd").eq("company_id", employee.currentCompanyId),
  ]);

  // 2026-09-17 — blank-P&L guard. If either view query failed because the
  // migration's new columns aren't in the DB yet (42703 "column does not
  // exist"), retry ONCE with the pre-migration column list so the tables
  // still render today's real numbers instead of an empty shell; the ▾
  // breakdown renders nothing for those rows (undefined columns). Any
  // other error also falls back the same way — P&L visibility is too
  // important to blank the whole page over one missing column.
  const baseCompanyCols = "company_id, company_name, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead";
  const baseMonthCols = "month, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead";
  let plCompanyRows = plByCompany;
  let plMonthRows = plByMonth;
  if (plByCompanyErr || plByMonthErr) {
    const [retryCompany, retryMonth] = await Promise.all([
      finSupabase.from("pl_dashboard_by_company_view").select(baseCompanyCols).in("company_id", employee.companyIds),
      finSupabase.from("pl_dashboard_by_month_view").select(baseMonthCols).limit(24),
    ]);
    // Cast is honest: base rows genuinely lack the breakdown columns at
    // runtime — PlExpenseBreakdown's `undefined` check renders nothing for
    // them, and every other cell reads with ?? 0.
    if (!retryCompany.error) plCompanyRows = retryCompany.data as typeof plByCompany;
    if (!retryMonth.error) plMonthRows = retryMonth.data as typeof plByMonth;
    console.error("P&L breakdown columns unavailable — rendered base P&L instead. Run db/2026-09-17-pl-expense-breakdown.sql. Errors:", plByCompanyErr?.message, plByMonthErr?.message);
  }

  const orderStatusCounts = new Map<string, number>();
  for (const row of orderStatusCountRows ?? []) {
    orderStatusCounts.set(row.status, Number(row.cnt));
  }
  const ORDER_STATUSES = ["Pending", "Confirmed", "In Production", "Dispatched", "Delivered", "Hold", "Cancelled", "Returned"];

  const attendanceCounts = new Map<string, number>();
  for (const a of attendanceRows ?? []) {
    if (a.status) attendanceCounts.set(a.status, (attendanceCounts.get(a.status) ?? 0) + 1);
  }
  const ATTENDANCE_STATUSES = ["Present", "Absent", "Late", "Half Day", "Week Off", "Leave", "Holiday"];

  const quickFindRows = "data" in quickFindResult ? quickFindResult.data ?? [] : [];

  // Top Buyers — group by contact_no when present (a phone number is a
  // much more reliable dedup key than free-text buyer_name_address, which
  // varies row to row for the same real buyer — different spelling,
  // extra address details, etc.), falling back to the name text only when
  // no contact number was captured. Rows with neither are skipped (not a
  // real identifiable buyer to group).
  const buyerKey = (b: { buyer_name_address: string | null; contact_no: string | null }) =>
    b.contact_no?.trim() || b.buyer_name_address?.trim() || null;
  const buyerStats = new Map<string, { label: string; orderCount: number; totalUsd: number }>();
  for (const o of buyerOrderRows ?? []) {
    const key = buyerKey(o);
    if (!key) continue;
    const existing = buyerStats.get(key);
    const usd = Number(o.order_value_usd ?? 0);
    if (existing) {
      existing.orderCount += 1;
      existing.totalUsd += usd;
    } else {
      buyerStats.set(key, { label: o.buyer_name_address?.trim() || key, orderCount: 1, totalUsd: usd });
    }
  }
  const topBuyers = Array.from(buyerStats.values())
    .filter((b) => b.orderCount > 1) // "repeat" buyers — a single one-off order isn't a repeat-customer signal
    .sort((a, b) => b.orderCount - a.orderCount || b.totalUsd - a.totalUsd)
    .slice(0, 15);

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

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Top Buyers — Repeat Customers (current company)</h2>
        <p className="mb-3 text-xs text-slate-400">
          Grouped by contact number (falls back to buyer name when no number was captured). Only buyers with more than
          one order are shown.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Buyer</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Orders</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Total Value (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {topBuyers.map((b) => (
                <tr key={b.label + b.orderCount}>
                  <td className="px-3 py-2 font-medium text-slate-800">{b.label}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{b.orderCount}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">${b.totalUsd.toFixed(2)}</td>
                </tr>
              ))}
              {topBuyers.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                    No repeat buyers yet for this company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Internal Expenses (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Net Earn (After Overhead)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(plCompanyRows ?? []).map((r) => (
                <tr key={r.company_id}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{r.company_name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{Number(r.total_sale_value_inr ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700" title="Courier + Duty + Purchase − Note adjustments + history — hover the ▾ for the line-by-line split">
                    {Number(r.total_expenses_inr ?? 0).toFixed(2)}
                    <PlExpenseBreakdown row={r} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{Number(r.net_earn ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{(Number(r.profit_pct ?? 0) * 100).toFixed(2)}%</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{Number(r.total_internal_expenses_inr ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{Number(r.net_earn_after_overhead ?? 0).toFixed(2)}</td>
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
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Internal Expenses (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Net Earn (After Overhead)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(plMonthRows ?? []).length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No Sale &amp; Profit Ledger data yet — import via CSV Upload.</td></tr>
              )}
              {(plMonthRows ?? []).map((r) => (
                <tr key={r.month}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{r.month}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{Number(r.total_sale_value_inr ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700" title="Courier + Duty + Purchase − Note adjustments + history — hover the ▾ for the line-by-line split">
                    {Number(r.total_expenses_inr ?? 0).toFixed(2)}
                    <PlExpenseBreakdown row={r} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{Number(r.net_earn ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{(Number(r.profit_pct ?? 0) * 100).toFixed(2)}%</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{Number(r.total_internal_expenses_inr ?? 0).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{Number(r.net_earn_after_overhead ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
