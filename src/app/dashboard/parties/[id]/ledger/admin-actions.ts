"use server";

// 2026-09-13 — "sath me admin ke pass to kisi bill ko edit deleate modify ka
// option hona chahiye na, kyuki kai entry galat date me ho jati hai, kuch
// par payment galt dal jata hai or galat update ho jata hai" — the Party
// Ledger previously had NO way to fix a wrong bill/payment row at all: a
// bill typed on the wrong date, or a payment entered against the wrong
// bill, stayed wrong forever (short of raw SQL). These four actions add
// exactly that, gated on the existing `employee_admin` capability — the
// same gate the Employees admin screen uses, i.e. Admin/MD by default —
// NOT plain `bill_payment`, because editing money rows retroactively is a
// more sensitive act than recording a payment.
//
// Edit vs delete rules (deliberately different, mirroring
// bill-payment/actions.ts's existing source-gating):
//  - EDIT a bill: allowed for every row INCLUDING auto-mirrored ones
//    (source = purchase_bill/freight_bill/duty_tax_bill). That is a
//    conscious exception to updateBillPassRegisterEntry's source IS NULL
//    rule over there: the user explicitly asked for Admin to be able to
//    fix "galat date me ho jati hai" entries, and mirrored bills are the
//    majority of this ledger. Editing a MIRROR's own display/date/amount
//    fields here writes bill_pass_register directly (the mirror), not the
//    source document — the note shown in the UI says to prefer fixing the
//    Purchase/Courier/Duty Bill at its source screen when the amount
//    itself is wrong, so the two don't drift for long.
//  - DELETE a bill: source IS NULL only, same as everywhere else in this
//    app — deleting a mirrored row here would desync it from its source
//    document (the bill would resurrect in Approvals/Bill Payment from the
//    source), so mirrors must be deleted at their source screen.
//  - EDIT/DELETE a payment: always allowed for Admin — a payment is a
//    standalone ledger event with no mirror anywhere. After either, the
//    bill's total_paid is recomputed FROM the payments ledger (same
//    never-trust-a-hand-typed-total rule as recordBillPayment), which also
//    fixes the reverse mistake the user described ("payment galt dal jata
//    hai or galat update ho jata hai").
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type LedgerAdminState = { error: string | null; success: boolean };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

async function revalidateLedgers(supabase: ReturnType<typeof createServiceRoleClient>, partyId: string) {
  // Company can't change what the ledger shows beyond scoping, and this
  // view has a cross-company mode — revalidate broadly, same reasoning as
  // switchCompanyAction's deliberately-wide revalidate (see BRAIN.md §7).
  revalidatePath(`/dashboard/parties/${partyId}/ledger`);
  revalidatePath("/dashboard/parties");
  revalidatePath("/dashboard/bill-payment");
  void supabase;
}

/** Admin edit of one bill_pass_register row (mirror rows included — see header). */
export async function adminEditBill(_prev: LedgerAdminState, formData: FormData): Promise<LedgerAdminState> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const billId = str(formData, "bill_id");
  const partyId = str(formData, "party_id");
  if (!billId || !partyId) return { error: "Missing bill/party reference.", success: false };

  const { data: bill } = await supabase.from("bill_pass_register").select("id, company_id").eq("id", billId).single();
  if (!bill || !employee.companyIds.includes(bill.company_id)) {
    return { error: "Bill not found or not in a company you can access.", success: false };
  }

  const totalAmtStr = str(formData, "total_amt");
  const totalAmt = Number(totalAmtStr);
  if (!totalAmtStr || !Number.isFinite(totalAmt) || totalAmt < 0) {
    return { error: "Bill Amount must be a non-negative number.", success: false };
  }
  const creditNoteAmt = Number(str(formData, "credit_note_amt")) || 0;
  if (creditNoteAmt < 0) return { error: "Credit Note amount cannot be negative.", success: false };

  const { error } = await supabase
    .from("bill_pass_register")
    .update({
      invoice_no: strOrNull(formData, "invoice_no"),
      vendor_invoice_no: strOrNull(formData, "vendor_invoice_no"),
      invoice_date: strOrNull(formData, "invoice_date"),
      invoice_recv_date: strOrNull(formData, "invoice_recv_date"),
      total_amt: totalAmt,
      credit_note_amt: creditNoteAmt,
      remark: strOrNull(formData, "remark"),
    })
    .eq("id", billId);
  if (error) return { error: error.message, success: false };

  await revalidateLedgers(supabase, partyId);
  return { error: null, success: true };
}

