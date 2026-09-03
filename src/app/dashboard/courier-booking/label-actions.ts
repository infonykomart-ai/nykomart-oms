"use server";

// On-demand label generation for Delhivery and Shiprocket — the 2 of the 6
// couriers whose booking response never includes a label (see
// delhivery-ship.ts's and shiprocket-ship.ts's own header comments; the
// other 4 — FedEx/UPS/Aramex/DHL — already get a label back at booking
// time, captured into courier_shipments.label_url by actions.ts's
// logAttempt, nothing new needed for those). Separate call, callable any
// time after a shipment already exists (not folded into the booking
// actions in actions.ts) since a label can legitimately be (re-)generated
// later — first attempt failed, label lost, etc.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolveCourierCredentials } from "@/lib/couriers/credentials";
import { getDelhiveryLabel } from "@/lib/couriers/delhivery-label";
import { generateShiprocketLabel } from "@/lib/couriers/shiprocket-label";

export type GenerateLabelState = { error: string | null; success: boolean; labelUrl: string | null };

export async function generateLabelAction(_prev: GenerateLabelState, formData: FormData): Promise<GenerateLabelState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const shipmentId = String(formData.get("courier_shipment_id") ?? "");
  if (!shipmentId) return { error: "Missing shipment.", success: false, labelUrl: null };

  // Scope through the order — courier_shipments has no company_id column
  // of its own (see db/2026-09-01-multi-courier-booking-and-freight-recon.sql's
  // header comment), same transitive-scoping pattern used everywhere else
  // in this feature. Plain queries (not an embedded-resource join) — see
  // require-capability.ts's own comment on why this codebase's hand-rolled
  // Database type doesn't emit Relationships metadata for join shapes.
  const { data: row } = await supabase
    .from("courier_shipments")
    .select("id, courier, awb_no, status, response_payload, order_id")
    .eq("id", shipmentId)
    .single();

  if (!row) return { error: "Shipment not found.", success: false, labelUrl: null };

  const { data: order } = await supabase.from("orders").select("company_id").eq("id", row.order_id).single();
  const companyId = order?.company_id;
  if (!companyId || !employee.companyIds.includes(companyId)) {
    return { error: "Not authorized for this shipment's company.", success: false, labelUrl: null };
  }
  if (row.status !== "created" || !row.awb_no) {
    return { error: "This shipment was not booked successfully — nothing to label.", success: false, labelUrl: null };
  }
  if (row.courier !== "delhivery" && row.courier !== "shiprocket") {
    return { error: "This courier's label is already captured at booking time — nothing to generate.", success: false, labelUrl: null };
  }

  try {
    let labelUrl: string | null = null;
    if (row.courier === "delhivery") {
      const credentials = await resolveCourierCredentials(supabase, companyId, "delhivery");
      const result = await getDelhiveryLabel(row.awb_no, credentials);
      labelUrl = result.labelUrl;
    } else {
      const shiprocketShipmentId = (row.response_payload as { order?: { shipment_id?: number } } | null)?.order?.shipment_id;
      if (!shiprocketShipmentId) {
        return {
          error: "This Shiprocket shipment's internal shipment_id wasn't found in the saved booking response — cannot request a label.",
          success: false,
          labelUrl: null,
        };
      }
      const credentials = await resolveCourierCredentials(supabase, companyId, "shiprocket");
      const result = await generateShiprocketLabel(shiprocketShipmentId, credentials);
      labelUrl = result.labelUrl;
    }

    if (labelUrl) {
      await supabase.from("courier_shipments").update({ label_url: labelUrl }).eq("id", shipmentId);
    }

    revalidatePath("/dashboard/courier-booking");
    return { error: null, success: true, labelUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, success: false, labelUrl: null };
  }
}
