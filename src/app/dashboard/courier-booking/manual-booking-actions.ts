"use server";

// Manual Entry (Booked Outside) — for a shipment that was ALREADY booked
// with some courier or process entirely outside this app (not one of the
// 6 integrated couriers this Book Shipment tab otherwise calls real APIs
// for — see actions.ts's header comment), where staff still want the
// dimension/weight/courier-charge on file so the cost shows up in Track
// Shipments and feeds the same Booked-vs-Billed reconciliation Freight
// Bill entry already reads off order_shipments.booked_freight_amt /
// booked_currency (documents/freight-bill-section.tsx and friends) — see
// db/2026-09-04-manual-external-booking.sql.
//
// This writes the SAME two tables every create*Booking action in
// actions.ts writes (order_shipments + courier_shipments), just with
// booked_amount_source = 'manual' as the discriminator (this codebase's
// established "*_source" convention — see e.g. bill_pass_register.source /
// received_chalans.source) instead of 'api'/'rate_card_estimate', and with
// NO courier API ever called — request_payload/response_payload stay
// null. That is deliberate: the user explicitly asked for a REAL row here
// (shows up in Track Shipments / Shipment Detail / the reconciliation
// banner exactly like a real booking), not a lightweight disconnected
// note.
//
// v1 SCOPE NOTE: unlike the 6 real create*Booking actions, this does NOT
// support the "Combine & Book" multiple-orders-into-one-AWB flow
// (applyCombinedSiblingShipments in actions.ts) — that helper is private
// to actions.ts and typed against the 6-courier union, and a manual entry
// is a rarer, single-shipment, staff-typed-it-in path. One manual entry =
// one order. Combine can be added later the same way actions.ts does it,
// if this turns out to be needed for manual entries too.
//
// 2026-09-05 FIX: ManualBookingCourierChoice/MANUAL_BOOKING_COURIERS used
// to live here, but this is a "use server" file and Next.js requires every
// export of one to be an async function — the moment create-shipment-
// form.tsx (a client component) imported that array directly from here,
// it crashed the whole /dashboard/courier-booking page with "A 'use
// server' file can only export async functions, found object." Moved to
// manual-booking-config.ts (plain data, no directive); both this file and
// the form now import from there instead of from each other.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";
import type { ManualBookingCourierChoice } from "./manual-booking-config";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

const COURIER_DISPLAY_LABEL: Record<Exclude<ManualBookingCourierChoice, "other">, string> = {
  fedex: "FedEx",
  ups: "UPS",
  aramex: "Aramex",
  delhivery: "Delhivery",
  shiprocket: "Shiprocket",
  dhl: "DHL",
};

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
  return Number.isFinite(n) ? n : null;
}

async function getNextShipmentNo(supabase: ServiceClient, orderId: string): Promise<number> {
  const { data } = await supabase.from("order_shipments").select("shipment_no").eq("order_id", orderId).order("shipment_no", { ascending: false }).limit(1);
  return (data?.[0]?.shipment_no ?? 0) + 1;
}

export type ManualBookingState = {
  error: string | null;
  success: boolean;
  shipmentId: string | null;
  awbNo: string | null;
};

const MANUAL_BOOKING_INITIAL: ManualBookingState = { error: null, success: false, shipmentId: null, awbNo: null };

