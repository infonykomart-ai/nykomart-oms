import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { CsbFilingReportTable, type CsbFilingReportRow } from "./csb-filing-report-table";

// CSB Filing report (2026-10-28) — "ek csb filing ki report bhi nikalne ka
// option hona chahiye ki kab se kab tak or konkonse colom chahiye, order se
// related sabhi field hone chahiye isme".
//
// Until now csb_filings could only be seen as the 8-row "Recent CSB Filings"
// list on Document Entry — no date range, no column choice, and nothing from
// the order it was filed for (the register itself only knows csb_number /
// EGM / HAWB / invoice no, all free text with no FK).
//
// This page fills that gap without any new column or a new join table: the
// filing is matched to its order(s) through the two numbers the register
// already stores, both of which also exist on the order side —
//   csb_filings.hawb_number → order_shipments.awb_no         (AWB)
//   csb_filings.invoice_no  → dispatch_invoices.invoice_no   (sale invoice)
// and everything order-related (PO/RF/RG, company/store, buyer, qty, SKU,
// courier, AWB/forwarding no, delivered status, invoice value, HSN) is read
// from those matched orders. One filing can cover several orders (one buyer
// invoice often carries a whole batch), so the identifiers are joined and
// quantities are summed — see the aggregation in the row builder below.
//
// Filtering is by FILING DATE (the date customs filed it, which is what a
// "filing report" is asked to range over), plus the order's company, since
// csb_filings has no company_id column of its own.

