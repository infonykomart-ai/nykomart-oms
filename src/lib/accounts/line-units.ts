// 2026-11-19 — EXPENSE LINE UNITS.
//
// "KG QTY MTR SQ FT INCH SABHI SAHI SE KAAM KARE" — an expense voucher line
// used to take a free-text unit box, so "sq ft", "SQFT" and "MTR" were stored
// as typed and nothing could compare, total or convert them. Every unit on a
// line is now one of the OMS measurement engine's units
// (src/lib/measurement.ts), with the same exact conversion constants the rest
// of the app uses.
//
// WHAT TRAVELS WITH A UNIT (the whole point of a unit being real):
//   * the unit the VENDOR billed in — `unit` on the line;
//   * the RATE, quoted per that same unit (`rate`, gross = qty × rate);
//   * a BASE quantity for every line, so 10 MTR and 32.808 FT are comparable
//     in reports: weight → KG, length → FT, area → SQ FT, count → PCS;
//   * for an AREA unit, the size that produced it. A carpet bill is
//     "12 rugs of 4 × 6 ft at ₹85 per sq ft" — the area is Length × Width ×
//     pieces, converted into the chosen area unit (mixed length units
//     allowed). When no size is typed, the qty box IS the total area, which
//     covers an already-totalled "240 sq ft" bill.
//
// Pure and dependency-free apart from the measurement engine, so the browser
// preview and the server recalculation produce identical numbers.

import {
  AREA_UNITS,
  AREA_UNIT_LABEL,
  LENGTH_UNITS,
  LENGTH_UNIT_LABEL,
  QUANTITY_UNITS,
  QUANTITY_UNIT_LABEL,
  WEIGHT_UNITS,
  WEIGHT_UNIT_LABEL,
  convertArea,
  convertLength,
  convertWeight,
  isAreaUnit,
  isLengthUnit,
  isQuantityUnit,
  isWeightUnit,
  measureDimensions,
  roundTo,
  type AreaUnit,
  type LengthUnit,
  type QuantityUnit,
  type WeightUnit,
} from "@/lib/measurement";

export type ExpenseUnit = QuantityUnit | WeightUnit | LengthUnit | AreaUnit;

export type ExpenseUnitFamily = "COUNT" | "WEIGHT" | "LENGTH" | "AREA";

export type ExpenseUnitGroup = {
  family: ExpenseUnitFamily;
  label: string;
  units: ExpenseUnit[];
};

/** Dropdown groups, in the order a shopkeeper thinks about them. */
export const EXPENSE_UNIT_GROUPS: ExpenseUnitGroup[] = [
  { family: "COUNT", label: "Count — pieces", units: [...QUANTITY_UNITS] },
  { family: "WEIGHT", label: "Weight — KG", units: [...WEIGHT_UNITS] },
  { family: "LENGTH", label: "Length — MTR / INCH / FT", units: [...LENGTH_UNITS] },
  { family: "AREA", label: "Area — SQ FT / SQ MTR", units: [...AREA_UNITS] },
];

/**
 * The dropdown, optionally narrowed to the units this company enabled in
 * OMS Settings → Measurement. Unknown/empty settings fall back to every unit
 * (the pre-settings list), so the form never ends up with no choice at all.
 */
export function expenseUnitGroups(enabledUnits?: readonly string[] | null): ExpenseUnitGroup[] {
  if (!enabledUnits || enabledUnits.length === 0) return EXPENSE_UNIT_GROUPS;
  const enabled = new Set(
    enabledUnits.map((unit) => normalizeExpenseUnit(unit)).filter((unit): unit is ExpenseUnit => unit != null)
  );
  const groups = EXPENSE_UNIT_GROUPS.map((group) => ({
    ...group,
    units: group.units.filter((unit) => enabled.has(unit)),
  })).filter((group) => group.units.length > 0);
  return groups.length > 0 ? groups : EXPENSE_UNIT_GROUPS;
}

const UNIT_LABELS: Record<string, string> = {
  ...QUANTITY_UNIT_LABEL,
  ...WEIGHT_UNIT_LABEL,
  ...LENGTH_UNIT_LABEL,
  ...AREA_UNIT_LABEL,
};

/**
 * Free text → engine unit. Covers how these units are actually typed on a
 * vendor bill ("kgs", "mtr", "sq ft", "in", "qty"), so an old or hand-typed
 * value is normalised instead of rejected. Returns null for anything unknown.
 */