/** Admin delete of one bill — manual/imported rows only (source IS NULL). */
export async function adminDeleteBill(billId: string, partyId: string): Promise<LedgerAdminState> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const { data: bill } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, source, invoice_no")
    .eq("id", billId)
    .single();
  if (!bill || !employee.companyIds.includes(bill.company_id)) {
    return { error: "Bill not found or not in a company you can access.", success: false };
  }
  if (bill.source) {
    return {
      error: `This is an auto-mirrored ${bill.source.replace(/_/g, " ")} entry — delete it at its source screen (Purchase/Courier/Duty Bill) instead, so the two records stay in sync.`,
      success: false,
    };
  }

  // Delete the bill's payment rows first (no ON DELETE CASCADE guaranteed
  // on this FK in every historical schema load — do it explicitly).
  const { error: payError } = await supabase
    .from("bill_pass_register_payments")
    .delete()
    .eq("bill_pass_register_id", billId);
  if (payError) return { error: payError.message, success: false };

  const { error } = await supabase.from("bill_pass_register").delete().eq("id", billId);
  if (error) return { error: error.message, success: false };

  await revalidateLedgers(supabase, partyId);
  return { error: null, success: true };
}

/** Admin edit of one payment row; recomputes the bill's total_paid from the ledger. */
export async function adminEditPayment(_prev: LedgerAdminState, formData: FormData): Promise<LedgerAdminState> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const paymentId = str(formData, "payment_id");
  const partyId = str(formData, "party_id");
  if (!paymentId || !partyId) return { error: "Missing payment/party reference.", success: false };

  const { data: payment } = await supabase
    .from("bill_pass_register_payments")
    .select("id, bill_pass_register_id")
    .eq("id", paymentId)
    .single();
  if (!payment) return { error: "Payment not found.", success: false };

  const { data: bill } = await supabase
    .from("bill_pass_register")
    .select("company_id")
    .eq("id", payment.bill_pass_register_id)
    .single();
  if (!bill || !employee.companyIds.includes(bill.company_id)) {
    return { error: "Payment's bill not in a company you can access.", success: false };
  }

  const amountStr = str(formData, "amount");
  const amount = Number(amountStr);
  if (!amountStr || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be a positive number.", success: false };
  }
  const paymentDate = str(formData, "payment_date");
  if (!paymentDate) return { error: "Payment date is required.", success: false };

  const { error } = await supabase
    .from("bill_pass_register_payments")
    .update({
      amount,
      payment_date: paymentDate,
      payment_mode: strOrNull(formData, "payment_mode"),
      reference_no: strOrNull(formData, "reference_no"),
      remark: strOrNull(formData, "remark"),
    })
    .eq("id", paymentId);
  if (error) return { error: error.message, success: false };

  await recomputeTotalPaid(supabase, payment.bill_pass_register_id);
  await revalidateLedgers(supabase, partyId);
  return { error: null, success: true };
}

/**
 * 2026-09-15 — batch edit for a MERGED payment line. The ledger now
 * collapses an invoice's same-(date, mode, UTR) payment rows into one
 * line ("13 payments merged"); the Admin edit form on that line edits the
 * WHOLE batch: one total amount + shared date/mode/UTR/remark. The total
 * is re-split across the batch's rows proportionally to their current
 * split (rounding drift absorbed by the largest row), and every affected
 * bill's total_paid is recomputed from the ledger afterwards.
 */
export async function adminEditPaymentBatch(_prev: LedgerAdminState, formData: FormData): Promise<LedgerAdminState> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const ids = str(formData, "payment_ids").split(",").map((s) => s.trim()).filter(Boolean);
  const partyId = str(formData, "party_id");
  if (ids.length === 0 || !partyId) return { error: "Missing payment/party reference.", success: false };

  const amountStr = str(formData, "amount");
  const amount = Number(amountStr);
  if (!amountStr || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be a positive number.", success: false };
  }
  const paymentDate = str(formData, "payment_date");
  if (!paymentDate) return { error: "Payment date is required.", success: false };

  const { data: rows } = await supabase
    .from("bill_pass_register_payments")
    .select("id, amount, bill_pass_register_id")
    .in("id", ids);
  if (!rows || rows.length !== ids.length) return { error: "Some payments in this batch were not found.", success: false };

  const billIds = Array.from(new Set(rows.map((r) => r.bill_pass_register_id)));
  const { data: bills } = await supabase.from("bill_pass_register").select("id, company_id").in("id", billIds);
  const allowed = new Set((bills ?? []).filter((b) => employee.companyIds.includes(b.company_id)).map((b) => b.id));
  if (rows.some((r) => !allowed.has(r.bill_pass_register_id))) {
    return { error: "Payment's bill not in a company you can access.", success: false };
  }

  if (amount < 0.01 * rows.length) {
    return { error: `Amount too small to split across ${rows.length} payment rows.`, success: false };
  }
  const split = splitBatchAmount(amount, rows.map((r) => Number(r.amount)));
  const sharedFields = {
    payment_date: paymentDate,
    payment_mode: strOrNull(formData, "payment_mode"),
    reference_no: strOrNull(formData, "reference_no"),
    remark: strOrNull(formData, "remark"),
  };
  for (let i = 0; i < rows.length; i++) {
    const { error } = await supabase
      .from("bill_pass_register_payments")
      .update({ amount: split[i], ...sharedFields })
      .eq("id", rows[i].id);
    if (error) return { error: error.message, success: false };
  }

  for (const billId of billIds) await recomputeTotalPaid(supabase, billId);
  await revalidateLedgers(supabase, partyId);
  return { error: null, success: true };
}

