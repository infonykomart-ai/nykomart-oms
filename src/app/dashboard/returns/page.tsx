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
//    refund entered against a cancelled/returned order (see
//    src/app/dashboard/orders/actions.ts's saveOrderRefundCore, used from
//    the order-hold-cancel-actions.tsx mini-form). Company-scoped via its
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
// 2026-08-22 — ported onto the Reports hub's pattern: searchParams filters
// + <ExportBar /> on each table.
//
// 2026-11-01d — user's report: "screenshot me Hindi likha hai, na filter
// samajh aa raha, na kuch samajh aa raha — theek se hona chahiye". Three
// real problems, all fixed here:
//
//  1. Copy was Hinglish and explained the WRONG thing. Every label/help
//     line on this page is now plain English and says exactly what the
//     number means and which date it uses.
//  2. The company filter was applied in JavaScript AFTER `.limit(300)`, so
//     it silently showed the 300 most recent rows of ALL companies and
//     then filtered — a company whose refunds are older than those 300
//     looked empty. Company (and now store / order no.) filters are applied
//     in the query itself, against the joined order (`orders!inner`).
//  3. There was no way to filter by store or to find one order's refund;
//     both filters exist now and apply to both refund tables. The
//     per-store table keeps the From/To + Company + Store filters, and a
//     summary card gives the all-stores totals for the range.
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const storeId = typeof sp.store === "string" && sp.store ? sp.store : "";
  const orderNo = typeof sp.q === "string" ? sp.q.trim() : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  const scopedCompanyIds = companyId ? [companyId] : employee.companyIds;

  const [{ data: companies }, { data: stores }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("stores").select("id, name, company_id").in("company_id", scopedCompanyIds).order("name"),
  ]);

  // Per-store Return % / Cancel % — counted from the order STATUS, so it
  // answers "kaun sa store zyada cancel/return kar raha hai" without
  // depending on whether a refund row was ever entered. Same From/To + Store
  // filter as the tables; the date used here is order_date (a refund row's
  // own date is a different thing and is labelled on each table).
  let storeStatusQuery = supabase
    .from("orders")
    .select("id, store_id, status, order_date")
    .in("company_id", scopedCompanyIds)
    .limit(20000);
  if (fromDate) storeStatusQuery = storeStatusQuery.gte("order_date", fromDate);
  if (toDate) storeStatusQuery = storeStatusQuery.lte("order_date", toDate);
  if (storeId) storeStatusQuery = storeStatusQuery.eq("store_id", storeId);
  const { data: storeStatusOrders } = await storeStatusQuery;

  // `orders!inner` + filtering on the joined columns is what makes the
  // company/store/order-no filters real: without `!inner` PostgREST left-
  // joins and only the page's JS filtered, i.e. the filter changed what you
  // SAW but not what was fetched (and `.limit(300)` bit first).
  let orderRefundsQuery = supabase
    .from("order_refunds")
    .select(
      "id, order_id, refund_amount, refund_currency, refund_date, reason, credit_note_id, entry_by_employee_id, created_at, refund_basis_percent, order_value_refund_amount, shipping_refund_amount, duty_refund_amount, orders!inner(ref_no, company_id, store_id, buyer_name_address, status)"
    )
    .in("orders.company_id", scopedCompanyIds)
    .order("refund_date", { ascending: false })
    .limit(300);
  if (fromDate) orderRefundsQuery = orderRefundsQuery.gte("refund_date", fromDate);
  if (toDate) orderRefundsQuery = orderRefundsQuery.lte("refund_date", toDate);
  if (storeId) orderRefundsQuery = orderRefundsQuery.eq("orders.store_id", storeId);
  if (orderNo) orderRefundsQuery = orderRefundsQuery.ilike("orders.ref_no", `%${orderNo}%`);
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
    if (orderNo) historicalRefundsQuery = historicalRefundsQuery.ilike("marketplace_order_no", `%${orderNo}%`);
  }
  const { data: historicalRefundsRaw } = historicalRefundsQuery
    ? await historicalRefundsQuery
    : { data: [] as never[] };

  const orderRefunds = (orderRefundsRaw ?? []) as unknown as {
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
  const totalOrderRefundsNonUsd = orderRefunds
    .filter((r) => r.refund_currency !== "USD")
    .reduce((sum, r) => sum + Number(r.refund_amount), 0);
  const totalHistoricalRefundsUsd = historicalRefunds.reduce((sum, r) => sum + Number(r.refund_amt_usd ?? 0), 0);
  const totalDutyRefunded = orderRefunds.reduce((sum, r) => sum + Number(r.duty_refund_amount ?? 0), 0);

  // "Dispatch & Refund" = invoice was already raised (so a Credit Note
  // exists against it); "No Dispatch & Refund" = cancelled before dispatch,
  // no invoice/Credit Note. saveOrderRefundCore implements exactly this, so
  // credit_note_id presence IS the category — no extra column needed.
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
    .map(([id, t]) => ({
      id,
      store_name: storeName.get(id) ?? "—",
      total_orders: t.total,
      cancelled_count: t.cancelled,
      cancelled_pct: t.total > 0 ? (t.cancelled / t.total) * 100 : 0,
      returned_count: t.returned,
      returned_pct: t.total > 0 ? (t.returned / t.total) * 100 : 0,
    }))
    .sort((a, b) => b.total_orders - a.total_orders);

  const rangeOrders = storeRateRows.reduce((n, r) => n + r.total_orders, 0);
  const rangeCancelled = storeRateRows.reduce((n, r) => n + r.cancelled_count, 0);
  const rangeReturned = storeRateRows.reduce((n, r) => n + r.returned_count, 0);

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
  const selectedCompany = companyId ? companies?.find((c) => c.id === companyId)?.name ?? "selected company" : "all companies";
  const selectedStore = storeId ? storeName.get(storeId) ?? "selected store" : "all stores";
  const dateLabel = fromDate || toDate ? `${fromDate || "start"} to ${toDate || "today"}` : "all dates";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Returns &amp; Refunds</h1>
          <p className="mt-1 text-sm text-slate-500">
            One page for every refund: what was refunded, which store is cancelling or returning the most, and the
            old marketplace refund sheets. Filters apply to the tables below.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">
            From
          </label>
          <input id="from" name="from" type="date" defaultValue={fromDate} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">
            To
          </label>
          <input id="to" name="to" type="date" defaultValue={toDate} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">
            Company
          </label>
          <select id="company" name="company" defaultValue={companyId} className={inputClass}>
            <option value="">All companies</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="store">
            Store
          </label>
          <select id="store" name="store" defaultValue={storeId} className={inputClass}>
            <option value="">All stores</option>
            {(stores ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">
            Order no.
          </label>
          <input
            id="q"
            name="q"
            type="text"
            defaultValue={orderNo}
            placeholder="Partial match, e.g. PO-A451"
            className={`${inputClass} w-52`}
          />
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Apply filters
        </button>
        <a href="/dashboard/returns" className="text-xs text-slate-500 underline">
          Clear
        </a>
      </form>

      <p className="text-xs text-slate-500">
        Showing <strong>{selectedCompany}</strong> · <strong>{selectedStore}</strong> · <strong>{dateLabel}</strong>. The
        OMS refund table and the marketplace sheet table filter by <strong>refund date</strong>; the store rate table
        filters by <strong>order date</strong>.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Refunds recorded in OMS</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{orderRefunds.length}</div>
          <div className="mt-1 text-xs text-slate-500">
            ${totalOrderRefundsUsd.toFixed(2)} in USD
            {totalOrderRefundsNonUsd > 0 ? ` · ${totalOrderRefundsNonUsd.toFixed(2)} in other currencies (as entered)` : ""}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Dispatch &amp; Refund: <strong>{dispatchRefundCount}</strong> (invoice raised, cancelled after) · No Dispatch
            &amp; Refund: <strong>{noDispatchRefundCount}</strong> (cancelled before dispatch)
          </div>
          {totalDutyRefunded > 0 && (
            <div className="mt-1 text-xs text-slate-500">Duty / tax refunded (as entered): {totalDutyRefunded.toFixed(2)}</div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Marketplace refund sheets (historical)</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{historicalRefunds.length}</div>
          <div className="mt-1 text-xs text-slate-500">${totalHistoricalRefundsUsd.toFixed(2)} total — imported sheets, USD only</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Orders in range (all stores shown)</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{rangeOrders}</div>
          <div className="mt-1 text-xs text-slate-500">
            Cancelled {rangeCancelled} ({rangeOrders ? ((rangeCancelled / rangeOrders) * 100).toFixed(1) : "0.0"}%) ·
            Returned {rangeReturned} ({rangeOrders ? ((rangeReturned / rangeOrders) * 100).toFixed(1) : "0.0"}%)
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-medium text-amber-700">Refunds as % of orders in range</div>
          <div className="mt-1 text-2xl font-bold text-amber-900">
            {rangeOrders ? (((orderRefunds.length + historicalRefunds.length) / rangeOrders) * 100).toFixed(1) : "0.0"}%
          </div>
          <div className="mt-1 text-xs text-amber-700">
            {orderRefunds.length + historicalRefunds.length} refund rows against {rangeOrders} orders
          </div>
        </div>
      </div>

      <StoreRateReportTable rows={storeRateRows} />
      <OrderRefundsReportTable rows={orderRefundRows} />
      <HistoricalRefundsReportTable rows={historicalRefundRows} />
    </div>
  );
}
