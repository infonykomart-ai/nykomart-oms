import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { OrderRefundsReportTable, HistoricalRefundsReportTable, StoreRateReportTable } from "./returns-report-tables";

// 2026-08-17 — dedicated Returns/Refunds report. Gap identified in a
// system-wide OMS-features audit: "Refunds/order_refunds tables hain
// (returns track hote hain), lekin ek dedicated Returns/Exchange dashboard
// page nahi hai (abhi order edit ke andar hi hota hai)". The data already
// existed in two places — this just surfaces it:
//
//  - `order_refunds`: the LIVE, actively-written table — one row per
//    refund entered against a cancelled order (see
//    src/app/dashboard/orders/actions.ts's saveOrderRefund, used from the
//    order-hold-cancel-actions.tsx mini-form). Company-scoped via its
//    order's company_id.
//  - `refunds`: HISTORICAL only — the old FBA Refund / Dispatch & Refund /
//    No Dispatch & Refund sheets, imported once; nothing in the current
//    app code inserts into it (confirmed via grep — only
//    documents/actions.ts's deleteCreditNote reads it, to block deleting a
//    Credit Note a historical refund still points at). Company-scoped via
//    store_id -> stores.company_id (it has no company_id of its own).
//
// Both shown here, clearly labeled, rather than merged into one table —
// they have different shapes (order_refunds is currency-flexible per row;
// refunds is USD-only, per the old sheets) and merging would lose that
// distinction silently.
//
// Reuses the `reports` capability (no new capability/role-assignment SQL
// needed) since this is conceptually part of the Reports suite — linked
// from there.
//
// 2026-08-22 — ported onto the Reports hub's established pattern (see
// reports/orders-report-table.tsx's header comment): searchParams filters
// (date range + company, same shape as the Orders report) + <ExportBar />
// (now with the generic column picker) on each table below, instead of
// the previous plain unfiltered/unexportable HTML tables. The DATA shown
// is unchanged — same two sources, same company scoping — this only adds
// the filter/export UI other reports already have.
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  const scopedCompanyIds = companyId ? [companyId] : employee.companyIds;

  const [{ data: companies }, { data: stores }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("stores").select("id, name, company_id").in("company_id", scopedCompanyIds),
  ]);

  // 2026-08-25 — "kis store par return ka % kitna chal raha, cancel ka
  // kitna chal raha" — per-store Return-rate / Cancel-rate. Uses the SAME
  // from/to filter as the refund tables below, applied to order_date (the
  // refund tables filter by refund_date — a different date field, so a
  // store can legitimately show up in one table's range and not the
  // other's; both are documented in the table's own header). Selects only
  // id/store_id/status/order_date — no heavy columns — since this only
  // needs per-store counts, aggregated in JS below. Capped at 20,000 orders
  // (generous for this app's real volume) rather than left unbounded.
  let storeStatusQuery = supabase
    .from("orders")
    .select("id, store_id, status, order_date")
    .in("company_id", scopedCompanyIds)
    .limit(20000);
  if (fromDate) storeStatusQuery = storeStatusQuery.gte("order_date", fromDate);
  if (toDate) storeStatusQuery = storeStatusQuery.lte("order_date", toDate);
  const { data: storeStatusOrders } = await storeStatusQuery;

  let orderRefundsQuery = supabase
    .from("order_refunds")
    .select(
      "id, order_id, refund_amount, refund_currency, refund_date, reason, credit_note_id, entry_by_employee_id, created_at, refund_basis_percent, order_value_refund_amount, shipping_refund_amount, duty_refund_amount, orders(ref_no, company_id, buyer_name_address, status)"
    )
    .order("refund_date", { ascending: false })
    .limit(300);
  if (fromDate) orderRefundsQuery = orderRefundsQuery.gte("refund_date", fromDate);
  if (toDate) orderRefundsQuery = orderRefundsQuery.lte("refund_date", toDate);
  const { data: orderRefundsRaw } = await orderRefundsQuery;

  const storeIds = (stores ?? []).map((s) => s.id);
  const storeName = new Map((stores ?? []).map((s) => [s.id, s.name]));

  let historicalRefundsQuery = storeIds.length
    ? supabase
        .from("refunds")
        .select(
          "id, source, marketplace_order_no, item_id, buyer_name, store_id, invoice_no, status, order_amt_usd, refund_amt_usd, refund_amt_pct, refund_type, refund_date, reason, remark"
        )
        .in("store_id", storeIds)
        .order("refund_date", { ascending: false, nullsFirst: false })
        .limit(300)
    : null;
  if (historicalRefundsQuery) {
    if (fromDate) historicalRefundsQuery = historicalRefundsQuery.gte("refund_date", fromDate);
    if (toDate) historicalRefundsQuery = historicalRefundsQuery.lte("refund_date", toDate);
  }
  const { data: historicalRefundsRaw } = historicalRefundsQuery
    ? await historicalRefundsQuery
    : { data: [] as never[] };

  // order_refunds has no company_id of its own — scope via the joined
  // order's company_id, same pattern as every other "no direct column"
  // scoping in this codebase (e.g. purchase_bills before its own
  // company_id was added). `scopedCompanyIds` is either the one selected
  // company or every company this login can access.
  const orderRefunds = (orderRefundsRaw ?? []).filter(
    (r) => r.orders && scopedCompanyIds.includes((r.orders as { company_id: string }).company_id)
  ) as {
    id: string;
    order_id: string;
    refund_amount: number;
    refund_currency: string;
    refund_date: string;
    reason: string | null;
    credit_note_id: string | null;
    refund_basis_percent: number | null;
    order_value_refund_amount: number | null;
    shipping_refund_amount: number | null;
    duty_refund_amount: number | null;
    orders: { ref_no: string; company_id: string; buyer_name_address: string | null; status: string } | null;
  }[];

  const historicalRefunds = historicalRefundsRaw ?? [];

  const totalOrderRefundsUsd = orderRefunds
    .filter((r) => r.refund_currency === "USD")
    .reduce((sum, r) => sum + Number(r.refund_amount), 0);
  const totalHistoricalRefundsUsd = historicalRefunds.reduce((sum, r) => sum + Number(r.refund_amt_usd ?? 0), 0);

  // 2026-08-18 — user's own 2-category refund classification, confirmed in
  // chat: "Dispatch & Refund" = invoice already generated + tracking
  // arrived, order later cancelled (so a Credit Note exists against it);
  // "No Dispatch & Refund" = buyer raised a cancel request before dispatch
  // (no invoice, no Credit Note). saveOrderRefund (orders/actions.ts)
  // already implements exactly this split — it only creates a Credit Note
  // when order.invoice_id is set — so credit_note_id presence/absence on
  // order_refunds IS the category, no new data or business logic needed.
  const dispatchRefundCount = orderRefunds.filter((r) => r.credit_note_id).length;
  const noDispatchRefundCount = orderRefunds.length - dispatchRefundCount;

  const orderRefundRows = orderRefunds.map((r) => ({
    id: r.id,
    ref_no: r.orders?.ref_no ?? "—",
    buyer_name: r.orders?.buyer_name_address ?? null,
    order_status: r.orders?.status ?? null,
    refund_amount: Number(r.refund_amount),
    refund_currency: r.refund_currency,
    refund_date: r.refund_date,
    reason: r.reason,
    category: r.credit_note_id ? "Dispatch & Refund" : "No Dispatch & Refund",
    refund_basis_percent: r.refund_basis_percent != null ? Number(r.refund_basis_percent) : null,
    order_value_refund_amount: r.order_value_refund_amount != null ? Number(r.order_value_refund_amount) : null,
    shipping_refund_amount: r.shipping_refund_amount != null ? Number(r.shipping_refund_amount) : null,
    duty_refund_amount: r.duty_refund_amount != null ? Number(r.duty_refund_amount) : null,
  }));

  const historicalRefundRows = historicalRefunds.map((r) => ({
    id: r.id,
    source: r.source,
    store_name: r.store_id ? storeName.get(r.store_id) ?? "—" : "—",
    marketplace_order_no: r.marketplace_order_no,
    buyer_name: r.buyer_name,
    order_amt_usd: r.order_amt_usd != null ? Number(r.order_amt_usd) : null,
    refund_amt_usd: r.refund_amt_usd != null ? Number(r.refund_amt_usd) : null,
    refund_amt_pct: r.refund_amt_pct != null ? Number(r.refund_amt_pct) : null,
    refund_type: r.refund_type,
    refund_date: r.refund_date,
  }));

  // 2026-08-25 — per-store Return %/Cancel % (see storeStatusQuery above).
  // Orders with no store_id (shouldn't happen — store_id is NOT NULL on
  // orders — kept defensively) are skipped rather than lumped into an
  // "Unknown" row.
  const storeTotals = new Map<string, { total: number; cancelled: number; returned: number }>();
  for (const o of storeStatusOrders ?? []) {
    if (!o.store_id) continue;
    const entry = storeTotals.get(o.store_id) ?? { total: 0, cancelled: 0, returned: 0 };
    entry.total += 1;
    if (o.status === "Cancelled") entry.cancelled += 1;
    if (o.status === "Returned") entry.returned += 1;
    storeTotals.set(o.store_id, entry);
  }
  const storeRateRows = Array.from(storeTotals.entries())
    .map(([storeId, t]) => ({
      id: storeId,
      store_name: storeName.get(storeId) ?? "—",
      total_orders: t.total,
      cancelled_count: t.cancelled,
      cancelled_pct: t.total > 0 ? (t.cancelled / t.total) * 100 : 0,
      returned_count: t.returned,
      returned_pct: t.total > 0 ? (t.returned / t.total) * 100 : 0,
    }))
    .sort((a, b) => b.total_orders - a.total_orders);

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">↩️ Returns / Refunds</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live order refunds (cancelled orders) + historical marketplace refunds (FBA / Dispatch / No-Dispatch), for
            your accessible companies — apply filters, then download/send below.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={companyId} className={inputClass}>
            <option value="">All</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/returns" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Live Order Refunds</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{orderRefunds.length}</div>
          <div className="text-xs text-slate-400">${totalOrderRefundsUsd.toFixed(2)} (USD rows only — shown below with currency)</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-medium text-amber-700">🚚 Dispatch &amp; Refund</div>
          <div className="mt-1 text-2xl font-bold text-amber-900">{dispatchRefundCount}</div>
          <div className="text-xs text-amber-600">invoiced + dispatched, cancelled after</div>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <div className="text-xs font-medium text-sky-700">🛑 No Dispatch &amp; Refund</div>
          <div className="mt-1 text-2xl font-bold text-sky-900">{noDispatchRefundCount}</div>
          <div className="text-xs text-sky-600">cancelled before invoice/dispatch</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Historical Marketplace Refunds</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{historicalRefunds.length}</div>
          <div className="text-xs text-slate-400">${totalHistoricalRefundsUsd.toFixed(2)} total</div>
        </div>
      </div>

      <StoreRateReportTable rows={storeRateRows} />
      <OrderRefundsReportTable rows={orderRefundRows} />
      <HistoricalRefundsReportTable rows={historicalRefundRows} />
    </div>
  );
}