export const EXPENSE_UNIT_ALIASES: Record<string, ExpenseUnit> = {
  // count — "QTY" was the old free-text default for a piece-rate bill
  QTY: "PCS",
  NOS: "PCS",
  NO: "PCS",
  PC: "PCS",
  PCS: "PCS",
  PIECE: "PCS",
  PIECES: "PCS",
  SET: "SET",
  SETS: "SET",
  BOX: "BOX",
  BOXES: "BOX",
  UNIT: "UNIT",
  UNITS: "UNIT",
  // weight
  G: "G",
  GM: "G",
  GMS: "G",
  GRAM: "G",
  GRAMS: "G",
  KG: "KG",
  KGS: "KG",
  KILO: "KG",
  KILOS: "KG",
  KILOGRAM: "KG",
  KILOGRAMS: "KG",
  TON: "TON",
  TONS: "TON",
  TONNE: "TON",
  TONNES: "TON",
  // length
  MM: "MM",
  MILLIMETER: "MM",
  MILLIMETRE: "MM",
  CM: "CM",
  CMS: "CM",
  MTR: "MTR",
  MTRS: "MTR",
  M: "MTR",
  METER: "MTR",
  METERS: "MTR",
  METRE: "MTR",
  METRES: "MTR",
  IN: "INCH",
  INCH: "INCH",
  INCHES: "INCH",
  FT: "FT",
  FEET: "FT",
  FOOT: "FT",
  // area
  SQMM: "SQ_MM",
  SQIN: "SQ_INCH",
  SQCM: "SQ_CM",
  SQM: "SQ_MTR",
  SFT: "SQ_FT",
  SQFT: "SQ_FT",
  SQFEET: "SQ_FT",
  SQMTR: "SQ_MTR",
};

/** Canonical unit for a typed value ("sq ft" → SQ_FT), or null. */
export function normalizeExpenseUnit(raw: string | null | undefined): ExpenseUnit | null {
  if (!raw) return null;
  const key = String(raw).toUpperCase().replace(/[.\s_-]+/g, "");
  if (!key) return null;
  const aliased = EXPENSE_UNIT_ALIASES[key];
  if (aliased) return aliased;
  // "4 × 6 FT" style noise is not a unit; only an exact engine unit is.
  const direct = [...QUANTITY_UNITS, ...WEIGHT_UNITS, ...LENGTH_UNITS, ...AREA_UNITS].find(
    (unit) => unit.replace(/_/g, "") === key
  );
  return (direct as ExpenseUnit | undefined) ?? null;
}

export function expenseUnitFamily(unit: string | null | undefined): ExpenseUnitFamily | null {
  if (!unit) return null;
  if (isWeightUnit(unit)) return "WEIGHT";
  if (isLengthUnit(unit)) return "LENGTH";
  if (isAreaUnit(unit)) return "AREA";
  if (isQuantityUnit(unit)) return "COUNT";
  return null;
}

export function expenseUnitLabel(unit: string | null | undefined): string {
  if (!unit) return "";
  return UNIT_LABELS[unit] ?? unit;
}

/** The comparable unit a line is also stored in (see `baseQty`). */
export function expenseBaseUnit(family: ExpenseUnitFamily | null): string | null {
  switch (family) {
    case "WEIGHT":
      return "KG";
    case "LENGTH":
      return "FT";
    case "AREA":
      return "SQ_FT";
    case "COUNT":
      return "PCS";
    default:
      return null;
  }
}

/** Converts a quantity into its family's base unit (KG / FT / SQ FT / PCS). */
export function toBaseExpenseQuantity(qty: number, unit: ExpenseUnit): number {
  const family = expenseUnitFamily(unit);
  switch (family) {
    case "WEIGHT":
      return convertWeight(qty, unit as WeightUnit, "KG");
    case "LENGTH":
      return convertLength(qty, unit as LengthUnit, "FT");
    case "AREA":
      return convertArea(qty, unit as AreaUnit, "SQ_FT");
    case "COUNT":
      return qty;
    default:
      return NaN;
  }
}

export type ExpenseLineUnitInput = {
  qty?: number | string | null;
  unit?: string | null;
  rate?: number | string | null;
  amount?: number | string | null;
  /** Size of ONE piece, only meaningful for an area unit. */
  length?: number | string | null;
  width?: number | string | null;
  lengthUnit?: string | null;
  widthUnit?: string | null;
  /** How many pieces the size applies to (defaults to the qty when omitted). */
  pieces?: number | string | null;
};

