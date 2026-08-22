import Link from "next/link";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { DocumentEntryTabs } from "./document-entry-tabs";

// Document Entry module (2026-08-07) — the dashboard's "Document Entry"
// tile has pointed at /dashboard/documents since the Invoice round, but
// this route never existed (404) — this page + the 4 forms in
// document-entry-tabs.tsx are the actual build. See actions.ts's header
// comment for the full "why" — short version: Credit Note / Debit Note /
// Washing Entry all connect back to `orders` (and, via orders.invoice_id,
// to `sales_invoices`) through the shared PO/RF/RG lookup box, so the
// order <-> invoice <-> credit/debit-note chain the user asked about is
// now something you can actually see and use, not just a foreign key.
//
// 2026-08-07 (later round): wrapped in try/catch — an employee without the
// "doc_entry" capability navigating here directly (e.g. a stale/typed URL;
// the dashboard tile itself is already hidden for them, see dashboard/
// page.tsx's `tiles` filter) used to hit Next.js's generic opaque-digest
// crash screen. Now they get a plain "Access Denied" message instead.
// (2026-08-08: a prior TEMP DEBUG version of this wrapper — which dumped
// the raw error name/message/stack trace to the page — was accidentally
// left live in production instead of being replaced by this version; that
// leaked internal file paths to anyone who hit the ForbiddenError path.
// Fixed by actually shipping this clean version.)
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  try {
    return await DocumentsPageInner(searchParams);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">Access Denied</p>
          <p className="mt-1">{err.message} Contact your Admin if you need access to Document Entry.</p>
        </div>
      );
    }
    throw err;
  }
}

