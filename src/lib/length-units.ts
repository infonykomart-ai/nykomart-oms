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

// 2026-08-27 — "AGAR PURCHASE PCS ME KIYA JATA HAI TO US PCS KI RATE KYA
// HOGI" — some vendor bills price by piece count with a rate PER PIECE
// (e.g. garment vendors: "16 PCS @ Rs.260/pc"), not by size at all. This is
// a SEPARATE type from LengthUnit above, used only by the Purchase Bill
// forms (src/components/purchase-qty-unit-select.tsx) — PCS has no
// feet-equivalent, so it's kept out of LENGTH_UNITS/FT_PER_UNIT/toFeet
// rather than added there, to avoid silently breaking Stock In/Out and
// Material Out Chalan, which share LengthUnit and DO convert every entered
// quantity to feet (toFeet) to keep one running stock balance comparable
// across units.
export const PURCHASE_QTY_UNITS = [...LENGTH_UNITS, "PCS"] as const;
export type PurchaseQtyUnit = (typeof PURCHASE_QTY_UNITS)[number];