export type ResolvedExpenseLineUnits = {
  /** Canonical unit, or null when the line has no unit at all. */
  unit: ExpenseUnit | null;
  family: ExpenseUnitFamily | null;
  /** Quantity in `unit` — derived from Length × Width × pieces for an area. */
  qty: number | null;
  rate: number | null;
  /** True when `qty` came from the size fields rather than being typed. */
  derivedFromSize: boolean;
  /** Area of ONE piece in `unit` when a size was used. */
  pieceArea: number | null;
  /** Same quantity in the family's base unit, for comparisons/reports. */
  baseQty: number | null;
  baseUnit: string | null;
  /** Human error for an unknown unit or an unusable size, else null. */
  error: string | null;
};

function optionalNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(/[,\s]/g, ""));
  return Number.isFinite(num) ? num : null;
}

const QTY_DECIMALS = 3;

/**
 * Resolves what a line's quantity, unit and rate ACTUALLY are.
 *
 * Area lines with a typed size are authoritative: the area is recomputed here
 * from Length × Width × pieces in the engine, so the client can never post a
 * total the size does not support. Everything else is the plain
 * `qty × rate` the bill states.
 */
export function resolveExpenseLineUnits(input: ExpenseLineUnitInput): ResolvedExpenseLineUnits {
  const typedUnit = String(input.unit ?? "").trim();
  const unit = normalizeExpenseUnit(typedUnit);
  const family = expenseUnitFamily(unit);
  const baseUnit = expenseBaseUnit(family);
  const rate = optionalNumber(input.rate);
  let qty = optionalNumber(input.qty);
  let derivedFromSize = false;
  let pieceArea: number | null = null;
  const errors: string[] = [];

  if (!unit && typedUnit) {
    errors.push(`"${typedUnit}" is not a supported unit — use PCS/SET, G/KG/TON, MM/CM/MTR/INCH/FT or SQ FT/SQ MTR.`);
  }

  if (unit && isAreaUnit(unit)) {
    const length = optionalNumber(input.length);
    const width = optionalNumber(input.width);
    const pieces = optionalNumber(input.pieces) ?? (qty && qty > 0 ? qty : null);
    const lengthUnit = normalizeExpenseUnit(input.lengthUnit) ?? "FT";
    const widthUnit = normalizeExpenseUnit(input.widthUnit) ?? lengthUnit;
    const hasSize = length != null && length > 0 && width != null && width > 0;

    if (hasSize) {
      if (!isLengthUnit(lengthUnit) || !isLengthUnit(widthUnit)) {
        errors.push("A size's Length and Width must be in MM, CM, MTR, INCH or FT.");
      } else if (pieces != null && pieces > 0) {
        const measured = measureDimensions({
          length,
          lengthUnit,
          width,
          widthUnit,
          qty: pieces,
          outputUnit: unit,
        });
        if (measured.ok) {
          qty = roundTo(measured.result.area, QTY_DECIMALS);
          pieceArea = roundTo(measured.result.area / pieces, 4);
          derivedFromSize = true;
        } else {
          errors.push(measured.error);
        }
      } else {
        errors.push("An area line with a size also needs the number of pieces.");
      }
    }
  }

  const baseQty =
    unit && family && qty != null && qty > 0 ? roundTo(toBaseExpenseQuantity(qty, unit), QTY_DECIMALS) : null;

  return {
    unit,
    family,
    qty: qty != null && qty > 0 ? qty : null,
    rate,
    derivedFromSize,
    pieceArea,
    baseQty: baseQty != null && Number.isFinite(baseQty) && baseQty > 0 ? baseQty : null,
    baseUnit,
    error: errors.length > 0 ? errors.join(" ") : null,
  };
}

/** "Rate per SQ FT" — the rate is always per the line's own unit. */
export function expenseRateLabel(unit: string | null | undefined): string {
  const label = expenseUnitLabel(unit);
  return label ? `Rate / ${label}` : "Rate";
}

/** "Qty (MTR)" — so the quantity's unit is never guessed. */
export function expenseQtyLabel(unit: string | null | undefined): string {
  const label = expenseUnitLabel(unit);
  return label ? `Qty (${label})` : "Qty";
}