// 2026-08-22 — filter UI added to the Purchase Bill / Courier (Freight)
// Bill / Duty & Tax Bill lists specifically (GET-form + searchParams, same
// pattern as Orders): date range + vendor party. These 3 "Recent" lists had
// no filter UI at all before — a flat most-recent-8 list, full stop. Since
// the tab switcher (document-entry-tabs.tsx) is client-only useState (not
// URL-driven), `tab` is threaded through as its own searchParam so
// submitting one of these filter forms (a plain GET, full navigation)
// lands back on the same tab instead of resetting to Credit Note.
async function DocumentsPageInner(searchParamsPromise: Promise<{ [key: string]: string | string[] | undefined }>) {
  const employee = await requireCapability("doc_entry");
  const supabase = await createClient();
  const sp = await searchParamsPromise;

  const initialTab = typeof sp.tab === "string" ? sp.tab : "";
  const pbVendor = typeof sp.pbVendor === "string" ? sp.pbVendor : "";
  const pbFrom = typeof sp.pbFrom === "string" ? sp.pbFrom : "";
  const pbTo = typeof sp.pbTo === "string" ? sp.pbTo : "";
  const fbVendor = typeof sp.fbVendor === "string" ? sp.fbVendor : "";
  const fbFrom = typeof sp.fbFrom === "string" ? sp.fbFrom : "";
  const fbTo = typeof sp.fbTo === "string" ? sp.fbTo : "";
  const dbVendor = typeof sp.dbVendor === "string" ? sp.dbVendor : "";
  const dbFrom = typeof sp.dbFrom === "string" ? sp.dbFrom : "";
  const dbTo = typeof sp.dbTo === "string" ? sp.dbTo : "";
  // Any of these 3 lists' filters active -> raise the normal limit(8) so a
  // filter that legitimately matches more than 8 rows isn't silently
  // truncated back down to the unfiltered "recent" page size.
  const FILTERED_LIMIT = 200;
  const pbFiltered = !!(pbVendor || pbFrom || pbTo);
  const fbFiltered = !!(fbVendor || fbFrom || fbTo);
  const dbFiltered = !!(dbVendor || dbFrom || dbTo);

  const [
    { data: companies },
    { data: parties },
    { data: stores },
    { data: currencies },
    { data: recentCreditNotes },
    { data: recentDebitNotes },
    { data: recentWashingEntries },
    { data: recentInternalInvoices },
    { data: recentPurchaseBills },
    { data: recentFreightBills },
    { data: recentDutyBills },
    { data: recentCsbFilings },
    { data: recentShipmentChalans },
  ] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    // 2026-08-12 (round 10): invoice_type/party_type added so the party
    // dropdown can group "Purchase" vendors separately from "Courier"
    // parties — see documents/party-options.ts. The list itself was
    // already unfiltered (every form gets every party); the ask was
    // findability, not access ("DEBIT NOTE ME PARTY SELECTION ME ONLY
    // PURCHASE PARTY AARI HAI" turned out to mean "hard to find the
    // courier in a long flat list", not an actual code filter).
    supabase.from("parties").select("id, name, invoice_type, party_type").order("name"),
    supabase.from("stores").select("id, name, company_id").order("name"),
    supabase.from("currencies").select("code, name").order("code"),
    // 2026-08-17 fix — same bug/fix as Party Ledger / Bill Payment: these 5
    // "Recent" lists had NO company filter at all (worse than the
    // companyIds bug — RLS here is USING (true), so app-level filtering is
    // the only boundary), meaning every employee with doc_entry access saw
    // every company's Credit Notes / Debit Notes / Washing Entries /
    // Internal Invoices / Purchase Bills mixed together regardless of the
    // top-nav company switcher. Now scoped to employee.currentCompanyId,
    // matching every other doc type on this page and every other fixed
    // "Recent" list elsewhere in the app. (freight_bills / duty_tax_bills /
    // csb_filings genuinely have no company_id column — those registers
    // are standalone by design, see db/schema.sql — so they're unchanged.)
    supabase
      .from("credit_notes")
      .select(
        "id, cn_no, company_id, store_id, credit_note_date, item_id, buyer_name, refund_date, item_name, item_price, invoice_no, invoice_value_usd, invoice_value_inr, refund_amount, refund_amt_usd, refund_amt_inr, credit_note_status, refund_type, remark"
      )
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("debit_notes")
      .select(
        "id, debit_note_no, debit_note_date, company_id, party_id, against_invoice_bill_no, particulars, bill_no, bill_date, sq_ft, qty, rate, debit_amount, remark"
      )
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("washing_entries")
      .select("id, chalan_no, chalan_date, company_id, party_id, store_id, item_size, pcs, sq_mtr_ft, rate, debit_charges, amount")
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("internal_invoices")
      .select("id, invoice_no, invoice_date, from_company_id, to_company_id, description, qty, rate, remark, total_amount")
      // company_id on this table is set to from_company_id by its own
      // insert trigger (db/schema.sql) — "invoices issued BY the currently
      // selected company", the natural match for a per-company Doc Entry
      // recent list.
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
    (() => {
      let query = supabase
        .from("purchase_bills")
        .select(
          "id, company_id, vendor_party_id, vendor_invoice_no, vendor_invoice_date, qty, sq_feet, qty_unit, work_description, unit_rate, total_amount, gst_rate_pct, gst_type, round_off_amt, g_total_plus_gst"
        )
        .eq("company_id", employee.currentCompanyId)
        .order("created_at", { ascending: false })
        .limit(pbFiltered ? FILTERED_LIMIT : 8);
      if (pbVendor) query = query.eq("vendor_party_id", pbVendor);
      if (pbFrom) query = query.gte("vendor_invoice_date", pbFrom);
      if (pbTo) query = query.lte("vendor_invoice_date", pbTo);
      return query;
    })(),
    (() => {
      let query = supabase
        .from("freight_bills")
        .select(
          "id, invoice_no, invoice_date, bill_weight_kg, freight_amt, fuel_amt, other_charges, total_amt, gst_18pct_amt, gross_total_amt, credit_note_no, credit_note_date, credit_note_amt, vendor_party_id"
        )
        .order("created_at", { ascending: false })
        .limit(fbFiltered ? FILTERED_LIMIT : 8);
      if (fbVendor) query = query.eq("vendor_party_id", fbVendor);
      if (fbFrom) query = query.gte("invoice_date", fbFrom);
      if (fbTo) query = query.lte("invoice_date", fbTo);
      return query;
    })(),
    (() => {
      let query = supabase
        .from("duty_tax_bills")
        .select(
          "id, invoice_no, invoice_date, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, gross_total_amt, credit_note_no, credit_note_date, credit_note_amt, disbursement_fee, courier_duty_charges_adj, total_payable_amt, vendor_party_id"
        )
        .order("created_at", { ascending: false })
        .limit(dbFiltered ? FILTERED_LIMIT : 8);
      if (dbVendor) query = query.eq("vendor_party_id", dbVendor);
      if (dbFrom) query = query.gte("invoice_date", dbFrom);
      if (dbTo) query = query.lte("invoice_date", dbTo);
      return query;
    })(),
    supabase
      .from("csb_filings")
      .select(
        "id, csb_number, exchange_rate, total_taxable_value, taxable_value_currency, fob_value_inr, filing_date, egm_number, egm_date, hawb_number, invoice_no, invoice_date"
      )
      .order("created_at", { ascending: false })
      .limit(8),
    // 2026-08-17 — Shipment Handover Chalan (see actions.ts's
    // createShipmentHandoverChalan): "AAJ FEDEX 5 SHIPMENT DI TO USKA BHI
    // CHALAN KATE". Scoped to the CURRENTLY SELECTED company (not every
    // company the login can access) — same currentCompanyId fix as the 5
    // lists above, applied here from the start since this table is also
    // new this session.
    supabase
      .from("shipment_handover_chalans")
      .select("id, chalan_no, chalan_date, company_id, courier_party_id, remark")
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  // Courier Bill / Duty & Tax Bill assignments + the order ref_no's they
  // point at — fetched separately since freight_bill_awb_assignments /
  // duty_bill_awb_assignments only hold order_id, not the human-readable
  // PO/RF/RG number.
  const freightBillIds = (recentFreightBills ?? []).map((b) => b.id);
  const dutyBillIds = (recentDutyBills ?? []).map((b) => b.id);
  const [{ data: freightAssignments }, { data: dutyAssignments }, { data: financeLinks }] = await Promise.all([
    freightBillIds.length
      ? supabase
          .from("freight_bill_awb_assignments")
          .select(
            "id, freight_bill_id, order_id, bill_weight_kg, dimensional_weight_kg, difference_amt, credit_note_no, credit_note_date, credit_note_amt, debit_note_no, debit_note_date, debit_note_amt, remark"
          )
          .in("freight_bill_id", freightBillIds)
      : Promise.resolve({ data: [] }),
    dutyBillIds.length
      ? supabase
          .from("duty_bill_awb_assignments")
          .select(
            "id, duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, other_charge, gst_18pct, credit_note_no, credit_note_date, credit_note_amt, debit_note_no, debit_note_date, debit_note_amt, remark"
          )
          .in("duty_tax_bill_id", dutyBillIds)
      : Promise.resolve({ data: [] }),
    // 2026-08-12 (round 10): which of these bills already have a "Send to
    // Bill Pass Register" entry, so the button can hide/grey out instead
    // of allowing a double-post.
    freightBillIds.length || dutyBillIds.length
      ? supabase
          .from("bill_pass_register")
          .select("source, source_id")
          .in("source", ["freight_bill", "duty_tax_bill"])
          .in("source_id", [...freightBillIds, ...dutyBillIds])
      : Promise.resolve({ data: [] }),
  ]);
  const sentFreightBillIds = new Set((financeLinks ?? []).filter((f) => f.source === "freight_bill").map((f) => f.source_id));
  const sentDutyBillIds = new Set((financeLinks ?? []).filter((f) => f.source === "duty_tax_bill").map((f) => f.source_id));

  const assignmentOrderIds = Array.from(
    new Set([...(freightAssignments ?? []).map((a) => a.order_id), ...(dutyAssignments ?? []).map((a) => a.order_id)])
  );
  const { data: assignmentOrders } = assignmentOrderIds.length
    ? await supabase.from("orders").select("id, ref_no").in("id", assignmentOrderIds)
    : { data: [] };
  const orderRefNo = new Map((assignmentOrders ?? []).map((o) => [o.id, o.ref_no]));

  // Shipment Handover Chalan lines — same "fetch header, then its lines by
  // chalan_id" shape as Material OUT Chalan (stock/page.tsx), joined back
  // to the order's own ref_no for a human-readable list.
  const shipmentChalanIds = (recentShipmentChalans ?? []).map((c) => c.id);
  const { data: shipmentChalanLines } = shipmentChalanIds.length
    ? await supabase
        .from("shipment_handover_chalan_lines")
        .select("chalan_id, order_id, orders(ref_no)")
        .in("chalan_id", shipmentChalanIds)
    : { data: [] as { chalan_id: string; order_id: string; orders: { ref_no: string } | { ref_no: string }[] | null }[] };
  const shipmentChalanRows = (recentShipmentChalans ?? []).map((c) => ({
    id: c.id,
    chalan_no: c.chalan_no,
    chalan_date: c.chalan_date,
    remark: c.remark,
    courierName: partyName.get(c.courier_party_id) ?? "—",
    lines: (shipmentChalanLines ?? [])
      .filter((l) => l.chalan_id === c.id)
      .map((l) => {
        const o = l.orders;
        const refNo = Array.isArray(o) ? o[0]?.ref_no : o?.ref_no;
        return refNo ?? "—";
      }),
  }));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Document Entry</h1>
          <p className="mt-1 text-sm text-slate-500">
            Credit Note, Debit Note, Washing Entry, Internal Invoice, Purchase Bill, Courier Bill, Duty &amp; Tax
            Bill — entering a PO/RF/RG (or AWB) number automatically fetches the order, so every document stays
            linked back to it.
          </p>
        </div>
        <Link
          href="/dashboard/documents/bulk-upload"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          📤 Bulk Upload (CSV)
        </Link>
      </div>

      <DocumentEntryTabs
        companies={companies ?? []}
        parties={parties ?? []}
        stores={stores ?? []}
        currencies={currencies ?? []}
        recent={{
          creditNotes: (recentCreditNotes ?? []).map((r) => ({
            ...r,
            item_price: r.item_price != null ? Number(r.item_price) : null,
            invoice_value_usd: r.invoice_value_usd != null ? Number(r.invoice_value_usd) : null,
            invoice_value_inr: r.invoice_value_inr != null ? Number(r.invoice_value_inr) : null,
            refund_amount: Number(r.refund_amount),
            refund_amt_usd: r.refund_amt_usd != null ? Number(r.refund_amt_usd) : null,
            refund_amt_inr: r.refund_amt_inr != null ? Number(r.refund_amt_inr) : null,
            companyName: companyName.get(r.company_id) ?? "",
          })),
          debitNotes: (recentDebitNotes ?? []).map((r) => ({
            ...r,
            sq_ft: r.sq_ft != null ? Number(r.sq_ft) : null,
            rate: r.rate != null ? Number(r.rate) : null,
            debit_amount: Number(r.debit_amount),
            companyName: companyName.get(r.company_id) ?? "",
          })),
          washingEntries: (recentWashingEntries ?? []).map((r) => ({
            ...r,
            sq_mtr_ft: r.sq_mtr_ft != null ? Number(r.sq_mtr_ft) : null,
            rate: r.rate != null ? Number(r.rate) : null,
            debit_charges: r.debit_charges != null ? Number(r.debit_charges) : null,
            amount: Number(r.amount ?? 0),
            companyName: companyName.get(r.company_id) ?? "",
          })),
          internalInvoices: (recentInternalInvoices ?? []).map((r) => ({
            ...r,
            qty: Number(r.qty),
            rate: Number(r.rate),
            total_amount: Number(r.total_amount),
            fromCompanyName: companyName.get(r.from_company_id) ?? "",
            toCompanyName: companyName.get(r.to_company_id) ?? "",
          })),
          purchaseBills: (recentPurchaseBills ?? []).map((r) => ({
            ...r,
            qty: Number(r.qty),
            sq_feet: Number(r.sq_feet),
            unit_rate: Number(r.unit_rate),
            total_amount: Number(r.total_amount ?? 0),
            gst_rate_pct: r.gst_rate_pct != null ? Number(r.gst_rate_pct) : null,
            round_off_amt: Number(r.round_off_amt ?? 0),
            g_total_plus_gst: r.g_total_plus_gst != null ? Number(r.g_total_plus_gst) : null,
            vendorName: partyName.get(r.vendor_party_id) ?? "",
          })),
          csbFilings: (recentCsbFilings ?? []).map((r) => ({
            ...r,
            exchange_rate: r.exchange_rate != null ? Number(r.exchange_rate) : null,
            total_taxable_value: r.total_taxable_value != null ? Number(r.total_taxable_value) : null,
            fob_value_inr: r.fob_value_inr != null ? Number(r.fob_value_inr) : null,
          })),
          freightBills: (recentFreightBills ?? []).map((b) => ({
            ...b,
            freight_amt: Number(b.freight_amt),
            fuel_amt: Number(b.fuel_amt),
            other_charges: Number(b.other_charges),
            total_amt: b.total_amt != null ? Number(b.total_amt) : null,
            gst_18pct_amt: b.gst_18pct_amt != null ? Number(b.gst_18pct_amt) : null,
            gross_total_amt: b.gross_total_amt != null ? Number(b.gross_total_amt) : null,
            credit_note_amt: Number(b.credit_note_amt ?? 0),
            sentToFinance: sentFreightBillIds.has(b.id),
            vendor_party_id: b.vendor_party_id,
            vendor_name: b.vendor_party_id ? partyName.get(b.vendor_party_id) ?? null : null,
            assignments: (freightAssignments ?? [])
              .filter((a) => a.freight_bill_id === b.id)
              .map((a) => ({
                id: a.id,
                order_ref_no: orderRefNo.get(a.order_id) ?? "—",
                bill_weight_kg: a.bill_weight_kg != null ? Number(a.bill_weight_kg) : null,
                dimensional_weight_kg: a.dimensional_weight_kg != null ? Number(a.dimensional_weight_kg) : null,
                difference_amt: a.difference_amt != null ? Number(a.difference_amt) : null,
                credit_note_no: a.credit_note_no,
                credit_note_date: a.credit_note_date,
                credit_note_amt: a.credit_note_amt != null ? Number(a.credit_note_amt) : null,
                debit_note_no: a.debit_note_no,
                debit_note_date: a.debit_note_date,
                debit_note_amt: a.debit_note_amt != null ? Number(a.debit_note_amt) : null,
                remark: a.remark,
              })),
          })),
          dutyBills: (recentDutyBills ?? []).map((b) => ({
            ...b,
            duty_tax_amt_usd: b.duty_tax_amt_usd != null ? Number(b.duty_tax_amt_usd) : null,
            duty_tax_amt_inr: Number(b.duty_tax_amt_inr),
            gst_18pct_amt: Number(b.gst_18pct_amt),
            gross_total_amt: b.gross_total_amt != null ? Number(b.gross_total_amt) : null,
            credit_note_amt: Number(b.credit_note_amt ?? 0),
            disbursement_fee: Number(b.disbursement_fee ?? 0),
            courier_duty_charges_adj: Number(b.courier_duty_charges_adj ?? 0),
            total_payable_amt: b.total_payable_amt != null ? Number(b.total_payable_amt) : null,
            sentToFinance: sentDutyBillIds.has(b.id),
            vendor_party_id: b.vendor_party_id,
            vendor_name: b.vendor_party_id ? partyName.get(b.vendor_party_id) ?? null : null,
            assignments: (dutyAssignments ?? [])
              .filter((a) => a.duty_tax_bill_id === b.id)
              .map((a) => ({
                id: a.id,
                order_ref_no: orderRefNo.get(a.order_id) ?? "—",
                duty_tax_amt_usd: a.duty_tax_amt_usd != null ? Number(a.duty_tax_amt_usd) : null,
                duty_tax_amt_inr: a.duty_tax_amt_inr != null ? Number(a.duty_tax_amt_inr) : null,
                other_charge: a.other_charge != null ? Number(a.other_charge) : null,
                gst_18pct: a.gst_18pct != null ? Number(a.gst_18pct) : null,
                credit_note_no: a.credit_note_no,
                credit_note_date: a.credit_note_date,
                credit_note_amt: a.credit_note_amt != null ? Number(a.credit_note_amt) : null,
                debit_note_no: a.debit_note_no,
                debit_note_date: a.debit_note_date,
                debit_note_amt: a.debit_note_amt != null ? Number(a.debit_note_amt) : null,
                remark: a.remark,
              })),
          })),
        }}
        shipmentChalans={shipmentChalanRows}
        initialTab={initialTab}
        billFilters={{
          purchaseBill: { vendor: pbVendor, from: pbFrom, to: pbTo },
          freightBill: { vendor: fbVendor, from: fbFrom, to: fbTo },
          dutyBill: { vendor: dbVendor, from: dbFrom, to: dbTo },
        }}
      />
    </div>
  );
}
