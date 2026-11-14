// Customs conversion calculator — pure, so it can be unit tested.
//
// Rule (CBIC / Section 14 of the Customs Act): the customs value in INR is
// the foreign-currency amount multiplied by the applicable customs rate, and
// when the notification quotes the rate per 100 units, the amount is
// multiplied by the rate and divided by 100.
//
// This is NOT a bank settlement rate, an RBI reference rate, or a payment
// conversion. It applies only the published Customs rate.
import type { CustomsRateKind } from "./types";

export type ConversionInput = {
  amount: number;
  rate: number;
  /** The row's official currency unit (1, 10, 100, 1000). */
  unit: number;
};

export type ConversionResult = {
  /** amount × rate ÷ unit, rounded to paise. */
  inr: number;
  /** The exact pre-rounding value, for display/audit. */
  raw: number;
  amount: number;
  rate: number;
  unit: number;
};

function round2(value: number): number {
  // Round half away from zero to paise. The scale is first snapped to 6
  // decimal places so a binary-fraction artefact (3 × 1.005 = 3.0149999…)
  // still rounds to 3.02 rather than silently losing a paisa.
  const sign = value < 0 ? -1 : 1;
  const scaled = Number((Math.abs(value) * 100).toFixed(6));
  return (sign * Math.round(scaled)) / 100;
}

export function convertToInr({ amount, rate, unit }: ConversionInput): ConversionResult {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Foreign currency amount must be a non-negative number.");
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("The applicable customs rate must be a positive number.");
  }
  if (!Number.isFinite(unit) || unit <= 0) {
    throw new Error("The currency unit must be a positive number.");
  }
  const raw = (amount * rate) / unit;
  return { inr: round2(raw), raw, amount, rate, unit };
}

/** The rate actually applied per ONE unit of foreign currency. */
export function ratePerUnit(rate: number, unit: number): number {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Rate must be positive.");
  if (!Number.isFinite(unit) || unit <= 0) throw new Error("Unit must be positive.");
  return rate / unit;
}

/** Human label for the rate, e.g. "₹95.35000000 per 1 USD". */
export function describeRate(rate: number, unit: number, code: string): string {
  return `₹${rate} per ${unit} ${code}`;
}

export type RateChoice = { kind: CustomsRateKind; label: string };

export const RATE_KINDS: RateChoice[] = [
  { kind: "import", label: "Import" },
  { kind: "export", label: "Export" },
];
