import Link from "next/link";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { DocumentEntryTabs } from "./document-entry-tabs";
import { listRelatedNotesForBills } from "./actions";
import { groupPurchaseBillInvoices } from "@/lib/bill-grouping";
import { purchaseBillGrandTotal } from "@/lib/purchase-bill-money";

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
    { data: recentJournalVouchers },
    { data: recentReceivedChalans },
    { data: allWashingEntriesForTotal },
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
      // 2026-10-29 — '*' not a column list: round_off_amt arrives with
      // db/2026-10-29-round-off-all-documents.sql, and naming one column a
      // database hasn't got yet makes PostgREST reject the WHOLE query — which
      // would silently empty this "Recent …" list on an un-migrated DB (same
      // reasoning as the washing_entries query below).
      .select("*")
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("debit_notes")
      // 2026-10-29 — '*' not a column list: round_off_amt arrives with
      // db/2026-10-29-round-off-all-documents.sql, and naming one column a
      // database hasn't got yet makes PostgREST reject the WHOLE query — which
      // would silently empty this "Recent …" list on an un-migrated DB (same
      // reasoning as the washing_entries query below).
      .select("*")
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
    // 2026-10-24 — `*` instead of a column list: round_off_amt arrives with
    // db/2026-10-24b-…, and naming one column the database hasn't got yet
    // makes PostgREST reject the WHOLE query — which silently emptied this
    // "Recent Washing Entries" list (and its total) on an un-migrated DB.
    supabase
      .from("washing_entries")
      .select("*")
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("internal_invoices")
      // 2026-10-29 — '*' not a column list: round_off_amt arrives with
      // db/2026-10-29-round-off-all-documents.sql, and naming one column a
      // database hasn't got yet makes PostgREST reject the WHOLE query — which
      // would silently empty this "Recent …" list on an un-migrated DB (same
      // reasoning as the washing_entries query below).
      .select("*")
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
        // 2026-10-21 — deliberately "*" instead of a column list. This list
        // now reads audit columns added by newer migrations
        // (created_at/updated_at from 2026-10-20, entered_by_* from
        // 2026-10-21); naming them explicitly would make the ENTIRE Purchase
        // Bill list error out — showing nothing at all — on a database where
        // one of those SQL files has not been run yet. "*" returns whatever
        // columns exist, and every field below already has a null fallback,
        // so an un-run migration degrades one line of text instead of the
        // whole register. The Admin's Schema Status card says which file.
        .select("*")
        .eq("company_id", employee.currentCompanyId)
        .order("created_at", { ascending: false })
        // 2026-10-20 — was limit(8) ROWS: fine while every row was its own
        // card, but a single 6-item invoice could eat 6 of those 8 slots and
        // the list is now grouped into ONE card per invoice (see
        // groupPurchaseBillInvoices). Fetch enough rows to fill the same
        // "recent 8 invoices" the user used to see, then cap by GROUP below.
        .limit(pbFiltered ? FILTERED_LIMIT * 5 : 400);
      if (pbVendor) query = query.eq("vendor_party_id", pbVendor);
      if (pbFrom) query = query.gte("vendor_invoice_date", pbFrom);
      if (pbTo) query = query.lte("vendor_invoice_date", pbTo);
      return query;
    })(),
    (() => {
      let query = supabase
        // 2026-10-24 — `*`: round_off_amt arrives with db/2026-10-24b-…. A
        // named-but-missing column rejects the whole query, which silently
        // emptied the entire Courier Bill section of Document Entry instead
        // of just zeroing the round-off line. Every field read below has a
        // null fallback.
        .from("freight_bills")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(fbFiltered ? FILTERED_LIMIT : 8);
      if (fbVendor) query = query.eq("vendor_party_id", fbVendor);
      if (fbFrom) query = query.gte("invoice_date", fbFrom);
      if (fbTo) query = query.lte("invoice_date", fbTo);
      return query;
    })(),
    (() => {
      let query = supabase
        // 2026-10-24 — `*` for the same reason as freight_bills above
        // (round_off_amt from db/2026-10-24b-…): one missing column used to
        // blank this whole Duty & Tax section.
        .from("duty_tax_bills")
        .select("*")
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
    // 2026-08-29 (evening) — Journal Voucher (see actions.ts's
    // createJournalVoucherForBill / saveJournalVoucherCore's header
    // comment for the full "why"). Scoped to the currently selected
    // company, same as every other "Recent" list above.
    supabase
      .from("journal_vouchers")
      // 2026-10-29 — '*' not a column list: round_off_amt arrives with
      // db/2026-10-29-round-off-all-documents.sql, and naming one column a
      // database hasn't got yet makes PostgREST reject the WHOLE query — which
      // would silently empty this "Recent …" list on an un-migrated DB (same
      // reasoning as the washing_entries query below).
      .select("*")
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
    // 2026-08-29 (evening, follow-up round) — Received Chalan (see
    // actions.ts's createReceivedChalanForBillGroup / createReceivedChalanManual
    // header comments). Scoped to the currently selected company, same as
    // every other "Recent" list above.
    supabase
      .from("received_chalans")
      .select("id, chalan_no, chalan_date, company_id, party_id, order_id, source, remark")
      .eq("company_id", employee.currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(8),
    // 2026-09-17 (evening) — "jitni bhi report hai un sabhi me total aana
      // chahiye ... kitne order hai unki value kitni hai vahi par sahi se
      // total hokar aaye": the "Recent Washing Entries" list above is
      // capped to 8 rows, so a total computed from just those 8 would be
      // wrong and wouldn't tie out to the CRM P&L's "Washing Chalans"
      // expense line (which sums ALL of this company's washing entries).
      // This is a SEPARATE unlimited query, just the 2 numeric columns
      // (amount, debit_charges — same fields the P&L view sums), so the
      // "Total" line shown under the list actually matches the P&L number.
    supabase
      .from("washing_entries")
      .select("amount, debit_charges")
      .eq("company_id", employee.currentCompanyId),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  // 2026-09-17 (evening) — full-history total for Washing Entries (see the
  // query's own comment above) — same "amount + debit_charges" sum the P&L
  // view's washing_agg CTE uses (db/2026-09-17-pl-cn-allocation-and-portal-
  // real.sql), so this number should match the P&L drill-down exactly.
  const washingEntriesTotal = {
    count: (allWashingEntriesForTotal ?? []).length,
    amount: (allWashingEntriesForTotal ?? []).reduce((s, r) => s + Number(r.amount ?? 0) + Number(r.debit_charges ?? 0), 0),
  };

  // Courier Bill / Duty & Tax Bill assignments + the order ref_no's they
  // point at — fetched separately since freight_bill_awb_assignments /
  // duty_bill_awb_assignments only hold order_id, not the human-readable
  // PO/RF/RG number.
  const freightBillIds = (recentFreightBills ?? []).map((b) => b.id);
  const dutyBillIds = (recentDutyBills ?? []).map((b) => b.id);
  const purchaseBillIds = (recentPurchaseBills ?? []).map((b) => b.id);
  const [{ data: freightAssignments }, { data: dutyAssignments }, { data: financeLinks }, { data: purchaseFinanceLinks }] = await Promise.all([
    freightBillIds.length
      ? supabase
          .from("freight_bill_awb_assignments")
          .select(
            // 2026-09-01: order_shipment_id + billed_freight_amt added — the
            // booking-cost-vs-billed-cost recheck (see
            // db/2026-09-01-multi-courier-booking-and-freight-recon.sql).
            // 2026-10-24b: billed_base/fuel/remote/other + billed_gst_amt come
            // along too — the bill card and each AWB row now show that
            // parcel's own GST and total ("PER-AWB GST FORM PAR DIKHE").
            // 2026-10-24 — `*`: the billed_* breakup columns arrive with
            // newer one-time SQL files (2026-09-21, 2026-10-24b per-AWB GST),
            // and naming one that a database hasn't got yet rejects the WHOLE
            // query — which silently removed every AWB row from these Courier
            // Bill cards. `*` returns whatever exists; each field below has a
            // null fallback.
            "*"
          )
          .in("freight_bill_id", freightBillIds)
      : Promise.resolve({ data: [] }),
    dutyBillIds.length
      ? supabase
          .from("duty_bill_awb_assignments")
          // 2026-10-28e — `*` for the same reason as the freight select above:
          // round_off_amt only exists once db/2026-10-28e-awb-round-off.sql has
          // been run, and naming a missing column rejects the whole query (all
          // AWB rows would disappear from the Duty Bill cards).
          .select("*")
          .in("duty_tax_bill_id", dutyBillIds)
      : Promise.resolve({ data: [] }),
    // 2026-08-12 (round 10): which of these bills already have a "Send to
    // Bill Pass Register" entry, so the button can hide/grey out instead
    // of allowing a double-post.
    // 2026-08-27 (later same day): `id` added too — Credit/Debit Notes link
    // to a specific bill_pass_register ROW (debit_notes.bill_pass_register_id
    // etc.), not to the freight_bill/duty_tax_bill row itself, so this id
    // is what listRelatedNotesForBills below actually needs.
    freightBillIds.length || dutyBillIds.length
      ? supabase
          .from("bill_pass_register")
          .select("id, source, source_id, company_id")
          .in("source", ["freight_bill", "duty_tax_bill"])
          .in("source_id", [...freightBillIds, ...dutyBillIds])
      : Promise.resolve({ data: [] }),
    purchaseBillIds.length
      ? supabase
          .from("bill_pass_register")
          .select("id, source_id, company_id, total_amt, merged_into_bill_id")
          .eq("source", "purchase_bill")
          .in("source_id", purchaseBillIds)
      : Promise.resolve({ data: [] }),
  ]);
  const sentFreightBillIds = new Set((financeLinks ?? []).filter((f) => f.source === "freight_bill").map((f) => f.source_id));
  const sentDutyBillIds = new Set((financeLinks ?? []).filter((f) => f.source === "duty_tax_bill").map((f) => f.source_id));
  // 2026-10-29 — the Finance entry's company, so a posted bill can be moved to
  // the right company from the bill card itself (see FinanceCompanyMover).
  const financeLinkBySourceId = new Map((financeLinks ?? []).map((f) => [`${f.source}:${f.source_id}`, f]));

  // 2026-09-01: booked_freight_amt for every freight-bill assignment's
  // order_shipment — the "recheck" comparison shown alongside
  // billed_freight_amt below. One batched query, not per-row.
  const freightShipmentIds = Array.from(new Set((freightAssignments ?? []).map((a) => a.order_shipment_id).filter((v): v is string => !!v)));

  // 2026-08-27 (later same day) — "purchase bill ho ya kisi bhi party ka
  // bill ho ... credite note ya debit note agar us invoice se related ho
  // to vaha dikhna cahiye sath hi link bhi hona chahiye": ONE batched
  // listRelatedNotesForBills call covering every Purchase Bill/Courier
  // Bill/Duty & Tax Bill on this page (never per-row — see that function's
  // own comment), keyed back to each bill's own id via its
  // bill_pass_register row (source_id -> bill_pass_register.id map).
  const bprIdByFreightBillId = new Map((financeLinks ?? []).filter((f) => f.source === "freight_bill").map((f) => [f.source_id, f.id]));
  const bprIdByDutyBillId = new Map((financeLinks ?? []).filter((f) => f.source === "duty_tax_bill").map((f) => [f.source_id, f.id]));
  // 2026-11-01 — only LIVE ledger rows count as "in Finance". A merged
  // duplicate is kept for audit with its amount zeroed, so treating it as
  // booked made a wrongly-merged invoice read as fully sent while the ledger
  // stayed short ("11,482.80 dikha raha jabki aana 18,460 chahiye"). Live
  // rows only → the card sees the missing slice and can send it.
  const livePurchaseFinanceLinks = (purchaseFinanceLinks ?? []).filter((f) => !f.merged_into_bill_id);
  const bprIdByPurchaseBillId = new Map(livePurchaseFinanceLinks.map((f) => [f.source_id, f.id]));
  // 2026-10-29 — which company holds each sent invoice in the Finance ledger
  // (the Send-to-Finance box shows it and offers to move it).
  const bprCompanyByPurchaseBillId = new Map(livePurchaseFinanceLinks.map((f) => [f.source_id, f.company_id]));
  const bprAmountByPurchaseBillId = new Map(livePurchaseFinanceLinks.map((f) => [f.source_id, Number(f.total_amt ?? 0)]));
  // 2026-11-01 — how much of each item actually reached the Finance ledger.
  // "Invoice 88 ka 18,460 aana chahiye tha, ledger me 11,482.80 hai": the
  // invoice's items were posted in pieces (6 items booked, 5 never), and the
  // Send-to-Finance box treated ANY posted item as "sent", so the rest could
  // never be posted and the ledger stayed short. The box now knows the
  // covered amount per item and can send the remainder.
  const allBprIds = [
    ...bprIdByFreightBillId.values(),
    ...bprIdByDutyBillId.values(),
    ...bprIdByPurchaseBillId.values(),
  ];

  const assignmentOrderIds = Array.from(
    new Set([...(freightAssignments ?? []).map((a) => a.order_id), ...(dutyAssignments ?? []).map((a) => a.order_id)])
  );

  // Shipment Handover Chalan lines — same "fetch header, then its lines by
  // chalan_id" shape as Material OUT Chalan (stock/page.tsx), joined back
  // to the order's own ref_no for a human-readable list.
  const shipmentChalanIds = (recentShipmentChalans ?? []).map((c) => c.id);

  // 2026-09-19 (audit fix, item C4) — these 4 lookups are independent of
  // each other (each depends only on ids already resolved above, from the
  // earlier Promise.all block), so they were needlessly running one after
  // another instead of concurrently — same latency-cost pattern already
  // fixed for received_chalan_items/orders further down in this same file.
  const [{ data: bookedShipmentRows }, relatedNotesForBills, { data: assignmentOrders }, { data: shipmentChalanLines }] = await Promise.all([
    freightShipmentIds.length
      ? supabase.from("order_shipments").select("id, booked_freight_amt, booked_currency, booked_amount_source").in("id", freightShipmentIds)
      : Promise.resolve({ data: [] }),
    listRelatedNotesForBills(allBprIds),
    assignmentOrderIds.length
      ? supabase.from("orders").select("id, ref_no").in("id", assignmentOrderIds)
      : Promise.resolve({ data: [] }),
    shipmentChalanIds.length
      ? supabase
          .from("shipment_handover_chalan_lines")
          .select("chalan_id, order_id, orders(ref_no)")
          .in("chalan_id", shipmentChalanIds)
      : Promise.resolve({ data: [] as { chalan_id: string; order_id: string; orders: { ref_no: string } | { ref_no: string }[] | null }[] }),
  ]);
  const bookedById = new Map((bookedShipmentRows ?? []).map((r) => [r.id, r]));
  const notesByBprId = new Map<string, typeof relatedNotesForBills>();
  for (const n of relatedNotesForBills) {
    const list = notesByBprId.get(n.billPassRegisterId) ?? [];
    list.push(n);
    notesByBprId.set(n.billPassRegisterId, list);
  }
  function notesFor(bprId: string | undefined) {
    return bprId ? notesByBprId.get(bprId) ?? [] : [];
  }
  const orderRefNo = new Map((assignmentOrders ?? []).map((o) => [o.id, o.ref_no]));
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

  // Received Chalan items + optional order ref_no — same "fetch header,
  // then its children by chalan_id" shape as Shipment Handover Chalan above.
  const receivedChalanIds = (recentReceivedChalans ?? []).map((c) => c.id);
  const receivedChalanOrderIds = Array.from(
    new Set((recentReceivedChalans ?? []).map((c) => c.order_id).filter((id): id is string => !!id))
  );
  const [{ data: receivedChalanItems }, { data: receivedChalanOrders }] = await Promise.all([
    receivedChalanIds.length
      ? supabase.from("received_chalan_items").select("chalan_id, description, qty, qty_unit").in("chalan_id", receivedChalanIds)
      : Promise.resolve({ data: [] as { chalan_id: string; description: string; qty: number; qty_unit: string }[] }),
    receivedChalanOrderIds.length
      ? supabase.from("orders").select("id, ref_no").in("id", receivedChalanOrderIds)
      : Promise.resolve({ data: [] as { id: string; ref_no: string }[] }),
  ]);
  const receivedChalanOrderRefNo = new Map((receivedChalanOrders ?? []).map((o) => [o.id, o.ref_no]));
  // 2026-10-20 — Document Entry → Purchase Bill is now ONE entry per vendor
  // invoice, expandable to its item rows (see src/lib/bill-grouping.ts's
  // groupPurchaseBillInvoices and document-entry-tabs.tsx's
  // PurchaseBillInvoiceList). Money comes from src/lib/purchase-bill-money.ts
  // so the card, the A4 sheet and Bill Payment can never disagree again.
  const purchaseBillInvoices = groupPurchaseBillInvoices(
    (recentPurchaseBills ?? []).map((r) => ({
      ...r,
      qty: Number(r.qty),
      sq_feet: Number(r.sq_feet),
      unit_rate: Number(r.unit_rate),
      total_amount: Number(r.total_amount ?? 0),
      // 0 = explicitly "No GST" (db/2026-10-20-...sql); the historical 5%
      // fallback only applies to a NULL from before the GST picker existed.
      // Collapsed back to null for the UI: the picker's "No GST" option IS
      // the empty value, and the money helpers treat both the same. The
      // stored total (g_total_plus_gst) is what every amount reads, so this
      // mapping can never change a rupee.
      gst_rate_pct: r.gst_rate_pct != null && Number(r.gst_rate_pct) > 0 ? Number(r.gst_rate_pct) : null,
      round_off_amt: Number(r.round_off_amt ?? 0),
      g_total_plus_gst: r.g_total_plus_gst != null ? Number(r.g_total_plus_gst) : null,
      vendorName: partyName.get(r.vendor_party_id) ?? "",
      // 2026-10-21 — "kisne entry ki": undefined (rather than null) when the
      // column does not exist yet, so `?? null` covers the un-migrated case.
      entered_by_name: r.entered_by_name ?? null,
      related_notes: notesFor(bprIdByPurchaseBillId.get(r.id)),
      finance_bpr_id: bprIdByPurchaseBillId.get(r.id) ?? null,
    }))
  )
    .map((g) => ({
      ...g,
      vendorName: partyName.get(g.vendor_party_id) ?? "",
      // 2026-10-28 — the per-invoice Debit Note shortcut needs these (see
      // document-entry-tabs.tsx); both already came through the group.
      companyId: g.company_id,
      vendorPartyId: g.vendor_party_id,
      // One invoice can be entered by one person (the normal case, all items
      // share the stamp). If a later item was added by someone else, the
      // per-item line inside "▸ Items" still names them individually.
      enteredByName: g.items.find((i) => i.entered_by_name)?.entered_by_name ?? null,
      taxableTotal: g.items.reduce((s, i) => s + Number(i.total_amount ?? 0), 0),
      grandTotal: g.items.reduce((s, i) => s + purchaseBillGrandTotal(i), 0),
      // First sent-to-Finance row drives the statement sheet; an invoice is
      // one bill_pass_register group there (see lib/bill-grouping.ts).
      finance_bpr_id: g.items.find((i) => i.finance_bpr_id)?.finance_bpr_id ?? null,
      financeCompanyId: (() => {
        const item = g.items.find((i) => i.finance_bpr_id);
        return item ? bprCompanyByPurchaseBillId.get(item.id) ?? null : null;
      })(),
      // 2026-11-01 — partial coverage, so the card can offer "send the rest"
      // instead of claiming the whole invoice is already booked.
      financePostedCount: g.items.filter((i) => i.finance_bpr_id).length,
      financePostedTotal: g.items.reduce((s, i) => s + (i.finance_bpr_id ? Number(bprAmountByPurchaseBillId.get(i.id) ?? 0) : 0), 0),
      notes: g.items.flatMap((i) => i.related_notes),
    }))
    .slice(0, pbFiltered ? FILTERED_LIMIT : 8);

  const receivedChalanRows = (recentReceivedChalans ?? []).map((c) => ({
    id: c.id,
    chalan_no: c.chalan_no,
    chalan_date: c.chalan_date,
    source: c.source,
    remark: c.remark,
    partyName: partyName.get(c.party_id) ?? "—",
    orderRefNo: c.order_id ? receivedChalanOrderRefNo.get(c.order_id) ?? null : null,
    items: (receivedChalanItems ?? [])
      .filter((it) => it.chalan_id === c.id)
      .map((it) => ({ description: it.description, qty: Number(it.qty), qty_unit: it.qty_unit })),
  }));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Document Entry</h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* 2026-10-15 — Unified Printing register: the printing job-work
              picture (material out / received back / printing bills) spans
              Documents AND Stock, so both headers link it. */}
          <Link
            href="/dashboard/printing-register"
            className="rounded-lg border border-fuchsia-300 bg-fuchsia-50 px-3 py-1.5 text-xs font-medium text-fuchsia-700 hover:bg-fuchsia-100"
          >
            🖨️ Printing Register
          </Link>
          <Link
            href="/dashboard/documents/bulk-upload"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            📤 Bulk Upload (CSV)
          </Link>
        </div>
      </div>

      <DocumentEntryTabs
        companies={companies ?? []}
        parties={parties ?? []}
        stores={stores ?? []}
        currencies={currencies ?? []}
        washingEntriesTotal={washingEntriesTotal}
        recent={{
          creditNotes: (recentCreditNotes ?? []).map((r) => ({
            ...r,
            item_price: r.item_price != null ? Number(r.item_price) : null,
            invoice_value_usd: r.invoice_value_usd != null ? Number(r.invoice_value_usd) : null,
            invoice_value_inr: r.invoice_value_inr != null ? Number(r.invoice_value_inr) : null,
            refund_amount: Number(r.refund_amount),
            round_off_amt: Number(r.round_off_amt ?? 0),
            refund_amt_usd: r.refund_amt_usd != null ? Number(r.refund_amt_usd) : null,
            refund_amt_inr: r.refund_amt_inr != null ? Number(r.refund_amt_inr) : null,
            // 2026-08-29 — Rate Difference Calculator reference fields
            // (vendor-side/Party notes only — see
            // db/2026-08-29-credit-note-rate-difference.sql).
            qty: r.qty != null ? Number(r.qty) : null,
            po_rate: r.po_rate != null ? Number(r.po_rate) : null,
            billed_rate: r.billed_rate != null ? Number(r.billed_rate) : null,
            companyName: companyName.get(r.company_id) ?? "",
          })),
          debitNotes: (recentDebitNotes ?? []).map((r) => ({
            ...r,
            sq_ft: r.sq_ft != null ? Number(r.sq_ft) : null,
            rate: r.rate != null ? Number(r.rate) : null,
            po_rate: r.po_rate != null ? Number(r.po_rate) : null,
            billed_rate: r.billed_rate != null ? Number(r.billed_rate) : null,
            debit_amount: Number(r.debit_amount),
            round_off_amt: Number(r.round_off_amt ?? 0),
            companyName: companyName.get(r.company_id) ?? "",
          })),
          washingEntries: (recentWashingEntries ?? []).map((r) => ({
            ...r,
            sq_mtr_ft: r.sq_mtr_ft != null ? Number(r.sq_mtr_ft) : null,
            rate: r.rate != null ? Number(r.rate) : null,
            debit_charges: r.debit_charges != null ? Number(r.debit_charges) : null,
            amount: Number(r.amount ?? 0),
            round_off_amt: r.round_off_amt != null ? Number(r.round_off_amt) : 0,
            companyName: companyName.get(r.company_id) ?? "",
          })),
          internalInvoices: (recentInternalInvoices ?? []).map((r) => ({
            ...r,
            qty: Number(r.qty),
            rate: Number(r.rate),
            total_amount: Number(r.total_amount),
            round_off_amt: Number(r.round_off_amt ?? 0),
            fromCompanyName: companyName.get(r.from_company_id) ?? "",
            toCompanyName: companyName.get(r.to_company_id) ?? "",
          })),
          purchaseBillInvoices,
          // 2026-10-20 — "kab entry ki gyi date & time ... admin ko": the
          // entry/updated stamps are admin-only, same capability the rest of
          // the app treats as "Admin" (see bill-payment's isPaidLockedViewer).
          canSeeAudit: employee.capabilities.includes("permissions_admin"),
          csbFilings: (recentCsbFilings ?? []).map((r) => ({
            ...r,
            exchange_rate: r.exchange_rate != null ? Number(r.exchange_rate) : null,
            total_taxable_value: r.total_taxable_value != null ? Number(r.total_taxable_value) : null,
            fob_value_inr: r.fob_value_inr != null ? Number(r.fob_value_inr) : null,
          })),
          journalVouchers: (recentJournalVouchers ?? []).map((r) => ({
            ...r,
            debit_amount: Number(r.debit_amount),
            round_off_amt: Number(r.round_off_amt ?? 0),
            passed_amount: r.passed_amount != null ? Number(r.passed_amount) : null,
            qty: r.qty != null ? Number(r.qty) : null,
            vendorName: r.party_id ? partyName.get(r.party_id) ?? "—" : "—",
          })),
          receivedChalans: receivedChalanRows,
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
            financeBprId: financeLinkBySourceId.get(`freight_bill:${b.id}`)?.id ?? null,
            financeCompanyId: financeLinkBySourceId.get(`freight_bill:${b.id}`)?.company_id ?? null,
            vendor_party_id: b.vendor_party_id,
            vendor_name: b.vendor_party_id ? partyName.get(b.vendor_party_id) ?? null : null,
            related_notes: notesFor(bprIdByFreightBillId.get(b.id)),
            assignments: (freightAssignments ?? [])
              .filter((a) => a.freight_bill_id === b.id)
              .map((a) => {
                const booked = a.order_shipment_id ? bookedById.get(a.order_shipment_id) : undefined;
                return {
                  id: a.id,
                  order_ref_no: orderRefNo.get(a.order_id) ?? "—",
                  bill_weight_kg: a.bill_weight_kg != null ? Number(a.bill_weight_kg) : null,
                  dimensional_weight_kg: a.dimensional_weight_kg != null ? Number(a.dimensional_weight_kg) : null,
                  difference_amt: a.difference_amt != null ? Number(a.difference_amt) : null,
                  billed_freight_amt: a.billed_freight_amt != null ? Number(a.billed_freight_amt) : null,
                  billed_base_amt: a.billed_base_amt != null ? Number(a.billed_base_amt) : null,
                  billed_fuel_amt: a.billed_fuel_amt != null ? Number(a.billed_fuel_amt) : null,
                  billed_remote_amt: a.billed_remote_amt != null ? Number(a.billed_remote_amt) : null,
                  billed_other_amt: a.billed_other_amt != null ? Number(a.billed_other_amt) : null,
                  billed_gst_amt: a.billed_gst_amt != null ? Number(a.billed_gst_amt) : null,
                  // 2026-10-28e — per-AWB/order round-off.
                  round_off_amt: a.round_off_amt != null ? Number(a.round_off_amt) : null,
                  booked_freight_amt: booked?.booked_freight_amt != null ? Number(booked.booked_freight_amt) : null,
                  booked_currency: booked?.booked_currency ?? null,
                  // booked_amount_source is a plain `text` column (no DB-level
                  // enum), so database.ts types it as bare `string`; cast to
                  // FreightBillAssignment's own literal union.
                  booked_amount_source: (booked?.booked_amount_source ?? null) as "api" | "rate_card_estimate" | "manual" | null,
                  credit_note_no: a.credit_note_no,
                  credit_note_date: a.credit_note_date,
                  credit_note_amt: a.credit_note_amt != null ? Number(a.credit_note_amt) : null,
                  debit_note_no: a.debit_note_no,
                  debit_note_date: a.debit_note_date,
                  debit_note_amt: a.debit_note_amt != null ? Number(a.debit_note_amt) : null,
                  remark: a.remark,
                  // 2026-11-03 — disputed AWB (payment hold). 'none' until the
                  // 2026-11-03 SQL is run, since `*` simply omits the columns.
                  dispute_status: (a.dispute_status ?? "none") as "none" | "under_dispute" | "resolved",
                  dispute_amount: a.dispute_amount != null ? Number(a.dispute_amount) : null,
                  dispute_reason: a.dispute_reason ?? null,
                  dispute_raised_on: a.dispute_raised_on ?? null,
                  dispute_resolved_on: a.dispute_resolved_on ?? null,
                  dispute_resolution: a.dispute_resolution ?? null,
                };
              }),
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
            financeBprId: financeLinkBySourceId.get(`duty_tax_bill:${b.id}`)?.id ?? null,
            financeCompanyId: financeLinkBySourceId.get(`duty_tax_bill:${b.id}`)?.company_id ?? null,
            vendor_party_id: b.vendor_party_id,
            vendor_name: b.vendor_party_id ? partyName.get(b.vendor_party_id) ?? null : null,
            related_notes: notesFor(bprIdByDutyBillId.get(b.id)),
            assignments: (dutyAssignments ?? [])
              .filter((a) => a.duty_tax_bill_id === b.id)
              .map((a) => ({
                id: a.id,
                order_ref_no: orderRefNo.get(a.order_id) ?? "—",
                duty_tax_amt_usd: a.duty_tax_amt_usd != null ? Number(a.duty_tax_amt_usd) : null,
                duty_tax_amt_inr: a.duty_tax_amt_inr != null ? Number(a.duty_tax_amt_inr) : null,
                other_charge: a.other_charge != null ? Number(a.other_charge) : null,
                gst_18pct: a.gst_18pct != null ? Number(a.gst_18pct) : null,
                // 2026-10-28e — per-AWB/order round-off.
                round_off_amt: a.round_off_amt != null ? Number(a.round_off_amt) : null,
                credit_note_no: a.credit_note_no,
                credit_note_date: a.credit_note_date,
                credit_note_amt: a.credit_note_amt != null ? Number(a.credit_note_amt) : null,
                debit_note_no: a.debit_note_no,
                debit_note_date: a.debit_note_date,
                debit_note_amt: a.debit_note_amt != null ? Number(a.debit_note_amt) : null,
                remark: a.remark,
                // 2026-11-03 — same disputed-AWB fields as the freight side.
                dispute_status: (a.dispute_status ?? "none") as "none" | "under_dispute" | "resolved",
                dispute_amount: a.dispute_amount != null ? Number(a.dispute_amount) : null,
                dispute_reason: a.dispute_reason ?? null,
                dispute_raised_on: a.dispute_raised_on ?? null,
                dispute_resolved_on: a.dispute_resolved_on ?? null,
                dispute_resolution: a.dispute_resolution ?? null,
              })),
          })),
        }}
        shipmentChalans={shipmentChalanRows}
        initialTab={initialTab}
        // 2026-10-28 — a Purchase Bill row's "🧾 Debit Note" shortcut opens the
        // Debit Note tab with the bill already linked (see
        // PurchaseBillInvoiceList in document-entry-tabs.tsx).
        debitNoteDefaults={{
          companyId: typeof sp.dn_company === "string" ? sp.dn_company : undefined,
          partyId: typeof sp.dn_party === "string" ? sp.dn_party : undefined,
          billId: typeof sp.dn_bill === "string" ? sp.dn_bill : undefined,
          invoiceNo: typeof sp.dn_invoice === "string" ? sp.dn_invoice : undefined,
        }}
        billFilters={{
          purchaseBill: { vendor: pbVendor, from: pbFrom, to: pbTo },
          freightBill: { vendor: fbVendor, from: fbFrom, to: fbTo },
          dutyBill: { vendor: dbVendor, from: dbFrom, to: dbTo },
        }}
      />
    </div>
  );
}
