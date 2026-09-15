"use server";

// 2026-09-15 — the consume half of the courier wallet (see
// wallet-actions.ts for the ledger design): when a FedEx/UPS invoice
// arrives, "Pay from Wallet" settles it out of the prepaid balance
// instead of a bank payment. Reuses the EXACT total_paid recompute
// pattern from recordBillPayment in actions.ts — only the source of the
// money differs. The wallet txn and the bill's total_paid are two
// statements, not one transaction (Supabase JS has no cross-table tx);
// the unique index uq_party_wallet_bill_consume makes a double-consume
// impossible, and a failed total_paid update leaves a consume row that
// the overview's recent list surfaces for manual fix — same
// tolerate-and-report philosophy as every other money action here.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type WalletPayState = { error: string | null; success: boolean };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function walletPayBill(_prev: WalletPayState, formData: FormData): Promise<WalletPayState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const billId = str(formData, "bill_pass_register_id");
  const amount = Number(str(formData, "amount"));
  const txnDate = str(formData, "txn_date") || new Date().toISOString().slice(0, 10);

  if (!billId) return { error: "Bill not specified.", success: false };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Wallet payment amount must be a positive number.", success: false };
  }

  const { data: bill, error: billError } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, party_id, balance_due")
    .eq("id", billId)
    .single();
  if (billError || !bill) return { error: "Bill not found.", success: false };
  if (!employee.companyIds.includes(bill.company_id)) {
    return { error: "You don't have access to this bill's company.", success: false };
  }
  if (!bill.party_id) return { error: "This bill has no party — a wallet needs a courier party.", success: false };
  if (Number(bill.balance_due) <= 0) return { error: "This bill has no balance due.", success: false };
  if (amount > Number(bill.balance_due) + 0.005) {
    return { error: `Amount ₹${amount.toFixed(2)} exceeds the bill's balance due ₹${Number(bill.balance_due).toFixed(2)}.`, success: false };
  }

  // Wallet balance for this (company, party) — must cover the payment.
  const { data: txns } = await supabase
    .from("party_wallet_txns")
    .select("direction, amount")
    .eq("company_id", bill.company_id)
    .eq("party_id", bill.party_id);
  const balance = (txns ?? []).reduce((s, t) => s + (t.direction === "in" ? Number(t.amount) : -Number(t.amount)), 0);
  if (amount > balance + 0.005) {
    return {
      error: `Wallet balance ₹${balance.toFixed(2)} is less than ₹${amount.toFixed(2)} — recharge first.`,
      success: false,
    };
  }

  // Consume row (direction 'out'). The partial unique index on
  // bill_pass_register_id makes a second consume of the same bill fail
  // loudly instead of double-paying.
  const { error: insertError } = await supabase.from("party_wallet_txns").insert({
    company_id: bill.company_id,
    party_id: bill.party_id,
    txn_type: "consume",
    direction: "out",
    amount,
    txn_date: txnDate,
    remark: str(formData, "remark") || null,
    bill_pass_register_id: billId,
    entered_by: employee.id,
  });
  if (insertError) {
    return {
      error: insertError.code === "23505"
        ? "This bill is already paid from the wallet."
        : insertError.message,
      success: false,
    };
  }

  // Same recompute-as-ledger rule as recordBillPayment: total_paid = SUM
  // of bank payments + wallet consumes. Wallet consumes live only in
  // party_wallet_txns, so add them on top of the bank ledger sum.
  const [{ data: bankPayments }, { data: walletConsumes }] = await Promise.all([
    supabase.from("bill_pass_register_payments").select("amount").eq("bill_pass_register_id", billId),
    supabase
      .from("party_wallet_txns")
      .select("amount")
      .eq("txn_type", "consume")
      .eq("bill_pass_register_id", billId),
  ]);
  const totalPaid =
    (bankPayments ?? []).reduce((s, p) => s + Number(p.amount), 0) +
    (walletConsumes ?? []).reduce((s, c) => s + Number(c.amount), 0);

  const { error: updateError } = await supabase
    .from("bill_pass_register")
    .update({ total_paid: totalPaid, payment_by_employee_id: employee.id })
    .eq("id", billId);
  if (updateError) return { error: updateError.message, success: false };

  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: true };
}
