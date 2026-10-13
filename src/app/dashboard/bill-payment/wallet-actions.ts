"use server";

// 2026-09-15 — "kuch kuch courier me shipment bhejne se pehle wallet
// recharge karna padta hai phir baad me adjust hota hai jab uska invoice
// aata hai to iska kese karenge"
//
// Prepaid courier wallets (FedEx / UPS / Delhivery style): money goes INTO
// the courier's wallet before shipments fly, the courier's freight/duty
// invoice later lands in bill_pass_register as always, and instead of a
// bank payment the wallet balance settles it. Three txn types:
//
//   recharge  (direction 'in')  — bank → wallet (payment_mode/reference
//                                 = NEFT/RTGS/UPI + UTR, same columns as
//                                 bill_pass_register_payments)
//   consume   (direction 'out') — a bill paid from the wallet; sets
//                                 bill_pass_register.wallet_paid, NEVER
//                                 touches bill_pass_register_payments
//                                 (that table means bank money left the
//                                 account — a wallet consume didn't)
//   refund    (direction 'in')  — courier returned unused wallet money
//
// balance = SUM(in) − SUM(out) over (company, party). This file holds the
// ledger primitives (overview / recharge / refund / ✏️ edit / 🗑 delete);
// the consume action that settles a bill lives in wallet-pay-actions.ts.
//
// 2026-10-13 — "wallet me agar koi entry galt dal jaye to modify update
// and delete ka option bhi hona chahiye": every row in the panel's
// Recent activity can now be corrected (amount / date / mode / UTR /
// remark) or deleted. Company, party, type and bill link are NOT
// editable — those are re-read from the database (a wrong party means
// delete + fresh entry), and both actions guard the two money
// invariants via src/lib/wallet/edit-guards.ts before writing:
// wallet balance never goes negative, a bill never goes overpaid.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { autoSettleWalletBills } from "@/lib/wallet/auto-settle";
import { billTotalPaidAfter, walletBalance, walletBalanceAfter, type TxnChange, type WalletTxnLite } from "@/lib/wallet/edit-guards";
import { revalidatePath } from "next/cache";

export type WalletTxnRow = {
  id: string;
  company_id: string;
  party_id: string;
  party_name: string;
  txn_type: "recharge" | "consume" | "refund";
  direction: "in" | "out";
  amount: number;
  txn_date: string;
  payment_mode: string | null;
  reference_no: string | null;
  remark: string | null;
  bill_pass_register_id: string | null;
};

export type WalletPartyBalance = {
  party_id: string;
  party_name: string;
  balance: number;
};

export type WalletOverview = {
  balances: WalletPartyBalance[];
  recent: WalletTxnRow[];
};

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export async function getWalletOverview(companyIds: string[]): Promise<WalletOverview> {
  if (companyIds.length === 0) return { balances: [], recent: [] };
  const supabase = createServiceRoleClient();

  const [{ data: txns }, { data: parties }] = await Promise.all([
    supabase
      .from("party_wallet_txns")
      .select("id, company_id, party_id, txn_type, direction, amount, txn_date, payment_mode, reference_no, remark, bill_pass_register_id")
      .in("company_id", companyIds)
      .order("txn_date", { ascending: false })
      .order("entered_on", { ascending: false })
      .limit(400),
    supabase.from("parties").select("id, name"),
  ]);

  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const bal = new Map<string, number>();
  // Recharge/refund add, consume subtracts — walk OLDEST-first so the
  // signed sum is order-independent anyway, but keep the map fill simple.
  const ordered = [...(txns ?? [])].reverse();
  for (const t of ordered) {
    const prev = bal.get(t.party_id) ?? 0;
    bal.set(t.party_id, t.direction === "in" ? prev + Number(t.amount) : prev - Number(t.amount));
  }

  const balances: WalletPartyBalance[] = Array.from(bal.entries())
    .map(([party_id, balance]) => ({ party_id, party_name: partyName.get(party_id) ?? "—", balance }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  const recent: WalletTxnRow[] = (txns ?? []).map((t) => ({
    id: t.id,
    company_id: t.company_id,
    party_id: t.party_id,
    party_name: partyName.get(t.party_id) ?? "—",
    txn_type: t.txn_type as WalletTxnRow["txn_type"],
    direction: t.direction as WalletTxnRow["direction"],
    amount: Number(t.amount),
    txn_date: t.txn_date,
    payment_mode: t.payment_mode,
    reference_no: t.reference_no,
    remark: t.remark,
    bill_pass_register_id: t.bill_pass_register_id,
  }));

  return { balances, recent };
}

/**
 * `done` is a per-submission timestamp set only on a successful ✏️/🗑
 * action — the panel compares edit-vs-delete `done` values to word its
 * "✅ updated / deleted" confirmation for the LATEST action (`success`
 * alone staying `true` across two saves can't order them).
 * Recharge/refund don't set it (they reload the page, see
 * wallet-panel.tsx).
 */
export type WalletActionState = { error: string | null; success: boolean; done?: number };

export async function walletRecharge(_prev: WalletActionState, formData: FormData): Promise<WalletActionState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const partyId = str(formData, "party_id");
  const amount = Number(str(formData, "amount"));
  const txnDate = str(formData, "txn_date") || new Date().toISOString().slice(0, 10);

  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to this company.", success: false };
  }
  if (!partyId) return { error: "Choose the courier party.", success: false };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Recharge amount must be a positive number.", success: false };
  }

  const { error } = await supabase.from("party_wallet_txns").insert({
    company_id: companyId,
    party_id: partyId,
    txn_type: "recharge",
    direction: "in",
    amount,
    txn_date: txnDate,
    payment_mode: strOrNull(formData, "payment_mode"),
    reference_no: strOrNull(formData, "reference_no"),
    remark: strOrNull(formData, "remark"),
    entered_by: employee.id,
  });
  if (error) return { error: error.message, success: false };

  // 2026-10-12 — "daal diya delhivery me 50000 to jo bill aayenge vo
  // usme auto adjust hote jayenge": settle whatever this party already
  // owes against the fresh balance right away (oldest due first). New
  // bills settle at their own send-to-ledger step (see
  // documents/actions.ts). Best-effort — the recharge above already
  // succeeded, so a settle failure must not turn it into an error; any
  // remainder is still payable with the per-bill "Pay from Wallet" button.
  try {
    await autoSettleWalletBills(supabase, {
      companyId,
      partyId,
      employeeId: employee.id,
    });
  } catch {
    // tolerated — see header comment
  }

  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: true };
}

