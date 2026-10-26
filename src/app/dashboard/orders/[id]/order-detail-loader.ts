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

  const [{ data: company }, { data: store }, { data: itemCategory }, { data: invoice }, { data: debitNotes }, { data: creditNotes }, statusByOrder, { data: parties }, vendorAssignments, { data: dispatchSummary }, { data: refunds }, { data: currencies }, { data: shipments }, { data: courierRows }] =
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
        .select(
          "invoice_no, invoice_date, courier_name, awb_no, shipping_weight_kg, length_cm, width_cm, height_cm, volumetric_weight, delivered_status, delivered_date, last_update_date"
        )
        .eq("order_id", id)
        .maybeSingle(),
      supabase
        .from("order_refunds")
        .select("refund_amount, refund_currency, refund_date, reason")
        .eq("order_id", id)
        .order("refund_date", { ascending: false }),
      supabase.from("currencies").select("code, name").order("code"),
      // 2026-10-26 — the shipment/package rows are the SOURCE OF TRUTH for
      // an order's AWB/weight/dimensions (order_shipments + order_packages;
      // dispatch_invoices is only their order-level mirror). The shipping
      // form used to pre-fill from that mirror alone, so whenever the mirror
      // lagged (a manual save that only touched an existing shipment, an
      // older row, a failed resync) every field looked empty again. Reading
      // the real rows here keeps the form in step with whatever any writer
      // — courier booking, Order Shipments & Packages, manual entry — saved.
      supabase
        .from("order_shipments")
        .select("id, shipment_no, awb_no, courier_name, delivered_status, delivered_date, last_update_date")
        .eq("order_id", id)
        .order("shipment_no"),
      supabase
        .from("courier_shipments")
        .select("courier, manual_courier_name, status, awb_no, label_url")
        .eq("order_id", id),
    ]);

  const shipmentRows = shipments ?? [];
  const shipmentIds = shipmentRows.map((s) => s.id);
  const { data: packageRows } = shipmentIds.length
    ? await supabase
        .from("order_packages")
        .select("order_shipment_id, package_no, weight_kg, length_cm, width_cm, height_cm, volumetric_weight")
        .in("order_shipment_id", shipmentIds)
    : { data: [] };
  const packages = packageRows ?? [];

  function joinDistinct(values: (string | null)[]): string | null {
    const distinct = Array.from(new Set(values.filter((v): v is string => !!v)));
    return distinct.length ? distinct.join(", ") : null;
  }

  const totalWeight = packages.reduce((sum, p) => sum + (p.weight_kg ? Number(p.weight_kg) : 0), 0);
  const totalVolumetric = packages.reduce((sum, p) => sum + (p.volumetric_weight ? Number(p.volumetric_weight) : 0), 0);
  const anyWeight = packages.some((p) => p.weight_kg != null);
  const firstShipment = shipmentRows.find((s) => s.shipment_no === 1) ?? shipmentRows[0] ?? null;
  const firstPackage = firstShipment
    ? packages.find((p) => p.order_shipment_id === firstShipment.id && p.package_no === 1) ??
      packages.find((p) => p.order_shipment_id === firstShipment.id) ??
      null
    : null;

  const shipmentsForView = shipmentRows.map((s) => {
    const pkgs = packages.filter((p) => p.order_shipment_id === s.id);
    const weight = pkgs.reduce((sum, p) => sum + (p.weight_kg ? Number(p.weight_kg) : 0), 0);
    const volumetric = pkgs.reduce((sum, p) => sum + (p.volumetric_weight ? Number(p.volumetric_weight) : 0), 0);
    const first = pkgs.find((p) => p.package_no === 1) ?? pkgs[0] ?? null;
    const courierRow =
      (courierRows ?? []).find((c) => !!s.awb_no && c.awb_no === s.awb_no) ?? (courierRows ?? [])[0] ?? null;
    return {
      id: s.id,
      shipmentNo: s.shipment_no,
      awbNo: s.awb_no,
      courierName: s.courier_name,
      deliveredStatus: s.delivered_status,
      deliveredDate: s.delivered_date,
      lastUpdateDate: s.last_update_date,
      weightKg: pkgs.some((p) => p.weight_kg != null) ? Math.round(weight * 1000) / 1000 : null,
      volumetricWeightKg: pkgs.some((p) => p.volumetric_weight != null) ? Math.round(volumetric * 100) / 100 : null,
      lengthCm: first?.length_cm != null ? Number(first.length_cm) : null,
      widthCm: first?.width_cm != null ? Number(first.width_cm) : null,
      heightCm: first?.height_cm != null ? Number(first.height_cm) : null,
      labelUrl: courierRow?.label_url ?? null,
      bookingStatus: courierRow?.status ?? null,
      bookingCourier: courierRow?.manual_courier_name ?? courierRow?.courier ?? null,
    };
  });

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
    // 2026-10-26 — real shipment/package rows win, the dispatch_invoices
    // mirror is the fallback (see the shipment query's comment above). This
    // is what makes the form auto-fill whatever was already saved, no matter
    // which screen saved it.
    shippingDefaults: {
      awb_no: joinDistinct(shipmentRows.map((s) => s.awb_no)) ?? dispatchSummary?.awb_no ?? null,
      courier_name: joinDistinct(shipmentRows.map((s) => s.courier_name)) ?? dispatchSummary?.courier_name ?? null,
      invoice_no: dispatchSummary?.invoice_no ?? invoice?.invoice_no ?? null,
      invoice_date: dispatchSummary?.invoice_date ?? invoice?.invoice_date ?? null,
      weight_kg: anyWeight
        ? Math.round(totalWeight * 1000) / 1000
        : dispatchSummary?.shipping_weight_kg != null
          ? Number(dispatchSummary.shipping_weight_kg)
          : null,
      length_cm:
        firstPackage?.length_cm != null
          ? Number(firstPackage.length_cm)
          : dispatchSummary?.length_cm != null
            ? Number(dispatchSummary.length_cm)
            : null,
      width_cm:
        firstPackage?.width_cm != null
          ? Number(firstPackage.width_cm)
          : dispatchSummary?.width_cm != null
            ? Number(dispatchSummary.width_cm)
            : null,
      height_cm:
        firstPackage?.height_cm != null
          ? Number(firstPackage.height_cm)
          : dispatchSummary?.height_cm != null
            ? Number(dispatchSummary.height_cm)
            : null,
    },
    /** Every AWB/package on this order, plus its courier-API tracking state. */
    shipments: shipmentsForView,
    /** Order-level shipment summary (dispatch_invoices mirror + totals). */
    dispatchSummary: {
      awbNo: joinDistinct(shipmentRows.map((s) => s.awb_no)) ?? dispatchSummary?.awb_no ?? null,
      courierName: joinDistinct(shipmentRows.map((s) => s.courier_name)) ?? dispatchSummary?.courier_name ?? null,
      invoiceNo: dispatchSummary?.invoice_no ?? null,
      invoiceDate: dispatchSummary?.invoice_date ?? null,
      weightKg: anyWeight
        ? Math.round(totalWeight * 1000) / 1000
        : dispatchSummary?.shipping_weight_kg != null
          ? Number(dispatchSummary.shipping_weight_kg)
          : null,
      volumetricWeightKg: totalVolumetric > 0 ? Math.round(totalVolumetric * 100) / 100 : null,
      lengthCm: firstPackage?.length_cm != null ? Number(firstPackage.length_cm) : null,
      widthCm: firstPackage?.width_cm != null ? Number(firstPackage.width_cm) : null,
      heightCm: firstPackage?.height_cm != null ? Number(firstPackage.height_cm) : null,
      deliveredStatus: dispatchSummary?.delivered_status ?? null,
      deliveredDate: dispatchSummary?.delivered_date ?? null,
      lastUpdateDate: dispatchSummary?.last_update_date ?? null,
    },
    canManageOrders: employee.capabilities.includes("order_entry"),
    refunds: (refunds ?? []).map((r) => ({ ...r, refund_amount: Number(r.refund_amount) })),
    currencies: currencies ?? [],
  };
}
