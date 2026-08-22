import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { OrderListTable } from "./order-list-table";

const STATUSES = ["Pending", "Confirmed", "In Production", "Dispatched", "Delivered", "Hold", "Cancelled", "Returned"];

// Orders hub (2026-08-07) — "order panal me order ko edit modify delet
// karne ka option" + WhatsApp-sent visual status. This is the list/search/
// edit/delete panel; fast day-to-day entry stays at /dashboard/orders/new
// (linked from here, and linking back).
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("order_entry");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  // 2026-08-17 fix — "order page har jagh par" filter should respect the
  // top-nav company switcher by default. Before this, landing on this page
  // fresh (no ?company= param yet) always fell back to `employee.companyIds`
  // (every accessible company mixed together), ignoring which company was
  // selected up top. Now: no `company` param at all (fresh page load, or
  // "Clear" was clicked) -> default to the currently selected company;
  // `company` param present but empty (user explicitly picked "All" from
  // this page's own filter and submitted) -> honor that explicit override
  // and show every accessible company; `company=<id>` -> that one company.
  const companyParamPresent = "company" in sp;
  const effectiveCompanyIds = companyId
    ? [companyId]
    : companyParamPresent
      ? employee.companyIds
      : [employee.currentCompanyId];
  const status = typeof sp.status === "string" && sp.status ? sp.status : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  // 2026-08-08 (pending item 5) — "Late Order" isn't a stored status, it's
  // a derived condition: dispatch date has passed but the order still
  // isn't Dispatched/Delivered/Cancelled/Returned.
  const lateOnly = sp.late === "1";
  const todayStr = new Date().toISOString().slice(0, 10);

  const [{ data: companies }, { data: itemCategories }, { data: sizes }, { data: currencies }, { data: parties }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("item_categories").select("id, name").order("name"),
    supabase.from("sizes").select("id, label").order("label"),
    supabase.from("currencies").select("code, name").order("code"),
    supabase.from("parties").select("id, name").order("name"),
  ]);
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  let query = supabase
    .from("orders")
    .select(
      "id, ref_no, order_date, company_id, status, shipment_status, dispatch_date, marketplace_order_no, buyer_name_address, contact_no, email_id, tax_id, address_type, po_date, delivery_date, photo_url, sku_label, size_label, qty, item_category_id, order_value_original, order_currency, colour, photo_type, tassel_fringes, remark, whatsapp_sent_at, invoice_id, entry_timestamp, vat_number, eori_number, ioss_number, destination_country, vendor_party_id"
    )
    .in("company_id", effectiveCompanyIds)
    .order("entry_timestamp", { ascending: false })
    .limit(300);

  if (status) query = query.eq("status", status as never);
  if (fromDate) query = query.gte("order_date", fromDate);
  if (toDate) query = query.lte("order_date", toDate);
  if (q) query = query.or(`ref_no.ilike.%${q}%,buyer_name_address.ilike.%${q}%,contact_no.ilike.%${q}%`);
  if (lateOnly) {
    query = query
      .lt("dispatch_date", todayStr)
      .not("status", "in", "(Dispatched,Delivered,Cancelled,Returned)");
  }

  const { data: orders } = await query;

  // 2026-08-14: "sabhi order upar niche aa rahe hai to ye sabhi order me
  // aaye a2z formate me" — the list was coming out in entry_timestamp order
  // (whatever order rows were bulk-uploaded/entered in), which scatters PO/
  // RF/RG numbers around instead of reading top-to-bottom in ref_no order.
  // A plain text sort on ref_no would put "PO-A100" before "PO-A20" (string
  // comparison, not numeric), so this pulls out the prefix/number/suffix
  // pieces and compares them numerically — same idea as the natural sort
  // used for the bulk-order-upload spreadsheet.
  function refNoSortKey(ref: string | null): [string, number, number, number] {
    if (!ref) return ["", 0, 0, 0];
    const m = ref.match(/^([A-Za-z]+)-?(\d+)(?:-(\d+)\/(\d+))?/);
    if (!m) return [ref, 0, 0, 0];
    const [, prefix, num, part, total] = m;
    return [prefix, Number(num), part ? Number(part) : 0, total ? Number(total) : 0];
  }
  orders?.sort((a, b) => {
    const ka = refNoSortKey(a.ref_no);
    const kb = refNoSortKey(b.ref_no);
    if (ka[0] !== kb[0]) return ka[0].localeCompare(kb[0]);
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    if (ka[2] !== kb[2]) return ka[2] - kb[2];
    return ka[3] - kb[3];
  });

  // 2026-08-08: "YE LINK HONA CHAHIYE... SABHI CHEJE LINK RAHEGI" — reverse
  // lookup so the Orders hub itself shows which vendor Party (if any) each
  // order's item was purchased from, via Purchase Bill's now-required
  // order_id link (see documents/actions.ts's savePurchaseBill).
  const orderIds = (orders ?? []).map((o) => o.id);

  // 2026-08-13 (see comment further down, kept here since normalizeOrderNo
  // is now needed before the marketplace fee queries fire, not after) —
  // marketplace_order_no is sometimes typed with a leading "#" and
  // sometimes without; none of the 3 ledger-side columns ever contain one.
  const normalizeOrderNo = (v: string | null | undefined): string | null => {
    const t = v?.trim().replace(/^#/, "").trim();
    return t || null;
  };
  const marketplaceOrderNos = Array.from(
    new Set((orders ?? []).map((o) => normalizeOrderNo(o.marketplace_order_no)).filter((x): x is string => !!x))
  );

  // 2026-08-17 performance fix — these 6 queries (purchaseBills through
  // amazonLines) each only depend on orderIds/marketplaceOrderNos computed
  // above, never on each other's results, but were previously awaited one
  // at a time — a fully sequential chain of round-trips on every Orders
  // hub page load. Running them together cuts that to the slowest single
  // query instead of the sum of all 6. Same empty-array short-circuit as
  // before (skip the query entirely, resolve to { data: [] }) — Promise.all
  // accepts a plain value alongside real promises just fine.
  const [
    { data: purchaseBills },
    { data: dispatchInvoices },
    { data: refunds },
    { data: etsyLines },
    { data: ebayTaxLines },
    { data: amazonLines },
  ] = await Promise.all([
    orderIds.length
      ? supabase.from("purchase_bills").select("order_id, vendor_party_id, vendor_invoice_no").in("order_id", orderIds)
      : { data: [] },
    orderIds.length
      ? supabase
          .from("dispatch_invoices")
          .select("order_id, awb_no, courier_name, delivered_status, delivered_date")
          .in("order_id", orderIds)
      : { data: [] },
    orderIds.length
      ? supabase
          .from("order_refunds")
          .select("order_id, refund_amount, refund_currency, refund_date, credit_note_id")
          .in("order_id", orderIds)
      : { data: [] },
    marketplaceOrderNos.length
      ? supabase
          .from("etsy_ledger_lines")
          .select("company_id, order_number, txn_date, type, title, info, amount, fees_and_taxes, net, currency")
          .in("company_id", effectiveCompanyIds)
          .in("order_number", marketplaceOrderNos)
      : { data: [] },
    marketplaceOrderNos.length
      ? supabase
          .from("ebay_tax_invoice_lines")
          .select("company_id, order_number, txn_date, description, memo, fee_type, currency, net_amount, igst_amount, total_amount")
          .in("company_id", effectiveCompanyIds)
          .in("order_number", marketplaceOrderNos)
      : { data: [] },
    marketplaceOrderNos.length
      ? supabase
          .from("amazon_transactions")
          .select("company_id, order_id, txn_date, transaction_type, product_details, amazon_fees, total_amount, currency")
          .in("company_id", effectiveCompanyIds)
          .in("order_id", marketplaceOrderNos)
      : { data: [] },
  ]);

  const purchasesByOrder: Record<string, { vendorName: string; vendorInvoiceNo: string }[]> = {};
  for (const pb of purchaseBills ?? []) {
    if (!pb.order_id) continue;
    (purchasesByOrder[pb.order_id] ??= []).push({
      vendorName: partyName.get(pb.vendor_party_id) ?? "—",
      vendorInvoiceNo: pb.vendor_invoice_no ?? "—",
    });
  }

  // 2026-08-08 (pending item 7's UI half — "Order section should show
  // status: In Transit / Delivered / red alert... with a More Details
  // click-through") — courier tracking info (AWB/courier/delivered date),
  // filled in via Bulk Courier Tracking Update (item 8, manual for now
  // since the live courier-API integration itself is still blocked).
  const trackingByOrder: Record<
    string,
    { awbNo: string | null; courierName: string | null; deliveredStatus: string | null; deliveredDate: string | null }
  > = {};
  for (const di of dispatchInvoices ?? []) {
    trackingByOrder[di.order_id] = {
      awbNo: di.awb_no,
      courierName: di.courier_name,
      deliveredStatus: di.delivered_status,
      deliveredDate: di.delivered_date,
    };
  }

  // Pending item 2 (Hold/Cancel/Refund) — surface any refund(s) already
  // entered against each order, and whether one auto-generated a Credit
  // Note, right on the Orders hub (same "link everything" principle as
  // purchasesByOrder/trackingByOrder above).
  const refundsByOrder: Record<string, { amount: number; currency: string; date: string; hasCreditNote: boolean }[]> = {};
  for (const r of refunds ?? []) {
    (refundsByOrder[r.order_id] ??= []).push({
      amount: Number(r.refund_amount),
      currency: r.refund_currency,
      date: r.refund_date,
      hasCreditNote: !!r.credit_note_id,
    });
  }

  // 2026-08-13 — "store par jab order aaya to kon kon si fee lagi vo uske
  // store ke statement se milani padegi" (per-order fee reconciliation).
  // etsy_ledger_lines.order_number is a generated column extracted from
  // the real Etsy Ledger CSV's Info/Title text (verified against 7 real
  // months, Jan-Jul 2026 — see db/2026-08-13-etsy-order-matching-and-
  // invoice-fix.sql). Matched by company_id + marketplace_order_no so an
  // order only ever sees fee rows from its own company's ledger. Orders
  // that aren't Etsy (or have no ledger rows yet) simply get no match —
  // this doesn't need to know which marketplace an order came from.
  //
  // 2026-08-13 (later same day) — user flagged that marketplace_order_no
  // is sometimes typed/entered with a leading "#" (e.g. "#1234567890")
  // and sometimes without, across Etsy/eBay/Amazon orders. None of the
  // 3 ledger-side columns this matches against ever contain a "#" — see
  // normalizeOrderNo above (moved up so marketplaceOrderNos is available
  // before the parallel query block fires).
  type EtsyFeeLine = {
    date: string | null;
    type: string | null;
    title: string | null;
    info: string | null;
    amount: number;
    fees: number;
    net: number;
    currency: string | null;
  };
  const etsyFeesByOrder: Record<string, { lines: EtsyFeeLine[]; totalFeesInr: number }> = {};
  for (const o of orders ?? []) {
    const orderNo = normalizeOrderNo(o.marketplace_order_no);
    if (!orderNo) continue;
    const matches = (etsyLines ?? []).filter(
      (l) => l.company_id === o.company_id && l.order_number === orderNo
    );
    if (matches.length === 0) continue;
    etsyFeesByOrder[o.id] = {
      lines: matches
        .map((l) => ({
          date: l.txn_date,
          type: l.type,
          title: l.title,
          info: l.info,
          amount: Number(l.amount ?? 0),
          fees: Number(l.fees_and_taxes ?? 0),
          net: Number(l.net ?? 0),
          currency: l.currency,
        }))
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
      // Fees & Taxes is negative for charges, positive for TCS credits —
      // summing it directly (not abs()) gives the real net fee impact,
      // matching how the ledger itself signs these amounts.
      totalFeesInr: matches.reduce((sum, l) => sum + Number(l.fees_and_taxes ?? 0), 0),
    };
  }

  // 2026-08-13 — same matching for eBay, now that a real eBay export has
  // been supplied: ebay_tax_invoice_lines.order_number is a NATIVE column
  // in eBay's own "Tax invoice detail" CSV (no regex extraction needed,
  // unlike Etsy) — verified against 8 real consecutive months (Dec 2025-
  // Jul 2026) that every non-subscription row carries a real order number
  // in eBay's own hyphenated format (e.g. "07-13945-27087"). Every row in
  // this report is itself a fee (Final Value Fee, International Fee,
  // Promoted Listings fee, Regulatory Operating Fee, Subscription Fee) —
  // total_amount is always the fee charged (shown positive in the source
  // CSV), so it's negated here to read as a fee-impact figure, the same
  // sign convention as Etsy's totalFeesUsd below (negative = cost).
  // Kept as a SEPARATE map from Etsy's (not merged into one combined
  // total) since the two are different currencies (INR vs USD) — summing
  // them together would be meaningless.
  type EbayFeeLine = {
    date: string | null;
    type: string | null;
    description: string | null;
    memo: string | null;
    amount: number;
    currency: string | null;
  };
  const ebayFeesByOrder: Record<string, { lines: EbayFeeLine[]; totalFeesUsd: number }> = {};
  for (const o of orders ?? []) {
    const orderNo = normalizeOrderNo(o.marketplace_order_no);
    if (!orderNo) continue;
    const matches = (ebayTaxLines ?? []).filter(
      (l) => l.company_id === o.company_id && l.order_number === orderNo
    );
    if (matches.length === 0) continue;
    ebayFeesByOrder[o.id] = {
      lines: matches
        .map((l) => ({
          date: l.txn_date,
          type: l.fee_type,
          description: l.description,
          memo: l.memo,
          amount: -Number(l.total_amount ?? 0),
          currency: l.currency,
        }))
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
      totalFeesUsd: matches.reduce((sum, l) => sum - Number(l.total_amount ?? 0), 0),
    };
  }

  // 2026-08-13 — same matching for Amazon (new marketplace, ground-up
  // build this round): amazon_transactions.order_id is Amazon's own real
  // order ID (native column, no extraction needed), verified against 3
  // real "Transactions" exports (amazon.co.uk/GBP, amazon.com/USD,
  // amazon.com.au/AUD). amazon_fees is already signed the same way as
  // Etsy/eBay (negative = charge) — no sign flip needed here, unlike
  // eBay's total_amount above.
  //
  // 2026-08-13 (later same day) — user asked for a single Amazon section
  // per order instead of one per currency (was previously grouped into
  // separate collapsible blocks per currency, which read as 3 separate
  // "Amazon" sections even though almost every real order only has one
  // currency's worth of lines). Now all matching lines for an order are
  // merged into one list (sorted by date), with a Currency column added
  // to the table so a rare multi-currency order is still legible, and
  // per-currency net-fee-impact subtotals are kept (never summed across
  // currencies — that would be meaningless) but shown together in one
  // header line instead of one header per currency.
  type AmazonFeeLine = {
    date: string | null;
    type: string | null;
    productDetails: string | null;
    amazonFees: number;
    totalAmount: number;
    currency: string;
  };
  type AmazonFeeMatch = {
    lines: AmazonFeeLine[];
    totalsByCurrency: { currency: string; totalFees: number }[];
  };
  const amazonFeesByOrder: Record<string, AmazonFeeMatch> = {};
  for (const o of orders ?? []) {
    const orderNo = normalizeOrderNo(o.marketplace_order_no);
    if (!orderNo) continue;
    const matches = (amazonLines ?? []).filter(
      (l) => l.company_id === o.company_id && l.order_id === orderNo
    );
    if (matches.length === 0) continue;
    const byCurrency = new Map<string, number>();
    for (const l of matches) {
      const cur = l.currency ?? "?";
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + Number(l.amazon_fees ?? 0));
    }
    amazonFeesByOrder[o.id] = {
      lines: matches
        .map((l) => ({
          date: l.txn_date,
          type: l.transaction_type,
          productDetails: l.product_details,
          amazonFees: Number(l.amazon_fees ?? 0),
          totalAmount: Number(l.total_amount ?? 0),
          currency: l.currency ?? "?",
        }))
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
      totalsByCurrency: Array.from(byCurrency.entries()).map(([currency, totalFees]) => ({ currency, totalFees })),
    };
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📋 Orders — Edit / Modify / Delete</h1>
          <p className="mt-1 text-sm text-slate-500">
            Orders already sent on WhatsApp are shown in green. The PO/RF/RG number cannot be edited (it&apos;s tied to batch/suffix logic) — everything else is editable.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/dashboard/orders/bulk-tracking-update"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            🚚 Bulk Tracking Update (CSV)
          </Link>
          <Link
            href="/dashboard/orders/bulk-upload"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            📤 Bulk Upload (CSV)
          </Link>
          <Link
            href="/dashboard/orders/new"
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
          >
            + New Order
          </Link>
        </div>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">Search (Ref/Buyer/Contact)</label>
          <input id="q" name="q" defaultValue={q} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={companyParamPresent ? companyId : employee.currentCompanyId} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5 pb-1.5">
          <input id="late" name="late" type="checkbox" value="1" defaultChecked={lateOnly} className="h-4 w-4 rounded border-slate-300" />
          <label htmlFor="late" className="text-xs font-medium text-red-600">⚠️ Late Orders only</label>
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
        <Link href="/dashboard/orders" className="text-xs text-slate-400 underline">Clear</Link>
      </form>

      <OrderListTable
        orders={orders ?? []}
        itemCategories={itemCategories ?? []}
        sizes={sizes ?? []}
        currencies={currencies ?? []}
        parties={parties ?? []}
        statuses={STATUSES}
        purchasesByOrder={purchasesByOrder}
        trackingByOrder={trackingByOrder}
        refundsByOrder={refundsByOrder}
        etsyFeesByOrder={etsyFeesByOrder}
        ebayFeesByOrder={ebayFeesByOrder}
        amazonFeesByOrder={amazonFeesByOrder}
      />
    </div>
  );
}