export async function walletRefund(_prev: WalletActionState, formData: FormData): Promise<WalletActionState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const partyId = str(formData, "party_id");
  const amount = Number(str(formData, "amount"));
  const txnDate = str(formData, "txn_date") || new Date().toISOString().slice(0, 10);

  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to this company.", success: false };
  }
  if (!partyId) return { error: "Choose the courier party.", success: false };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Refund amount must be a positive number.", success: false };
  }

  // Balance guard: a refund can't push the wallet negative.
  const { data: txns } = await supabase
    .from("party_wallet_txns")
    .select("direction, amount")
    .eq("company_id", companyId)
    .eq("party_id", partyId);
  const balance = (txns ?? []).reduce((s, t) => s + (t.direction === "in" ? Number(t.amount) : -Number(t.amount)), 0);
  if (amount > balance + 0.005) {
    return { error: `Refund ₹${amount.toFixed(2)} exceeds wallet balance ₹${balance.toFixed(2)}.`, success: false };
  }

  const { error } = await supabase.from("party_wallet_txns").insert({
    company_id: companyId,
    party_id: partyId,
    txn_type: "refund",
    direction: "in",
    amount,
    txn_date: txnDate,
    remark: strOrNull(formData, "remark"),
    entered_by: employee.id,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: true };
}

// ---------------------------------------------------------------------------
// ✏️ Edit / 🗑 Delete a wallet entry (2026-10-13)
//
// "wallet me agar koi entry galt dal jaye to modify update and delete ka
// option bhi hona chahiye" — fat-finger amounts, a wrong date/UTR, or a
// bill settled by mistake: every Recent-activity row can now be
// corrected or removed. What is (and isn't) editable, and why:
//
//   • amount / date / mode / UTR / remark — the human-entered fields.
//   • company, party, txn_type, bill link — NEVER editable here; they
//     come from a server-side re-read of the row (a wrong party means
//     delete + fresh entry), so a tampered form can't move money
//     between companies/parties — same rule as the ledger PDF route.
//   • money invariants are checked on the PROSPECTED state BEFORE any
//     write (edit-guards.ts): wallet balance never pushed below zero,
//     a wallet-settled bill never pushed overpaid. Deleting a consume
//     reverses it — the invoice goes back to owing that much (total_paid
//     is recomputed bank + wallet, exactly like walletPayBill).
//   • no autoSettle here on purpose: an edit/delete must never move
//     money onto OTHER bills by itself — freed money waits for the next
//     recharge/bill-send or the manual "Pay from Wallet" button.

type WalletTxnContext =
  | { ok: false; error: string }
  | {
      ok: true;
      txn: {
        id: string;
        company_id: string;
        txn_type: string;
        direction: "in" | "out";
        amount: number;
        bill_pass_register_id: string | null;
      };
      txns: WalletTxnLite[];
    };

