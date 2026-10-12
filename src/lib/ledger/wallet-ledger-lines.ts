// 2026-10-12 — prepaid courier wallet → party ledger lines, WITHOUT the
// double count the ledger used to show.
//
// The bug (visible on Delhivery's ledger on 2026-10-12):
//
//   Wallet recharge 1000 + 3000      posted as CREDIT  → balance +4000
//   Courier/Duty bills 1718.79       posted as CREDIT  → balance +5718.79
//   Wallet settled those bills 1397.19 posted as DEBIT → balance  4321.60
//   → banner: "Amount payable to Delhivery: ₹4321.60"
//
// Two errors in that:
//
//  1. A RECHARGE IS A PREPAYMENT, not a liability increase. We handed them
//     ₹4000 of our cash — that REDUCES what we owe them, so it belongs on the
//     DEBIT side exactly like any other payment. Posting it as Credit made
//     "amount payable to Delhivery" go UP by ₹4000 the moment we PAID them.
//
//  2. A WALLET SETTLEMENT MOVES NO NEW MONEY. The bill was already posted as
//     a Credit line when it was raised (accrual — see the ledger page's
//     2026-08-20 note: Bill → Credit, Payment → Debit). When the wallet later
//     pays that bill, the ₹4000 had ALREADY left our bank at recharge time.
//     Posting the settlement as a second ledger line counts the same rupee
//     twice — once as the recharge, once as the settlement.
//
// Correct model, keeping the app-wide convention (balance > 0 = we owe the
// party):
//
//   recharge  → DEBIT   (our cash out; what we owe them falls)
//   refund    → CREDIT  (their cash back to us; reverses part of the prepay)
//   consume   → NO LINE (funding source only — the bill line already exists)
//
// Applied to those exact numbers:
//
//   recharge 4000 (D) + bills 1718.79 (C) = -2281.21
//
// i.e. Delhivery is IN CREDIT WITH US by ₹2281.21 — which is the truth: they
// hold ₹2602.81 of our prepaid money (4000 − 1397.19) and we still owe them
// ₹321.60 of bills (1718.79 − 1397.19). 2602.81 − 321.60 = 2281.21. ✓
//
// So the settlement is not thrown away — it comes back as `settledByBill`,
// which the ledger page prints INSIDE the bill's own Particulars, so you can
// still see which invoices the wallet paid and how much of each is left.

export type WalletTxnRow = {
  id: string;
  txn_type: string; // 'recharge' | 'consume' | 'refund'
  amount: string | number;
  txn_date: string; // "YYYY-MM-DD"
  payment_mode: string | null;
  reference_no: string | null;
  remark: string | null;
  bill_pass_register_id: string | null;
};

export type WalletLedgerLine = {
  date: string;
  particulars: string;
  type: "Debit" | "Credit";
  debit: number;
  credit: number;
  /** date + same-day tiebreaker, matching the ledger page's sort convention */
  sortKey: string;
  billIds: string[];
  invoiceNo: string;
  paymentMode: string | null;
  referenceNo: string | null;
};

export type WalletSettlement = {
  /** total settled by the wallet against this bill */
  amount: number;
  /** every wallet date that touched this bill, ascending */
  dates: string[];
};

export type WalletLedgerResult = {
  lines: WalletLedgerLine[];
  /** bill_pass_register_id → what the wallet paid against it (consume txns) */
  settledByBill: Map<string, WalletSettlement>;
};

/**
 * Maps the party's raw wallet transactions onto ledger lines.
 *
 * Takes no bill labels: a settlement's amount + date are all the caller
 * needs to annotate its own bill row (which already carries the invoice
 * number), so nothing here has to resolve an invoice label.
 */
export function buildWalletLedgerLines(txns: WalletTxnRow[]): WalletLedgerResult {
  const lines: WalletLedgerLine[] = [];
  const settledByBill = new Map<string, WalletSettlement>();

  for (const w of txns) {
    const amount = Number(w.amount);
    if (!Number.isFinite(amount)) continue;

    if (w.txn_type === "consume") {
      // Not a ledger line — the bill it settles is already a Credit line.
      // Record it so the bill row can say so, and so the totals never
      // double-count the rupee.
      const billId = w.bill_pass_register_id;
      if (!billId) continue;
      const prev = settledByBill.get(billId) ?? { amount: 0, dates: [] };
      prev.amount += amount;
      if (!prev.dates.includes(w.txn_date)) prev.dates.push(w.txn_date);
      prev.dates.sort();
      settledByBill.set(billId, prev);
      continue;
    }

    if (w.txn_type === "recharge") {
      // Our cash went OUT to them → DEBIT, same side as any payment.
      lines.push({
        date: w.txn_date,
        particulars: `Wallet recharge${w.payment_mode ? ` via ${w.payment_mode}` : ""}`,
        type: "Debit",
        debit: amount,
        credit: 0,
        sortKey: `${w.txn_date}_1c_${w.id}`,
        billIds: [],
        invoiceNo: "",
        paymentMode: w.payment_mode,
        referenceNo: w.reference_no ?? w.remark,
      });
      continue;
    }

    if (w.txn_type === "refund") {
      // Their cash came BACK to us → reverses the prepayment → CREDIT.
      lines.push({
        date: w.txn_date,
        particulars: "Wallet refund to us",
        type: "Credit",
        debit: 0,
        credit: amount,
        sortKey: `${w.txn_date}_1c_${w.id}`,
        billIds: [],
        invoiceNo: "",
        paymentMode: null,
        referenceNo: w.remark,
      });
    }
  }

  return { lines, settledByBill };
}

/**
 * " — ₹1,000.00 settled from wallet on 2026-10-12" — appended to a bill's
 * Particulars when the wallet paid part or all of it. Empty string otherwise,
 * so callers can concatenate unconditionally.
 */
export function walletSettlementNote(settlement: WalletSettlement | undefined): string {
  if (!settlement || settlement.amount <= 0.005) return "";
  const dates = settlement.dates.join(", ");
  return ` — ₹${settlement.amount.toFixed(2)} settled from wallet${dates ? ` on ${dates}` : ""}`;
}
