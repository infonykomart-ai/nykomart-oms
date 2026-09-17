import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { getOrderStatusSummaries } from "@/lib/orders/order-status-summary";
import { matchMarketplaceFees } from "@/lib/orders/marketplace-fees";
import { OrderListTable } from "./order-list-table";
import { AutoRefresh } from "@/components/auto-refresh";

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

  let query = supabase
    .from("orders")
    .select(
      "id, ref_no, order_date, company_id, status, shipment_status, dispatch_date, marketplace_order_no, buyer_name_address, contact_no, email_id, tax_id, address_type, po_date, delivery_date, photo_url, sku_label, size_label, qty, item_category_id, order_value_original, order_currency, colour, photo_type, tassel_fringes, remark, whatsapp_sent_at, invoice_id, entry_timestamp, vat_number, eori_number, ioss_number, destination_country, buyer_address1, buyer_address2, buyer_address3, buyer_city, buyer_state, buyer_postal_code, vendor_party_id, advance_tracking, final_tracking"
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

  // 2026-08-17 performance fix — these queries each only depend on
  // orderIds computed above, never on each other's results, but were
  // previously awaited one at a time — a fully sequential chain of
  // round-trips on every Orders hub page load. Running them together cuts
  // that to the slowest single query instead of the sum of all of them.
  // Same empty-array short-circuit as before (skip the query entirely,
  // resolve to { data: [] }) — Promise.all accepts a plain value alongside
  // real promises just fine.
  //
  // 2026-09-04 — purchase_bills/dispatch_invoices were fetched and reduced
  // into purchasesByOrder/trackingByOrder right here; that's now
  // getOrderStatusSummaries() (src/lib/orders/order-status-summary.ts),
  // shared with the order detail page and the Orders Report so the
  // purchased-from/Purchase-Bill/delivered/tracking/freight sourcing rules
  // live in exactly one place. Run alongside the other independent queries
  // below, same Promise.all batching as before.
  //
  // 2026-09-09 — the Etsy/eBay/Amazon fee-matching queries + matching logic
  // (2026-08-13, "store par jab order aaya to kon kon si fee lagi") moved
  // into matchMarketplaceFees() (src/lib/orders/marketplace-fees.ts) so the
  // new Store Expense Report can reuse the EXACT same matching semantics
  // instead of a second hand-copied version drifting out of sync over
  // time. No behavior change here — same queries, same company scoping,
  // same normalizeOrderNo() (now imported from that shared module).
  const [{ data: refunds }, marketplaceFees, statusByOrder] = await Promise.all([
    orderIds.length
      ? supabase
          .from("order_refunds")
          .select("order_id, refund_amount, refund_currency, refund_date, credit_note_id")
          .in("order_id", orderIds)
      : { data: [] },
    matchMarketplaceFees(supabase, orders ?? [], effectiveCompanyIds),
    getOrderStatusSummaries(
      supabase,
      (orders ?? []).map((o) => ({
        id: o.id,
        vendor_party_id: o.vendor_party_id,
        advance_tracking: o.advance_tracking,
        final_tracking: o.final_tracking,
      }))
    ),
  ]);
  const { etsyFeesByOrder, ebayFeesByOrder, amazonFeesByOrder } = marketplaceFees;

  // Pending item 2 (Hold/Cancel/Refund) — surface any refund(s) already
  // entered against each order, and whether one auto-generated a Credit
  // Note, right on the Orders hub (same "link everything" principle as
  // statusByOrder above).
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
  // Matching logic itself now lives in matchMarketplaceFees() (see the
  // Promise.all above and src/lib/orders/marketplace-fees.ts) — orders
  // that aren't on a matched marketplace, or have no ledger rows yet,
  // simply get no entry in etsyFeesByOrder/ebayFeesByOrder/
  // amazonFeesByOrder.

  return (
    <div>
      {/* 2026-09-10 — "har 10-20 second me data sync hota rahe": see
          src/components/auto-refresh.tsx for what this does and why it's
          safe (pauses while typing, pauses on a hidden tab). */}
      <AutoRefresh intervalMs={15000} />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📋 Orders — Edit / Modify / Delete</h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/dashboard/orders/bulk-tracking-update"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            🚚 Bulk Tracking Update (CSV)
          </Link>
          {/* 2026-09-13 — "Vendor Assignment me ek sath agar 100-200 po par
              ek sath party assign karna ho to kese kerenge": bulk CSV path
              beside the existing bulk tracking/upload buttons. */}
          <Link
            href="/dashboard/orders/bulk-vendor-assignment"
            className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
          >
            👷 Bulk Assign Party (CSV)
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
        companies={companies ?? []}
        statuses={STATUSES}
        todayStr={todayStr}
        statusByOrder={statusByOrder}
        refundsByOrder={refundsByOrder}
        etsyFeesByOrder={etsyFeesByOrder}
        ebayFeesByOrder={ebayFeesByOrder}
        amazonFeesByOrder={amazonFeesByOrder}
      />
    </div>
  );
}
