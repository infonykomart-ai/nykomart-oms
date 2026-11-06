// 2026-11-05 — UNIVERSAL MEASUREMENT ENGINE.
//
// One centralized conversion engine for every dimension / area / per-area
// rate figure in OMS. Before this, Purchase Bill could only take an AREA that
// the vendor had already worked out (purchase_bills.sq_feet + qty_unit), or a
// free-text size parsed by src/lib/size-parser.ts into square feet. Neither
// could take a LENGTH × WIDTH pair in two DIFFERENT units, and neither could
// express the result in anything but sq ft.
//
// The owner's exact conversion standard (never approximate, never multiply
// values from different units without converting first):
//   1 FT    = 30.48 CM
//   1 INCH  = 2.54 CM
//   1 MTR   = 100 CM
//   1 SQ FT = 0.09290304 SQ MTR
//   1 SQ INCH = 6.4516 SQ CM
//   1 SQ MTR  = 10.7639104167 SQ FT
//   1 SQ FT   = 929.0304 SQ CM
//
// All of those follow from the two base constants below: centimetres per
// length unit, and square metres per area unit. CM is the base for LENGTH
// (matching size-parser.ts's historical convention) and SQ MTR is the base
// for AREA. Every public helper here is pure and dependency-free, so the
// SAME code runs in the browser (live form preview) and on the server
// (authoritative recalculation before a row is written) — the two can never
// disagree.

export const LENGTH_UNITS = ["MM", "CM", "MTR", "INCH", "FT"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const AREA_UNITS = ["SQ_MM", "SQ_CM", "SQ_MTR", "SQ_INCH", "SQ_FT"] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];

// 2026-11-06 — weight and count units for the non-area entry screens. They
// share the same engine/settings contract as length and area, but never
// convert into an area: a kg is not a dimension.
export const WEIGHT_UNITS = ["G", "KG", "TON"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const QUANTITY_UNITS = ["PCS", "SET", "BOX", "UNIT"] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

/** Kilograms per one weight unit. Exact by definition (1 TON = 1,000 KG). */
export const KG_PER_WEIGHT_UNIT: Record<WeightUnit, number> = {
  G: 0.001,
  KG: 1,
  TON: 1000,
};

export const WEIGHT_UNIT_LABEL: Record<WeightUnit, string> = {
  G: "Gram",
  KG: "KG",
  TON: "Ton",
};

export const QUANTITY_UNIT_LABEL: Record<QuantityUnit, string> = {
  PCS: "Pieces",
  SET: "Sets",
  BOX: "Boxes",
  UNIT: "Units",
};

export type RoundingMode = "HALF_UP" | "UP" | "DOWN";

export function isWeightUnit(value: unknown): value is WeightUnit {
  return typeof value === "string" && (WEIGHT_UNITS as readonly string[]).includes(value);
}

export function isQuantityUnit(value: unknown): value is QuantityUnit {
  return typeof value === "string" && (QUANTITY_UNITS as readonly string[]).includes(value);
}

export function isRoundingMode(value: unknown): value is RoundingMode {
  return value === "HALF_UP" || value === "UP" || value === "DOWN";
}

/** How many centimetres one unit of length is. Exact by definition. */
export const CM_PER_LENGTH_UNIT: Record<LengthUnit, number> = {
  MM: 0.1,
  CM: 1,
  MTR: 100,
  INCH: 2.54,
  FT: 30.48,
};

/** How many square metres one unit of area is. Exact by definition. */
export const SQ_M_PER_AREA_UNIT: Record<AreaUnit, number> = {
  SQ_MM: 0.000001,
  SQ_CM: 0.0001,
  SQ_MTR: 1,
  SQ_INCH: 0.00064516,
  SQ_FT: 0.09290304,
};

export const LENGTH_UNIT_LABEL: Record<LengthUnit, string> = {
  MM: "MM",
  CM: "CM",
  MTR: "MTR",
  INCH: "INCH",
  FT: "FT",
};

export const AREA_UNIT_LABEL: Record<AreaUnit, string> = {
  SQ_MM: "SQ MM",
  SQ_CM: "SQ CM",
  SQ_MTR: "SQ MTR",
  SQ_INCH: "SQ INCH",
  SQ_FT: "SQ FT",
};

export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === "string" && (LENGTH_UNITS as readonly string[]).includes(value);
}

