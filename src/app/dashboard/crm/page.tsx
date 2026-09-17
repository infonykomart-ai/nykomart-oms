import { Fragment } from "react";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { FY_START_MONTH, fyDateWindow } from "@/lib/fy-date";

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
  portal_expense_effective_inr?: number | null;
  bank_inflow_inr?: number | null;
  total_sale_value_inr?: number | null;
  total_expenses_inr?: number | null;
  net_earn?: number | null;
  portal_expenses_25pct?: number | null;
};

const inr2 = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 2026-09-17 — P&L by Month FY selector helpers. Same April-start FY math
// as fy_label()/src/lib/fy-date.ts — kept local because the page only
// needs start-year bucketing + the '26-27' label shape.
const fyStartYearOf = (dateStr: string) => {
  const [y, m] = dateStr.split("-").map(Number);
  return m < FY_START_MONTH ? y - 1 : y;
};
const fyLabelOf = (startYear: number) => `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;

// 2026-09-17 (evening) — the user's layout ask: "arrow ke sath hi usi entry
// ke niche dikh jaye" + per-company/month expense split + money colors +
// bank inflow vs order value difference. This renders an INLINE expansion
// row under the clicked entry (no floating popover — that floated mid-
// screen, the screenshot bug). Color language (same on every table):
//   expense lines  rose-600  |  credits/negative  emerald-600
//   profit         emerald-700 |  money-in (bank)  sky-700
// Net-profit chain is shown line by line so "Sale − Expenses − Portal = Net"
// is auditable without doing math in the head.
function PlExpenseBreakdown({ row }: { row: PlRow }) {
  if (row.expense_courier_inr === undefined) return null;
  const sale = Number(row.total_sale_value_inr ?? 0);
  const exp = Number(row.total_expenses_inr ?? 0);
  const est25 = Number(row.portal_expenses_25pct ?? sale * 0.25);
  const fees = Number(row.portal_fees_matched_inr ?? 0);
  // 2026-09-17 (late): REAL-IF-KNOWN — matched fees when the scope has
  // any, else the 25% estimate (same CASE as the SQL view).
  const portalEff = fees > 0 ? fees : est25;
  const net = Number(row.net_earn ?? sale - exp - portalEff);
  const bank = Number(row.bank_inflow_inr ?? 0);
  const inflowDiff = bank - sale;
  const portalMode = fees > 0 ? "real fees" : "25% estimate";
  const lines: Array<[string, number | null | undefined]> = [
    ["Courier, net of credit notes", row.expense_courier_inr],
    ["Duty, net of credit notes", row.expense_duty_inr],
    ["Purchase bills (GST-incl.)", row.expense_purchase_inr],
    ["Debit/Credit Note adjustments", row.expense_purchase_adjustments_inr],
    ["Washing chalans (auto)", row.expense_washing_inr],
    ["Old CSV history (pre-orders)", row.expense_historical_inr],
  ];
  return (
    <div className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-2 text-[11px]">
      <div className="grid gap-x-8 gap-y-0.5 sm:grid-cols-2">
        <div className="font-semibold pl-out text-rose-600">Expense split (kam kya raha)</div>
        <div className="font-semibold text-[var(--oms-text-muted)]">Net profit kaise bana</div>
        {lines.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">{label}</span>
            <span className={`font-medium ${Number(val ?? 0) < 0 ? "pl-profit text-emerald-600" : "pl-out text-rose-600"}`}>
              {Number(val ?? 0) < 0 ? "+" : "−"} {inr2(Math.abs(Number(val ?? 0)))}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4">
          <span className="text-[var(--oms-text-muted)]">Portal fees matched (real)</span>
          <span className="font-medium text-sky-700">{inr2(fees)}</span>
        </div>
        <div className="sm:col-span-2 mt-1 border-t border-[var(--oms-surface-border)] pt-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">Sale Value (INR)</span>
            <span className="pl-in font-semibold text-sky-700">{inr2(sale)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">− Total Expenses</span>
            <span className="font-semibold pl-out text-rose-600">{inr2(exp)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">
              − Portal ({portalMode}{fees > 0 ? `: ${inr2(fees)} matched, estimate was ${inr2(est25)}` : `: ${inr2(est25)}`})
            </span>
            <span className="font-semibold pl-out text-rose-600">{inr2(portalEff)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-[var(--oms-surface-border)] pt-1">
            <span className="font-semibold text-[var(--oms-text)]">= Net Earn</span>
            <span className={`font-bold ${net >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{inr2(net)}</span>
          </div>
        </div>
        <div className="sm:col-span-2 mt-1 border-t border-[var(--oms-surface-border)] pt-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">Bank me aaya (verified statement credits)</span>
            <span className="pl-in font-semibold text-sky-700">{inr2(bank)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">Order value vs bank ka difference {bank === 0 ? "(statement upload/link hone par dikhega)" : ""}</span>
            <span className={`font-semibold ${inflowDiff >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>
              {inflowDiff >= 0 ? "+" : "−"} {inr2(Math.abs(inflowDiff))}
            </span>
          </div>
        </div>
      </div>
    </div>
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
  searchParams: Promise<{ q?: string; fy?: string }>;
}) {
  const employee = await requireCapability("crm_dashboard");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const { q, fy: fyParam } = await searchParams;
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
    finSupabase.from("pl_dashboard_by_company_view").select("company_id, company_name, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead, portal_expenses_25pct, expense_courier_inr, expense_duty_inr, expense_purchase_inr, expense_purchase_adjustments_inr, expense_washing_inr, expense_historical_inr, portal_fees_matched_inr, bank_inflow_inr").in("company_id", employee.companyIds),
    finSupabase.from("pl_dashboard_by_month_view").select("month, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead, portal_expenses_25pct, expense_courier_inr, expense_duty_inr, expense_purchase_inr, expense_purchase_adjustments_inr, expense_washing_inr, expense_historical_inr, portal_fees_matched_inr, bank_inflow_inr"),
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
      finSupabase.from("pl_dashboard_by_month_view").select(baseMonthCols),
    ]);
    // Cast is honest: base rows genuinely lack the breakdown columns at
    // runtime — PlExpenseBreakdown's `undefined` check renders nothing for
    // them, and every other cell reads with ?? 0.
    if (!retryCompany.error) plCompanyRows = retryCompany.data as typeof plByCompany;
    if (!retryMonth.error) plMonthRows = retryMonth.data as typeof plByMonth;
    console.error("P&L breakdown columns unavailable — rendered base P&L instead. Run db/2026-09-17-pl-expense-breakdown.sql. Errors:", plByCompanyErr?.message, plByMonthErr?.message);
  }

  // 2026-09-17 — P&L by Month FY selector ("kahi par fy year select karne
  // ka option to nahi diya"). Options derive from the SAME fyDateWindow()
  // the entry validators use (current FY − 10 … current FY + 1) — nothing
  // hardcoded, slides forward every April by itself. ?fy=<startYear>
  // filters the month table to that FY; empty/all keeps the old
  // most-recent-24 view. The view already orders month DESC and holds no
  // data, so fetching all months (limit removed above) and slicing here
  // is the whole implementation — zero SQL/view changes.
  const fyMinStartYear = Number(fyDateWindow().min.slice(0, 4));
  const fyMaxStartYear = fyStartYearOf(fyDateWindow().max);
  const fyOptions = Array.from(
    { length: fyMaxStartYear - fyMinStartYear + 1 },
    (_, i) => fyMaxStartYear - i,
  );
  const fySelectedRaw = Number.parseInt(fyParam ?? "", 10);
  const fySelected =
    Number.isFinite(fySelectedRaw) && fySelectedRaw >= fyMinStartYear && fySelectedRaw <= fyMaxStartYear
      ? fySelectedRaw
      : null;
  const allMonthRows = plMonthRows ?? [];
  const plMonthRowsFiltered = fySelected
    ? allMonthRows.filter((r) => r.month && fyStartYearOf(r.month) === fySelected)
    : allMonthRows.slice(0, 24);

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
        <h1 className="text-2xl font-semibold text-[var(--oms-text)]">📊 CRM Overview</h1>
        <p className="mt-1 text-sm text-[var(--oms-text-muted)]">Company-wide order/attendance snapshot, data-quality alerts, and the P&amp;L Dashboard.</p>
      </div>

      <form method="GET" className="oms-card rounded-xl border p-4">
        <label className="mb-1 block text-xs font-medium text-[var(--oms-text-muted)]">Quick Find — PO/RF/RG No., buyer name, contact no., or marketplace order no.</label>
        <div className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="e.g. PO-0001 or a buyer name"
            className="w-full max-w-md rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-3 py-2 text-sm text-[var(--oms-text)] outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">Search</button>
        </div>
        {query && (
          <div className="mt-3 space-y-1 text-sm">
            {quickFindRows.length === 0 && <p className="text-[var(--oms-text-muted)]">No matches.</p>}
            {quickFindRows.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--oms-surface-border)] py-1.5 last:border-0">
                <span className="font-medium text-[var(--oms-text)]">{o.ref_no}</span>
                <span className="text-[var(--oms-text-muted)]">{o.buyer_name_address ?? "—"}</span>
                <span className="text-[var(--oms-text-muted)]">{o.contact_no ?? "—"}</span>
                <span className="rounded-full bg-[var(--oms-canvas)] px-2 py-0.5 text-xs text-[var(--oms-text-muted)]">{o.status}</span>
              </div>
            ))}
          </div>
        )}
      </form>

      <div className="oms-card rounded-xl border p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Top Buyers — Repeat Customers (current company)</h2>
        <p className="mb-3 text-xs text-[var(--oms-text-muted)]">
          Grouped by contact number (falls back to buyer name when no number was captured). Only buyers with more than
          one order are shown.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--oms-surface-border)] text-sm">
            <thead className="bg-[var(--oms-canvas)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--oms-text-muted)]">Buyer</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Orders</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Total Value (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--oms-surface-border)]">
              {topBuyers.map((b) => (
                <tr key={b.label + b.orderCount}>
                  <td className="px-3 py-2 font-medium text-[var(--oms-text)]">{b.label}</td>
                  <td className="px-3 py-2 text-right text-[var(--oms-text)]">{b.orderCount}</td>
                  <td className="px-3 py-2 text-right font-semibold text-[var(--oms-text)]">${b.totalUsd.toFixed(2)}</td>
                </tr>
              ))}
              {topBuyers.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-[var(--oms-text-muted)]">
                    No repeat buyers yet for this company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="oms-card rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Orders by Status</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ORDER_STATUSES.map((s) => (
              <div key={s} className="rounded-lg bg-[var(--oms-canvas)] p-3 text-center">
                <div className="text-xl font-bold text-[var(--oms-text)]">{orderStatusCounts.get(s) ?? 0}</div>
                <div className="text-xs text-[var(--oms-text-muted)]">{s}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="oms-card rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Today&apos;s Attendance ({today})</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ATTENDANCE_STATUSES.map((s) => (
              <div key={s} className="rounded-lg bg-[var(--oms-canvas)] p-3 text-center">
                <div className="text-xl font-bold text-[var(--oms-text)]">{attendanceCounts.get(s) ?? 0}</div>
                <div className="text-xs text-[var(--oms-text-muted)]">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="oms-card rounded-xl border p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Data Quality Alerts ({(alerts ?? []).length} of up to 50)</h2>
        <div className="space-y-1 text-xs">
          {(alerts ?? []).length === 0 && <p className="text-[var(--oms-text-muted)]">No alerts. 🎉</p>}
          {(alerts ?? []).map((a, i) => (
            <div key={`${a.order_id}-${i}`} className="flex items-start gap-2 border-b border-[var(--oms-surface-border)] py-1.5 last:border-0">
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">{a.alert_type}</span>
              <span className="text-[var(--oms-text-muted)]">{a.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="oms-card rounded-xl border p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">P&amp;L by Company</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--oms-surface-border)] text-sm">
            <thead className="bg-[var(--oms-canvas)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--oms-text-muted)]">Company</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Sale Value (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Expenses (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Net Earn</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Profit %</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Internal Expenses (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Net Earn (After Overhead)</th>
                <th className="w-8 px-2 py-2"><span className="sr-only">Expand</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--oms-surface-border)]">
              {(plCompanyRows ?? []).map((r) => (
                <Fragment key={r.company_id}>
                  <tr className="pl-expand align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--oms-text)]">{r.company_name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right pl-in font-semibold text-sky-700">{Number(r.total_sale_value_inr ?? 0).toFixed(2)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold pl-out text-rose-600" title="Courier + Duty + Purchase − Note adjustments + Washing + history — click ▾ for the line-by-line split">
                      {Number(r.total_expenses_inr ?? 0).toFixed(2)}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${Number(r.net_earn ?? 0) >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{Number(r.net_earn ?? 0).toFixed(2)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">{(Number(r.profit_pct ?? 0) * 100).toFixed(2)}%</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{Number(r.total_internal_expenses_inr ?? 0).toFixed(2)}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${Number(r.net_earn_after_overhead ?? 0) >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{Number(r.net_earn_after_overhead ?? 0).toFixed(2)}</td>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" className="pl-toggle" aria-label={`Expand ${r.company_name ?? "company"} P&L breakdown`} />
                    </td>
                  </tr>
                  <tr className="pl-detail">
                    <td colSpan={8} className="bg-[var(--oms-canvas)] px-6 py-2">
                      <PlExpenseBreakdown row={r} />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="oms-card rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--oms-text)]">
            P&amp;L by Month{fySelected ? ` — FY ${fyLabelOf(fySelected)}` : " (most recent 24)"}
          </h2>
          <form method="GET" className="flex items-center gap-2">
            <label htmlFor="pl-fy" className="text-xs text-[var(--oms-text-muted)]">Financial Year</label>
            <select
              id="pl-fy"
              name="fy"
              defaultValue={fySelected ? String(fySelected) : "all"}
              className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-2 py-1 text-xs text-[var(--oms-text)] outline-none focus:border-amber-500"
            >
              <option value="all">All FYs</option>
              {fyOptions.map((y) => (
                <option key={y} value={String(y)}>FY {fyLabelOf(y)}</option>
              ))}
            </select>
            <button type="submit" className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600">Apply</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--oms-surface-border)] text-sm">
            <thead className="bg-[var(--oms-canvas)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--oms-text-muted)]">Month</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Sale Value (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Expenses (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Net Earn</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Profit %</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Internal Expenses (INR)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Net Earn (After Overhead)</th>
                <th className="w-8 px-2 py-2"><span className="sr-only">Expand</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--oms-surface-border)]">
              {plMonthRowsFiltered.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-[var(--oms-text-muted)]">No Sale &amp; Profit Ledger data yet — import via CSV Upload.</td></tr>
              )}
              {plMonthRowsFiltered.map((r) => (
                <Fragment key={r.month ?? ""}>
                  <tr className="pl-expand align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--oms-text)]">{r.month}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right pl-in font-semibold text-sky-700">{Number(r.total_sale_value_inr ?? 0).toFixed(2)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold pl-out text-rose-600" title="Courier + Duty + Purchase − Note adjustments + Washing + history — click ▾ for the line-by-line split">
                      {Number(r.total_expenses_inr ?? 0).toFixed(2)}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${Number(r.net_earn ?? 0) >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{Number(r.net_earn ?? 0).toFixed(2)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">{(Number(r.profit_pct ?? 0) * 100).toFixed(2)}%</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{Number(r.total_internal_expenses_inr ?? 0).toFixed(2)}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${Number(r.net_earn_after_overhead ?? 0) >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{Number(r.net_earn_after_overhead ?? 0).toFixed(2)}</td>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" className="pl-toggle" aria-label={`Expand ${r.month ?? "month"} P&L breakdown`} />
                    </td>
                  </tr>
                  <tr className="pl-detail">
                    <td colSpan={8} className="bg-[var(--oms-canvas)] px-6 py-2">
                      <PlExpenseBreakdown row={r} />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
