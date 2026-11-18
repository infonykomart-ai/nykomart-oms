// 2026-11-18b — EXPENSE VOUCHER CALCULATION (pure, no I/O).
//
// One place that turns what the user typed (qty × rate, GST rate, inclusive or
// exclusive, discount, additional charges) into every stored figure on an
// expense voucher. It runs in the browser for the live preview AND on the
// server before a voucher is written, so the two can never disagree — same
// contract as src/lib/measurement.ts.
//
// All money is INTEGER PAISE (see ./money.ts). No floats are stored, summed or
// compared. Taxes are derived per line; the voucher total is the sum of lines,
// so the lines always reconcile with the header.
//
// GST MODEL: `gstRate` is the TOTAL rate (18 = 9 CGST + 9 SGST, or 18 IGST) —
// see gstSplit(). Same-state vs interstate comes from place of supply, exactly
// as the prompt requires; nothing is auto-claimed as ITC unless the line is
// marked eligible.

import {
  MAX_ROUND_OFF_PAISE,
  extractGstFromInclusive,
  gstSplit,
  roundHalfUp,
  roundOffToRupee,
  toPaise,
  type Paise,
} from "./money";

export type ExpenseItemInput = {
  description?: string | null;
  categoryId?: string | null;
  qty?: number | string | null;
  unit?: string | null;
  rate?: number | string | null;
  /** Direct amount, used when qty/rate are not both present. */
  amount?: number | string | null;
  discount?: number | string | null;
  /** TOTAL GST rate for the line (18, 12, 5, 0…). */
  gstRate?: number | string | null;
  cessRate?: number | string | null;
  gstInclusive?: boolean;
  gstApplicable?: boolean;
  itcEligible?: boolean;
  ledgerAccountId?: string | null;
  costCentre?: string | null;
  remarks?: string | null;
};

export type ExpenseChargeInput = {
  chargeName?: string | null;
  amount?: number | string | null;
  gstRate?: number | string | null;
  isTaxable?: boolean;
  itcEligible?: boolean;
  ledgerAccountId?: string | null;
  allocationMethod?: "equal" | "quantity" | "weight" | "value" | "manual" | null;
  /** Used only when allocationMethod = 'manual'. */
  allocatedAmount?: number | string | null;
};

export type CalculatedLine = {
  lineNo: number;
  description: string;
  categoryId: string | null;
  ledgerAccountId: string | null;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  gstRate: number;
  gstInclusive: boolean;
  gstApplicable: boolean;
  itcEligible: boolean;
  costCentre: string | null;
  remarks: string | null;
  grossPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  nonGstPaise: Paise;
  itcPaise: Paise;
  totalPaise: Paise;
};

export type CalculatedCharge = {
  chargeName: string;
  ledgerAccountId: string | null;
  allocationMethod: "equal" | "quantity" | "weight" | "value" | "manual";
  isTaxable: boolean;
  itcEligible: boolean;
  amountPaise: Paise;
  gstRate: number;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  itcPaise: Paise;
  totalPaise: Paise;
};

export type VoucherTotals = {
  grossPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  taxPaise: Paise;
  chargesPaise: Paise;
  nonGstPaise: Paise;
  itcPaise: Paise;
  /** Sum of everything before the round-off. */
  exactTotalPaise: Paise;
  roundOffPaise: Paise;
  /** What the voucher is worth — exact total + round-off. */
  grandTotalPaise: Paise;
};

export type VoucherCalculation = {
  valid: boolean;
  errors: string[];
  lines: CalculatedLine[];
  charges: CalculatedCharge[];
  totals: VoucherTotals;
};

export type VoucherInput = {
  items: ExpenseItemInput[];
  charges?: ExpenseChargeInput[];
  /** Place of supply differs from the company's state → IGST. */
  interstate: boolean;
  /** Print a whole-rupee bill (round-off line). Defaults to false. */
  roundToRupee?: boolean;
};

const ALLOWED_GST_RATES = [0, 0.25, 1, 1.5, 2.5, 3, 5, 6, 9, 12, 18, 28];

function normalizeGstRate(value: number | string | null | undefined): number {
  const rate = typeof value === "number" ? value : Number(String(value ?? "0").replace(/[%\s]/g, "") || 0);
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return rate;
}

function isSupportedGstRate(rate: number): boolean {
  return ALLOWED_GST_RATES.some((allowed) => Math.abs(allowed - rate) < 1e-9);
}

function optionalNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(/[,\s]/g, ""));
  return Number.isFinite(num) ? num : null;
}

/**
 * Calculates ONE line. `qty × rate` wins when both are present (the master
 * prompt's Gross = Quantity × Rate); otherwise the typed amount is used
 * as-is — a flat ₹500 stationery bill needs no fake quantity.
 */
