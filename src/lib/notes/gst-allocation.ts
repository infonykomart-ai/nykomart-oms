// GST-inclusive allocation for note adjustments.
//
// A Debit Note's `debit_amount` is the PRE-GST figure; its document total is
// `debit_amount × 1.05 + round_off_amt` (see the generated `total_amount`
// column in db/schema.sql). A bill's payable is reduced by
// bill_pass_register_adjustments.amount, which is trigger-summed into
// bill_pass_register.adj_amt — so the adjustment MUST carry the GST-inclusive
// figure, or the vendor is credited only the base amount.
//
// This is the same defect already fixed for multi-AWB credit notes in
// src/app/dashboard/bill-payment/credit-note-actions.ts; the debit-note path
// had never been corrected, so a 4,140 note (+5% GST = 4,347) reduced a bill by
// 4,140 and left 207 of GST unaccounted for.

export function money2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** The document total a Debit Note is worth: base + 5% GST + signed round-off. */
export function debitNoteTotal(debitAmount: number, roundOff = 0): number {
  return money2(Number(debitAmount) * 1.05 + Number(roundOff || 0));
}

/**
 * Splits `target` across rows proportionally to `amounts`, putting the
 * rounding remainder on the last row so the parts sum to EXACTLY `target`
 * (never a few paise off the document they net against).
 */
export function allocateTotal(amounts: number[], target: number): number[] {
  if (amounts.length === 0) return [];
  const total = money2(amounts.reduce((sum, a) => sum + Number(a), 0));
  const wanted = money2(target);
  if (total <= 0) return amounts.map(() => 0);

  let allocated = 0;
  return amounts.map((amount, index) => {
    if (index === amounts.length - 1) return money2(wanted - allocated);
    const share = money2((Number(amount) * wanted) / total);
    allocated = money2(allocated + share);
    return share;
  });
}

/**
 * The amount to post against a target bill for a Debit Note.
 *
 * A figure equal to the note's pre-GST Debit Amount is what the create form
 * shows in that field — it is grossed up to the note's real total. Any other
 * figure is taken as the GST-inclusive adjustment the user deliberately typed
 * (a partial adjustment must stay partial). A blank amount means "the whole
 * note".
 */
export function resolveDebitNoteAdjustmentAmount(args: {
  requested: number | null | undefined;
  debitAmount: number;
  noteTotal: number;
}): number {
  const { requested, debitAmount, noteTotal } = args;
  if (requested == null || requested <= 0) return money2(noteTotal);
  if (Math.abs(Number(requested) - Number(debitAmount)) < 0.01) return money2(noteTotal);
  return money2(requested);
}
