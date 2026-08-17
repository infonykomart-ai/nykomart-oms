// 2026-08-17 — "AB JESE KUCH PARTY ESI HOGI JIS SE KACHA MAAL AATA HAI JESE
// AARADHYA OR FT/MTR/INCH/YARD/CM SABHI KA FOURMULA KAAM KARNA CHAHIYE JAHA
// JAHA PAR JARURT PAD RAHI" — raw-material vendors (fabric etc., e.g.
// Aaradhya Fabrics) often bill in metres/yards/inches/cm rather than this
// app's own feet convention. Purchase Bill and Stock Entry both let the
// user pick whichever unit the vendor's own bill/chalan uses; the value
// actually stored is always converted to FEET first — matching
// purchase_bills' existing "Sq. Feet" field so there's one consistent base
// unit everywhere a quantity gets compared, summed, or multiplied by a
// rate. Same FT_PER_UNIT numbers as src/lib/size-parser.ts's own
// conversion table (kept identical on purpose — don't let the two drift
// apart), plus YARD, which size-parser.ts has never needed since no real
// historical order Size value has ever used yards.
export const LENGTH_UNITS = ["FT", "MTR", "INCH", "YARD", "CM"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const FT_PER_UNIT: Record<LengthUnit, number> = {
  FT: 1,
  MTR: 3.28084,
  INCH: 1 / 12,
  YARD: 3,
  CM: 1 / 30.48,
};

export function toFeet(value: number, unit: LengthUnit): number {
  if (!Number.isFinite(value)) return 0;
  return value * FT_PER_UNIT[unit];
}