export function isAreaUnit(value: unknown): value is AreaUnit {
  return typeof value === "string" && (AREA_UNITS as readonly string[]).includes(value);
}

/** Rounds to `digits` decimals without the usual 1.005 float trap. */
export function roundTo(value: number, digits = 2, mode: RoundingMode = "HALF_UP"): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  // Add the epsilon BEFORE scaling. `scaled + EPSILON` is far too small at
  // 2 decimals (100.49999999999999 + 2.2e-16 is still below 100.5), which is
  // exactly how 1.005 used to round down to 1.00.
  const scaled = (value + (value >= 0 ? Number.EPSILON : -Number.EPSILON)) * factor;
  const rounded =
    mode === "UP"
      ? Math.ceil(scaled - Number.EPSILON)
      : mode === "DOWN"
        ? Math.floor(scaled + Number.EPSILON)
        : Math.round(scaled + Number.EPSILON);
  return rounded / factor;
}

/** Grouped, fixed-precision display string (e.g. "29,728.97"). */
export function formatMeasurement(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// ---------------------------------------------------------------------------
// Length
// ---------------------------------------------------------------------------

/** Converts a length to centimetres. Returns NaN for an unknown unit so
 *  callers validate instead of silently treating it as zero. */
export function lengthToCm(value: number, unit: LengthUnit): number {
  const factor = CM_PER_LENGTH_UNIT[unit];
  if (factor == null || !Number.isFinite(value)) return NaN;
  return value * factor;
}

export function weightToKg(value: number, unit: WeightUnit): number {
  const factor = KG_PER_WEIGHT_UNIT[unit];
  if (factor == null || !Number.isFinite(value)) return NaN;
  return value * factor;
}

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  const kg = weightToKg(value, from);
  const factor = KG_PER_WEIGHT_UNIT[to];
  if (!Number.isFinite(kg) || factor == null) return NaN;
  return kg / factor;
}

/**
 * Quantity units are labels, not convertible dimensions. Validation is the
 * only operation that makes sense; the total is simply value × rate.
 */
export function quantityAmount(quantity: number, unit: QuantityUnit, rate: number): number {
  if (!isQuantityUnit(unit) || !Number.isFinite(quantity) || quantity < 0) return NaN;
  if (!Number.isFinite(rate) || rate < 0) return NaN;
  return roundTo(quantity * rate, 2);
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  const cm = lengthToCm(value, from);
  const factor = CM_PER_LENGTH_UNIT[to];
  if (!Number.isFinite(cm) || factor == null) return NaN;
  return cm / factor;
}

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

export function areaToSqM(value: number, unit: AreaUnit): number {
  const factor = SQ_M_PER_AREA_UNIT[unit];
  if (factor == null || !Number.isFinite(value)) return NaN;
  return value * factor;
}

export function convertArea(value: number, from: AreaUnit, to: AreaUnit): number {
  const sqM = areaToSqM(value, from);
  const factor = SQ_M_PER_AREA_UNIT[to];
  if (!Number.isFinite(sqM) || factor == null) return NaN;
  return sqM / factor;
}

/**
 * Converts a rate quoted per one area unit into another area unit.
 * `₹85 per SQ FT` -> `₹914.84 per SQ MTR` (85 / 0.09290304).
 */