export function calculateLine(
  input: ExpenseItemInput,
  lineNo: number,
  interstate: boolean
): { line: CalculatedLine; errors: string[] } {
  const errors: string[] = [];
  const description = String(input.description ?? "").trim();
  const gstRate = normalizeGstRate(input.gstRate);
  const cessRate = normalizeGstRate(input.cessRate);
  const gstApplicable = input.gstApplicable !== false && gstRate > 0;
  const itcEligible = input.itcEligible !== false;

  const qty = optionalNumber(input.qty);
  const rate = optionalNumber(input.rate);
  const typedAmount = toPaise(input.amount ?? null);
  const discountPaise = Math.max(0, toPaise(input.discount ?? 0) || 0);

  let grossPaise: Paise;
  if (qty !== null && qty > 0 && rate !== null && rate >= 0) {
    grossPaise = toPaise(roundHalfUp(qty * rate, 2));
  } else {
    grossPaise = typedAmount;
  }

  if (!description) errors.push(`Line ${lineNo}: description is required.`);
  if (!Number.isFinite(grossPaise) || grossPaise <= 0) {
    errors.push(`Line ${lineNo}: amount must be greater than zero.`);
  }
  if (discountPaise > grossPaise) {
    errors.push(`Line ${lineNo}: discount cannot be more than the gross amount.`);
  }
  if (!isSupportedGstRate(gstRate)) {
    errors.push(`Line ${lineNo}: ${gstRate}% is not a supported GST rate.`);
  }
  if (gstRate > 28) errors.push(`Line ${lineNo}: GST rate cannot be more than 28%.`);

  const safeGross = Number.isFinite(grossPaise) && grossPaise > 0 ? Math.round(grossPaise) : 0;
  const safeDiscount = Math.min(discountPaise, safeGross);
  const netPaise = safeGross - safeDiscount;

  let taxablePaise = netPaise;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let cessPaise = 0;
  let nonGstPaise = 0;

  if (gstApplicable && gstRate > 0) {
    if (input.gstInclusive) {
      const extracted = extractGstFromInclusive(netPaise, gstRate, interstate);
      taxablePaise = extracted.basePaise;
      cgstPaise = extracted.gst.cgstPaise;
      sgstPaise = extracted.gst.sgstPaise;
      igstPaise = extracted.gst.igstPaise;
    } else {
      const split = gstSplit(netPaise, gstRate, interstate);
      cgstPaise = split.cgstPaise;
      sgstPaise = split.sgstPaise;
      igstPaise = split.igstPaise;
    }
    if (cessRate > 0) cessPaise = Math.round((taxablePaise * cessRate) / 100);
  } else {
    nonGstPaise = netPaise;
  }

  const taxPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
  const itcPaise = gstApplicable && itcEligible ? taxPaise : 0;

  return {
    errors,
    line: {
      lineNo,
      description,
      categoryId: input.categoryId ?? null,
      ledgerAccountId: input.ledgerAccountId ?? null,
      qty: qty !== null && qty > 0 ? qty : null,
      unit: input.unit ? String(input.unit).slice(0, 12) : null,
      rate: rate !== null && rate >= 0 ? rate : null,
      gstRate,
      gstInclusive: Boolean(input.gstInclusive),
      gstApplicable,
      itcEligible,
      costCentre: input.costCentre?.trim() || null,
      remarks: input.remarks?.trim() || null,
      grossPaise: safeGross,
      discountPaise: safeDiscount,
      taxablePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      cessPaise,
      nonGstPaise,
      itcPaise,
      totalPaise: taxablePaise + taxPaise,
    },
  };
}

/**
 * Calculates an additional charge. A charge is only taxed when it is marked
 * taxable AND has a GST rate — a non-taxable freight charge can never silently
 * pick up GST from the item lines (that would be double taxation).
 */
export function calculateCharge(
  input: ExpenseChargeInput,
  interstate: boolean
): { charge: CalculatedCharge; errors: string[] } {
  const errors: string[] = [];
  const chargeName = String(input.chargeName ?? "").trim();
  const amountPaise = toPaise(input.amount ?? 0) || 0;
  const gstRate = normalizeGstRate(input.gstRate);
  const isTaxable = input.isTaxable === true && gstRate > 0;
  const itcEligible = input.itcEligible !== false;
  const allocationMethod = input.allocationMethod ?? "value";

  if (!chargeName) errors.push("A charge needs a name (Freight, Loading, Kanta…).");
  if (amountPaise < 0) errors.push(`Charge "${chargeName || "unnamed"}": amount cannot be negative.`);
  if (isTaxable && !isSupportedGstRate(gstRate)) {
    errors.push(`Charge "${chargeName || "unnamed"}": ${gstRate}% is not a supported GST rate.`);
  }

  const split = isTaxable
    ? gstSplit(amountPaise, gstRate, interstate)
    : { cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };
  const taxPaise = split.cgstPaise + split.sgstPaise + split.igstPaise;

  return {
    errors,
    charge: {
      chargeName,
      ledgerAccountId: input.ledgerAccountId ?? null,
      allocationMethod,
      isTaxable,
      itcEligible,
      amountPaise,
      gstRate,
      cgstPaise: split.cgstPaise,
      sgstPaise: split.sgstPaise,
      igstPaise: split.igstPaise,
      itcPaise: isTaxable && itcEligible ? taxPaise : 0,
      totalPaise: amountPaise + taxPaise,
    },
  };
}

