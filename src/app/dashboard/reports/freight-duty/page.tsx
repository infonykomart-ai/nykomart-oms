import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { FreightReportTable, DutyReportTable, type FreightReportRow, type DutyReportRow } from "./freight-duty-report-tables";

// Freight/Duty Bill report (2026-08-22) — one of the 3 new report pages,
// following the Orders report's exact pattern.
//
// Source choice: freight_bills/duty_tax_bills carry the bill-level figures
// but NEITHER has a company_id or a fixed courier (freight_bills does have
// vendor_party_id, added 2026-08-17, but one invoice can span AWBs across
// multiple companies with no stored split per-company — see
// documents/freight-bill-section.tsx's own comment on this). Company
// scoping and a meaningful date/courier filter both need the
// SHIPMENT-level grain, which is exactly what
// freight_reconciliation_view/duty_reconciliation_view already are (built
// 2026-08-12, section 8/9 of db/schema.sql, joining the manual AWB
// assignment tables to orders/dispatch_invoices) — reused here as-is
// rather than re-deriving their arithmetic (GST/gross/percentages) by
// hand. This page only adds: (1) the invoice_date/vendor_party_id filter
// off freight_bills/duty_tax_bills themselves, and (2) company scoping by
// joining the view's order_id back to orders.company_id — neither
// re-implements anything the views already compute.
export default async function FreightDutyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const vendorId = typeof sp.vendor === "string" && sp.vendor ? sp.vendor : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  const scopedCompanyIds = companyId ? [companyId] : employee.companyIds;

  const [{ data: companies }, { data: vendors }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name").order("name"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));

  // ---- Freight ----
  let freightBillsQuery = supabase
    .from("freight_bills")
    .select("id, invoice_no, invoice_date, vendor_party_id")
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(500);
  if (fromDate) freightBillsQuery = freightBillsQuery.gte("invoice_date", fromDate);
  if (toDate) freightBillsQuery = freightBillsQuery.lte("invoice_date", toDate);
  if (vendorId) freightBillsQuery = freightBillsQuery.eq("vendor_party_id", vendorId);
  const { data: freightBills } = await freightBillsQuery;

  const freightBillIds = (freightBills ?? []).map((b) => b.id);
  const freightBillById = new Map((freightBills ?? []).map((b) => [b.id, b]));
  const { data: freightViewRows } = freightBillIds.length
    ? await supabase.from("freight_reconciliation_view").select("*").in("freight_bill_id", freightBillIds)
    : { data: [] as never[] };

  // ---- Duty ----
  let dutyBillsQuery = supabase
    .from("duty_tax_bills")
    .select("id, invoice_no, invoice_date, vendor_party_id")
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(500);
  if (fromDate) dutyBillsQuery = dutyBillsQuery.gte("invoice_date", fromDate);
  if (toDate) dutyBillsQuery = dutyBillsQuery.lte("invoice_date", toDate);
  if (vendorId) dutyBillsQuery = dutyBillsQuery.eq("vendor_party_id", vendorId);
  const { data: dutyBills } = await dutyBillsQuery;

  const dutyBillIds = (dutyBills ?? []).map((b) => b.id);
  const dutyBillById = new Map((dutyBills ?? []).map((b) => [b.id, b]));
  const { data: dutyViewRows } = dutyBillIds.length
    ? await supabase.from("duty_reconciliation_view").select("*").in("duty_tax_bill_id", dutyBillIds)
    : { data: [] as never[] };

  // ---- Company scoping: resolve every referenced order_id -> company_id
  // (freight_bills/duty_tax_bills have no company_id of their own — see
  // header comment — the SHIPMENT's order is the only thing that does). A
  // row whose order isn't in the caller's accessible companies is dropped
  // entirely, same "no direct column -> scope via the join" convention
  // used across this codebase (purchase_bills before it had its own
  // company_id, order_refunds in the Returns report, etc).
  const orderIds = Array.from(
    new Set([...(freightViewRows ?? []).map((r) => r.order_id), ...(dutyViewRows ?? []).map((r) => r.order_id)].filter(
      (id): id is string => !!id
    ))
  );
  const { data: orders } = orderIds.length
    ? await supabase.from("orders").select("id, ref_no, order_date, company_id").in("id", orderIds)
    : { data: [] as never[] };
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

  const freightRows: FreightReportRow[] = (freightViewRows ?? [])
    .map((v): FreightReportRow | null => {
      const order = v.order_id ? orderById.get(v.order_id) : undefined;
      const bill = v.freight_bill_id ? freightBillById.get(v.freight_bill_id) : undefined;
      if (!order || !scopedCompanyIds.includes(order.company_id)) return null;
      return {
        id: v.assignment_id ?? `${v.freight_bill_id}-${v.order_id}`,
        freight_invoice_no: bill?.invoice_no ?? v.freight_invoice_no ?? "—",
        invoice_date: bill?.invoice_date ?? null,
        vendor_name: bill?.vendor_party_id ? vendorName.get(bill.vendor_party_id) ?? "—" : "—",
        company_name: companyName.get(order.company_id) ?? "—",
        po_no: v.po_no,
        order_date: order.order_date,
        awb_no: v.awb_no,
        buyer_country: v.buyer_country,
        our_shipping_amt: v.our_shipping_amt != null ? Number(v.our_shipping_amt) : null,
        gst_18pct: v.gst_18pct != null ? Number(v.gst_18pct) : null,
        gross_shipping_amt: v.gross_shipping_amt != null ? Number(v.gross_shipping_amt) : null,
        bill_weight_kg: v.bill_weight_kg != null ? Number(v.bill_weight_kg) : null,
        dimensional_weight: v.dimensional_weight != null ? Number(v.dimensional_weight) : null,
        difference_amt: v.difference_amt != null ? Number(v.difference_amt) : null,
      };
    })
    .filter((r): r is FreightReportRow => r !== null);

  const dutyRows: DutyReportRow[] = (dutyViewRows ?? [])
    .map((v): DutyReportRow | null => {
      const order = v.order_id ? orderById.get(v.order_id) : undefined;
      const bill = v.duty_tax_bill_id ? dutyBillById.get(v.duty_tax_bill_id) : undefined;
      if (!order || !scopedCompanyIds.includes(order.company_id)) return null;
      return {
        id: v.assignment_id ?? `${v.duty_tax_bill_id}-${v.order_id}`,
        duty_invoice_no: bill?.invoice_no ?? v.duty_invoice_no ?? "—",
        invoice_date: bill?.invoice_date ?? null,
        vendor_name: bill?.vendor_party_id ? vendorName.get(bill.vendor_party_id) ?? "—" : "—",
        company_name: companyName.get(order.company_id) ?? "—",
        po_no: v.po_no,
        order_date: order.order_date,
        awb_no: v.awb_no,
        buyer_country: v.buyer_country,
        duty_tax_amt_usd: v.duty_tax_amt_usd != null ? Number(v.duty_tax_amt_usd) : null,
        duty_tax_amt_inr: v.duty_tax_amt_inr != null ? Number(v.duty_tax_amt_inr) : null,
        other_charge: v.other_charge != null ? Number(v.other_charge) : null,
        gst_18pct: v.gst_18pct != null ? Number(v.gst_18pct) : null,
        duty_gross_amt: v.duty_gross_amt != null ? Number(v.duty_gross_amt) : null,
        shipping_amt: v.shipping_amt != null ? Number(v.shipping_amt) : null,
        shipping_and_duty: v.shipping_and_duty != null ? Number(v.shipping_and_duty) : null,
      };
    })
    .filter((r): r is DutyReportRow => r !== null);

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🚚 Freight / Duty Bill Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Courier Freight Bills + Duty &amp; Tax Bills, one row per assigned shipment — apply filters, then
            download or send.
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
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="vendor">Courier / Vendor</label>
          <select id="vendor" name="vendor" defaultValue={vendorId} className={inputClass}>
            <option value="">All</option>
            {(vendors ?? []).map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports/freight-duty" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <FreightReportTable rows={freightRows} />
      <DutyReportTable rows={dutyRows} />
    </div>
  );
}
