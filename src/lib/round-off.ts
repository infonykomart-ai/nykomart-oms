// 2026-10-29 — ONE shared round-off rule for every bill, invoice, note and
// payment document in the app.
//
// "har section me jaha invoice payment bills jaha par bhi ho, chahe multiple
// entry ho chahe single entry ho, round off ka option ho aur round off karne
// par sabhi jagah par reflect ho jaye."
//
// Every document already (or now) carries a signed `round_off_amt`, and the
// rule is always the same:
//
//   net payable = pre-round-off payable + round_off_amt
//
// What differs per table is only WHERE the net is stored:
//   * purchase_bills / freight_bills / duty_tax_bills / washing_entries —
//     a generated (or mirrored) total adds round_off_amt on read;
//   * debit_notes / internal_invoices — the generated `total_amount`
//     column adds round_off_amt (db/2026-10-29-round-off-all-documents.sql);
//   * credit_notes / journal_vouchers — no generated payable column exists,
//     so the app stores the rounded net in refund_amount / debit_amount and
//     keeps round_off_amt as the recorded adjustment (subtract it to get the
//     pre-round-off figure back for an edit form).
//
// These helpers centralise the arithmetic so a preview, a saved row, a list
// total and a printed sheet can never disagree by a paisa.

/** Round to 2 decimals the same way the DB's numeric(…,2) rounds. */
export function round2(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Net payable = base payable + signed round-off. */
export function netWithRoundOff(base: number, roundOff: number | null | undefined): number {
  return round2((Number(base) || 0) + (Number(roundOff) || 0));
}

/**
 * The pre-round-off base when the stored amount already includes the
 * round-off (credit notes, journal vouchers). Always 0-safe.
 */
export function baseFromRounded(total: number, roundOff: number | null | undefined): number {
  return round2((Number(total) || 0) - (Number(roundOff) || 0));
}

/** "− 0.40" / "+ 12.00" / "" — the printable Round Off line. */
export function roundOffLabel(roundOff: number | null | undefined): string {
  const n = round2(Number(roundOff) || 0);
  if (n === 0) return "";
  return `${n > 0 ? "+" : "−"} ${Math.abs(n).toFixed(2)}`;
}

/** Quick round figures offered under every round-off control. */
export const ROUND_FIGURE_STEPS = [1, 5, 10, 50, 100] as const;

/**
 * The signed difference that turns `payable` into the nearest multiple of
 * `step`. Used by the quick "₹12,434 / ₹12,440" buttons.
 */
export function roundOffForStep(payable: number, step: number): { target: number; difference: number } {
  const safeStep = Number(step) > 0 ? Number(step) : 1;
  const target = Math.round((Number(payable) || 0) / safeStep) * safeStep;
  return { target: round2(target), difference: round2(target - (Number(payable) || 0)) };
}

/**
 * Server-side sanity check for a submitted round_off_amt — mirrors the DB
 * CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000) so a fat-fingered
 * full amount never reaches the database as a "round off".
 */
export function isSaneRoundOff(roundOff: number): boolean {
  return Number.isFinite(roundOff) && roundOff >= -1000 && roundOff <= 1000;
}
