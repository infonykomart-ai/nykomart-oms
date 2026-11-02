// 2026-11-02 — Stair Rug set-based quantity + area.
//
// Cotton / Jute / Tufted orders are plain piece counts and MUST stay plain
// piece counts (see new/order-form.tsx's Quantity field, untouched). A Stair
// Rug, though, is sold and packed in SETS ("1 set = 12 PCS"), so entering
// "100" there means nothing useful to the person packing it and nothing at
// all to whoever prices the area.
//
// The whole feature rests on ONE decision: the order row's existing `qty`
// column still holds the FINAL PIECE COUNT (sets × pieces per set). Every
// downstream consumer — stock lookups, invoices, purchase bills, courier
// bills, reports, margin, the Orders list — already multiplies/reads `qty`
// and doesn't need to know a set exists. The set facts are stored BESIDE it
// (new nullable orders.* columns) purely so the form, the order page and the
// WhatsApp caption can say "2 sets × 50 PCS = 100 PCS, 181.25 SQ FT" again
// later. That is why nothing in this file changes how a non-stair order is
// counted, and why a stair order saved before this feature (sets/pieces
// NULL, qty already the piece count) still reads correctly everywhere.
//
// Precision rule: every number below is full float precision. Rounding
// happens ONLY in the format* helpers, at the moment of display — so
// 9 × 29 inch × 18 pcs is 4698 / 144 = 32.625 SQ FT, not 32.63 fed back into
// another multiplication.

/** Units a stair-rug per-piece LENGTH may be entered in. */
export const STAIR_DIMENSION_UNITS = ["FT", "INCH", "CM"] as const;
export type StairDimensionUnit = (typeof STAIR_DIMENSION_UNITS)[number];

/** Inches in one unit of length. Exact for FT and INCH; 1 cm = 1/2.54 in. */
export const INCH_PER_UNIT: Record<StairDimensionUnit, number> = {
  FT: 12,
  INCH: 1,
  CM: 1 / 2.54,
};

/**
 * Ready-made "pieces per set" suggestions for the picker. NOT a limit: the
 * field is an ordinary number input, these are only dropdown hints, and any
 * positive whole number the buyer asks for (7, 23, 137, …) is accepted.
 */
export const PCS_PER_SET_PRESETS = [2, 4, 6, 12, 14, 18, 24, 50, 100, 125, 150, 200] as const;

export type StairSize = {
  setsCount: number;
  piecesPerSet: number;
  totalPieces: number;
  length: number | null;
  width: number | null;
  unit: StairDimensionUnit | null;
};

/** A years-old category may be spelled "Stair Rugs", "STAIR RUG", "Staircase Rug" — one word check covers all. */
export function isStairRugCategory(name: string | null | undefined): boolean {
  return /stair/i.test(name ?? "");
}

export function isStairDimensionUnit(value: unknown): value is StairDimensionUnit {
  return typeof value === "string" && (STAIR_DIMENSION_UNITS as readonly string[]).includes(value);
}

/**
 * Sets / pieces-per-set as a whole number, never below 1. Blank, zero,
 * negative, "abc" and 3.7 all resolve sensibly instead of producing a NaN
 * quantity that would be rejected (or worse, stored) downstream.
 */
export function normalizeCount(value: unknown, fallback = 1): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/** Total Pieces = Number of Sets × Pieces Per Set (the set system's whole formula). */
export function stairTotalPieces(setsCount: unknown, piecesPerSet: unknown): number {
  return normalizeCount(setsCount) * normalizeCount(piecesPerSet);
}

export type StairArea = {
  /** Length / width converted to inches, for traceability. */
  lengthIn: number;
  widthIn: number;
  /** Unrounded, exact values — display rounding is the caller's job. */
  perPieceSqIn: number;
  totalSqIn: number;
  totalSqFt: number;
  totalSqCm: number;
};

/**
 * Per-piece area × total pieces. Returns null when a dimension is missing or
 * not positive — the caller then shows "—" rather than a made-up area (same
 * never-guess rule as src/lib/size-parser.ts).
 */
