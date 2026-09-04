"use server";

// Cancel Shipment (EGS-integration round, 2026-09-04 — EGS's own Shipment
// History Detail page has this exact modal: reason dropdown + remark).
// Marks the courier_shipments row 'cancelled' (see
// db/2026-09-04-egs-integration-pickup-and-cancel.sql for the widened
// CHECK constraint + new columns) and flips the order back off "Shipped".
//
// HONEST SCOPE: this does NOT call any courier's real cancel-shipment API
// — none of the 6 couriers' cancel/void endpoints have been researched or
// verified (same "never fake an unverified API call" standard as Pickup
// Request — see that feature's own actions file). This records that the
// shipment was cancelled on OUR side; staff still need to cancel/void the
// AWB with the courier directly if it was already manifested with them.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export type CancelShipmentState = { error: string | null; success: boolean };
const INITIAL: CancelShipmentState = { error: null, success: false };

export async function cancelShipment(_prev: CancelShipmentState, formData: FormData): Promise<CancelShipmentState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const courierShipmentId = str(formData, "courier_shipment_id");
  const reason = str(formData, "cancel_reason");
  if (!courierShipmentId) return { ...INITIAL, error: "Missing shipment." };
  if (!reason) return { ...INITIAL, error: "Pick a cancellation reason." };

  const { data: shipment } = await supabase.from("courier_shipments").select("id, order_id").eq("id", courierShipmentId).maybeSingle();
  if (!shipment) return { ...INITIAL, error: "Shipment not found." };

  const { data: order } = await supabase.from("orders").select("id").eq("id", shipment.order_id).in("company_id", employee.companyIds).maybeSingle();
  if (!order) return { ...INITIAL, error: "Not authorized for this shipment's company." };

  const { error } = await supabase
    .from("courier_shipments")
    .update({
      status: "cancelled",
      cancel_reason: reason,
      cancel_remark: strOrNull(formData, "cancel_remark"),
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", courierShipmentId);
  if (error) return { ...INITIAL, error: error.message };

  // Order was flagged 'Shipped' at booking time (writeOrderShipmentFromBooking
  // in ../actions.ts) — cancelling the shipment reverts that so it shows
  // back up in Pending Orders / doesn't read as in-flight.
  await supabase.from("orders").update({ shipment_status: "Cancelled" }).eq("id", shipment.order_id);

  revalidatePath("/dashboard/courier-booking");
  revalidatePath(`/dashboard/courier-booking/shipment/${courierShipmentId}`);
  return { error: null, success: true };
}
