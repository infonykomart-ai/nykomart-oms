"use server";

// Bill Payment (round 11) — the bill_payment dashboard tile ("Bill-payment
// entry (not yet built in the source system)" per its own seed comment)
// records an actual payment against an existing bill_pass_register row.
// bill_pass_register.total_paid used to be a plain hand-typed number with
// no audit trail; this adds a real payments ledger
// (bill_pass_register_payments — see
// db/2026-08-12-round11-unbuilt-dashboard-sections.sql) and recomputes
// total_paid as the SUM of it on every insert, so the two can never drift.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type RecordPaymentState = { error: string | null; success: boolean };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export async function recordBillPayment(_prev: RecordPaymentState, formData: FormData): Promise<RecordPaymentState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const billId = str(formData, "bill_pass_register_id");
  const amountStr = str(formData, "amount");
  const amount = Number(amountStr);
  const paymentDate = str(formData, "payment_date");

  if (!billId) return { error: "Bill not specified.", success: false };
  if (!amountStr || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Payment amount must be a positive number.", success: false };
  }
  if (!paymentDate) return { error: "Payment date is required.", success: false };

  const { data: bill, error: billError } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, balance_due")
    .eq("id", billId)
    .single();
  if (billError || !bill) return { error: "Bill not found.", success: false };
  if (!employee.companyIds.includes(bill.company_id)) {
    return { error: "You don't have access to this bill's company.", success: false };
  }
  if (Number(bill.balance_due) <= 0) {
    return { error: "This bill has no balance due.", success: false };
  }

  const { error: insertError } = await supabase.from("bill_pass_register_payments").insert({
    bill_pass_register_id: billId,
    amount,
    payment_date: paymentDate,
    payment_mode: strOrNull(formData, "payment_mode"),
    reference_no: strOrNull(formData, "reference_no"),
    remark: strOrNull(formData, "remark"),
    entered_by: employee.id,
  });
  if (insertError) return { error: insertError.message, success: false };

  // Recompute total_paid from the payments ledger (never trust an
  // incremented value client-side — a concurrent second payment could
  // race it) — see this file's header comment.
  const { data: payments } = await supabase
    .from("bill_pass_register_payments")
    .select("amount")
    .eq("bill_pass_register_id", billId);
  const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  const { error: updateError } = await supabase
    .from("bill_pass_register")
    .update({ total_paid: totalPaid, payment_by_employee_id: employee.id })
    .eq("id", billId);
  if (updateError) return { error: updateError.message, success: false };

  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: true };
}
