// 2026-10-12 — "jaise daal diya delhivery me 50000 to jo bill aayenge vo
// usme auto adjust hote jayenge": automatic wallet adjustment. When money
// lands in a courier's prepaid wallet (recharge) OR a new courier bill
// lands in the Finance ledger (freight/duty send), any open bill of that
// same (company, party) is settled out of the wallet balance — oldest due
// date first — until the balance runs out. Remainder (if any) stays due
// and the manual per-bill "Pay from Wallet" button still works for it.
//
// This is the SAME money logic as walletPayBill (bill-payment/
// wallet-pay-actions.ts), factored out so the recharge action, the
// freight/duty send actions, and tests all share one implementation:
//   1. balance = SUM(in) − SUM(out) over party_wallet_txns
//   2. for each open bill (balance_due > 0), consume min(balance, due)
//   3. the unique index uq_party_wallet_bill_consume makes a re-consume
//      of the same bill impossible (skip on 23505, don't deduct balance)
//   4. recompute total_paid = bank payments + wallet consumes — exactly
//      like recordBillPayment/walletPayBill — never a raw add
//
// Consumes land in party_wallet_txns and total_paid updates on
// bill_pass_register, so EVERY surface that already reads those reflects
// the adjustment automatically: Bill Payment list (balance_due), Party
// Ledger passbook (wallet txns are ledger lines), bill statements, the
// wallet panel's balance cards. No separate "adjusted" bookkeeping exists
// — one ledger, one truth.
//
// Callers treat this as best-effort: a failure here must never fail the
// recharge/bill-send that triggered it (the money action already
// succeeded); unsettled remainder is visible as unpaid bills and can be
// paid with the manual button.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type AutoSettleResult = {
  /** how many bills were (partially) settled from the wallet */
  settled: number;
  /** total amount consumed across those bills */
  paidAmount: number;
  /** wallet balance left after settling */
  remainingBalance: number;
};

const EMPTY: AutoSettleResult = { settled: 0, paidAmount: 0, remainingBalance: 0 };

export async function autoSettleWalletBills(
  supabase: SupabaseClient<Database>,
  opts: { companyId: string; partyId: string; employeeId: string }
): Promise<AutoSettleResult> {
  // Callers treat this as best-effort (see header): a recharge or a bill
  // send must NEVER fail because the auto-adjust hit trouble — the money
  // action already succeeded. So the guarantee lives here, once, instead
  // of being re-implemented at each call site: anything unexpected comes
  // back as a no-op result and the remainder stays payable via the manual
  // "Pay from Wallet" button.
  try {
    return await autoSettleCore(supabase, opts);
  } catch {
    return EMPTY;
  }
}

async function autoSettleCore(
  supabase: SupabaseClient<Database>,
  opts: { companyId: string; partyId: string; employeeId: string }
): Promise<AutoSettleResult> {
  const { companyId, partyId, employeeId } = opts;
  if (!companyId || !partyId) return EMPTY;
  const txnDate = new Date().toISOString().slice(0, 10);

  // 1. Current wallet balance for this (company, party).
  const { data: txns, error: txnError } = await supabase
    .from("party_wallet_txns")
    .select("direction, amount")
    .eq("company_id", companyId)
    .eq("party_id", partyId);
  if (txnError) return EMPTY;
  let balance = (txns ?? []).reduce(
    (s, t) => s + (t.direction === "in" ? Number(t.amount) : -Number(t.amount)),
    0
  );
  if (balance <= 0.005) return { ...EMPTY, remainingBalance: balance };

  // 2. Open bills of this party, oldest due date first (the bills that
  //    "came in" get adjusted into the wallet in the order they fall due;
  //    undated bills sort after dated ones, oldest invoice first within).
  const { data: bills, error: billError } = await supabase
    .from("bill_pass_register")
    .select("id, balance_due")
    .eq("company_id", companyId)
    .eq("party_id", partyId)
    .gt("balance_due", 0)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("invoice_date", { ascending: true, nullsFirst: true })
    .limit(200);
  if (billError || !bills || bills.length === 0) {
    return { ...EMPTY, remainingBalance: balance };
  }

  let settled = 0;
  let paidAmount = 0;

  for (const bill of bills) {
    if (balance <= 0.005) break;
    const due = Number(bill.balance_due);
    if (!(due > 0)) continue;
    const pay = Math.min(balance, due);

    // 3. Consume row — unique index guards double-settle.
    const { error: insertError } = await supabase.from("party_wallet_txns").insert({
      company_id: companyId,
      party_id: partyId,
      txn_type: "consume",
      direction: "out",
      amount: pay,
      txn_date: txnDate,
      remark: "Auto-adjust from prepaid wallet",
      bill_pass_register_id: bill.id,
      entered_by: employeeId,
    });
    if (insertError) {
      // Already consumed (double-trigger race) — skip this bill without
      // deducting anything; any other error stops the run (tolerate and
      // leave the rest for the manual button, same philosophy as
      // walletPayBill).
      if (insertError.code === "23505") continue;
      break;
    }

    // 4. total_paid recompute — bank payments + wallet consumes, never a
    //    raw increment (same as walletPayBill / recordBillPayment).
    const [{ data: bankPayments }, { data: walletConsumes }] = await Promise.all([
      supabase.from("bill_pass_register_payments").select("amount").eq("bill_pass_register_id", bill.id),
      supabase
        .from("party_wallet_txns")
        .select("amount")
        .eq("txn_type", "consume")
        .eq("bill_pass_register_id", bill.id),
    ]);
    const totalPaid =
      (bankPayments ?? []).reduce((s, p) => s + Number(p.amount), 0) +
      (walletConsumes ?? []).reduce((s, c) => s + Number(c.amount), 0);

    // A failed update here is tolerated (the consume row still stands and
    // shows in the wallet history) — same rule as the manual path.
    await supabase
      .from("bill_pass_register")
      .update({ total_paid: totalPaid, payment_by_employee_id: employeeId })
      .eq("id", bill.id);

    balance -= pay;
    settled += 1;
    paidAmount += pay;
  }

  return { settled, paidAmount, remainingBalance: Math.max(0, balance) };
}
