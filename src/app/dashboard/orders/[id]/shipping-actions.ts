"use server";

// 2026-09-13 — user request #5 + #6: "agar kisi order ke against me invoice
// no add karna ho, invoice date add karni ho, shipment ka weight add karna
// ho, dimention add karna ho, awb add karna ho (tracking no), courier
// company add karna ho" and "jis jis order me awb no dal gaye invoice no
// mil gaya order ko to dispatch dikh jaye. agar manual karna ho to kese
// karenge."
//
// This is the MANUAL entry path for all six fields, straight from the
// order's own detail page — for shipments booked/handled entirely outside
// the app's Courier Booking screen (which already writes these same tables
// through createManualBooking / the 6 courier APIs). It writes exactly the
// structures every other writer uses, so nothing downstream can tell the
// difference:
//   - order_shipments + order_packages   (weight/dims/AWB/courier — see
//     db/2026-08-20-order-shipments-and-packages.sql; resyncDispatchSummary
//     then recomputes the dispatch_invoices summary the way EVERY other
//     write path does, never by hand-editing that summary here)
//   - dispatch_invoices.invoice_no/.invoice_date (the order-level summary
//     row's invoice fields — resync deliberately doesn't touch those two,
//     see resync-dispatch-summary.ts's "other fields are independently
//     managed" note, so upserting them first then syncing is safe)
//   - orders.status → 'Dispatched' (+ dispatch_date) ONLY when BOTH the
//     AWB and the invoice no. are present — the exact rule the user
//     stated for #6. Partial entries save without dispatching, so a
//     half-known AWB never fakes a dispatch.
// Capability is order_entry — the same gate the Orders hub's inline
// edit/delete already uses; this is order-level operational data, not a
// courier-account action.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";

