// 2026-11-25 — ONE way to split an invoice total across its Finance-ledger rows.
//
// A Purchase Bill is stored one `purchase_bills` row per item, but Finance books
// the INVOICE: `sendPurchaseBillInvoiceToFinance` posts one
// `bill_pass_register` row per item and apportions the approved invoice total
// across them in proportion to each item's own `g_total_plus_gst`. So each
// ledger row's `total_amt` is a SHARE of a group total, not a copy of its bill.
//
// That only works if every writer uses the same split. The edit path used to
// overwrite the one edited row with its full value, which silently moved the
// group's payable and left the other shares behind — the drift found on
// 2026-11-25. Both the posting path and the edit path now go through this
// module, and the group total is preserved whenever the group was already out
// of step with its bills (see nextGroupTotal) so a routine edit can never
// rewrite a payable figure that finance reviewed.

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Split `total` across `weights` in proportion, rounded to paise, with the last
 * row absorbing the rounding remainder so the parts always add up to `total`
 * exactly. Weights that are not positive finite numbers count as 0; when no
 * weight is usable every part is 0 rather than NaN.
 */
export function apportionByWeight(weights: number[], total: number): number[] {
  if (weights.length === 0) return [];
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = clean.reduce((s, w) => s + w, 0);
  if (!(sum > 0) || !(Number.isFinite(total) && total > 0)) return clean.map(() => 0);

  const amounts = clean.map((w) => round2((w / sum) * total));
  const head = amounts.slice(0, -1).reduce((s, n) => s + n, 0);
  amounts[amounts.length - 1] = round2(total - head);
  return amounts;
}

export type GroupTotalInput = {
  /** What the Finance ledger currently holds for the whole invoice (sum of its rows). */
  postedTotal: number;
  /** Sum of every item row's g_total_plus_gst BEFORE this edit. */
  billSumBefore: number;
  /** The same sum AFTER this edit. */
  billSumAfter: number;
};

/**
 * What the invoice's ledger total should be after an edit.
 *
 * A group in step with its bills (posted total equals the bill total) follows
 * the edit, so fixing a rate on a bill still reaches Bill Payment — the whole
 * point of the 2026-08-18 sync-back. A group already out of step is left at its
 * posted total: the shares are re-split to match the current bills, but the
 * money finance reviewed is not quietly rewritten by an unrelated item edit.
 * One paisa of slack keeps a rounded posting (₹30,946.00 vs ₹30,945.99) on the
 * "in step" side.
 */
export function nextGroupTotal({ postedTotal, billSumBefore, billSumAfter }: GroupTotalInput): number {
  const inStep = Math.abs(round2(postedTotal) - round2(billSumBefore)) <= 0.01;
  return inStep ? round2(billSumAfter) : round2(postedTotal);
}
