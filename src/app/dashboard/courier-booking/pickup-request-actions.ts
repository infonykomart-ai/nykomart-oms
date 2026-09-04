"use server";

// Pickup Request tab (EGS-integration round, 2026-09-04) — mirrors EGS's
// own "Pickup Request" page: pick courier + pickup address + booking date
// + scheduled pickup date, select from a table of matching booked-not-yet-
// picked-up AWBs, submit.
//
// HONEST SCOPE (see db/2026-09-04-egs-integration-pickup-and-cancel.sql's
// header comment for the full reasoning): unlike the Compare Courier
// Rates round, where each courier's rate-quote API was actually researched
// and a confidence level assigned per courier, NO courier's real pickup-
// scheduling API has been researched or verified here. This action
// creates an INTERNAL request record only — it does not call FedEx/UPS/
// Aramex/Delhivery/Shiprocket/DHL to actually schedule a reverse pickup.
// Staff still need to arrange the physical pickup with the courier
// themselves (phone/portal/account rep, whatever that courier's normal
// process is) — this just gives them one place to see "what did we ask
// to be picked up, and when."
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { CourierKey } from "@/lib/couriers/credentials";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export type CreatePickupRequestState = { error: string | null; success: boolean };
const INITIAL: CreatePickupRequestState = { error: null, success: false };

export async function createPickupRequest(_prev: CreatePickupRequestState, formData: FormData): Promise<CreatePickupRequestState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const courier = str(formData, "courier") as CourierKey;
  const pickupAddress = str(formData, "pickup_address");
  const bookingDate = str(formData, "booking_date");
  const scheduledPickupDate = str(formData, "scheduled_pickup_date");
  const orderShipmentIds = formData.getAll("order_shipment_ids").map(String).filter(Boolean);

  if (!courier) return { ...INITIAL, error: "Pick a courier." };
  if (!pickupAddress) return { ...INITIAL, error: "Pickup address is required — set up the Shipper Profile first if it's empty." };
  if (!bookingDate || !scheduledPickupDate) return { ...INITIAL, error: "Booking Date and Scheduled Pickup Date are both required." };
  if (orderShipmentIds.length === 0) return { ...INITIAL, error: "Select at least one AWB." };

  const { data: request, error } = await supabase
    .from("courier_pickup_requests")
    .insert({
      company_id: employee.currentCompanyId,
      courier,
      pickup_address: pickupAddress,
      booking_date: bookingDate,
      scheduled_pickup_date: scheduledPickupDate,
      remark: str(formData, "remark") || null,
      created_by_employee_id: employee.id,
    })
    .select("id")
    .single();

  if (error || !request) return { ...INITIAL, error: error?.message ?? "Could not create the pickup request." };

  const { error: linkError } = await supabase
    .from("courier_pickup_request_awbs")
    .insert(orderShipmentIds.map((orderShipmentId) => ({ pickup_request_id: request.id, order_shipment_id: orderShipmentId })));
  if (linkError) return { ...INITIAL, error: `Request created but linking AWBs failed: ${linkError.message}` };

  revalidatePath("/dashboard/courier-booking");
  return { error: null, success: true };
}
