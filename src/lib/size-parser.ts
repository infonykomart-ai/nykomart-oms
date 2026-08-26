// 2026-08-12 (round 10): "PURCHASE BILL ME ... ORDER ME PATA CHAL RHA HAI
// KI KITNE SQ FT MAAL HUA AGAR CM ME HAI TO USKO DEKHE YE JESE 3INCH X 4
// CM TO ISKO BHI SAMJH LO RATE MANUAL KAR DO" — Purchase Bill should be
// able to read an order's free-text Size field (orders.size_label /
// sizes.label — always plain text, never parsed anywhere else in this
// codebase, see design decision #7) and suggest a sq ft figure, handling
// feet/inch/cm/metre and mixed compound notation. Rate stays fully manual
// per the same request — this module ONLY ever suggests sq ft, never a
// rate or amount, and every suggestion is shown as an editable, overridable
// default in the UI, never a silently-applied value.
//
// This parser was built AND VERIFIED against ~290 real historical values
// pulled directly from the Orders "Size" field (user-supplied 2026-08-12),
// not guessed. 281/289 (97%) parsed cleanly; the remaining ~8 are things
// that were never real rug dimensions at all (clothing-style codes like
// "S"/"XL"/"XXL - 44 INCH", or "CUSTOME SIZE") or genuinely ambiguous
// single-dimension entries with no explicit shape word — those correctly
// fall back to `sqFt: null` so the form leaves sq ft blank for manual
// entry rather than guessing a number that could be silently wrong.
//
// Supported input shapes (case-insensitive, tolerant of extra spaces):
//   "5X5 ft"            -> 5 * 5 = 25
//   "2.6X4 FT"           -> decimal feet, either side
//   "51 INX8 FT"          -> mixed units, one side in inches
//   "26\"X10 FT"           -> bare inch-mark (no "IN"/"INCH" word)
//   "2'2\"X10 FT"           -> feet+inches compound (2ft 2in) on one side
//   "70CMX2 MTR"             -> centimetres / metres, mixed
//   "2.5X3.5 Mtr"             -> trailing unit applies to both sides
//   "5 FT SQUARE"              -> single dimension + explicit "SQUARE" -> NxN
//   "2X37 FEET RUNNER"          -> trailing descriptive word stripped
//   "1X1 FT (30X35 FT)"          -> parenthetical alt-size ignored (noted)
//   "10..5X10.5 FT"                -> tolerates the ".." typo
// Unsupported (returns null, by design — never guessed):
//   "CUSTOME SIZE", "S"/"M"/"L"/"XL"/"XXL - 44 INCH" (clothing-style codes),
//   "5 FT SCALLOPED" (single dimension with no unambiguous shape word).

const FT_PER_UNIT: Record<string, number> = {
  FT: 1,
  FEET: 1,
  FOOT: 1,
  IN: 1 / 12,
  INCH: 1 / 12,
  INCHES: 1 / 12,
  CM: 1 / 30.48,
  MTR: 3.28084,
  MT: 3.28084,
  M: 3.28084,
  METER: 3.28084,
  METERS: 3.28084,
  METRE: 3.28084,
  METRES: 3.28084,
};

const CLOTHING_CODE_RE = /^(XXXL|XXL|XL|S|M|L)\b/i;
const UNIT_WORD_RE = /\b(FT|FEET|FOOT|IN|INCH|INCHES|CM|MTR|MT|M|METER|METERS|METRE|METRES)\b/gi;

export type SizeParseResult = {
  sqFt: number | null;
  /** Short machine-readable reason, useful for debugging/logging only. */
  reason: string;
  /** Set when a "(...)" alternate size was stripped and ignored. */
  altNote?: string | null;
};

