"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type WallatRechargeResult = {
  error: string | null;
  success: boolean;
};

export async function wallatRecharge(
  _prev: WallatRechargeResult,
  formData: FormData,
): Promise<WallatRechargeResult> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const companyId = String(formData.get("company_id") || "");
  const partyId = String(formData.get("party_id") || "");
  const amount = Number(formData.get("amount") || "0");
  const paymentMaterial = String(formData.get("payment_material") || "bank");

  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to this company.", success: false };
  }
  if (!partyId) {
    return { error: "Choose a courier party.", success: false };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Recharge amount must be a positive number.", success: false };
  }
  if (!["bank", "credit_card", "phonpay"].includes(paymentMaterial as never)) {
    return { error: "Select a payment material (bank, credit card, or phonpay).", success: false };
  }

  const { data: targetParty } = await supabase
    .from("parties")
    .select("id, name, party_type")
    .eq("id", partyId)
    .maybeSingle();
  if (!targetParty) {
    return { error: "Courier party not found.", success: false };
  }

  const { error } = await supabase.from("party_wallet_txns").insert({
    company_id: companyId,
    party_id: partyId,
    txn_type: "recharge",
    direction: "in",
    amount,
    txn_date: new Date().toISOString().slice(0, 10),
    payment_mode: paymentMaterial,
    reference_no: null,
    remark: `Courriour wallat recharge funded from bank 5919 via ${paymentMaterial} by ${employee.name}`,
    entered_by: employee.id,
  });
  if (error) return { error: error.message, success: false };

  // 2026-10-10 — was revalidating a stale `/dashboard/payments/wallat`
  // path from before the route.ts → page.tsx move; the real page is
  // /dashboard/payments.
  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: true };
}
