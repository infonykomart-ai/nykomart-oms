import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { sanitizeSearchTerm } from "@/lib/orders/find-order";
import { AutoRefresh } from "@/components/auto-refresh";
import { OrderRefundsReportTable, HistoricalRefundsReportTable, StoreRateReportTable } from "./returns-report-tables";
import { RefundOrderPicker, type RefundPickerOrder } from "./refund-order-picker";
import { ReturnRequestPanel, type MyReturnRow, type PendingReturnRow } from "./return-request-panel";
import { isMissingAgreementSchema } from "@/lib/agreements/migration";

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
  // 2026-11-03b — order-entry staff must be able to raise refunds and return
  // requests from here (owner: "refund/return section ... order ki entry karne
  // wale employees ko access dena hai"), so the page is no longer reports-only.
  // The three REPORTS stay behind `reports` (see hasReports below), while the
  // refund sheet needs order_entry and the approval queue needs return_approval.
  const employee = await requireAnyCapability("reports", "order_entry", "return_approval");
  const hasReports = employee.capabilities.includes("reports");
  const canApproveReturns = employee.capabilities.includes("return_approval");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const storeId = typeof sp.store === "string" && sp.store ? sp.store : "";
  const orderNo = typeof sp.q === "string" ? sp.q.trim() : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  const scopedCompanyIds = companyId ? [companyId] : employee.companyIds;
  // 2026-11-03 — "isi section se ... po ya order no select kar to us order ki
  // sari detail auto fill hokar a4 ka form open ho jaye": a refund can be
  // started from THIS page. `po` is its own parameter (not the report's `q`)
  // so opening a refund sheet never changes which rows the three reports
  // below show.
  const poSearch = (typeof sp.po === "string" ? sp.po : "").trim();

  const [{ data: companies }, { data: stores }, { data: currencies }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("stores").select("id, name, company_id").in("company_id", scopedCompanyIds).order("name"),
    supabase.from("currencies").select("code, name").order("code"),
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

  // 2026-11-02 — "RETURN REFUND PAGE BHI ISI PARKAR SE BANAO ... FILTER
  // KARNE KA OPTION HI NAHI HAI": the Search box now matches PO no,
  // marketplace order no AND buyer name (it used to match only ref_no), and it
  // runs against the WHOLE table — a match is never dropped because it fell
  // outside the rows this page happened to load.
  //
  // The query's direction is deliberately reversed from the old version:
  // refund ROWS live in `order_refunds`, but those three searchable fields
  // live on `orders`, and PostgREST's top-level `or=` rejects a nested column
  // (exactly why the Orders hub's `.or()` only ever names orders' own
  // columns). So this starts from `orders` — where `.or()` is proven to work
  // against this database — embeds `order_refunds!inner(...)` (`inner` = only
  // orders that actually have a refund come back) and flattens the refunds
  // out of that. Two wins: the search stays server-side across every field,
  // and the URL stays short — an id-list `.in()` fails with "URI too long"
  // once a search matches a few hundred orders (supabase/postgrest-js#423),
  // which would make a broad search fail exactly when it should succeed.
  //
  // Company / store / refund-date filters are applied in the query itself
  // (the `!inner` embed is what makes a refund-date filter decide which
  // parent orders come back). Window: 1000 orders that have refunds, newest
  // order first, refunds flattened and re-sorted by refund date below.
  const safeQ = orderNo ? sanitizeSearchTerm(orderNo) : "";

  let refundBundlesQuery = supabase
    .from("orders")
    .select(
      "id, ref_no, store_id, status, marketplace_order_no, buyer_name_address, order_date, order_value_original, order_value_inr, order_currency, order_refunds!inner(id, order_id, refund_amount, refund_currency, refund_date, reason, credit_note_id, refund_amount_inr, refund_amount_usd, refund_basis_percent, order_value_refund_amount, shipping_refund_amount, duty_refund_amount, refund_qty, payment_mode, reference_no, remarks, created_at, updated_at)"
    )
    .in("company_id", scopedCompanyIds)
    .order("order_date", { ascending: false })
    .limit(1000);
  if (fromDate) refundBundlesQuery = refundBundlesQuery.gte("order_refunds.refund_date", fromDate);
  if (toDate) refundBundlesQuery = refundBundlesQuery.lte("order_refunds.refund_date", toDate);
  if (storeId) refundBundlesQuery = refundBundlesQuery.eq("store_id", storeId);
  if (orderNo) {
    // A term of only special characters (",", "(" …) can never match anything
    // after sanitising — force an empty result instead of silently ignoring
    // what the user typed.
    refundBundlesQuery = safeQ
      ? refundBundlesQuery.or(
          `ref_no.ilike.%${safeQ}%,marketplace_order_no.ilike.%${safeQ}%,buyer_name_address.ilike.%${safeQ}%`
        )
      : refundBundlesQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  const { data: refundBundlesRaw } = await refundBundlesQuery;

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
        .limit(1000)
    : null;
  if (historicalRefundsQuery) {
    if (fromDate) historicalRefundsQuery = historicalRefundsQuery.gte("refund_date", fromDate);
    if (toDate) historicalRefundsQuery = historicalRefundsQuery.lte("refund_date", toDate);
    if (orderNo) {
      // Same sanitised term as the OMS sheet above — top-level `.or()` on the
      // `refunds` table's OWN columns (marketplace order no + buyer), which is
      // the form PostgREST accepts.
      historicalRefundsQuery = safeQ
        ? historicalRefundsQuery.or(`marketplace_order_no.ilike.%${safeQ}%,buyer_name.ilike.%${safeQ}%`)
        : historicalRefundsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  }
  const { data: historicalRefundsRaw } = historicalRefundsQuery
    ? await historicalRefundsQuery
    : { data: [] as never[] };

  type RefundBundle = {
    id: string;
    ref_no: string;
    store_id: string | null;
    status: string;
    marketplace_order_no: string | null;
    buyer_name_address: string | null;
    order_value_original: number | null;
    order_value_inr: number | null;
    order_currency: string | null;
    order_refunds: {
      id: string;
      order_id: string;
      refund_amount: number;
      refund_currency: string;
      refund_date: string;
      reason: string | null;
      credit_note_id: string | null;
      refund_amount_inr: number | null;
      refund_amount_usd: number | null;
      refund_basis_percent: number | null;
      order_value_refund_amount: number | null;
      shipping_refund_amount: number | null;
      duty_refund_amount: number | null;
      // 2026-11-05 — editable detail + history (refund edit/delete round).
      refund_qty: number | null;
      payment_mode: string | null;
      reference_no: string | null;
      remarks: string | null;
      created_at: string;
      updated_at: string;
    }[];
  };

  // Flatten: one row per REFUND (the sheet's shape), with its parent order
  // carried alongside as `order`. PostgREST can order the parent
  // (orders.order_date) but not an embedded child column, so the refund-date
  // sort that used to be `.order("refund_date", …)` happens here.
  const orderRefunds = ((refundBundlesRaw ?? []) as unknown as RefundBundle[])
    .flatMap((o) => (o.order_refunds ?? []).map((r) => ({ ...r, order: o })))
    .sort((a, b) => (a.refund_date < b.refund_date ? 1 : a.refund_date > b.refund_date ? -1 : 0));

  const historicalRefunds = historicalRefundsRaw ?? [];

  // 2026-11-02 — Value Check ke liye har order ke SARE refunds (₹ me), sirf
  // is date-window me dikhne wale nahi: agar From/To filter ne us order ka
  // pehla refund bahar kar diya, tab bhi total sahi rehna chahiye. Isliye
  // ek alag query, bina date/store/search filter ke, poori company par — aur
  // har refund row pehle se hi refund_amount_inr me apna ₹ conversion store
  // rakhti hai, is liye yahan koi nayi conversion nahi chalti (currency ka
  // farq nahi aata: dono taraf wahi stored ₹ numbers hain).
  //
  // Company ke hisaab se hi maanga jaata hai (wahi `orders!inner` +
  // .in("orders.company_id") pattern jo is page ka purana main query use
  // karta tha), order-id list is liye NAHI: 800+ order ki id-list ek 30KB
  // ka URL banati hai jo HTTP layer database ko dekhne se pehle hi 400 me
  // reject kar deti hai (supabase/postgrest-js#423).
  const refundsInrByOrder = new Map<string, number>();
  if (orderRefunds.length > 0) {
    const { data: allCompanyRefunds } = await supabase
      .from("order_refunds")
      .select("order_id, refund_amount_inr, orders!inner(company_id)")
      .in("orders.company_id", scopedCompanyIds)
      .limit(10000);
    for (const r of allCompanyRefunds ?? []) {
      if (r.refund_amount_inr == null) continue;
      refundsInrByOrder.set(r.order_id, (refundsInrByOrder.get(r.order_id) ?? 0) + Number(r.refund_amount_inr));
    }
  }

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

  const orderRefundRows = orderRefunds.map((r, i) => {
    // "Order value se jyada refund nahi hoga" — ka rule ka on-screen result.
    // Dono taraf ₹: refund side unke stored refund_amount_inr total se, order
    // side order_value_inr se. Value hi na ho to "N/A" (compare karna hi
    // possible nahi), warna total ≤ value → OK, warna OVER.
    const orderValueInr = r.order.order_value_inr != null ? Number(r.order.order_value_inr) : 0;
    const totalRefundedInr = refundsInrByOrder.get(r.order_id) ?? 0;
    const valueCheck = orderValueInr > 0 ? (totalRefundedInr <= orderValueInr + 1 ? "OK" : "OVER") : "N/A";

    return {
      id: r.id,
      sn: i + 1,
      order_id: r.order_id,
      po_no: r.order.ref_no,
      order_no: r.order.marketplace_order_no,
      buyer_name: r.order.buyer_name_address,
      store_name: r.order.store_id ? storeName.get(r.order.store_id) ?? "—" : "—",
      order_status: r.order.status,
      order_value: r.order.order_value_original != null ? Number(r.order.order_value_original) : null,
      order_currency: r.order.order_currency,
      refund_amount: Number(r.refund_amount),
      refund_currency: r.refund_currency,
      refund_amount_inr: r.refund_amount_inr != null ? Number(r.refund_amount_inr) : null,
      refund_amount_usd: r.refund_amount_usd != null ? Number(r.refund_amount_usd) : null,
      refund_date: r.refund_date,
      reason: r.reason,
      category: r.credit_note_id ? "Dispatch & Refund" : "No Dispatch & Refund",
      refund_basis_percent: r.refund_basis_percent != null ? Number(r.refund_basis_percent) : null,
      order_value_refund_amount: r.order_value_refund_amount != null ? Number(r.order_value_refund_amount) : null,
      shipping_refund_amount: r.shipping_refund_amount != null ? Number(r.shipping_refund_amount) : null,
      duty_refund_amount: r.duty_refund_amount != null ? Number(r.duty_refund_amount) : null,
      // 2026-11-05 — the Edit/Delete dialog and the history columns read
      // these straight off the row.
      order_ref_no: r.order.ref_no,
      refund_qty: r.refund_qty != null ? Number(r.refund_qty) : null,
      payment_mode: r.payment_mode,
      reference_no: r.reference_no,
      remarks: r.remarks,
      created_at: r.created_at,
      updated_at: r.updated_at,
      value_check: valueCheck,
    };
  });

  const overValueCount = orderRefundRows.filter((r) => r.value_check === "OVER").length;
  const naValueCount = orderRefundRows.filter((r) => r.value_check === "N/A").length;

  const historicalRefundRows = historicalRefunds.map((r, i) => ({
    id: r.id,
    sn: i + 1,
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

  // Same control styling as the Orders hub's filter bar (orders/page.tsx) so
  // the two pages read as one product.
  // Orders this login can raise a refund against, searched by PO/RF/RG no,
  // marketplace order no or buyer. Same `.or()`-on-orders shape as the
  // report search above (PostgREST rejects nested columns there).
  let pickerOrders: RefundPickerOrder[] = [];
  if (poSearch) {
    const safePo = sanitizeSearchTerm(poSearch);
    if (safePo) {
      const { data } = await supabase
        .from("orders")
        .select(
          "id, ref_no, status, order_currency, order_value_original, buyer_name_address, marketplace_order_no, order_date, store_id"
        )
        .in("company_id", scopedCompanyIds)
        .or(`ref_no.ilike.%${safePo}%,marketplace_order_no.ilike.%${safePo}%,buyer_name_address.ilike.%${safePo}%`)
        .order("order_date", { ascending: false })
        .limit(25);
      const nameByStore = new Map((stores ?? []).map((s) => [s.id, s.name]));
      pickerOrders = (data ?? []).map((o) => ({
        id: o.id,
        ref_no: o.ref_no,
        status: o.status,
        order_currency: o.order_currency,
        order_value_original: Number(o.order_value_original) || 0,
        buyer_name_address: o.buyer_name_address,
        marketplace_order_no: o.marketplace_order_no,
        order_date: o.order_date,
        store_name: o.store_id ? nameByStore.get(o.store_id) ?? null : null,
      }));
    }
  }

  // 2026-11-03b — return approval queue. return_requests is RLS-forced with no
  // policies, so it is read with the service-role client AFTER the capability
  // gate above; the same company scope as the refund sheet applies.
  const serviceDb = createServiceRoleClient();
  const returnMigrationPending = await serviceDb
    .from("return_requests")
    .select("id")
    .limit(1)
    .then(({ error }) => Boolean(error) && isMissingAgreementSchema(error));

  type PendingRow = {
    id: string;
    reason: string;
    note: string | null;
    refund_amount: number | null;
    refund_currency: string | null;
    refund_date: string | null;
    requested_at: string;
    requested_by: string | null;
    orders: { ref_no: string | null; buyer_name_address: string | null } | null;
  };
  type MyRow = {
    id: string;
    status: "Pending" | "Approved" | "Rejected";
    reason: string;
    refund_amount: number | null;
    requested_at: string;
    decided_at: string | null;
    decision_note: string | null;
    orders: { ref_no: string | null } | null;
  };

  let pendingReturnRows: PendingRow[] = [];
  let myReturnRows: MyRow[] = [];
  if (!returnMigrationPending) {
    const [pendingResult, mineResult] = await Promise.all([
      canApproveReturns
        ? serviceDb
            .from("return_requests")
            .select(
              "id, reason, note, refund_amount, refund_currency, refund_date, requested_at, requested_by, orders!inner(ref_no, buyer_name_address)"
            )
            .eq("status", "Pending")
            .in("company_id", employee.companyIds)
            .order("requested_at", { ascending: true })
            .limit(100)
        : Promise.resolve({ data: [] as PendingRow[] }),
      serviceDb
        .from("return_requests")
        .select("id, status, reason, refund_amount, requested_at, decided_at, decision_note, orders!inner(ref_no)")
        .eq("requested_by", employee.id)
        .order("requested_at", { ascending: false })
        .limit(20),
    ]);
    pendingReturnRows = (pendingResult.data ?? []) as unknown as PendingRow[];
    myReturnRows = (mineResult.data ?? []) as unknown as MyRow[];
  }

  const requesterIds = Array.from(new Set(pendingReturnRows.map((row) => row.requested_by).filter(Boolean))) as string[];
  const { data: requesterNames } = requesterIds.length
    ? await serviceDb.from("employees").select("id, name").in("id", requesterIds)
    : { data: [] as { id: string; name: string }[] };
  const requesterNameById = new Map((requesterNames ?? []).map((row) => [row.id, row.name]));

  // The embedded `orders` relation is typed loosely here (hand-written
  // Database type), so normalise defensively instead of trusting the shape.
  const pendingReturns: PendingReturnRow[] = pendingReturnRows.map((row) => {
    const order = (row.orders ?? {}) as { ref_no?: string | null; buyer_name_address?: string | null };
    return {
      id: row.id,
      refNo: order.ref_no ?? "—",
      buyer: order.buyer_name_address ?? null,
      reason: row.reason,
      note: row.note,
      refundAmount: row.refund_amount != null ? Number(row.refund_amount) : null,
      refundCurrency: row.refund_currency,
      refundDate: row.refund_date,
      requestedAt: row.requested_at,
      requestedByName: row.requested_by ? (requesterNameById.get(row.requested_by) ?? null) : null,
    };
  });

  const myReturns: MyReturnRow[] = myReturnRows.map((row) => {
    const order = (row.orders ?? {}) as { ref_no?: string | null };
    return {
      id: row.id,
      refNo: order.ref_no ?? "—",
      status: row.status,
      reason: row.reason,
      refundAmount: row.refund_amount != null ? Number(row.refund_amount) : null,
      requestedAt: row.requested_at,
      decidedAt: row.decided_at,
      decisionNote: row.decision_note,
    };
  });

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500";
  const selectedCompany = companyId ? companies?.find((c) => c.id === companyId)?.name ?? "selected company" : "all companies";
  const selectedStore = storeId ? storeName.get(storeId) ?? "selected store" : "all stores";
  const dateLabel = fromDate || toDate ? `${fromDate || "start"} to ${toDate || "today"}` : "all dates";

  return (
    <div className="space-y-6">
      {/* 2026-09-10 convention, same as the Orders hub: near-live data
          without a page reload — re-runs this page's server fetch every 15s
          while the tab is visible, and deliberately does nothing while
          focus is inside any input (so a half-typed column filter is never
          blown away). See src/components/auto-refresh.tsx. */}
      <AutoRefresh intervalMs={15000} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Returns &amp; Refunds</h1>
          <p className="mt-1 text-sm text-slate-500">
            One page for every refund: what was refunded, which store is cancelling or returning the most, and the
            old marketplace refund sheets. Every sheet below has its own search box, a filter under each column and a
            Columns picker — exactly like the Orders page.
          </p>
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live — refreshes every 15 seconds (pauses while you type)
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">
            Search (PO / order no / buyer)
          </label>
          <input
            id="q"
            name="q"
            type="text"
            defaultValue={orderNo}
            placeholder="Partial match, e.g. PO-A451 or Amazon order no"
            className={`${inputClass} w-64`}
          />
        </div>
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
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
        <Link href="/dashboard/returns" className="text-xs text-slate-400 underline">
          Clear
        </Link>
      </form>

      {/* 2026-11-03 — new refund straight from this page: type the PO /
          marketplace order no (or buyer), pick the order, and its read-only
          A4 refund sheet opens — only reason + amount (and date / currency)
          are typed there. Same dialog, same save action as the Orders page. */}
      <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4 print:hidden">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-teal-900">🆕 New refund / return</h2>
            <p className="text-xs text-teal-700">
              PO / RF / RG no, marketplace order no ya buyer ka naam daalo — order select karo, uski poori detail wali A4
              refund sheet khul jayegi (read only), phir reason aur amount bhar ke save karo.
            </p>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="from" value={fromDate} />
            <input type="hidden" name="to" value={toDate} />
            <input type="hidden" name="company" value={companyId} />
            <input type="hidden" name="store" value={storeId} />
            <div>
              <label className="mb-1 block text-xs font-medium text-teal-800" htmlFor="po">PO / Order No / Buyer</label>
              <input
                id="po"
                name="po"
                defaultValue={poSearch}
                placeholder="PO-123 / 171-1234567-1234567"
                className={inputClass}
              />
            </div>
            <button type="submit" className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700">
              Find order
            </button>
          </form>
        </div>
        {poSearch && <RefundOrderPicker orders={pickerOrders} currencies={currencies ?? []} search={poSearch} />}
      </div>

      {/* 2026-11-03b — refunds post immediately; returns need MD/Admin
          approval before they change anything. */}
      <div className="mt-4">
        <ReturnRequestPanel
          canApprove={canApproveReturns}
          pending={pendingReturns}
          mine={myReturns}
          currencies={(currencies ?? []).map((row) => row.code)}
          migrationPending={returnMigrationPending}
          migrationFile="db/2026-11-03b-return-approval.sql"
        />
      </div>

      <p className="text-xs text-slate-500">
        Showing <strong>{selectedCompany}</strong> · <strong>{selectedStore}</strong> · <strong>{dateLabel}</strong>.
        The OMS refund sheet and the marketplace sheet filter by <strong>refund date</strong>; the store rate sheet
        filters by <strong>order date</strong>. Each sheet shows up to <strong>1,000 rows</strong> (newest first) —
        narrow it with its own search box or the filter under any column.
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
          {/* "Order value se jyada refund nahi hoga" — rule ka live result.
              OVER kam se kam dikha hi dena chahiye (wo data problem hai), aur
              N/A batata hai ki kitne orders ka value hi record nahi hai. */}
          <div className="mt-1 text-xs text-slate-500">
            Value check: <strong className="text-emerald-600">{orderRefundRows.length - overValueCount - naValueCount} OK</strong>
            {overValueCount > 0 && (
              <>
                · <strong className="text-red-600">{overValueCount} over the order&apos;s value</strong>
              </>
            )}
            {naValueCount > 0 && <>. {naValueCount} with no recorded order value</>}
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

      {/* Reports stay behind the `reports` capability; order-entry staff see
          only the refund / return actions above. */}
      {hasReports ? (
        <>
          <StoreRateReportTable rows={storeRateRows} />
          <OrderRefundsReportTable rows={orderRefundRows} currencies={(currencies ?? []).map((row) => row.code)} />
          <HistoricalRefundsReportTable rows={historicalRefundRows} />
        </>
      ) : null}
    </div>
  );
}