export type ShippingDetailsState = { error: string | null; success: boolean; dispatched: boolean };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}
function numOrNull(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function saveManualShippingDetails(_prev: ShippingDetailsState, formData: FormData): Promise<ShippingDetailsState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { error: "Missing order.", success: false, dispatched: false };

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, company_id, status, dispatch_date")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return { error: "Order not found.", success: false, dispatched: false };
  if (!employee.companyIds.includes(order.company_id)) {
    return { error: "You don't have access to this order's company.", success: false, dispatched: false };
  }
  if (order.status === "Cancelled") {
    return { error: "This order is Cancelled — shipping details can't be added to it.", success: false, dispatched: false };
  }

  const awbNo = strOrNull(formData, "awb_no");
  const courierName = strOrNull(formData, "courier_name");
  const invoiceNo = strOrNull(formData, "invoice_no");
  const invoiceDate = strOrNull(formData, "invoice_date");
  const weightKg = numOrNull(formData, "weight_kg");
  const lengthCm = numOrNull(formData, "length_cm");
  const widthCm = numOrNull(formData, "width_cm");
  const heightCm = numOrNull(formData, "height_cm");

  if (!awbNo && !courierName && !invoiceNo && !invoiceDate && weightKg == null && lengthCm == null && widthCm == null && heightCm == null) {
    return { error: "Nothing entered — fill at least one field.", success: false, dispatched: false };
  }
  if ((lengthCm == null) !== (widthCm == null) || (widthCm == null) !== (heightCm == null)) {
    return { error: "Dimensions: enter all three of Length, Width, Height (or leave all three blank).", success: false, dispatched: false };
  }

  const today = new Date().toISOString().slice(0, 10);

  // 1. Shipment + package rows (only when there's something shipment-level
  //    to store — AWB/courier/weight/dims). shipment_no = next per order,
  //    same convention as createManualBooking.
  let shipmentId: string | null = null;
  if (awbNo || courierName || weightKg != null || lengthCm != null) {
    // 2026-10-22 — "AWB courier weight dimension daal diya uske baad bhi
    // assign nahi hota". This always INSERTED a new shipment
    // (shipment_no = last + 1), so saving the form a second time — AWB first,
    // weight/dims after, or just correcting a typo — left the SAME AWB on two
    // shipment rows. The courier bill's Assign-AWB screen then refused the
    // order ("has 2 shipments/AWBs — search by AWB instead"), and its AWB
    // lookup itself errored out on the duplicate, so the AWB could never be
    // assigned at all. Now the order's existing shipment is REUSED when it
    // has one — the normal case for this form (see the header comment) — and
    // a shipment is only created when the order has none. An order that
    // genuinely has several shipments is the Order Shipments & Packages
    // screen's job, so this form says so instead of inventing a duplicate.
    const { data: existingShipments, error: existingError } = await supabase
      .from("order_shipments")
      .select("id, awb_no, shipment_no")
      .eq("order_id", orderId)
      .order("shipment_no");
    if (existingError) {
      return { error: existingError.message, success: false, dispatched: false };
    }
    const existing = (existingShipments ?? [])[0] ?? null;
    if ((existingShipments ?? []).length > 1) {
      return {
        error: "This order already has more than one shipment/AWB — manage them on Order Shipments & Packages instead of this form.",
        success: false,
        dispatched: false,
      };
    }

    let shipment: { id: string } | null = null;
    if (existing) {
      // Only the fields the form actually carries are written, and awb_no /
      // courier_name only when typed — so saving weight or dimensions can
      // never blank out an AWB that came from a real courier booking.
      const patch: { last_update_date: string; awb_no?: string; courier_name?: string } = { last_update_date: today };
      if (awbNo) patch.awb_no = awbNo;
      if (courierName) patch.courier_name = courierName;
      const { data, error } = await supabase
        .from("order_shipments")
        .update(patch)
        .eq("id", existing.id)
        .select("id")
        .single();
      if (error || !data) {
        return { error: error?.message ?? "Could not save the shipment.", success: false, dispatched: false };
      }
      shipment = data;
    } else {
      const { data, error } = await supabase
        .from("order_shipments")
        .insert({
          order_id: orderId,
          shipment_no: 1,
          awb_no: awbNo,
          courier_name: courierName,
          last_update_date: today,
          created_by_employee_id: employee.id,
          booked_amount_source: "manual",
          remark: "Manual shipping-details entry from the order page (2026-09-13).",
        })
        .select("id")
        .single();
      if (error || !data) {
        return { error: error?.message ?? "Could not save the shipment.", success: false, dispatched: false };
      }
      shipment = data;
    }
    shipmentId = shipment.id;

    if (weightKg != null || lengthCm != null) {
      const { error: pkgError } = await supabase.from("order_packages").upsert(
        {
          order_shipment_id: shipment.id,
          package_no: 1,
          weight_kg: weightKg,
          length_cm: lengthCm,
          width_cm: widthCm,
          height_cm: heightCm,
        },
        { onConflict: "order_shipment_id,package_no" }
      );
      if (pkgError) return { error: pkgError.message, success: false, dispatched: false };
    }
  }

  // 2. Invoice no/date on the order-level summary — upsert FIRST so the
  //    row exists even for an order with no packages at all, then let
  //    resyncDispatchSummary fill its own fields on the same row.
  if ((invoiceNo || invoiceDate) && !shipmentId) {
    const { error: diError } = await supabase
      .from("dispatch_invoices")
      .upsert({ order_id: orderId, invoice_no: invoiceNo, invoice_date: invoiceDate }, { onConflict: "order_id" });
    if (diError) return { error: diError.message, success: false, dispatched: false };
  } else if (invoiceNo || invoiceDate) {
    // Row will exist after resync below if it didn't already — set the
    // invoice fields AFTER resync so resync's upsert (which omits these
    // two columns) can't be the write that creates the row without them.
    // resync's upsert only writes its own summary columns, so this order
    // is: resync (creates/updates row) → then stamp invoice fields.
  }

  if (shipmentId) await resyncDispatchSummary(supabase, orderId);

  if ((invoiceNo || invoiceDate) && shipmentId) {
    const { error: diError } = await supabase
      .from("dispatch_invoices")
      .upsert({ order_id: orderId, invoice_no: invoiceNo, invoice_date: invoiceDate }, { onConflict: "order_id" });
    if (diError) return { error: diError.message, success: false, dispatched: false };
  }

  // 3. #6 — dispatch marker. Exactly the user's rule: AWB present AND
  //    invoice no. present → Dispatched everywhere. Already-Delivered
  //    orders are never downgraded; an existing dispatch_date is kept.
  let dispatched = false;
  if (awbNo && invoiceNo && order.status !== "Delivered" && order.status !== "Dispatched") {
    const { error: stError } = await supabase
      .from("orders")
      .update({ status: "Dispatched", dispatch_date: order.dispatch_date ?? invoiceDate ?? today })
      .eq("id", orderId);
    if (stError) return { error: stError.message, success: false, dispatched: false };
    dispatched = true;
  } else if (awbNo && invoiceNo && (order.status === "Dispatched" || order.status === "Delivered")) {
    dispatched = true; // already dispatched/delivered — rule already satisfied
  }

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/order-packages");
  return { error: null, success: true, dispatched };
}
