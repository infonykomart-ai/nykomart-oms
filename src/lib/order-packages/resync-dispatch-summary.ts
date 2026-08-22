// Gap 1 (multi-package per order, 2026-08-20) — see
// claude/gap1-multipackage-design-2026-08-20.md and the header comment on
// db/2026-08-20-order-shipments-and-packages.sql for the full reasoning.
//
// order_shipments (one row per real AWB) + order_packages (one row per
// physical box, FK'd to the shipment/AWB it travels under) are now the
// source of truth for an order's shipment detail. dispatch_invoices is
// KEPT as an order-level SUMMARY (too many existing read paths depend on
// its current shape) — this file is the one place that recomputes it,
// called after ANY write to order_shipments/order_packages for an order
// (manual entry, courier webhook, Shipglobal manifest, bulk CSV update).
//
// Sync rules (all confirmed with the user, 2026-08-20, or flagged as an
// explicit assumption where not directly asked):
//  - awb_no/courier_name: the single shared value when every shipment on
//    the order agrees, else a comma-joined display list (multi-AWB order).
//  - shipping_weight_kg/volumetric_weight: SUM across every package on
//    every shipment for the order.
//  - length_cm/width_cm/height_cm: no sane sum exists for dimensions, so
//    these mirror shipment_no=1's package_no=1 dims (today's single-
//    package behavior, unchanged) — a multi-package order's individual
//    package dims live on order_packages itself, not here.
//  - delivered_status: 'Delivered' ONLY once EVERY shipment for the order
//    is 'Delivered' — "weakest link". FLAGGED ASSUMPTION, confirmed by the
//    user rather than silently guessed: an order with 2 of 3 boxes
//    delivered is not shown as delivered.
//  - orders.shipment_status: mirrors the same weakest-link rule for
//    'Delivered'. RTO/In Transit are set directly by the caller (courier-
//    webhook event bucket), NOT derived here — see apply-tracking-event.ts.
import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function joinDistinct(values: (string | null)[]): string | null {
  const distinct = Array.from(new Set(values.filter((v): v is string => !!v)));
  if (distinct.length === 0) return null;
  return distinct.join(", ");
}

/**
 * Recomputes dispatch_invoices' summary columns for one order from its
 * current order_shipments/order_packages rows, and mirrors the weakest-
 * link 'Delivered' status onto orders.shipment_status.
 *
 * Safe to call with zero shipments for an order (e.g. order deleted its
 * only shipment) — dispatch_invoices is left untouched in that case rather
 * than blanked out, since other fields on that row (invoice_no, buyer
 * details, charges) are independently managed and shouldn't be wiped.
 */
export async function resyncDispatchSummary(supabase: ServiceClient, orderId: string): Promise<void> {
  const { data: shipments } = await supabase
    .from("order_shipments")
    .select("id, shipment_no, courier_name, awb_no, delivered_status, delivered_date, last_update_date")
    .eq("order_id", orderId)
    .order("shipment_no");

  if (!shipments || shipments.length === 0) return;

  const shipmentIds = shipments.map((s) => s.id);
  const { data: packages } = await supabase
    .from("order_packages")
    .select("order_shipment_id, package_no, weight_kg, length_cm, width_cm, height_cm, volumetric_weight")
    .in("order_shipment_id", shipmentIds);

  const allPackages = packages ?? [];
  const totalWeight = allPackages.reduce((sum, p) => sum + (p.weight_kg ? Number(p.weight_kg) : 0), 0);
  const totalVolumetric = allPackages.reduce((sum, p) => sum + (p.volumetric_weight ? Number(p.volumetric_weight) : 0), 0);
  const anyWeight = allPackages.some((p) => p.weight_kg != null);
  const anyVolumetric = allPackages.some((p) => p.volumetric_weight != null);

  const firstShipment = shipments.find((s) => s.shipment_no === 1) ?? shipments[0];
  const firstPackage = allPackages.find((p) => p.order_shipment_id === firstShipment.id && p.package_no === 1) ?? null;

  const awbNo = joinDistinct(shipments.map((s) => s.awb_no));
  const courierName = joinDistinct(shipments.map((s) => s.courier_name));

  const allDelivered = shipments.every((s) => s.delivered_status === "Delivered");
  const anyStatusSet = shipments.some((s) => s.delivered_status != null);
  const deliveredStatus: "Delivered" | "NOT Delivered" | null = !anyStatusSet ? null : allDelivered ? "Delivered" : "NOT Delivered";
  const deliveredDate = allDelivered
    ? shipments.reduce<string | null>((latest, s) => (s.delivered_date && (!latest || s.delivered_date > latest) ? s.delivered_date : latest), null)
    : null;
  const lastUpdateDate = shipments.reduce<string | null>(
    (latest, s) => (s.last_update_date && (!latest || s.last_update_date > latest) ? s.last_update_date : latest),
    null
  );

  await supabase
    .from("dispatch_invoices")
    .upsert(
      {
        order_id: orderId,
        courier_name: courierName,
        awb_no: awbNo,
        shipping_weight_kg: anyWeight ? totalWeight : null,
        volumetric_weight: anyVolumetric ? totalVolumetric : null,
        length_cm: firstPackage?.length_cm ?? null,
        width_cm: firstPackage?.width_cm ?? null,
        height_cm: firstPackage?.height_cm ?? null,
        delivered_status: deliveredStatus,
        delivered_date: deliveredDate,
        last_update_date: lastUpdateDate,
      },
      { onConflict: "order_id" }
    );

  if (deliveredStatus === "Delivered") {
    await supabase.from("orders").update({ shipment_status: "Delivered" }).eq("id", orderId);
  }
}