export function stairArea(input: {
  length: unknown;
  width: unknown;
  unit: unknown;
  totalPieces: unknown;
}): StairArea | null {
  const length = Number(input.length);
  const width = Number(input.width);
  const unit = input.unit;
  if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) return null;
  if (!isStairDimensionUnit(unit)) return null;

  const pieces = normalizeCount(input.totalPieces);
  const factor = INCH_PER_UNIT[unit];
  const lengthIn = length * factor;
  const widthIn = width * factor;
  const perPieceSqIn = lengthIn * widthIn;
  const totalSqIn = perPieceSqIn * pieces;

  return {
    lengthIn,
    widthIn,
    perPieceSqIn,
    totalSqIn,
    totalSqFt: totalSqIn / 144,
    totalSqCm: totalSqIn * 6.4516, // 2.54²
  };
}

/**
 * Display formatter — the ONLY place rounding happens. Up to `maxFraction`
 * decimals, trailing zeros dropped, thousands separated (26,100 SQ INCH,
 * 181.25 SQ FT, 32.625 SQ FT).
 */
export function formatAreaNumber(value: number, maxFraction = 3): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: maxFraction, minimumFractionDigits: 0 });
}

/** Dimensions as entered, e.g. "9 × 29 INCH" — used for the auto size label. */
export function stairSizeLabel(length: unknown, width: unknown, unit: unknown): string {
  const l = Number(length);
  const w = Number(width);
  if (!Number.isFinite(l) || !Number.isFinite(w) || l <= 0 || w <= 0) return "";
  const u = isStairDimensionUnit(unit) ? unit : "INCH";
  return `${l} × ${w} ${u}`;
}

/**
 * What the packing WhatsApp caption shows for a stair order — the exact set
 * lines the owner asked for. Kept here (not inline in the button) so the
 * numbers in the message are the same numbers the order page shows.
 */
export function stairWhatsAppLines(input: {
  size: StairSize;
}): { number_of_sets: string; pieces_per_set: string; total_pieces: string; area_per_piece: string; total_area_sq_in: string; total_area_sq_ft: string } {
  const { size } = input;
  const area = stairArea({ length: size.length, width: size.width, unit: size.unit, totalPieces: size.totalPieces });
  return {
    number_of_sets: String(size.setsCount),
    pieces_per_set: `${size.piecesPerSet} PCS`,
    total_pieces: `${size.totalPieces} PCS`,
    area_per_piece: area ? `${formatAreaNumber(area.perPieceSqIn)} SQ INCH` : "—",
    total_area_sq_in: area ? `${formatAreaNumber(area.totalSqIn)} SQ INCH` : "—",
    total_area_sq_ft: area ? `${formatAreaNumber(area.totalSqFt)} SQ FT` : "—",
  };
}

/**
 * DB-shaped size read from an orders row, tolerant of:
 *  - rows saved before this feature (no sets/pieces: treat qty as one set of
 *    qty pieces, so the area and the packing caption still come out right),
 *  - a partially-filled row (dims missing → area is simply null).
 */
export function stairSizeFromRow(row: {
  qty: number | null | undefined;
  sets_count?: number | null;
  pieces_per_set?: number | null;
  dimension_length?: number | string | null;
  dimension_width?: number | string | null;
  dimension_unit?: string | null;
}): StairSize {
  const qty = normalizeCount(row.qty, 1);
  const piecesPerSet = normalizeCount(row.pieces_per_set ?? qty, qty);
  const setsCount = normalizeCount(row.sets_count ?? 1, 1);
  return {
    setsCount,
    piecesPerSet,
    totalPieces: qty,
    length: row.dimension_length == null ? null : Number(row.dimension_length),
    width: row.dimension_width == null ? null : Number(row.dimension_width),
    unit: isStairDimensionUnit(row.dimension_unit) ? row.dimension_unit : null,
  };
}