export async function createManualBooking(_prev: ManualBookingState, formData: FormData): Promise<ManualBookingState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { ...MANUAL_BOOKING_INITIAL, error: "Missing order — look it up again." };

  const courierChoice = str(formData, "manual_courier_choice") as ManualBookingCourierChoice | "";
  if (!courierChoice) return { ...MANUAL_BOOKING_INITIAL, error: "Pick a courier, or Other." };
  const isKnownCourier = courierChoice !== "other" && courierChoice in COURIER_DISPLAY_LABEL;
  if (courierChoice !== "other" && !isKnownCourier) return { ...MANUAL_BOOKING_INITIAL, error: "Unrecognized courier." };

  const manualCourierNameInput = strOrNull(formData, "manual_courier_name");
  if (courierChoice === "other" && !manualCourierNameInput) {
    return { ...MANUAL_BOOKING_INITIAL, error: "Enter the courier/process name for Other." };
  }
  const courierLabel = courierChoice === "other" ? manualCourierNameInput! : COURIER_DISPLAY_LABEL[courierChoice as Exclude<ManualBookingCourierChoice, "other">];

  const weightKg = numOrNull(formData, "package_weight_kg");
  if (weightKg == null) return { ...MANUAL_BOOKING_INITIAL, error: "Weight (kg) is required." };
  const lengthCm = numOrNull(formData, "package_length_cm");
  const widthCm = numOrNull(formData, "package_width_cm");
  const heightCm = numOrNull(formData, "package_height_cm");
  if (lengthCm == null || widthCm == null || heightCm == null) {
    return { ...MANUAL_BOOKING_INITIAL, error: "Length, Width and Height (cm) are required." };
  }

  const bookedAmt = numOrNull(formData, "booked_amt");
  if (bookedAmt == null) return { ...MANUAL_BOOKING_INITIAL, error: "Courier charges amount is required." };
  const bookedCurrency = str(formData, "booked_currency") || "INR";

  const awbNo = strOrNull(formData, "awb_no");
  const remarkNote = strOrNull(formData, "remark");
  const remark = `Manual entry — booked outside the app (${courierLabel}).${remarkNote ? ` ${remarkNote}` : ""}`;

  const { data: order } = await supabase.from("orders").select("id").eq("id", orderId).in("company_id", employee.companyIds).maybeSingle();
  if (!order) return { ...MANUAL_BOOKING_INITIAL, error: "Order not found (or not in a company you can access)." };

  const shipmentNo = await getNextShipmentNo(supabase, orderId);
  const { data: shipment, error: shipmentError } = await supabase
    .from("order_shipments")
    .upsert(
      {
        order_id: orderId,
        shipment_no: shipmentNo,
        awb_no: awbNo,
        courier_name: courierLabel,
        last_update_date: new Date().toISOString().slice(0, 10),
        created_by_employee_id: employee.id,
        booked_freight_amt: bookedAmt,
        booked_currency: bookedCurrency,
        booked_amount_source: "manual",
        remark,
      },
      { onConflict: "order_id,shipment_no" }
    )
    .select("id")
    .single();
  if (shipmentError || !shipment) return { ...MANUAL_BOOKING_INITIAL, error: shipmentError?.message ?? "Could not save the shipment." };

  await supabase.from("order_packages").upsert(
    {
      order_shipment_id: shipment.id,
      package_no: 1,
      length_cm: lengthCm,
      width_cm: widthCm,
      height_cm: heightCm,
      weight_kg: weightKg,
    },
    { onConflict: "order_shipment_id,package_no" }
  );

  await resyncDispatchSummary(supabase, orderId);
  await supabase.from("orders").update({ shipment_status: "Shipped" }).eq("id", orderId);

  const { error: attemptError } = await supabase.from("courier_shipments").upsert(
    {
      courier: courierChoice === "other" ? "other" : courierChoice,
      manual_courier_name: courierChoice === "other" ? manualCourierNameInput : null,
      order_id: orderId,
      order_shipment_id: shipment.id,
      status: "created",
      awb_no: awbNo,
      booked_amt: bookedAmt,
      booked_currency: bookedCurrency,
      booked_amount_source: "manual",
      created_by: employee.id,
    },
    { onConflict: "order_id,courier" }
  );
  if (attemptError) return { ...MANUAL_BOOKING_INITIAL, error: attemptError.message };

  revalidatePath("/dashboard/courier-booking");
  revalidatePath("/dashboard/orders");
  return { error: null, success: true, shipmentId: shipment.id, awbNo };
}
