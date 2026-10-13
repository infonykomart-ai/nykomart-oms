// 2026-10-13 — "wallet me agar koi entry galt dal jaye to modify update
// and delete ka option bhi hona chahiye": the money math behind the
// wallet panel's ✏️ edit / 🗑 delete actions (wallet-actions.ts), kept in
// this dependency-free module so it can be unit-tested on its own — no
// Supabase, no Next, run it straight with bun/node.
//
// Editing or deleting ANY party_wallet_txns row must keep both of the
// app's money invariants true:
//
//   1. WALLET — balance = SUM(direction 'in') − SUM('out') never drops
//      below zero: a negative balance means bills were "marked paid"
//      from money the wallet never held (the panel's red card).
//   2. BILL   — total_paid = bank payments + wallet consumes never
//      exceeds what the invoice allows (its current total_paid +
//      balance_due), because balance_due is a GENERATED column
//      (total_amt − credit_note_amt − adj_amt − total_paid) — an
//      overpaid bill would show a negative due.
//
// Both guards are evaluated on the PROSPECTED state BEFORE anything is
// written, so a rejected change leaves the database untouched (the
// read-then-write pattern every money action in this codebase uses —
// Supabase JS has no cross-table transaction).

/** The fields both guards need from a party_wallet_txns row. */
export type WalletTxnLite = { id: string; direction: "in" | "out"; amount: number };

/** The wallet consumes linked to one bill (txn_type 'consume' rows). */
export type WalletConsumeLite = { id: string; amount: number };

/**
 * How one row is changing: its new amount, or `nextAmount: null` when
 * the row is being deleted entirely.
 */
export type TxnChange = { txnId: string; nextAmount: number | null };

/** The wallet's balance right now: SUM('in') − SUM('out'). */
export function walletBalance(txns: WalletTxnLite[]): number {
  let balance = 0;
  for (const t of txns) balance += (t.direction === "in" ? 1 : -1) * t.amount;
  return balance;
}

/**
 * The (company, party) wallet balance AFTER applying `change` — i.e. the
 * balance the change must not push below zero.
 */
export function walletBalanceAfter(txns: WalletTxnLite[], change: TxnChange): number {
  let balance = 0;
  for (const t of txns) {
    if (t.id === change.txnId) {
      if (change.nextAmount === null) continue; // row disappears on delete
      balance += (t.direction === "in" ? 1 : -1) * change.nextAmount;
      continue;
    }
    balance += (t.direction === "in" ? 1 : -1) * t.amount;
  }
  return balance;
}

/**
 * A bill's total_paid AFTER applying `change` to its wallet-settling
 * consume row — bankPayments is the already-summed bank ledger
 * (bill_pass_register_payments); wallet consumes are summed here with
 * the change folded in. Delete → the consume drops out, so the invoice
 * goes back to owing that much.
 */
export function billTotalPaidAfter(
  bankPayments: number,
  walletConsumes: WalletConsumeLite[],
  change: TxnChange
): number {
  let totalPaid = bankPayments;
  for (const c of walletConsumes) {
    if (c.id === change.txnId) {
      if (change.nextAmount === null) continue;
      totalPaid += change.nextAmount;
      continue;
    }
    totalPaid += c.amount;
  }
  return totalPaid;
}
