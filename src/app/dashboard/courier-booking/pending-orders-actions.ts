"use server";

// Pending Orders tab (EGS-integration round, 2026-09-04) — the
// buyer-info-edit modal (EGS's own Pending Orders page has one: address/
// contact fields, editable inline before booking). Deliberately a small,
// FOCUSED action touching only the fields that modal edits — NOT a
// reimplementation of orders/actions.ts's updateOrder (the full Order Edit
// form), which also recomputes currency conversion and touches many more
// fields this modal never shows. Same requireCapability gate as the rest
// of this dashboard (courier_booking_shipment — booking staff, not full
// Order Entry access, are exactly who uses this tab).
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

export type BuyerInfoEditState = { error: string | null; success: boolean };
const INITIAL: BuyerInfoEditState = { error: null, success: false };

export async function updateOrderBuyerInfo(_prev: BuyerInfoEditState, formData: FormData): Promise<BuyerInfoEditState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { ...INITIAL, error: "Missing order." };

  const { error } = await supabase
    .from("orders")
    .update({
      buyer_name_address: strOrNull(formData, "buyer_name_address"),
      contact_no: strOrNull(formData, "contact_no"),
      email_id: strOrNull(formData, "email_id"),
      destination_country: strOrNull(formData, "destination_country"),
    })
    .eq("id", orderId)
    .in("company_id", employee.companyIds);

  if (error) return { ...INITIAL, error: error.message };
  revalidatePath("/dashboard/courier-booking");
  return { error: null, success: true };
}