/** Batch delete for a merged payment line — removes every underlying row at once. */
export async function adminDeletePaymentBatch(paymentIds: string, partyId: string): Promise<LedgerAdminState> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const ids = paymentIds.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return { error: "Missing payment reference.", success: false };

  const { data: rows } = await supabase
    .from("bill_pass_register_payments")
    .select("id, bill_pass_register_id")
    .in("id", ids);
  if (!rows || rows.length !== ids.length) return { error: "Some payments in this batch were not found.", success: false };

  const billIds = Array.from(new Set(rows.map((r) => r.bill_pass_register_id)));
  const { data: bills } = await supabase.from("bill_pass_register").select("id, company_id").in("id", billIds);
  const allowed = new Set((bills ?? []).filter((b) => employee.companyIds.includes(b.company_id)).map((b) => b.id));
  if (rows.some((r) => !allowed.has(r.bill_pass_register_id))) {
    return { error: "Payment's bill not in a company you can access.", success: false };
  }

  const { error } = await supabase.from("bill_pass_register_payments").delete().in("id", ids);
  if (error) return { error: error.message, success: false };

  for (const billId of billIds) await recomputeTotalPaid(supabase, billId);
  await revalidateLedgers(supabase, partyId);
  return { error: null, success: true };
}

// Proportional re-split of a new batch total across its rows, keeping each
// row's current share (all rows are > 0 by the table's CHECK constraint) and
// letting the largest row absorb the paise of rounding drift so the parts
// always sum back to exactly `total`.
function splitBatchAmount(total: number, weights: number[]): number[] {
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => Math.max(0.01, Math.round(((total * w) / wsum) * 100) / 100));
  const drift = Math.round((total - raw.reduce((a, b) => a + b, 0)) * 100) / 100;
  const maxIdx = raw.indexOf(Math.max(...raw));
  raw[maxIdx] = Math.round((raw[maxIdx] + drift) * 100) / 100;
  return raw;
}

/** Admin delete of one payment; recomputes the bill's total_paid from the ledger. */
export async function adminDeletePayment(paymentId: string, partyId: string): Promise<LedgerAdminState> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const { data: payment } = await supabase
    .from("bill_pass_register_payments")
    .select("id, bill_pass_register_id")
    .eq("id", paymentId)
    .single();
  if (!payment) return { error: "Payment not found.", success: false };

  const { data: bill } = await supabase
    .from("bill_pass_register")
    .select("company_id")
    .eq("id", payment.bill_pass_register_id)
    .single();
  if (!bill || !employee.companyIds.includes(bill.company_id)) {
    return { error: "Payment's bill not in a company you can access.", success: false };
  }

  const { error } = await supabase.from("bill_pass_register_payments").delete().eq("id", paymentId);
  if (error) return { error: error.message, success: false };

  await recomputeTotalPaid(supabase, payment.bill_pass_register_id);
  await revalidateLedgers(supabase, partyId);
  return { error: null, success: true };
}

async function recomputeTotalPaid(supabase: ReturnType<typeof createServiceRoleClient>, billId: string) {
  // Same sum-from-ledger rule as recordBillPayment — balance_due is a
  // GENERATED column off total_paid, so fixing total_paid here fixes the
  // paid/pending status colors on the ledger automatically.
  const { data: payments } = await supabase
    .from("bill_pass_register_payments")
    .select("amount")
    .eq("bill_pass_register_id", billId);
  const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  await supabase.from("bill_pass_register").update({ total_paid: totalPaid }).eq("id", billId);
}