/**
 * Re-reads the target row AND its whole (company, party) wallet from the
 * database before anything is changed — the form only ever supplies the
 * txn id; company scope, type, bill link and the balance inputs are all
 * server-derived (rows from the client are never trusted).
 */
async function loadWalletTxnContext(
  supabase: ReturnType<typeof createServiceRoleClient>,
  companyIds: string[],
  txnId: string
): Promise<WalletTxnContext> {
  const { data: txn, error: txnErr } = await supabase
    .from("party_wallet_txns")
    .select("id, company_id, party_id, txn_type, direction, amount, bill_pass_register_id")
    .eq("id", txnId)
    .maybeSingle();
  if (txnErr) return { ok: false, error: txnErr.message };
  if (!txn) return { ok: false, error: "Entry not found — it may already be deleted." };
  if (!companyIds.includes(txn.company_id)) {
    return { ok: false, error: "You don't have access to this company." };
  }

  const { data: siblings, error: sibErr } = await supabase
    .from("party_wallet_txns")
    .select("id, direction, amount")
    .eq("company_id", txn.company_id)
    .eq("party_id", txn.party_id);
  if (sibErr) return { ok: false, error: sibErr.message };

  return {
    ok: true,
    txn: {
      id: txn.id,
      company_id: txn.company_id,
      txn_type: txn.txn_type,
      direction: txn.direction === "in" ? "in" : "out",
      amount: Number(txn.amount),
      bill_pass_register_id: txn.bill_pass_register_id,
    },
    txns: (siblings ?? []).map((t) => ({
      id: t.id,
      direction: t.direction === "in" ? "in" : "out",
      amount: Number(t.amount),
    })),
  };
}

type BillAfterChange = {
  billId: string;
  /** the bill's total_paid as it stands right now */
  currentTotalPaid: number;
  /** what the invoice still owes (generated balance_due column) */
  balanceDue: number;
  /** total_paid after the edit/delete is applied (bank + wallet consumes) */
  nextTotalPaid: number;
};

/**
 * What the linked invoice's total_paid becomes after `change`, plus its
 * current figures for the overpay guard. `null` when the txn settles no
 * bill (recharge/refund) or the bill row is gone (FK is ON DELETE SET
 * NULL) — then nothing needs recomputing.
 */
async function billAfterWalletChange(
  supabase: ReturnType<typeof createServiceRoleClient>,
  txn: { txn_type: string; bill_pass_register_id: string | null },
  change: TxnChange
): Promise<BillAfterChange | null> {
  if (txn.txn_type !== "consume" || !txn.bill_pass_register_id) return null;
  const billId = txn.bill_pass_register_id;

  const [{ data: bill }, { data: bankPayments }, { data: consumes }] = await Promise.all([
    supabase.from("bill_pass_register").select("total_paid, balance_due").eq("id", billId).maybeSingle(),
    supabase.from("bill_pass_register_payments").select("amount").eq("bill_pass_register_id", billId),
    supabase
      .from("party_wallet_txns")
      .select("id, amount")
      .eq("txn_type", "consume")
      .eq("bill_pass_register_id", billId),
  ]);
  if (!bill) return null;

  const bankSum = (bankPayments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  return {
    billId,
    currentTotalPaid: Number(bill.total_paid),
    balanceDue: Number(bill.balance_due),
    nextTotalPaid: billTotalPaidAfter(
      bankSum,
      (consumes ?? []).map((c) => ({ id: c.id, amount: Number(c.amount) })),
      change
    ),
  };
}

/** ✏️ Fix a wrong wallet entry — amount / date / mode / UTR / remark. */
export async function walletUpdateTxn(_prev: WalletActionState, formData: FormData): Promise<WalletActionState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const txnId = str(formData, "txn_id");
  // Round to paise FIRST — the guards below run on the exact number the
  // numeric(14,2) column will store.
  const amount = Math.round(Number(str(formData, "amount")) * 100) / 100;
  const txnDate = str(formData, "txn_date");
  const paymentMode = strOrNull(formData, "payment_mode");
  const referenceNo = strOrNull(formData, "reference_no");
  const remark = strOrNull(formData, "remark");

  if (!txnId) return { error: "Entry not specified.", success: false };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be a positive number.", success: false };
  }
  // Unlike the CREATE actions there is no fallback to today's date: an
  // edit must never move the date without the user actually asking.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) {
    return { error: "Choose a valid entry date.", success: false };
  }

  const ctx = await loadWalletTxnContext(supabase, employee.companyIds, txnId);
  if (!ctx.ok) return { error: ctx.error, success: false };
  const { txn, txns } = ctx;

  const change: TxnChange = { txnId, nextAmount: amount };

  // Guard 1 — the wallet must not be pushed below zero by the change.
  // (If the balance is ALREADY negative — the panel's red "recharge
  // pending?" card — a change that doesn't reduce it further, e.g. a
  // remark fix, must still go through.)
  const currentBalance = walletBalance(txns);
  const balanceAfter = walletBalanceAfter(txns, change);
  if (balanceAfter < -0.005 && balanceAfter < currentBalance - 0.005) {
    return {
      error: `Cannot save: the wallet balance would go to ₹${balanceAfter.toFixed(2)} — bills are already marked paid from more money than would remain. Delete or reduce those "Invoice paid" entries first.`,
      success: false,
    };
  }

  // Guard 2 — a wallet-settled bill must not go overpaid. Only a change
  // that pushes it FURTHER into overpay is blocked, so an already-
  // overpaid bill (due < 0, an anomaly) can still be reduced.
  const billAfter = await billAfterWalletChange(supabase, txn, change);
  if (
    billAfter &&
    billAfter.nextTotalPaid > billAfter.currentTotalPaid + billAfter.balanceDue + 0.005 &&
    billAfter.nextTotalPaid > billAfter.currentTotalPaid + 0.005
  ) {
    return {
      error: `Amount ₹${amount.toFixed(2)} exceeds this invoice's balance due ₹${billAfter.balanceDue.toFixed(2)} — the bill would go overpaid.`,
      success: false,
    };
  }

  const { data: updated, error: upErr } = await supabase
    .from("party_wallet_txns")
    .update({ amount, txn_date: txnDate, payment_mode: paymentMode, reference_no: referenceNo, remark })
    .eq("id", txnId)
    .select("id");
  if (upErr) return { error: upErr.message, success: false };
  if (!updated || updated.length === 0) {
    return { error: "Entry not found — it may already be deleted.", success: false };
  }

  // Same roundtrip invalidation the recharge/refund actions use — Next
  // re-renders the route with fresh data in THIS action's response, so
  // the panel updates without a page reload (and stays open).
  revalidatePath("/dashboard/bill-payment");

  if (billAfter) {
    // The wallet row changed, so the invoice's total_paid moves with it
    // (recompute = bank + wallet, never a raw delta — same rule as
    // walletPayBill / autoSettle). A failure here means the two
    // statements disagree until repaired; report it loudly, retrying
    // the same save recomputes it.
    const { error: billErr } = await supabase
      .from("bill_pass_register")
      .update({ total_paid: billAfter.nextTotalPaid })
      .eq("id", billAfter.billId);
    if (billErr) {
      return {
        error: `Entry saved, but the invoice's paid total could not be refreshed (${billErr.message}) — press Save again to repair it.`,
        success: false,
      };
    }
  }

  return { error: null, success: true, done: Date.now() };
}

