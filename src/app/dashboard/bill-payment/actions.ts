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

// -----------------------------------------------------------------------
// Bulk payment — 2026-08-17. "FEDEX KE YA UPS KE 5 BILL EK SATH PAYMENT
// KIYA HAI UN SABHI KO SELECT KAR KE EK SATH PAYMENT REFRANCE UPDATE KAR
// SAKE" — when several bills from the same party were paid together in one
// bank transaction, select all of them and enter the payment date/mode/
// reference/remark ONCE instead of repeating "Record Payment" per row. The
// amount is still per-bill (defaults to that bill's balance due, but stays
// editable in case only part of a bill was covered by that transaction),
// while date/mode/reference_no/remark are shared across every selected
// bill. Same "keep going, report per-item" tolerance as Purchase Bill
// Multi / the chalan forms — one bad row shouldn't roll back the rest,
// and the caller needs to see exactly which ones actually went through.
// -----------------------------------------------------------------------

export type BulkPaymentState = {
  error: string | null;
  success: { results: { billId: string; label: string; ok: boolean; error: string | null }[] } | null;
};

export async function recordBulkBillPayment(_prev: BulkPaymentState, formData: FormData): Promise<BulkPaymentState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const paymentDate = str(formData, "payment_date");
  if (!paymentDate) return { error: "Payment date is required.", success: null };
  const paymentMode = strOrNull(formData, "payment_mode");
  const referenceNo = strOrNull(formData, "reference_no");
  const remark = strOrNull(formData, "remark");

  let billIds: string[];
  try {
    billIds = JSON.parse(str(formData, "bill_ids_json") || "[]");
  } catch {
    return { error: "Invalid selection — please retry.", success: null };
  }
  if (!billIds.length) return { error: "Select at least one bill.", success: null };

  const results: { billId: string; label: string; ok: boolean; error: string | null }[] = [];

  for (const billId of billIds) {
    const amountStr = str(formData, `amount_${billId}`);
    const amount = Number(amountStr);

    const { data: bill, error: billError } = await supabase
      .from("bill_pass_register")
      .select("id, company_id, balance_due, invoice_no, vendor_invoice_no")
      .eq("id", billId)
      .single();
    const label = bill?.invoice_no || bill?.vendor_invoice_no || billId;

    if (billError || !bill) {
      results.push({ billId, label, ok: false, error: "Bill not found." });
      continue;
    }
    if (!employee.companyIds.includes(bill.company_id)) {
      results.push({ billId, label, ok: false, error: "You don't have access to this bill's company." });
      continue;
    }
    if (!amountStr || !Number.isFinite(amount) || amount <= 0) {
      results.push({ billId, label, ok: false, error: "Amount must be a positive number." });
      continue;
    }
    if (Number(bill.balance_due) <= 0) {
      results.push({ billId, label, ok: false, error: "This bill has no balance due." });
      continue;
    }
    if (amount > Number(bill.balance_due) + 0.01) {
      results.push({ billId, label, ok: false, error: `Amount exceeds balance due (${Number(bill.balance_due).toFixed(2)}).` });
      continue;
    }

    const { error: insertError } = await supabase.from("bill_pass_register_payments").insert({
      bill_pass_register_id: billId,
      amount,
      payment_date: paymentDate,
      payment_mode: paymentMode,
      reference_no: referenceNo,
      remark,
      entered_by: employee.id,
    });
    if (insertError) {
      results.push({ billId, label, ok: false, error: insertError.message });
      continue;
    }

    // Same recompute-from-ledger approach as the single-bill path above.
    const { data: payments } = await supabase
      .from("bill_pass_register_payments")
      .select("amount")
      .eq("bill_pass_register_id", billId);
    const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

    const { error: updateError } = await supabase
      .from("bill_pass_register")
      .update({ total_paid: totalPaid, payment_by_employee_id: employee.id })
      .eq("id", billId);

    results.push({ billId, label, ok: !updateError, error: updateError?.message ?? null });
  }

  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: { results } };
}