/**
 * Allocates every charge across the item lines by the chosen method, returning
 * one share per line index. Shares always add back to the charge amount (the
 * last line absorbs the rounding remainder) — the master prompt's allocation
 * methods, with no paise lost. `weight` falls back to quantity: an expense line
 * has no weight field of its own.
 */
export function allocateCharges(lines: CalculatedLine[], charges: CalculatedCharge[]): number[][] {
  return charges.map((charge) => {
    const count = lines.length;
    if (count === 0) return [];
    if (charge.allocationMethod === "equal") {
      const base = Math.floor(charge.amountPaise / count);
      const shares = new Array(count).fill(base);
      shares[count - 1] += charge.amountPaise - base * count;
      return shares;
    }
    const weights = lines.map((line) => {
      switch (charge.allocationMethod) {
        case "quantity":
        case "weight":
          return line.qty && line.qty > 0 ? line.qty : 0;
        case "manual":
        case "value":
        default:
          return line.taxablePaise;
      }
    });
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) {
      const base = Math.floor(charge.amountPaise / count);
      const shares = new Array(count).fill(base);
      shares[count - 1] += charge.amountPaise - base * count;
      return shares;
    }
    const shares = weights.map((w) => Math.floor((charge.amountPaise * w) / totalWeight));
    const allocated = shares.reduce((sum, s) => sum + s, 0);
    // Remainder goes to the largest line so the total is exact.
    let largest = 0;
    for (let i = 1; i < weights.length; i += 1) if (weights[i] > weights[largest]) largest = i;
    shares[largest] += charge.amountPaise - allocated;
    return shares;
  });
}

/**
 * The full voucher calculation. Every stored figure on the voucher comes from
 * here; nothing downstream recomputes a total differently.
 */
export function calculateVoucher(input: VoucherInput): VoucherCalculation {
  const errors: string[] = [];
  const items = Array.isArray(input.items) ? input.items : [];
  const chargeInputs = Array.isArray(input.charges) ? input.charges : [];

  if (items.length === 0) errors.push("Add at least one expense line.");

  const lines: CalculatedLine[] = [];
  items.forEach((item, index) => {
    const { line, errors: lineErrors } = calculateLine(item, index + 1, input.interstate);
    errors.push(...lineErrors);
    lines.push(line);
  });

  const charges: CalculatedCharge[] = [];
  chargeInputs.forEach((charge) => {
    const { charge: calculated, errors: chargeErrors } = calculateCharge(charge, input.interstate);
    errors.push(...chargeErrors);
    charges.push(calculated);
  });

  const totals: VoucherTotals = {
    grossPaise: lines.reduce((sum, l) => sum + l.grossPaise, 0),
    discountPaise: lines.reduce((sum, l) => sum + l.discountPaise, 0),
    taxablePaise: lines.reduce((sum, l) => sum + l.taxablePaise, 0),
    cgstPaise: lines.reduce((sum, l) => sum + l.cgstPaise, 0) + charges.reduce((sum, c) => sum + c.cgstPaise, 0),
    sgstPaise: lines.reduce((sum, l) => sum + l.sgstPaise, 0) + charges.reduce((sum, c) => sum + c.sgstPaise, 0),
    igstPaise: lines.reduce((sum, l) => sum + l.igstPaise, 0) + charges.reduce((sum, c) => sum + c.igstPaise, 0),
    cessPaise: lines.reduce((sum, l) => sum + l.cessPaise, 0),
    taxPaise: 0,
    chargesPaise: charges.reduce((sum, c) => sum + c.totalPaise, 0),
    nonGstPaise: lines.reduce((sum, l) => sum + l.nonGstPaise, 0),
    itcPaise: lines.reduce((sum, l) => sum + l.itcPaise, 0) + charges.reduce((sum, c) => sum + c.itcPaise, 0),
    exactTotalPaise: 0,
    roundOffPaise: 0,
    grandTotalPaise: 0,
  };

  totals.taxPaise = totals.cgstPaise + totals.sgstPaise + totals.igstPaise + totals.cessPaise;
  totals.exactTotalPaise =
    lines.reduce((sum, l) => sum + l.totalPaise, 0) + charges.reduce((sum, c) => sum + c.totalPaise, 0);

  if (input.roundToRupee && totals.exactTotalPaise > 0) {
    const roundOff = roundOffToRupee(totals.exactTotalPaise);
    if (Math.abs(roundOff) <= MAX_ROUND_OFF_PAISE) totals.roundOffPaise = roundOff;
  }
  totals.grandTotalPaise = totals.exactTotalPaise + totals.roundOffPaise;

  if (totals.exactTotalPaise <= 0 && items.length > 0) {
    errors.push("The voucher total must be greater than zero.");
  }

  return { valid: errors.length === 0, errors, lines, charges, totals };
}
