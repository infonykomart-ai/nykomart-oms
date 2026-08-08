import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type ShipmentMatch = {
  orderId: string | null;
  orderRefNo: string | null;
  alreadyAssigned: boolean;
};

const NO_MATCH: ShipmentMatch = { orderId: null, orderRefNo: null, alreadyAssigned: false };

// Matches a parsed shipment's tracking number to an order via
// dispatch_invoices.awb_no — the same field Bulk Tracking Update writes
// (see src/app/dashboard/orders/bulk-tracking-update/actions.ts). The
// courier's own "Reference No. 1" field on the bill (e.g. "NK-369-25-26")
// does NOT match orders.ref_no's format ("PO-0001") — it's some other
// internal booking reference — so it's kept only for display, not used to
// auto-match. Unmatched shipments are still returned to the caller so the
// review screen can offer a manual PO/RF/RG-or-AWB lookup (reusing
// lookupOrderForReconciliation), same as the existing manual Courier Bill /
// Duty & Tax Bill entry flow.
export async function matchShipmentByTracking(
  supabase: ServiceClient,
  employeeCompanyIds: string[],
  billKind: "freight" | "duty",
  trackingNo: string
): Promise<ShipmentMatch> {
  const { data: byAwb } = await supabase.from("dispatch_invoices").select("order_id").ilike("awb_no", trackingNo).maybeSingle();
  if (!byAwb) return NO_MATCH;

  const { data: order } = await supabase.from("orders").select("id, ref_no, company_id").eq("id", byAwb.order_id).maybeSingle();
  if (!order || !employeeCompanyIds.includes(order.company_id)) return NO_MATCH;

  const table = billKind === "freight" ? "freight_bill_awb_assignments" : "duty_bill_awb_assignments";
  const { data: existing } = await supabase.from(table).select("id").eq("order_id", order.id).maybeSingle();

  return { orderId: order.id, orderRefNo: order.ref_no, alreadyAssigned: !!existing };
}
