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
//   - orders.status → 'Dispatched' (+ dispatch_date) as soon as an AWB is
//     on file (2026-10-26 — the user's updated rule: "AWB NO JAB SHIPMENT
//     ME ADD HO GAYA TO DISPATCH DIKHAYE"; this used to also require the
//     invoice no., which left real shipments showing as not dispatched).
//     orders.shipment_status → 'Shipped' at the same moment, the value a
//     courier API booking sets, so tracking can move it onward.
//   - courier_shipments (mirror row) — so Track Shipments, Shipment
//     Detail, NDR, pickups and the daily report see the AWB too, not just
//     the order page's own tables (2026-10-26).
// Capability is order_entry — the same gate the Orders hub's inline
// edit/delete already uses; this is order-level operational data, not a
// courier-account action.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";
// 2026-10-26 — forwarding_no (the second, forwarder-side number an aggregator
// courier reports for the same parcel) is written/read tolerantly, so a
// database that has not had db/2026-10-26-order-shipment-forwarding-no.sql run
// yet keeps saving AWBs instead of failing on an unknown column.
import { tolerateMissingColumn } from "@/lib/db/missing-column";
// 2026-11-23 — the manual AWB → Track Shipments mirror is shared with the
// bulk tracking CSV (src/lib/orders/sync-courier-shipment.ts).
import { syncCourierShipmentRow } from "@/lib/orders/sync-courier-shipment";
// 2026-11-23 — one shared tracking → order-status writer, so a manual
// Tracking Status entry moves the order (status + shipment status + dispatch
// date + dispatch_invoices summary) exactly like a courier event does.
import { syncOrderTrackingState } from "@/lib/orders/tracking-status-sync";
import { isTrackingState } from "@/lib/orders/tracking-status";
// 2026-11-27 — the one status writer (status + automatic WhatsApp message).
import { setOrderStatus } from "@/lib/orders/set-order-status";

export type ShippingDetailsState = { error: string | null; success: boolean; dispatched: boolean; trackingSync?: string | null };

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

// Standard international air-freight volumetric divisor — the same formula
// every courier booking already uses (actions.ts's
// computeVolumetricWeightKg), so a manual entry's volumetric weight matches
// what a real booking would have stored.
function computeVolumetricWeightKg(length: number | null, width: number | null, height: number | null): number | null {
  if (!length || !width || !height) return null;
  return Math.round(((length * width * height) / 5000) * 100) / 100;
}

