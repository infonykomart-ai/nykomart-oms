// 2026-11-05 — the purchase forms' bridge to the universal measurement
// engine. Pure (no React, no Supabase), so the browser preview and the server
// action both call the SAME functions — see src/lib/measurement.ts for the
// conversion mathematics and db/2026-11-05-refund-edit-delete-and-measurement.sql
// for where the inputs/outputs are stored.
import {
  computePurchaseArea,
  roundTo,
  type AreaBreakdown,
  type AreaUnit,
  type AreaQtyUnit,
  type LengthUnit,
  type RoundingMode,
} from "./measurement";

export type PurchaseDimensionState = {
  length: string;
  lengthUnit: LengthUnit;
  width: string;
  widthUnit: LengthUnit;
  /** The unit the calculated area is shown/saved in. */
  areaUnit: AreaUnit;
  /** The unit the vendor's rate is quoted in. */
  rateUnit: AreaUnit;
};

export type PurchaseMeasurementDefaults = {
  dimensionUnit?: string | null;
  areaUnit?: string | null;
  rateUnit?: string | null;
  /** 2026-11-06 — units enabled in OMS Settings → Measurement. */
  enabledLengthUnits?: string[] | null;
  enabledAreaUnits?: string[] | null;
  enabledQuantityUnits?: string[] | null;
};

/** Form defaults: OMS Settings → Measurement when configured, else FT / SQ FT. */
export function purchaseDimensionDefaults(defaults?: PurchaseMeasurementDefaults | null): PurchaseDimensionState {
  const dimensionUnit = (defaults?.dimensionUnit ?? "FT") as LengthUnit;
  const areaUnit = (defaults?.areaUnit ?? "SQ_FT") as AreaUnit;
  const rateUnit = (defaults?.rateUnit ?? areaUnit) as AreaUnit;
  return {
    length: "",
    lengthUnit: dimensionUnit,
    width: "",
    widthUnit: dimensionUnit,
    areaUnit,
    rateUnit,
  };
}

export type PurchaseMeasurementDerived =
  | { active: false }
  | {
      active: true;
      error: string | null;
      /** Area of ONE piece (Length × Width) in `areaUnit` — stored per row. */
      area: number;
      /** Total area (Length × Width × Qty) in `areaUnit`, for display. */
      totalArea: number;
      /** The same TOTAL area in every area unit — for the live reference line. */
      breakdown: AreaBreakdown | null;
      /** Area rounded to 4dp, the value shown next to the unit in the form. */
      storedArea: number;
      qtyUnit: AreaQtyUnit;
      /** Rate converted to `areaUnit` and rounded to 2dp (what gets stored). */
      unitRate: number;
      /** Rate exactly as the user typed it. */
      rateInput: number;
      rateInputUnit: AreaUnit;
    };

/**
 * `active` only when BOTH dimensions are present — a blank panel keeps the
 * old manual area entry path untouched. One dimension without the other is an
 * error, never a silently ignored input.
 */
export function derivePurchaseMeasurement(
  state: PurchaseDimensionState,
  qty: number,
  rateInput: string,
  precision = 2,
  rounding: RoundingMode = "HALF_UP"
): PurchaseMeasurementDerived {
  const hasLength = state.length.trim() !== "";
  const hasWidth = state.width.trim() !== "";
  if (!hasLength && !hasWidth) return { active: false };
  if (!hasLength || !hasWidth) {
    return {
      active: true,
      error: "Enter BOTH Length and Width (or clear both to type the area directly).",
      area: 0,
      totalArea: 0,
      breakdown: null,
      storedArea: 0,
      qtyUnit: "FT",
      unitRate: 0,
      rateInput: Number(rateInput) || 0,
      rateInputUnit: state.rateUnit,
    };
  }

  const calc = computePurchaseArea({
    length: Number(state.length),
    lengthUnit: state.lengthUnit,
    width: Number(state.width),
    widthUnit: state.widthUnit,
    qty: Number(qty) || 0,
    outputUnit: state.areaUnit,
    precision,
    rate: Number(rateInput) || 0,
    rateUnit: state.rateUnit,
    rounding,
  });
  if (!calc.ok) {
    return {
      active: true,
      error: calc.error,
      area: 0,
      totalArea: 0,
      breakdown: null,
      storedArea: 0,
      qtyUnit: "FT",
      unitRate: 0,
      rateInput: Number(rateInput) || 0,
      rateInputUnit: state.rateUnit,
    };
  }

  return {
    active: true,
    error: null,
    area: calc.result.area,
    totalArea: calc.result.totalArea,
    breakdown: calc.result.measurement.breakdown,
    storedArea: roundTo(calc.result.area, 4),
    qtyUnit: calc.result.qtyUnit,
    unitRate: calc.result.unitRate,
    rateInput: calc.result.rateInput,
    rateInputUnit: calc.result.rateInputUnit,
  };
}

/**
 * The exact object the server action recalculates from. Numbers only, so a
 * JSON round-trip through the multi-item form cannot change its meaning.
 */
export function purchaseMeasurementPayload(
  state: PurchaseDimensionState,
  qty: number,
  rateInput: string,
  precision = 2,
  rounding: RoundingMode = "HALF_UP"
): {
  length: number;
  lengthUnit: LengthUnit;
  width: number;
  widthUnit: LengthUnit;
  areaUnit: AreaUnit;
  rateUnit: AreaUnit;
  rate: number;
  precision: number;
  rounding: RoundingMode;
} | null {
  const derived = derivePurchaseMeasurement(state, qty, rateInput, precision, rounding);
  if (!derived.active) return null;
  return {
    length: Number(state.length),
    lengthUnit: state.lengthUnit,
    width: Number(state.width),
    widthUnit: state.widthUnit,
    areaUnit: state.areaUnit,
    rateUnit: state.rateUnit,
    rate: Number(rateInput) || 0,
    precision,
    rounding,
  };
}

/** Compact "32 SQ FT · 2.9729 SQ MTR · 4,608 SQ INCH" reference line. */
export function measurementReference(
  derived: PurchaseMeasurementDerived,
  precision = 2
): string | null {
  if (!derived.active || derived.error || !derived.breakdown) return null;
  const parts = [
    `SQ FT ${derived.breakdown.SQ_FT.toFixed(precision)}`,
    `SQ MTR ${derived.breakdown.SQ_MTR.toFixed(precision)}`,
    `SQ CM ${derived.breakdown.SQ_CM.toFixed(precision)}`,
    `SQ INCH ${derived.breakdown.SQ_INCH.toFixed(precision)}`,
  ];
  return parts.join(" · ");
}