/** 🗑 Remove a wrong wallet entry outright. */
export async function walletDeleteTxn(_prev: WalletActionState, formData: FormData): Promise<WalletActionState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const txnId = str(formData, "txn_id");
  if (!txnId) return { error: "Entry not specified.", success: false };

  const ctx = await loadWalletTxnContext(supabase, employee.companyIds, txnId);
  if (!ctx.ok) return { error: ctx.error, success: false };
  const { txn, txns } = ctx;

  const change: TxnChange = { txnId, nextAmount: null };

  // Guard 1 — deleting a recharge/refund (money IN) removes wallet money;
  // it must not erase money bills were already settled from. Same
  // already-negative escape hatch as the update guard.
  const currentBalance = walletBalance(txns);
  const balanceAfter = walletBalanceAfter(txns, change);
  if (balanceAfter < -0.005 && balanceAfter < currentBalance - 0.005) {
    return {
      error: `Cannot delete: the wallet balance would go to ₹${balanceAfter.toFixed(2)} — bills are already marked paid from this money. Delete or reduce those "Invoice paid" entries first.`,
      success: false,
    };
  }

  // Deleting a consume can only REDUCE what the bill has paid (no
  // overpay guard needed) — but the recompute still has to happen.
  const billAfter = await billAfterWalletChange(supabase, txn, change);

  const { data: deleted, error: delErr } = await supabase
    .from("party_wallet_txns")
    .delete()
    .eq("id", txnId)
    .select("id");
  if (delErr) return { error: delErr.message, success: false };
  if (!deleted || deleted.length === 0) {
    return { error: "Entry not found — it may already be deleted.", success: false };
  }

  revalidatePath("/dashboard/bill-payment");

  if (billAfter) {
    const { error: billErr } = await supabase
      .from("bill_pass_register")
      .update({ total_paid: billAfter.nextTotalPaid })
      .eq("id", billAfter.billId);
    if (billErr) {
      return {
        error: `Entry deleted, but the invoice's paid total could not be refreshed (${billErr.message}) — reload; the bill's payment screen repairs it on its next save.`,
        success: false,
      };
    }
  }

  return { error: null, success: true, done: Date.now() };
}