export function convertAreaRate(rate: number, from: AreaUnit, to: AreaUnit): number {
  if (!Number.isFinite(rate)) return NaN;
  const fromSqM = SQ_M_PER_AREA_UNIT[from];
  const toSqM = SQ_M_PER_AREA_UNIT[to];
  if (fromSqM == null || toSqM == null) return NaN;
  return (rate * toSqM) / fromSqM;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export type DimensionInput = {
  length: number;
  lengthUnit: LengthUnit;
  /** Defaults to the length unit (a plain square entry stays one unit). */
  widthUnit?: LengthUnit;
  width: number;
  /** Multiplied into the total area. Defaults to 1. */
  qty?: number;
  /** The unit the caller wants the result expressed in. */
  outputUnit?: AreaUnit;
  /** Display precision (2, 3 or 4 decimals in OMS Settings). */
  precision?: number;
  /** OMS Settings → Measurement rounding rule for stored money/area values. */
  rounding?: RoundingMode;
};

export type AreaBreakdown = Record<AreaUnit, number>;

export type MeasurementResult = {
  /** Normalized dimensions, in centimetres. */
  lengthCm: number;
  widthCm: number;
  /** Area of ONE piece, in square metres. */
  unitAreaSqM: number;
  /** lengthCm × widthCm × qty, in square metres. */
  areaSqM: number;
  /** The same total area in every supported area unit (unrounded). */
  breakdown: AreaBreakdown;
  /** Total area expressed in the requested output unit. */
  area: number;
  outputUnit: AreaUnit;
  precision: number;
  /** Echo of what was entered, for storing alongside the normalized numbers. */
  length: number;
  lengthUnit: LengthUnit;
  width: number;
  widthUnit: LengthUnit;
  qty: number;
};

export type MeasurementOutcome =
  | { ok: true; result: MeasurementResult }
  | { ok: false; error: string };

/**
 * Area = Length × Width × Quantity.
 *
 * Both dimensions are converted into the common base unit (CM) FIRST, then
 * multiplied — mixed units (30 INCH × 5 FT) are handled correctly by
 * construction, and swapping Length and Width cannot change the result.
 */
export function measureDimensions(input: DimensionInput): MeasurementOutcome {
  const { length, width, lengthUnit, qty = 1, precision = 2 } = input;
  const widthUnit = input.widthUnit ?? lengthUnit;

  if (!isLengthUnit(lengthUnit)) return { ok: false, error: `Unknown length unit: ${String(lengthUnit)}` };
  if (!isLengthUnit(widthUnit)) return { ok: false, error: `Unknown width unit: ${String(widthUnit)}` };
  if (!Number.isFinite(length) || length <= 0) return { ok: false, error: "Length must be greater than zero." };
  if (!Number.isFinite(width) || width <= 0) return { ok: false, error: "Width must be greater than zero." };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Quantity must be greater than zero." };
  if (!Number.isFinite(precision) || precision < 0 || precision > 6) {
    return { ok: false, error: "Precision must be between 0 and 6 decimal places." };
  }

  const outputUnit = input.outputUnit ?? "SQ_FT";
  if (!isAreaUnit(outputUnit)) return { ok: false, error: `Unknown area unit: ${String(outputUnit)}` };

  const lengthCm = lengthToCm(length, lengthUnit);
  const widthCm = lengthToCm(width, widthUnit);

  // CM² -> M² is /10,000, the single place that conversion happens.
  const unitAreaSqM = (lengthCm * widthCm) / 10000;
  const areaSqM = unitAreaSqM * qty;

  const breakdown = {} as AreaBreakdown;
  for (const unit of AREA_UNITS) {
    breakdown[unit] = areaSqM / SQ_M_PER_AREA_UNIT[unit];
  }

  return {
    ok: true,
    result: {
      lengthCm,
      widthCm,
      unitAreaSqM,
      areaSqM,
      breakdown,
      area: breakdown[outputUnit],
      outputUnit,
      precision,
      length,
      lengthUnit,
      width,
      widthUnit,
      qty,
    },
  };
}

// ---------------------------------------------------------------------------
// Purchase-bill bridge
// ---------------------------------------------------------------------------
//
// purchase_bills stores ONE area number (`sq_feet`, historical name) in
// `qty_unit`, and `unit_rate` is per that same unit. These two helpers map
// between that legacy pair and the engine's area units, so the engine can
// fill the existing columns without inventing a second area column — every
// report, generated total and export keeps reading exactly what it read
// before.

export type AreaQtyUnit = "MM" | "CM" | "MTR" | "INCH" | "FT";

export const AREA_UNIT_TO_QTY_UNIT: Record<AreaUnit, AreaQtyUnit> = {
  SQ_MM: "MM",
  SQ_CM: "CM",
  SQ_MTR: "MTR",
  SQ_INCH: "INCH",
  SQ_FT: "FT",
};

export function areaUnitToQtyUnit(unit: AreaUnit): AreaQtyUnit {
  return AREA_UNIT_TO_QTY_UNIT[unit];
}

/** Null for units that are not an area (YARD bills and PCS) — those keep
 *  the pre-existing manual entry path untouched. */
export function qtyUnitToAreaUnit(unit: string | null | undefined): AreaUnit | null {
  const map: Record<string, AreaUnit> = {
    MM: "SQ_MM",
    CM: "SQ_CM",
    MTR: "SQ_MTR",
    INCH: "SQ_INCH",
    FT: "SQ_FT",
  };
  return map[(unit ?? "").toUpperCase()] ?? null;
}

export type PurchaseAreaResult = {
  /**
   * Area of ONE piece in the bill's own `qty_unit` — the value that goes
   * into `sq_feet` / `area_value`. The stored total is `qty * area * rate`
   * (the existing generated formula), which equals Length × Width × Qty ×
   * rate without changing what the totals mean.
   */
  area: number;
  /** Length × Width × Qty, in the same unit, for display only. */
  totalArea: number;
  qtyUnit: AreaQtyUnit;
  areaUnit: AreaUnit;
  /** rate converted from the quoted rate unit into the stored area unit. */
  unitRate: number;
  /** Rate exactly as quoted, for the "entered rate" trail. */
  rateInput: number;
  rateInputUnit: AreaUnit;
  measurement: MeasurementResult;
};

/**
 * Server-side authoritative calculation for a purchase-bill line. Given the
 * dimensions the user typed, the area unit they chose and the rate THEY
 * quoted (per `rateUnit`), produces the exact numbers to persist.
 */
export function computePurchaseArea(input: DimensionInput & { rate: number; rateUnit?: AreaUnit }): {
  ok: true;
  result: PurchaseAreaResult;
} | { ok: false; error: string } {
  const measured = measureDimensions(input);
  if (!measured.ok) return measured;
  const rounding = input.rounding ?? "HALF_UP";

  const rate = input.rate;
  if (!Number.isFinite(rate) || rate < 0) return { ok: false, error: "Rate must be a valid number." };

  const rateInputUnit = input.rateUnit ?? measured.result.outputUnit;
  if (!isAreaUnit(rateInputUnit)) return { ok: false, error: `Unknown rate unit: ${String(rateInputUnit)}` };

  // The engine's `area` already includes qty; the legacy purchase columns
  // store the PER-PIECE area and multiply by qty themselves, so divide qty
  // back out ONCE here instead of letting the generated column double-count.
  const unitArea = measured.result.area / measured.result.qty;

  return {
    ok: true,
    result: {
      area: roundTo(unitArea, 4, rounding),
      totalArea: roundTo(measured.result.area, 6, rounding),
      qtyUnit: areaUnitToQtyUnit(measured.result.outputUnit),
      areaUnit: measured.result.outputUnit,
      // unit_rate is numeric(14,2) — round here so the amount the form shows
      // is exactly the amount the generated column computes.
      unitRate: roundTo(convertAreaRate(rate, rateInputUnit, measured.result.outputUnit), 2, rounding),
      rateInput: rate,
      rateInputUnit,
      measurement: measured.result,
    },
  };
}
