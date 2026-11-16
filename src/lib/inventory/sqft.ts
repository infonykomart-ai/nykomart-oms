// PCS ↔ SQ FT maths for dimension-based products (rugs, table cloth, table
// runner). Area is stored at 3 decimals and never silently rounded away:
// computeSqFt() returns the exact product rounded to storage precision, and
// splitSqFt() distributes a total across lines so the parts add back to the
// whole (same remainder-to-last rule used for money allocation elsewhere).
export const QTY_DECIMALS = 3;

export function roundQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** QTY_DECIMALS;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Area for a shipment/inward of `pcs` pieces of a variant whose single piece
 * measures `sqftPerPiece`. Returns null when the variant has no dimensions —
 * the caller must then either collect SQ FT manually or store PCS only.
 */
export function computeSqFt(pcs: number, sqftPerPiece: number | null | undefined): number | null {
  if (sqftPerPiece === null || sqftPerPiece === undefined) return null;
  if (!Number.isFinite(pcs) || !Number.isFinite(sqftPerPiece)) return null;
  return roundQty(pcs * sqftPerPiece);
}

/** Area per piece for a length × width variant, in feet. */
export function sqftPerPiece(lengthFt: number | null, widthFt: number | null): number | null {
  if (lengthFt === null || widthFt === null) return null;
  if (lengthFt <= 0 || widthFt <= 0) return null;
  return Math.round(lengthFt * widthFt * 10000) / 10000;
}

/**
 * Split `total` SQ FT across lines in proportion to `weights`, with the
 * floating remainder landing on the last line so the sum is exact.
 */
export function splitSqFt(total: number, weights: number[]): number[] {
  const roundedTotal = roundQty(total);
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const out = weights.map(() => 0);
    out[out.length - 1] = roundedTotal;
    return out;
  }
  let allocated = 0;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return roundQty(roundedTotal - allocated);
    const share = roundQty((roundedTotal * w) / sum);
    allocated = roundQty(allocated + share);
    return share;
  });
}

/**
 * Resolve the SQ FT for a movement. An explicit, non-negative figure from the
 * user wins (manual correction for irregular pieces); otherwise derive from
 * the variant. Throws when neither is available and the product tracks area.
 */
export function resolveSqFt(input: {
  pcs: number;
  sqftPerPiece: number | null;
  override?: number | null;
  sqftTracked: boolean;
}): number {
  if (input.override !== null && input.override !== undefined && input.override >= 0) {
    return roundQty(input.override);
  }
  const derived = computeSqFt(input.pcs, input.sqftPerPiece);
  if (derived !== null) return derived;
  if (!input.sqftTracked) return 0;
  return 0;
}
