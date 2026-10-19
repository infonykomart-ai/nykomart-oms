// 2026-10-19 — shared loader for the order detail view. Both the page
// (/dashboard/orders/[id], full app shell) and the dialog-sized sheet
// (/order-sheet/[id], rendered inside the Orders list's A4 dialog) need the
// exact same data. Keeping one loader means the dialog can never show
// different numbers than the page it replaces.
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { getOrderStatusSummaries } from "@/lib/orders/order-status-summary";
import { listVendorAssignments } from "../vendor-assignment-actions";

export async function loadOrderDetail(id: string) {
  const employee = await getAuthedEmployee();
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, ref_no, company_id, store_id, order_date, po_date, delivery_date, dispatch_date, estimated_dispatch_date, status, shipment_status, marketplace_order_no, buyer_name_address, contact_no, email_id, address_type, destination_country, buyer_address1, buyer_address2, buyer_address3, buyer_city, buyer_state, buyer_postal_code, item_category_id, sku_label, size_label, qty, colour, photo_type, photo_url, photo_urls, order_currency, order_value_original, order_value_usd, order_value_inr, exchange_rate_source, invoice_id, vendor_party_id, remark, entry_timestamp, advance_tracking, final_tracking"
    )
    .eq("id", id)
    .maybeSingle();

  if (!order || !employee.companyIds.includes(order.company_id)) return null;

  const [{ data: company }, { data: store }, { data: itemCategory }, { data: invoice }, { data: debitNotes }, { data: creditNotes }, statusByOrder, { data: parties }, vendorAssignments, { data: dispatchSummary }, { data: refunds }, { data: currencies }] =
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
      supabase.from("parties").select("id, name").order("name"),
      listVendorAssignments(id),
      supabase
        .from("dispatch_invoices")
        .select("invoice_no, invoice_date, courier_name, awb_no, shipping_weight_kg, length_cm, width_cm, height_cm")
        .eq("order_id", id)
        .maybeSingle(),
      supabase
        .from("order_refunds")
        .select("refund_amount, refund_currency, refund_date, reason")
        .eq("order_id", id)
        .order("refund_date", { ascending: false }),
      supabase.from("currencies").select("code, name").order("code"),
    ]);

  const statusSummary = statusByOrder[order.id];

  return {
    order,
    companyName: company?.name ?? "",
    companyLogoUrl: company?.logo_url ?? null,
    storeName: store?.name ?? "",
    itemCategoryName: itemCategory?.name ?? "",
    hsnCode: itemCategory?.hsn_code ?? "",
    invoice: invoice ?? null,
    vendorName: statusSummary?.purchasedFromName
      ? `${statusSummary.purchasedFromName}${statusSummary.purchasedFromIsPlanned ? " (planned)" : ""}`
      : null,
    statusSummary: statusSummary ?? null,
    debitNotes: (debitNotes ?? []).map((d) => ({ ...d, debit_amount: Number(d.debit_amount) })),
    creditNotes: (creditNotes ?? []).map((c) => ({ ...c, refund_amount: Number(c.refund_amount) })),
    vendorAssignmentParties: parties ?? [],
    vendorAssignmentCycles: vendorAssignments,
    shippingDefaults: dispatchSummary
      ? {
          awb_no: dispatchSummary.awb_no,
          courier_name: dispatchSummary.courier_name,
          invoice_no: dispatchSummary.invoice_no,
          invoice_date: dispatchSummary.invoice_date,
          weight_kg: dispatchSummary.shipping_weight_kg != null ? Number(dispatchSummary.shipping_weight_kg) : null,
          length_cm: dispatchSummary.length_cm != null ? Number(dispatchSummary.length_cm) : null,
          width_cm: dispatchSummary.width_cm != null ? Number(dispatchSummary.width_cm) : null,
          height_cm: dispatchSummary.height_cm != null ? Number(dispatchSummary.height_cm) : null,
        }
      : { awb_no: null, courier_name: null, invoice_no: null, invoice_date: null, weight_kg: null, length_cm: null, width_cm: null, height_cm: null },
    canManageOrders: employee.capabilities.includes("order_entry"),
    refunds: (refunds ?? []).map((r) => ({ ...r, refund_amount: Number(r.refund_amount) })),
    currencies: currencies ?? [],
  };
}