export default async function CsbFilingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Reports hub se `reports` capability wale aate hain, aur Document Entry ke
  // CSB Filing tab se `doc_entry` wale — dono ko chalna chahiye (same
  // cross-module widening as the Credit Note Register, see
  // requireAnyCapability's own comment).
  const employee = await requireAnyCapability("reports", "doc_entry");
  const supabase = await createClient();
  const sp = await searchParams;

  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  const companyId = typeof sp.company === "string" && employee.companyIds.includes(sp.company) ? sp.company : "";

  const [{ data: companies }, { data: filingsRaw }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    (() => {
      let query = supabase
        .from("csb_filings")
        .select(
          "id, csb_number, exchange_rate, total_taxable_value, taxable_value_currency, fob_value_inr, filing_date, egm_number, egm_date, hawb_number, invoice_no, invoice_date"
        )
        .order("filing_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (fromDate) query = query.gte("filing_date", fromDate);
      if (toDate) query = query.lte("filing_date", toDate);
      return query;
    })(),
  ]);

  const filings = filingsRaw ?? [];
  const key = (v: string | null) => (v ?? "").trim().toUpperCase();
  // Case-insensitive matching without a functional index: query both the raw
  // value and its upper-case form, then compare keys upper-cased on this side.
  const variants = (values: string[]) => {
    const set = new Set<string>();
    for (const v of values) {
      const t = v.trim();
      if (!t) continue;
      set.add(t);
      set.add(t.toUpperCase());
    }
    return [...set];
  };
  const hawbs = variants(filings.map((f) => f.hawb_number ?? ""));
  const invoiceNos = variants(filings.map((f) => f.invoice_no ?? ""));

  // `.in()` lists are sent in the URL, so a year's worth of AWB/invoice
  // numbers can blow past the request-size limit. Query them in small
  // batches and concatenate — same rows either way, no truncation.
  const BATCH = 120;
  const chunked = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  type ShipmentRow = {
    order_id: string;
    awb_no: string | null;
    forwarding_no: string | null;
    courier_name: string | null;
    delivered_status: string | null;
    delivered_date: string | null;
    booked_freight_amt: number | null;
    booked_currency: string | null;
  };
  type DispatchRow = {
    order_id: string;
    invoice_no: string | null;
    invoice_date: string | null;
    invoice_amt_inr: number | null;
    invoice_amt_usd: number | null;
    awb_no: string | null;
    courier_name: string | null;
    hsn_no: string | null;
    buyer_name: string | null;
    buyer_country: string | null;
  };

  const shipments: ShipmentRow[] = [];
  const dispatches: DispatchRow[] = [];
  for (const part of chunked(hawbs, BATCH)) {
    const { data } = await supabase
      .from("order_shipments")
      .select("order_id, awb_no, forwarding_no, courier_name, delivered_status, delivered_date, booked_freight_amt, booked_currency")
      .in("awb_no", part);
    shipments.push(...((data ?? []) as ShipmentRow[]));
  }
  for (const part of chunked(invoiceNos, BATCH)) {
    const { data } = await supabase
      .from("dispatch_invoices")
      .select("order_id, invoice_no, invoice_date, invoice_amt_inr, invoice_amt_usd, awb_no, courier_name, hsn_no, buyer_name, buyer_country")
      .in("invoice_no", part);
    dispatches.push(...((data ?? []) as DispatchRow[]));
  }

  const orderIdsByHawb = new Map<string, string[]>();
  const shipmentByOrder = new Map<string, ShipmentRow>();
  for (const s of shipments) {
    const k = key(s.awb_no);
    if (!k) continue;
    const list = orderIdsByHawb.get(k) ?? [];
    if (!list.includes(s.order_id)) list.push(s.order_id);
    orderIdsByHawb.set(k, list);
    // Prefer the row that actually matches the filing's AWB on courier/forwarding.
    if (!shipmentByOrder.has(s.order_id)) shipmentByOrder.set(s.order_id, s);
  }
  const orderIdsByInvoice = new Map<string, string[]>();
  const dispatchByOrder = new Map<string, DispatchRow>();
  for (const d of dispatches) {
    const k = key(d.invoice_no);
    if (!k) continue;
    const list = orderIdsByInvoice.get(k) ?? [];
    if (!list.includes(d.order_id)) list.push(d.order_id);
    orderIdsByInvoice.set(k, list);
    if (!dispatchByOrder.has(d.order_id)) dispatchByOrder.set(d.order_id, d);
  }

  const allOrderIds = Array.from(new Set([...orderIdsByHawb.values(), ...orderIdsByInvoice.values()].flat()));
  type OrderRow = {
    id: string;
    company_id: string;
    store_id: string;
    ref_no: string;
    order_date: string | null;
    po_date: string | null;
    delivery_date: string | null;
    dispatch_date: string | null;
    status: string;
    marketplace_order_no: string | null;
    buyer_name_address: string | null;
    buyer_country: string | null;
    buyer_city: string | null;
    buyer_state: string | null;
    buyer_postal_code: string | null;
    contact_no: string | null;
    email_id: string | null;
    qty: number;
    sku_label: string | null;
    size_label: string | null;
    item_category_id: string | null;
    remark: string | null;
  };
  const orders: OrderRow[] = [];
  for (const part of chunked(allOrderIds, BATCH)) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, company_id, store_id, ref_no, order_date, po_date, delivery_date, dispatch_date, status, marketplace_order_no, buyer_name_address, buyer_country, buyer_city, buyer_state, buyer_postal_code, contact_no, email_id, qty, sku_label, size_label, item_category_id, remark"
      )
      .in("id", part);
    orders.push(...((data ?? []) as OrderRow[]));
  }
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const storeIds = Array.from(new Set(orders.map((o) => o.store_id).filter((v): v is string => !!v)));
  const categoryIds = Array.from(new Set(orders.map((o) => o.item_category_id).filter((v): v is string => !!v)));
  const [{ data: stores }, { data: categories }] = await Promise.all([
    storeIds.length ? supabase.from("stores").select("id, name").in("id", storeIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    categoryIds.length ? supabase.from("item_categories").select("id, name").in("id", categoryIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const storeName = new Map((stores ?? []).map((s) => [s.id, s.name]));
  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));

  const uniqueJoin = (values: (string | null | undefined)[]) =>
    Array.from(new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))).join(" / ");

  // The company filter is applied on the MATCHED order (csb_filings has no
  // company of its own), so each row's company ids are kept aside while the
  // row is built.
  const rowCompanyIds = new Map<string, Set<string>>();

  const rows: CsbFilingReportRow[] = filings.map((f) => {
    const matchedIds = Array.from(
      new Set([...(orderIdsByHawb.get(key(f.hawb_number)) ?? []), ...(orderIdsByInvoice.get(key(f.invoice_no)) ?? [])])
    );
    const matched = matchedIds.map((id) => orderById.get(id)).filter((o): o is OrderRow => !!o);
    rowCompanyIds.set(f.id, new Set(matched.map((o) => o.company_id)));

    // The shipment whose AWB is the filing's own HAWB is the right one; when
    // the filing matched only by invoice (no HAWB), fall back to any shipment
    // of the matched orders so courier/forwarding no. still show.
    const shipment =
      matchedIds.map((id) => shipmentByOrder.get(id)).find((s) => s && key(s.awb_no) === key(f.hawb_number)) ??
      matchedIds.map((id) => shipmentByOrder.get(id)).find((s): s is ShipmentRow => !!s);
    const dispatch = matchedIds.map((id) => dispatchByOrder.get(id)).find((d): d is DispatchRow => !!d);
    const first = matched[0];

    const qty = matched.length ? matched.reduce((sum, o) => sum + Number(o.qty ?? 0), 0) : null;
    const bookedFreight = shipment?.booked_freight_amt != null
      ? `${shipment.booked_currency ?? ""} ${Number(shipment.booked_freight_amt).toFixed(2)}`.trim()
      : "";

    return {
      id: f.id,
      csb_number: f.csb_number,
      filing_date: f.filing_date,
      egm_number: f.egm_number,
      egm_date: f.egm_date,
      hawb_number: f.hawb_number,
      invoice_no: f.invoice_no,
      invoice_date: f.invoice_date,
      exchange_rate: f.exchange_rate != null ? Number(f.exchange_rate) : null,
      total_taxable_value: f.total_taxable_value != null ? Number(f.total_taxable_value) : null,
      taxable_value_currency: f.taxable_value_currency,
      fob_value_inr: f.fob_value_inr != null ? Number(f.fob_value_inr) : null,

      order_ref_no: uniqueJoin(matched.map((o) => o.ref_no)),
      company_name: uniqueJoin(matched.map((o) => companyName.get(o.company_id) ?? "")),
      store_name: uniqueJoin(matched.map((o) => (o.store_id ? storeName.get(o.store_id) ?? "" : ""))),
      order_date: first?.order_date ?? null,
      po_date: first?.po_date ?? null,
      delivery_date: first?.delivery_date ?? null,
      dispatch_date: first?.dispatch_date ?? null,
      order_status: uniqueJoin(matched.map((o) => o.status)),
      marketplace_order_no: uniqueJoin(matched.map((o) => o.marketplace_order_no)),
      buyer_name_address: uniqueJoin(matched.map((o) => o.buyer_name_address ?? dispatch?.buyer_name)),
      buyer_country: uniqueJoin(matched.map((o) => o.buyer_country ?? dispatch?.buyer_country)),
      buyer_city: uniqueJoin(matched.map((o) => o.buyer_city)),
      buyer_state: uniqueJoin(matched.map((o) => o.buyer_state)),
      buyer_postal_code: uniqueJoin(matched.map((o) => o.buyer_postal_code)),
      contact_no: uniqueJoin(matched.map((o) => o.contact_no)),
      email_id: uniqueJoin(matched.map((o) => o.email_id)),
      qty,
      sku_label: uniqueJoin(matched.map((o) => o.sku_label)),
      size_label: uniqueJoin(matched.map((o) => o.size_label)),
      item_category: uniqueJoin(matched.map((o) => (o.item_category_id ? categoryName.get(o.item_category_id) ?? "" : ""))),
      courier_name: shipment?.courier_name ?? dispatch?.courier_name ?? "",
      awb_no: f.hawb_number ?? shipment?.awb_no ?? dispatch?.awb_no ?? "",
      forwarding_no: shipment?.forwarding_no ?? "",
      delivered_status: shipment?.delivered_status ?? "",
      delivered_date: shipment?.delivered_date ?? null,
      booked_freight: bookedFreight,
      invoice_amt_inr: dispatch?.invoice_amt_inr != null ? Number(dispatch.invoice_amt_inr) : null,
      invoice_amt_usd: dispatch?.invoice_amt_usd != null ? Number(dispatch.invoice_amt_usd) : null,
      hsn_no: dispatch?.hsn_no ?? "",
      remark: uniqueJoin(matched.map((o) => o.remark)),
      order_count: matched.length,
    };
  });

  // A filing that matched no order can't belong to a company, so it only
  // shows in the unfiltered view.
  const filteredRows = companyId ? rows.filter((r) => rowCompanyIds.get(r.id)?.has(companyId)) : rows;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🛃 CSB Filing Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Customs CSB-V filings with their order details — filing date se date tak, aur jitne column chahiye utne.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <CsbFilingReportTable
        rows={filteredRows}
        companies={companies ?? []}
        filters={{ fromDate, toDate, companyId }}
      />
    </div>
  );
}
