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

export type ShippingDetailsState = { error: string | null; success: boolean; dispatched: boolean; trackingSync?: string | null };

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

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

const KNOWN_COURIERS = ["fedex", "ups", "aramex", "delhivery", "shiprocket", "dhl"] as const;
type CourierRowKey = (typeof KNOWN_COURIERS)[number] | "other";

// Free-text courier -> the courier_shipments.courier enum value. Matches on
// substring because staff type "FedEx", "fedex india", "FedEx Express"…
function courierRowForName(courierName: string | null): { courier: CourierRowKey; manual_courier_name: string | null } {
  const name = (courierName ?? "").trim();
  const lower = name.toLowerCase();
  const known = KNOWN_COURIERS.find((k) => lower.includes(k));
  if (known) return { courier: known, manual_courier_name: null };
  return { courier: "other", manual_courier_name: name || null };
}

// 2026-10-26 — "AWB/weight/dimension/invoice no & date har jagah update kyu
// nahi hote": this form only ever wrote order_shipments/order_packages, so
// the same AWB never showed up on Courier Booking -> Track Shipments (which
// reads courier_shipments), its Shipment Detail page, NDR, pickups or the
// daily report. This mirrors that row for a manually-entered AWB.
//
// Deliberately conservative: a row already owned by a real courier API
// booking is never rewritten (its AWB/amount/payload belong to the API),
// and an existing row that already carries a DIFFERENT AWB is left alone
// rather than silently repointed — this form is for the order's own
// shipment, not for re-labelling someone else's booking.
async function syncCourierShipmentRow(
  supabase: ServiceClient,
  args: { orderId: string; orderShipmentId: string; awbNo: string | null; courierName: string | null; employeeId: string }
): Promise<string | null> {
  if (!args.awbNo && !args.courierName) return null;
  const mapped = courierRowForName(args.courierName);

  const { data: rows, error } = await supabase
    .from("courier_shipments")
    .select("id, courier, awb_no, booked_amount_source")
    .eq("order_id", args.orderId);
  if (error) return error.message;

  const sameCourier = (rows ?? []).find((r) => r.courier === mapped.courier) ?? null;
  if (sameCourier) {
    if (sameCourier.booked_amount_source === "api") return null;
    if (sameCourier.awb_no && args.awbNo && sameCourier.awb_no !== args.awbNo) return null;
    const { error: updateError } = await supabase
      .from("courier_shipments")
      .update({
        order_shipment_id: args.orderShipmentId,
        awb_no: args.awbNo ?? sameCourier.awb_no,
        manual_courier_name: mapped.manual_courier_name,
      })
      .eq("id", sameCourier.id);
    return updateError?.message ?? null;
  }

  const sameAwb = args.awbNo ? (rows ?? []).find((r) => r.awb_no === args.awbNo) ?? null : null;
  if (sameAwb) {
    const { error: updateError } = await supabase
      .from("courier_shipments")
      .update({ order_shipment_id: args.orderShipmentId })
      .eq("id", sameAwb.id);
    return updateError?.message ?? null;
  }

  const { error: insertError } = await supabase.from("courier_shipments").insert({
    courier: mapped.courier,
    manual_courier_name: mapped.manual_courier_name,
    order_id: args.orderId,
    order_shipment_id: args.orderShipmentId,
    status: "created",
    awb_no: args.awbNo,
    booked_amount_source: "manual",
    created_by: args.employeeId,
  });
  return insertError?.message ?? null;
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
    if (order.status !== "Dispatched") {
      const { error: stError } = await supabase
        .from("orders")
        .update({ status: "Dispatched", dispatch_date: order.dispatch_date ?? invoiceDate ?? today })
        .eq("id", orderId);
      if (stError) return { error: stError.message, success: false, dispatched: false };
    } else if (!order.dispatch_date) {
      await supabase.from("orders").update({ dispatch_date: invoiceDate ?? today }).eq("id", orderId);
    }
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

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/order-packages");
  revalidatePath("/dashboard/courier-booking");
  return { error: null, success: true, dispatched, trackingSync };
}
