import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { SaleProfitReportTable, type SaleProfitRow } from "./sale-profit-report-table";

// Sale & Profit report (2026-08-22) — one of the 3 new report pages
// requested after "Reports hub — remaining scope".
//
// Per-order revenue/expense model reuses the exact one built for
// pl_dashboard_by_company_view/pl_dashboard_by_month_view (db/schema.sql,
// 2026-08-20 order-value fix): Order Value (orders.order_value_inr, live
// orders only, Cancelled excluded — a cancelled order isn't a real sale)
// netted against that order's own Courier + Duty expense
// (order_courier_duty_expense_view, summed per order across every
// AWB/shipment) and the standard 25%-portal-expense assumption, same math
// as sale_profit_ledger's own generated columns.
//
// DELIBERATELY EXCLUDES purchase_bills costs, unlike the company-level P&L
// views. Those views pool ALL of a company's purchase_bills into one
// company-wide total (purchase_bills isn't reliably tied to one specific
// order — see that view's own comment) — there is no legitimate way to
// attribute a slice of a pooled company-wide cost to a single order row.
// Rather than silently guess or invent a per-order allocation, this report
// nets only what IS genuinely attributable per-order (Courier+Duty) and
// flags the omission plainly in the UI (see the amber note in
// sale-profit-report-table.tsx) so it's never mistaken for full profit.
//
// Historical sale_profit_ledger rows (order_id IS NULL — CSV-imported
// rows that predate the live `orders` table) are included too, using
// their own already-computed total_value_inr/total_expenses_inr/
// net_earn/profit_pct generated columns, same "still folded in for
// continuity" treatment the P&L views give them.
export default async function SaleProfitReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";

  const scopedCompanyIds = companyId ? [companyId] : employee.companyIds;

  const [{ data: companies }, { data: itemCategories }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("item_categories").select("id, name"),
  ]);
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const categoryName = new Map((itemCategories ?? []).map((c) => [c.id, c.name]));

  let orderQuery = supabase
    .from("orders")
    .select("id, ref_no, order_date, company_id, status, buyer_name_address, item_category_id, qty, order_value_inr")
    .in("company_id", scopedCompanyIds)
    .neq("status", "Cancelled")
    .order("order_date", { ascending: false })
    .limit(2000);
  if (fromDate) orderQuery = orderQuery.gte("order_date", fromDate);
  if (toDate) orderQuery = orderQuery.lte("order_date", toDate);

  const { data: orders } = await orderQuery;
  const orderIds = (orders ?? []).map((o) => o.id);

  // order_courier_duty_expense_view itself isn't in the generated Supabase
  // types (it's only ever been used inline inside the P&L views' own SQL
  // before now, never queried directly from app code), so this queries
  // its two underlying already-typed views directly and sums them the
  // same way that view does (SUM(gross_shipping_amt)/SUM(duty_gross_amt)
  // per order_id) rather than adding an untyped `.from()` call.
  // 2026-08-25 — refund_amount_inr per order, netted out of revenue below.
  // User confirmed ("ha kar do isko bhi") this report should treat a
  // refunded order the same way pl_dashboard_by_company_view /
  // pl_dashboard_by_month_view now do — see those views' schema.sql
  // comment for the full reasoning. Covers Returned orders AND the
  // goodwill/duty-only refund on an order that stays Dispatched/Delivered
  // (order-hold-cancel-actions.tsx) — any money actually refunded reduces
  // recognized revenue here, regardless of which button entered it.
  const [{ data: freightRows }, { data: dutyRows }, { data: refundRows }] = orderIds.length
    ? await Promise.all([
        finSupabase.from("freight_reconciliation_view").select("order_id, gross_shipping_amt").in("order_id", orderIds),
        finSupabase.from("duty_reconciliation_view").select("order_id, duty_gross_amt").in("order_id", orderIds),
        finSupabase.from("order_refunds").select("order_id, refund_amount_inr").in("order_id", orderIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const courierByOrder = new Map<string, number>();
  for (const r of freightRows ?? []) {
    if (!r.order_id) continue;
    courierByOrder.set(r.order_id, (courierByOrder.get(r.order_id) ?? 0) + Number(r.gross_shipping_amt ?? 0));
  }
  const dutyByOrder = new Map<string, number>();
  for (const r of dutyRows ?? []) {
    if (!r.order_id) continue;
    dutyByOrder.set(r.order_id, (dutyByOrder.get(r.order_id) ?? 0) + Number(r.duty_gross_amt ?? 0));
  }
  const refundByOrder = new Map<string, number>();
  for (const r of refundRows ?? []) {
    if (r.refund_amount_inr == null) continue;
    refundByOrder.set(r.order_id, (refundByOrder.get(r.order_id) ?? 0) + Number(r.refund_amount_inr));
  }

  const liveRows: SaleProfitRow[] = (orders ?? []).map((o) => {
    const courier = courierByOrder.get(o.id) ?? 0;
    const duty = dutyByOrder.get(o.id) ?? 0;
    const refunded = refundByOrder.get(o.id) ?? 0;
    const orderValue = Number(o.order_value_inr ?? 0) - refunded;
    const netTotalValue = orderValue - courier - duty;
    const portalExpenses = orderValue * 0.25;
    const netEarn = netTotalValue - portalExpenses;
    return {
      id: `order_${o.id}`,
      source: "Live Order",
      company_name: companyName.get(o.company_id) ?? "—",
      ref_no: o.ref_no,
      order_date: o.order_date,
      buyer_name: o.buyer_name_address,
      item_category: o.item_category_id ? categoryName.get(o.item_category_id) ?? "—" : "—",
      qty: o.qty,
      order_value_inr: orderValue,
      courier_expense_inr: courier,
      duty_expense_inr: duty,
      net_total_value: netTotalValue,
      portal_expenses_25pct: portalExpenses,
      net_earn: netEarn,
      profit_pct: orderValue !== 0 ? netEarn / orderValue : null,
    };
  });

  // Historical (pre-`orders`-table) rows — order_id IS NULL, per the P&L
  // views' own "still folded in for continuity" treatment.
  let histQuery = finSupabase
    .from("sale_profit_ledger")
    .select(
      "id, company_id, invoice_date, buyer_name, sizes, qty, total_value_inr, total_expenses_inr, net_total_value, portal_expenses_25pct, net_earn, profit_pct, po_rf_rg_no, item_category_id"
    )
    .is("order_id", null)
    .in("company_id", scopedCompanyIds)
    .order("invoice_date", { ascending: false })
    .limit(2000);
  if (fromDate) histQuery = histQuery.gte("invoice_date", fromDate);
  if (toDate) histQuery = histQuery.lte("invoice_date", toDate);

  const { data: histRows } = await histQuery;

  const historicalRows: SaleProfitRow[] = (histRows ?? []).map((h) => ({
    id: `hist_${h.id}`,
    source: "Historical",
    company_name: companyName.get(h.company_id) ?? "—",
    ref_no: h.po_rf_rg_no ?? "—",
    order_date: h.invoice_date,
    buyer_name: h.buyer_name,
    item_category: h.item_category_id ? categoryName.get(h.item_category_id) ?? "—" : "—",
    qty: h.qty,
    order_value_inr: Number(h.total_value_inr),
    courier_expense_inr: 0,
    duty_expense_inr: Number(h.total_expenses_inr),
    net_total_value: Number(h.net_total_value),
    portal_expenses_25pct: Number(h.portal_expenses_25pct),
    net_earn: Number(h.net_earn),
    profit_pct: h.profit_pct === null ? null : Number(h.profit_pct),
  }));

  const rows = [...liveRows, ...historicalRows].sort((a, b) => (b.order_date ?? "").localeCompare(a.order_date ?? ""));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">💹 Sale & Profit Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Per-order revenue vs. Courier+Duty expense — apply filters, then download or send.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <SaleProfitReportTable rows={rows} companies={companies ?? []} filters={{ companyId, from: fromDate, to: toDate }} />
    </div>
  );
}