function normalize(raw: string): string {
  let s = raw.trim();
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/\.\./g, "."); // "10..5" typo -> "10.5"
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function parseToken(tokRaw: string, defaultUnit: string): number | null {
  const t = tokRaw.trim();
  if (!t) return null;

  // feet' inches" compound, e.g. 2'2", 1' 10", 7'3", optionally trailed by FT
  let m = t.match(/^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*"?\s*(FT|FEET)?$/i);
  if (m) {
    const feet = parseFloat(m[1]);
    const inches = m[2] ? parseFloat(m[2]) : 0;
    return feet + inches / 12;
  }

  // bare inch-mark, e.g. 26", 30"
  m = t.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (m) return parseFloat(m[1]) / 12;

  // number + optional unit word, e.g. "8 FT", "51 IN", "4.5", "70CM"
  m = t.match(/^(\d+(?:\.\d+)?)\s*(FT|FEET|FOOT|IN|INCH|INCHES|CM|MTR|MT|M|METER|METERS|METRE|METRES)?$/i);
  if (m) {
    const val = parseFloat(m[1]);
    const unit = (m[2] || defaultUnit || "FT").toUpperCase();
    const factor = FT_PER_UNIT[unit];
    if (factor == null) return null;
    return val * factor;
  }

  return null;
}

function findGlobalUnit(s: string): string {
  const matches = [...s.matchAll(UNIT_WORD_RE)];
  if (matches.length === 0) return "FT"; // majority default across historical data
  return matches[matches.length - 1][1].toUpperCase();
}

/**
 * Best-effort parse of a free-text Size field into total square feet.
 * Never throws. Returns { sqFt: null } for anything it isn't confident
 * about — callers must treat that as "leave sq ft blank, manual entry",
 * never fall back to a guessed number.
 */
export function parseSizeToSqFt(raw: string | null | undefined): SizeParseResult {
  if (!raw) return { sqFt: null, reason: "empty" };
  let s = normalize(raw);
  if (!s) return { sqFt: null, reason: "empty" };

  if (CLOTHING_CODE_RE.test(s)) return { sqFt: null, reason: "clothing-code" };
  if (!/\d/.test(s)) return { sqFt: null, reason: "no-digits" };

  let altNote: string | null = null;
  const parenMatch = s.match(/\s*\(([^)]*)\)\s*$/);
  if (parenMatch) {
    altNote = parenMatch[1];
    s = s.slice(0, parenMatch.index).trim();
  }

  let isSquareHint = false;
  s = s.replace(/\bSQUARE\b/gi, () => {
    isSquareHint = true;
    return "";
  });
  s = s.replace(/\bSCALLOPED\b/gi, "");
  s = s.replace(/\bROUND\b/gi, "");
  s = s.replace(/\bRUNNER\b/gi, "");
  s = s.replace(/\bFEET\b/gi, "FT");
  s = s.trim();
  if (!s) return { sqFt: null, reason: "empty-after-strip" };

  const globalUnit = findGlobalUnit(s);
  // 2026-08-26: some vendor purchase bills write the dimension with "*"
  // instead of "x" (e.g. "3*90 FT", straight from a real bill) — accepted
  // alongside "x"/"X"/"×" as the same separator, purely additive (no
  // historical Size value used "*", so this can't change any existing
  // result, only recognize a new one).
  const parts = s.split(/\s*[x×*]\s*/i).filter((p) => p.trim() !== "");

  if (parts.length === 2) {
    const d1 = parseToken(parts[0], globalUnit);
    const d2 = parseToken(parts[1], globalUnit);
    if (d1 != null && d2 != null && d1 > 0 && d2 > 0) {
      return { sqFt: Math.round(d1 * d2 * 1000) / 1000, reason: "ok-2d", altNote };
    }
    return { sqFt: null, reason: "unparsed-2d" };
  }

  if (parts.length === 1) {
    const d1 = parseToken(parts[0], globalUnit);
    if (d1 != null && d1 > 0) {
      if (isSquareHint) return { sqFt: Math.round(d1 * d1 * 1000) / 1000, reason: "ok-1d-square" };
      return { sqFt: null, reason: "single-dim-ambiguous" };
    }
    return { sqFt: null, reason: "unparsed-1d" };
  }

  return { sqFt: null, reason: "unparsed-parts" };
}
