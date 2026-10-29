// 2026-10-29b — the DUPLICATE-BILL MERGE KEY, and the two helpers the undo
// needs. Pure functions only (no Supabase, no "use server"), so the rule that
// decides what may be merged is stated once and can be tested directly.
//
// WHY THE DATE AND THE AMOUNT ARE PART OF THE KEY
// -----------------------------------------------
// A vendor invoice NUMBER is not unique on its own. The same vendor reuses
// numbers across financial years (82 of 2026-10-19 in one company, 82 of
// 2026-08-02 in another), and two genuinely different bills can share a
// number. When merging was keyed on party + invoice number only, those two
// bills were folded into one: the second bill's amount was zeroed and its
// payments/CN-DN adjustments were moved onto the first, so the party ledger
// showed one company's bill carrying another company's money.
//
// A merge is only ever a DUPLICATE ENTRY when party, invoice number, invoice
// date and amount ALL agree. invoice_type is deliberately not part of the key:
// the same courier invoice recorded once as "Courier Bill (Freight)" and once
// as a plain "FREIGHT INVOICE" is the same document.

export type MergeKeyFields = {
  party_id: string | null;
  vendor_invoice_no: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  total_amt: number | string | null;
};

/**
 * The identity of one real-world bill for merge purposes. Two rows may only be
 * folded together when this string is identical.
 */
export function billMergeKey(r: MergeKeyFields): string {
  return [
    r.party_id ?? "",
    (r.vendor_invoice_no ?? r.invoice_no ?? "").toLowerCase().trim(),
    (r.invoice_date ?? "").slice(0, 10),
    Number(r.total_amt ?? 0).toFixed(2),
  ].join("|");
}

/**
 * Exact subset of rows whose amounts add up to `target` (paisa-precise), or
 * null when no combination exists.
 *
 * Depth-first with memo + a hard visit budget, NOT a sum-indexed DP: a bill can
 * carry tens of thousands of rupees, so a table keyed by "remaining paisa"
 * would allocate millions of entries. A bill has a handful of payments, so the
 * search finishes immediately in the normal case and simply gives up (returns
 * null → the caller reports it instead of guessing) on a pathological one.
 */
export function pickRowsSummingTo<T extends { amount: number }>(rows: T[], target: number): T[] | null {
  const cents = Math.round(target * 100);
  if (cents <= 0) return [];
  const values = rows.map((r) => Math.round(r.amount * 100));
  const chosen: number[] = [];
  const dead = new Set<string>();
  let budget = 50_000;

  const dfs = (i: number, remaining: number): boolean => {
    if (remaining === 0) return true;
    if (i >= values.length || remaining < 0 || budget-- <= 0) return false;
    const key = `${i}:${remaining}`;
    if (dead.has(key)) return false;
    // take this row first — a single payment matching exactly is the common case
    if (values[i] <= remaining) {
      chosen.push(i);
      if (dfs(i + 1, remaining - values[i])) return true;
      chosen.pop();
    }
    if (dfs(i + 1, remaining)) return true;
    dead.add(key);
    return false;
  };

  if (!dfs(0, cents)) return null;
  return chosen.map((i) => rows[i]);
}

/**
 * The audit line a merge writes into the loser's remark:
 * "[merged into <invoice> — <company>; original total 1184.50]".
 * Returns the original amount, or 0 when the row carries no such line.
 */
export const MERGE_TAG = /\s*\[merged into .*?original total ([\d.]+)\]/i;

export function parseMergeOriginalTotal(remark: string | null | undefined): number {
  const m = MERGE_TAG.exec(remark ?? "");
  return m ? Number(m[1]) : 0;
}
