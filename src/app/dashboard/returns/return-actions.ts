"use server";

// 2026-11-03b — RETURN REQUESTS (approval-gated) vs REFUNDS (immediate).
//
// Owner's rule, implemented literally:
//   "jab koi new refund ki entry ho to direct feel ho jaye lekin agar return ki
//    ho to uska approval ke liye admin md vagera ke pass jaye ... final
//    approval jaruri hai."
//
// So this file deliberately contains NO refund-writing code of its own: a
// refund raised from the Returns/Orders screen keeps going through the
// existing immediate saveOrderRefundCore() path. A RETURN is only ever a
// request_requests row until an employee holding the `return_approval`
// capability (MD/Admin — seeded by db/2026-11-03b-return-approval.sql)
// approves it; that approval is what marks the order Returned and, when a
// refund was requested, releases the refund through the same capped core.
import { revalidatePath } from "next/cache";
import { requireAnyCapability, requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { saveOrderRefundCore } from "@/app/dashboard/orders/actions";
import { isMissingAgreementSchema } from "@/lib/agreements/migration";

export const RETURN_MIGRATION_FILE = "db/2026-11-03b-return-approval.sql";

function schemaPending(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  if (isMissingAgreementSchema(error)) return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("return_requests");
}

const PENDING_HINT = `Run ${RETURN_MIGRATION_FILE} in the Supabase SQL editor to enable the return approval queue.`;

export type ReturnOrderOption = {
  id: string;
  refNo: string;
  buyer: string | null;
  status: string | null;
  currency: string;
  value: number | null;
  orderDate: string | null;
  marketplaceOrderNo: string | null;
};

/** Order lookup for the return form — same reference search the refund sheet uses. */
export async function searchOrdersForReturn(query: string): Promise<{ ok: true; orders: ReturnOrderOption[] } | { ok: false; error: string }> {
  const employee = await requireAnyCapability("order_entry", "reports", "return_approval");
  const term = (query ?? "").trim();
  if (term.length < 2) return { ok: true, orders: [] };

  const supabase = createServiceRoleClient();
  const safe = term.replace(/[%,()*\\]/g, " ").trim();
  const { data, error } = await supabase
    .from("orders")
    .select("id, ref_no, buyer_name_address, status, order_currency, order_value_original, order_date, marketplace_order_no")
    .in("company_id", employee.companyIds)
    .or(`ref_no.ilike.%${safe}%,marketplace_order_no.ilike.%${safe}%,buyer_name_address.ilike.%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    orders: (data ?? []).map((row) => ({
      id: row.id,
      refNo: row.ref_no,
      buyer: row.buyer_name_address,
      status: row.status,
      currency: row.order_currency,
      value: row.order_value_original,
      orderDate: row.order_date,
      marketplaceOrderNo: row.marketplace_order_no,
    })),
  };
}

export type CreateReturnInput = {
  orderId: string;
  reason: string;
  note?: string;
  /** Empty / null = a plain return with no money movement. */
  refundAmount?: number | null;
  refundCurrency?: string | null;
  refundDate?: string | null;
};

export async function createReturnRequest(
  input: CreateReturnInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const employee = await requireAnyCapability("order_entry", "reports", "return_approval");
  if (!input.orderId) return { ok: false, error: "Select the order being returned." };
  if (!input.reason?.trim()) return { ok: false, error: "A return reason is required." };

  const supabase = createServiceRoleClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, company_id, status")
    .eq("id", input.orderId)
    .maybeSingle();
  if (orderError) return { ok: false, error: orderError.message };
  if (!order) return { ok: false, error: "Order not found." };
  if (!employee.companyIds.includes(order.company_id)) {
    return { ok: false, error: "You do not have access to this order's company." };
  }

  const wantsRefund = input.refundAmount != null && Number(input.refundAmount) > 0;
  if (wantsRefund) {
    if (!input.refundCurrency) return { ok: false, error: "Refund currency is required when a refund amount is entered." };
    if (!input.refundDate) return { ok: false, error: "Refund date is required when a refund amount is entered." };
  }

  const { data: existingPending } = await supabase
    .from("return_requests")
    .select("id")
    .eq("order_id", order.id)
    .eq("status", "Pending")
    .limit(1)
    .maybeSingle();
  if (existingPending) return { ok: false, error: "A return request for this order is already pending approval." };

  const { data, error } = await supabase
    .from("return_requests")
    .insert({
      order_id: order.id,
      company_id: order.company_id,
      requested_by: employee.id,
      reason: input.reason.trim().slice(0, 2000),
      note: input.note?.trim().slice(0, 2000) || null,
      refund_amount: wantsRefund ? Number(input.refundAmount) : null,
      refund_currency: wantsRefund ? input.refundCurrency : null,
      refund_date: wantsRefund ? input.refundDate : null,
      status: "Pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    if (schemaPending(error)) return { ok: false, error: PENDING_HINT };
    return { ok: false, error: error?.message ?? "Could not submit the return request." };
  }

  revalidatePath("/dashboard/returns");
  return { ok: true, id: data.id };
}

export async function decideReturnRequest(input: {
  id: string;
  decision: "Approved" | "Rejected";
  note?: string;
}): Promise<{ ok: true; refundApplied: boolean } | { ok: false; error: string }> {
  const employee = await requireCapability("return_approval");
  if (!input.id) return { ok: false, error: "Missing return request." };

  const supabase = createServiceRoleClient();
  const { data: request, error } = await supabase
    .from("return_requests")
    .select("id, order_id, company_id, status, reason, refund_amount, refund_currency, refund_date, requested_by")
    .eq("id", input.id)
    .maybeSingle();

  if (error) {
    if (schemaPending(error)) return { ok: false, error: PENDING_HINT };
    return { ok: false, error: error.message };
  }
  if (!request) return { ok: false, error: "Return request not found." };
  if (!employee.companyIds.includes(request.company_id)) {
    return { ok: false, error: "You do not have access to this company." };
  }
  if (request.status !== "Pending") return { ok: false, error: `This request is already ${request.status.toLowerCase()}.` };
  if (request.requested_by && request.requested_by === employee.id) {
    return { ok: false, error: "You cannot approve a return you raised yourself — a second approver must decide it." };
  }

  // Claim the request FIRST, conditionally on it still being Pending. Two
  // approvers clicking together therefore cannot both apply the return (and
  // both release the refund): only one update matches a Pending row.
  const { data: claimed, error: claimError } = await supabase
    .from("return_requests")
    .update({
      status: input.decision,
      decided_by: employee.id,
      decided_at: new Date().toISOString(),
      decision_note: input.note?.trim().slice(0, 2000) || null,
    })
    .eq("id", request.id)
    .eq("status", "Pending")
    .select("id");

  if (claimError) return { ok: false, error: claimError.message };
  if (!claimed || claimed.length === 0) return { ok: false, error: "This return request was already decided by someone else." };

  if (input.decision === "Rejected") {
    revalidatePath("/dashboard/returns");
    return { ok: true, refundApplied: false };
  }

  // Approval is the ONLY place a return takes effect.
  const { data: orderRow } = await supabase.from("orders").select("status").eq("id", request.order_id).maybeSingle();
  const previousStatus = orderRow?.status ?? "Pending";

  const reopen = async (error: string) => {
    await supabase
      .from("return_requests")
      .update({ status: "Pending", decided_by: null, decided_at: null, decision_note: null })
      .eq("id", request.id);
    return { ok: false as const, error };
  };

  const { error: orderError } = await supabase.from("orders").update({ status: "Returned" }).eq("id", request.order_id);
  if (orderError) return reopen(`Could not mark the order Returned: ${orderError.message}`);

  let appliedRefundId: string | null = null;
  let refundApplied = false;

  if (request.refund_amount != null && Number(request.refund_amount) > 0) {
    const refundResult = await saveOrderRefundCore(employee, supabase, {
      orderId: request.order_id,
      refundAmount: Number(request.refund_amount),
      refundCurrency: request.refund_currency ?? "INR",
      refundDate: request.refund_date ?? new Date().toISOString().slice(0, 10),
      reason: request.reason,
    });
    if (refundResult.error) {
      // Nothing is half-applied: the order status goes back to what it was and
      // the request returns to Pending so the amount can be corrected.
      await supabase.from("orders").update({ status: previousStatus }).eq("id", request.order_id);
      return reopen(`Return approved, but the refund was rejected: ${refundResult.error}`);
    }
    refundApplied = true;
    const { data: latestRefund } = await supabase
      .from("order_refunds")
      .select("id")
      .eq("order_id", request.order_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    appliedRefundId = latestRefund?.id ?? null;

    if (appliedRefundId) {
      await supabase.from("return_requests").update({ applied_refund_id: appliedRefundId }).eq("id", request.id);
    }
  }

  revalidatePath("/dashboard/returns");
  revalidatePath("/dashboard/orders");
  return { ok: true, refundApplied };
}
