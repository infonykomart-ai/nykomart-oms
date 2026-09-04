import { notFound } from "next/navigation";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { getOrderStatusSummaries } from "@/lib/orders/order-status-summary";
import { OrderView } from "./order-view";

// Order detail / view page (2026-08-22) — until now the Orders hub
// (order-list-table.tsx) had no separate read-only page at all: "Edit"
// swaps the row in place for an inline form, there was never a
// /dashboard/orders/[id] to link someone to or to print/save-as-PDF on its
// own. Mirrors src/app/dashboard/invoices/[id]/page.tsx + invoice-view.tsx
// closely (auth -> fetch -> company-scope check -> hand off to a read-only
// view component with PrintArea/PrintButton), just without the editable
// form panel since this page is view-only — editing still happens back on
// the Orders hub's inline form, unchanged.
//
// Deliberately just getAuthedEmployee() (not requireCapability) — any
// signed-in employee who can already see this order's company (via
// employee.companyIds, same scoping every other page here uses) can view
// its detail/print page; there's no separate capability gate on read-only
// order viewing today (Orders hub itself is gated behind "order_entry" for
// the edit/delete panel, but that's a different concern from "can this
// person see one order's read-only detail").
//
// 2026-09-04 — this USED to deliberately leave out multi-package/AWB
// shipment data (that already lives at its own screen,
// /dashboard/order-packages — "Order Shipments & Packages") on the grounds
// that showing it here too would just be two places to keep in sync. A
// non-technical user then flagged they could no longer easily tell, per
// order, its delivered status/tracking/freight/purchased-from vendor/
// Purchase Bill status from this page — so those 5 fields are now shown
// here too, via the SAME shared read path order-packages and the Orders
// list/Report use (getOrderStatusSummaries, see
// src/lib/orders/order-status-summary.ts), which is what keeps this from
// becoming a second, divergent place: there's one function computing these
// 5 facts, just called from 3 pages instead of 1. Full package/box-level
// detail (dimensions, per-package weight, multiple AWBs listed
// individually) still only lives on /dashboard/order-packages — this page
// shows the summarized 5 fields only, linking there is left for later if
// asked for.
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await getAuthedEmployee();
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, ref_no, company_id, store_id, order_date, po_date, delivery_date, dispatch_date, status, shipment_status, marketplace_order_no, buyer_name_address, contact_no, email_id, address_type, destination_country, item_category_id, sku_label, size_label, qty, colour, photo_type, photo_url, order_currency, order_value_original, order_value_usd, order_value_inr, exchange_rate_source, invoice_id, vendor_party_id, remark, entry_timestamp, advance_tracking, final_tracking"
    )
    .eq("id", id)
    .maybeSingle();

  if (!order || !employee.companyIds.includes(order.company_id)) notFound();

  // 2026-09-04 — the old standalone `vendor` query (order.vendor_party_id ->
  // parties.name) only ever knew the PLANNED vendor. getOrderStatusSummaries
  // below already resolves the same party name AND prefers the ACTUAL
  // Purchase Bill vendor when one exists, so that query was folded into this
  // one call instead of kept as a second, less-accurate source of the same
  // fact.
  const [{ data: company }, { data: store }, { data: itemCategory }, { data: invoice }, { data: debitNotes }, { data: creditNotes }, statusByOrder] =
    await Promise.all([
      supabase.from("companies").select("id, name, logo_url").eq("id", order.company_id).single(),
      supabase.from("stores").select("id, name").eq("id", order.store_id).single(),
      supabase.from("item_categories").select("id, name, hsn_code").eq("id", order.item_category_id).single(),
      order.invoice_id
        ? supabase
            .from("sales_invoices")
            .select("id, invoice_no, master_invoice_no, invoice_date, csb_type, courier_company")
            .eq("id", order.invoice_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // 2026-08-27 — "kisi order ke against me bhi agar credit debit note
      // bana na pade to vo bhi link ho": debit_notes.order_id /
      // credit_notes.order_id already existed (pre-this-round), but this
      // detail page never surfaced them — the only place they showed was
      // OrderLookupBox's own inline results while CREATING a new note, not
      // here on the order itself.
      supabase.from("debit_notes").select("id, debit_note_no, debit_note_date, debit_amount").eq("order_id", id).order("debit_note_date", { ascending: false }),
      supabase.from("credit_notes").select("id, cn_no, credit_note_date, refund_amount").eq("order_id", id).order("credit_note_date", { ascending: false }),
      getOrderStatusSummaries(supabase, [
        {
          id: order.id,
          vendor_party_id: order.vendor_party_id,
          advance_tracking: order.advance_tracking,
          final_tracking: order.final_tracking,
        },
      ]),
    ]);

  const statusSummary = statusByOrder[order.id];

  return (
    <OrderView
      order={order}
      companyName={company?.name ?? ""}
      companyLogoUrl={company?.logo_url ?? null}
      storeName={store?.name ?? ""}
      itemCategoryName={itemCategory?.name ?? ""}
      hsnCode={itemCategory?.hsn_code ?? ""}
      invoice={invoice ?? null}
      vendorName={
        statusSummary?.purchasedFromName
          ? `${statusSummary.purchasedFromName}${statusSummary.purchasedFromIsPlanned ? " (planned)" : ""}`
          : null
      }
      statusSummary={statusSummary ?? null}
      debitNotes={(debitNotes ?? []).map((d) => ({ ...d, debit_amount: Number(d.debit_amount) }))}
      creditNotes={(creditNotes ?? []).map((c) => ({ ...c, refund_amount: Number(c.refund_amount) }))}
    />
  );
}
