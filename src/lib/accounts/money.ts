// 2026-11-18b — MONEY IN PAISE.
//
// Every financial number in the Purchase & Accounts module is an INTEGER
// number of paise. Never a float: `0.1 + 0.2 !== 0.3` is exactly how a trial
// balance stops balancing after a few hundred vouchers, and the master prompt
// forbids floating-point financial calculations.
//
// Storage stays numeric(14,2) in Postgres (exact decimal); the float/paise
// boundary is crossed ONCE here, on input, and once on output. All internal
// arithmetic (GST splits, allocations, journal totals) happens on integers.

export type Paise = number;

/** A rupee amount as a number, in paise. Kept as a named type for readers. */
export type Rupees = number;

/**
 * Parses user input to paise. Accepts "1,234.56", "₹1234.5", 1234.56, "" → NaN.
 * Strings are parsed digit-by-digit so 1.005-style float error can't creep in
 * before rounding. Invalid input returns NaN — callers validate, they never
 * treat NaN as zero.
 */
export function toPaise(value: number | string | null | undefined): Paise {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return NaN;
    return Math.round(value * 100);
  }
  const raw = String(value).replace(/[,\s₹]/g, "").trim();
  if (raw === "") return NaN;
  if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === "-" || raw === ".") return NaN;
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace("-", "").split(".");
  const thirdDigit = Number(fraction[2] ?? "0");
  const paise =
    Number(whole || "0") * 100 +
    Number((fraction.slice(0, 2) + "00").slice(0, 2)) +
    (thirdDigit >= 5 ? 1 : 0);
  return negative ? -paise : paise;
}

/** Paise → the rupee number stored in Postgres numeric(14,2). */
export function fromPaise(paise: Paise): Rupees {
  if (!Number.isFinite(paise)) return 0;
  return Math.round(paise) / 100;
}

/** "1,23,456.78" — Indian grouping, always two decimals. */
export function formatPaise(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "—";
  return (paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Rounds a rupee amount half-up to `digits` decimals. Display/input only. */
export function roundHalfUp(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return NaN;
  const factor = 10 ** digits;
  return Math.round((value + (value >= 0 ? Number.EPSILON : -Number.EPSILON)) * factor) / factor;
}

export function sumPaise(values: Array<Paise | null | undefined>): Paise {
  let total = 0;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    total += Math.round(value);
  }
  return total;
}

export type GstSplit = {
  /** Total tax across all heads, in paise. */
  totalPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
};

/**
 * Splits GST on a taxable base.
 *
 * `ratePct` is the TOTAL GST rate (18 → 9% CGST + 9% SGST or 18% IGST) — the
 * rate a person actually says out loud. Same-state supply splits it; interstate
 * puts it all in IGST (place-of-supply rules).
 *
 * The intrastate half is rounded ONCE and the remainder goes to SGST, so
 * cgst + sgst is always exactly the total tax — never a paisa lost or invented.
 */
export function gstSplit(taxablePaise: Paise, ratePct: number, interstate: boolean): GstSplit {
  if (!Number.isFinite(taxablePaise) || taxablePaise === 0) {
    return { totalPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  }
  if (!Number.isFinite(ratePct) || ratePct <= 0) {
    return { totalPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  }
  const total = Math.round((taxablePaise * ratePct) / 100);
  if (interstate) {
    return { totalPaise: total, cgstPaise: 0, sgstPaise: 0, igstPaise: total };
  }
  const cgst = Math.round(total / 2);
  return { totalPaise: total, cgstPaise: cgst, sgstPaise: total - cgst, igstPaise: 0 };
}

/**
 * Extracts the taxable base from a GST-INCLUSIVE amount (the vendor's bill
 * says ₹1,180 including 18%). The tax is the difference, so base + tax is
 * exactly the amount entered.
 */
export function extractGstFromInclusive(
  inclusivePaise: Paise,
  ratePct: number,
  interstate: boolean
): { basePaise: Paise; gst: GstSplit } {
  if (!Number.isFinite(inclusivePaise) || inclusivePaise <= 0) {
    return { basePaise: 0, gst: { totalPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 } };
  }
  if (!Number.isFinite(ratePct) || ratePct <= 0) {
    return { basePaise: inclusivePaise, gst: { totalPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 } };
  }
  const base = Math.round((inclusivePaise * 100) / (100 + ratePct));
  const tax = inclusivePaise - base;
  const split = gstSplit(base, ratePct, interstate);
  // The difference is authoritative for the TOTAL; distribute it into the
  // heads (rounding here would otherwise lose/gain a paisa).
  if (interstate) {
    return { basePaise: base, gst: { totalPaise: tax, cgstPaise: 0, sgstPaise: 0, igstPaise: tax } };
  }
  const cgst = Math.round(tax / 2);
  return {
    basePaise: base,
    gst: { totalPaise: tax, cgstPaise: cgst, sgstPaise: tax - cgst, igstPaise: split.igstPaise },
  };
}

/**
 * Signed round-off to the nearest whole rupee (the "round figure" every Indian
 * bill prints). Positive when the exact total was rounded up.
 */
export function roundOffToRupee(grandTotalPaise: Paise): Paise {
  if (!Number.isFinite(grandTotalPaise)) return 0;
  const rounded = Math.round(grandTotalPaise / 100) * 100;
  return rounded - grandTotalPaise;
}

/** Defensive bound so a fat-fingered amount can't become a round-off entry. */
export const MAX_ROUND_OFF_PAISE = 100_000; // ₹1,000