export async function saveManualShippingDetails(_prev: ShippingDetailsState, formData: FormData): Promise<ShippingDetailsState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { error: "Missing order.", success: false, dispatched: false, trackingSync: null };

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, company_id, status, dispatch_date, shipment_status")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return { error: "Order not found.", success: false, dispatched: false, trackingSync: null };
  if (!employee.companyIds.includes(order.company_id)) {
    return { error: "You don't have access to this order's company.", success: false, dispatched: false, trackingSync: null };
  }
  if (order.status === "Cancelled") {
    return { error: "This order is Cancelled — shipping details can't be added to it.", success: false, dispatched: false, trackingSync: null };
  }

  const awbNo = strOrNull(formData, "awb_no");
  // 2026-10-26 — the SECOND number an aggregator courier hands out (Shiprocket
  // shipment id, Shipglobal order number, OnPoint/Delhivery partner ref).
  // Stored on order_shipments beside awb_no and mirrored to courier_shipments
  // below, exactly like the AWB itself.
  const forwardingNo = strOrNull(formData, "forwarding_no");
  const courierName = strOrNull(formData, "courier_name");
  const invoiceNo = strOrNull(formData, "invoice_no");
  const invoiceDate = strOrNull(formData, "invoice_date");
  const weightKg = numOrNull(formData, "weight_kg");
  const lengthCm = numOrNull(formData, "length_cm");
  const widthCm = numOrNull(formData, "width_cm");
  const heightCm = numOrNull(formData, "height_cm");

  if (
    !awbNo &&
    !forwardingNo &&
    !courierName &&
    !invoiceNo &&
    !invoiceDate &&
    weightKg == null &&
    lengthCm == null &&
    widthCm == null &&
    heightCm == null &&
    !str(formData, "tracking_status")
  ) {
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
  if (awbNo || forwardingNo || courierName || weightKg != null || lengthCm != null) {
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
      const patch: { last_update_date: string; awb_no?: string; forwarding_no?: string; courier_name?: string } = { last_update_date: today };
      if (awbNo) patch.awb_no = awbNo;
      if (forwardingNo) patch.forwarding_no = forwardingNo;
      if (courierName) patch.courier_name = courierName;
      const { data, error } = await tolerateMissingColumn(patch, "forwarding_no", (clean) =>
        supabase.from("order_shipments").update(clean).eq("id", existing.id).select("id").single()
      );
      if (error || !data) {
        return { error: error?.message ?? "Could not save the shipment.", success: false, dispatched: false };
      }
      shipment = data;
    } else {
      const { data, error } = await tolerateMissingColumn(
        {
          order_id: orderId,
          shipment_no: 1,
          awb_no: awbNo,
          forwarding_no: forwardingNo,
          courier_name: courierName,
          last_update_date: today,
          created_by_employee_id: employee.id,
          booked_amount_source: "manual" as const,
          remark: "Manual shipping-details entry from the order page (2026-09-13).",
        },
        "forwarding_no",
        (clean) => supabase.from("order_shipments").insert(clean).select("id").single()
      );
      if (error || !data) {
        return { error: error?.message ?? "Could not save the shipment.", success: false, dispatched: false };
      }
      shipment = data;
    }
    shipmentId = shipment.id;

    if (weightKg != null || lengthCm != null) {
      // 2026-10-26 — only the fields actually typed are written. Before, a
      // second save that carried only the weight (correction, or weight
      // added after the AWB) sent length/width/height as NULL and wiped the
      // dimensions already on file, so the order page/documents kept losing
      // them. Blank now means "keep what's there", never "clear".
      const pkg: {
        order_shipment_id: string;
        package_no: number;
        weight_kg?: number;
        length_cm?: number;
        width_cm?: number;
        height_cm?: number;
        volumetric_weight?: number | null;
      } = { order_shipment_id: shipment.id, package_no: 1 };
      if (weightKg != null) pkg.weight_kg = weightKg;
      if (lengthCm != null && widthCm != null && heightCm != null) {
        pkg.length_cm = lengthCm;
        pkg.width_cm = widthCm;
        pkg.height_cm = heightCm;
        pkg.volumetric_weight = computeVolumetricWeightKg(lengthCm, widthCm, heightCm);
      }
      const { error: pkgError } = await supabase
        .from("order_packages")
        .upsert(pkg, { onConflict: "order_shipment_id,package_no" });
      if (pkgError) return { error: pkgError.message, success: false, dispatched: false };
    }

    // Mirror the AWB/courier onto courier_shipments so Track Shipments,
    // Shipment Detail, NDR, pickups and the daily report all see this manual
    // entry too (see syncCourierShipmentRow's comment).
    const courierRowError = await syncCourierShipmentRow(supabase, {
      orderId,
      orderShipmentId: shipment.id,
      awbNo,
      forwardingNo,
      courierName,
      employeeId: employee.id,
    });
    if (courierRowError) return { error: courierRowError, success: false, dispatched: false };
  }

  // 2. Invoice no/date on the order-level summary. Only the fields actually
  //    typed are written (2026-10-26 — submitting a date without re-typing
  //    the number used to NULL the saved number), and the row is upserted
  //    first so it exists even for an order with no shipment at all. When a
  //    shipment exists, resyncDispatchSummary runs in between and then these
  //    two columns are stamped on the same row (resync never writes them).
  const invoicePatch: { order_id: string; invoice_no?: string; invoice_date?: string } = { order_id: orderId };
  if (invoiceNo) invoicePatch.invoice_no = invoiceNo;
  if (invoiceDate) invoicePatch.invoice_date = invoiceDate;
  const hasInvoiceFields = !!(invoiceNo || invoiceDate);

  if (hasInvoiceFields && !shipmentId) {
    const { error: diError } = await supabase
      .from("dispatch_invoices")
      .upsert(invoicePatch, { onConflict: "order_id" });
    if (diError) return { error: diError.message, success: false, dispatched: false };
  }

  if (shipmentId) await resyncDispatchSummary(supabase, orderId);

  if (hasInvoiceFields && shipmentId) {
    const { error: diError } = await supabase
      .from("dispatch_invoices")
      .upsert(invoicePatch, { onConflict: "order_id" });
    if (diError) return { error: diError.message, success: false, dispatched: false };
  }

  // 3. Dispatch marker. 2026-10-26 — the user's updated rule: an AWB in
  //    hand IS the dispatch ("AWB NO JAB SHIPMENT ME ADD HO GAYA TO
  //    DISPATCH DIKHAYE"). Before this, an AWB saved without an invoice no.
  //    left the order sitting at its old status with no dispatch date, so it
  //    never showed as dispatched anywhere. Terminal states are never
  //    downgraded and an existing dispatch_date is kept.
  let dispatched = false;
  const terminalStatuses = ["Delivered", "Returned", "Cancelled"];
  if (awbNo && !terminalStatuses.includes(order.status)) {
    // 2026-11-27 — setOrderStatus() owns the status column: an existing
    // dispatch date is kept, a missing one is stamped, and the automatic
    // status message (when this status is a trigger) goes through the same
    // helper as every other status change.
    const statusResult = await setOrderStatus(supabase, {
      orderId,
      toStatus: "Dispatched",
      patch: order.dispatch_date ? undefined : { dispatch_date: invoiceDate ?? today },
      actorEmployeeId: employee.id,
    });
    if (statusResult.error) return { error: statusResult.error, success: false, dispatched: false };
    dispatched = true;
  }

  // 4. Shipment status — the same value a real courier booking sets, so the
  //    order shows "Shipped" and the tracking poller/webhooks can then move
  //    it to In Transit / Delivered. A later tracking state is never reset.
  let trackingSync: string | null = null;
  if (awbNo) {
    const trackingStates = ["Shipped", "In Transit", "Delivered", "Returned"];
    if (!order.shipment_status || !trackingStates.includes(order.shipment_status)) {
      const { error: ssError } = await supabase.from("orders").update({ shipment_status: "Shipped" }).eq("id", orderId);
      if (ssError) return { error: ssError.message, success: false, dispatched };
    }
    trackingSync = order.shipment_status && order.shipment_status !== "Shipped" ? order.shipment_status : "Shipped";
  }

  // 5. 2026-11-23 — an explicit Tracking Status from the form. This is the
  //    manual path for couriers with no tracking API here (Shipglobal /
  //    OnPoint, or a parcel entered by hand): it moves the order the same way
  //    a courier webhook would — orders.status, dispatch date, shipment status,
  //    order_shipments delivered fields and the dispatch summary all together,
  //    so the Order page, Orders list, Track Shipments and the PDF agree.
  //
  //    2026-11-23b — "Delivered marks every AWB": the call below used to have
  //    no shipment scope, so syncOrderTrackingState wrote delivered_status to
  //    EVERY order_shipments row of a multi-shipment order. A tracking status
  //    now moves exactly one shipment — the one picked in the form's Shipment
  //    dropdown, or the shipment this same save just created/updated — and a
  //    multi-AWB order refuses the save until it is picked. The ORDER still
  //    follows the weakest-link rule inside syncOrderTrackingState, so it only
  //    turns Delivered once every AWB is.
  const trackingStatus = str(formData, "tracking_status");
  if (trackingStatus) {
    if (!isTrackingState(trackingStatus)) {
      return { error: `Tracking status "${trackingStatus}" is not valid.`, success: false, dispatched };
    }
    const { data: shipmentRows, error: shipmentListError } = await supabase
      .from("order_shipments")
      .select("id")
      .eq("order_id", orderId);
    if (shipmentListError) return { error: shipmentListError.message, success: false, dispatched };
    const orderShipmentIds = (shipmentRows ?? []).map((row) => row.id);
    const requestedShipmentId = strOrNull(formData, "shipment_id");
    if (requestedShipmentId && !orderShipmentIds.includes(requestedShipmentId)) {
      return { error: "That shipment doesn't belong to this order.", success: false, dispatched };
    }
    const targetShipmentId = requestedShipmentId ?? shipmentId;
    if (!targetShipmentId && orderShipmentIds.length > 1) {
      return {
        error: "This order has more than one AWB — choose the Shipment this tracking status applies to.",
        success: false,
        dispatched,
      };
    }
    await syncOrderTrackingState(supabase, orderId, trackingStatus, {
      force: true,
      deliveredDate: strOrNull(formData, "delivered_date"),
      shipmentIds: targetShipmentId ? [targetShipmentId] : undefined,
    });
    trackingSync = trackingStatus;
  }

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/order-packages");
  revalidatePath("/dashboard/courier-booking");
  revalidatePath(`/dashboard/courier-booking/shipment`);
  return { error: null, success: true, dispatched, trackingSync };
}
