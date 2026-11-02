import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatAreaNumber,
  isStairRugCategory,
  normalizeCount,
  PCS_PER_SET_PRESETS,
  stairArea,
  stairSizeFromRow,
  stairTotalPieces,
  stairWhatsAppLines,
  stairSizeLabel,
} from "./stair-rug";

// 2026-11-02 — the owner gave exact worked examples for this feature; they are
// pinned here so a later "tidy-up" of the area maths can't quietly move a real
// order's square feet.

test("the three examples from the brief come out exactly", () => {
  // 9 × 29 INCH, 1 set × 12 PCS
  const a = stairArea({ length: 9, width: 29, unit: "INCH", totalPieces: stairTotalPieces(1, 12) });
  assert.ok(a);
  assert.equal(a.perPieceSqIn, 261);
  assert.equal(a.totalSqIn, 3132);
  assert.equal(formatAreaNumber(a.totalSqFt), "21.75");

  // 1 set × 18 PCS
  const b = stairArea({ length: 9, width: 29, unit: "INCH", totalPieces: stairTotalPieces(1, 18) });
  assert.ok(b);
  assert.equal(b.totalSqIn, 4698);
  assert.equal(formatAreaNumber(b.totalSqFt), "32.625");

  // 2 sets × 50 PCS
  const c = stairArea({ length: 9, width: 29, unit: "INCH", totalPieces: stairTotalPieces(2, 50) });
  assert.ok(c);
  assert.equal(c.totalSqIn, 26100);
  assert.equal(formatAreaNumber(c.totalSqFt), "181.25");
  assert.equal(formatAreaNumber(c.totalSqIn), "26,100");
});

test("changing pieces per set re-derives everything (12 → 18 → 50 → 100)", () => {
  const ft = (pcs: number) => {
    const a = stairArea({ length: 9, width: 29, unit: "INCH", totalPieces: stairTotalPieces(1, pcs) });
    return a ? formatAreaNumber(a.totalSqFt) : null;
  };
  assert.equal(ft(12), "21.75");
  assert.equal(ft(18), "32.625");
  assert.equal(ft(50), "90.625");
  assert.equal(ft(100), "181.25");
});

test("custom piece counts are supported and never capped", () => {
  assert.equal(stairTotalPieces(1, 125), 125);
  assert.equal(stairTotalPieces(1, 150), 150);
  assert.equal(stairTotalPieces(3, 1000), 3000);
  assert.equal(stairTotalPieces(1, 7), 7);
  assert.equal(normalizeCount(undefined), 1);
  assert.equal(normalizeCount(0), 1);
  assert.equal(normalizeCount(-5), 1);
  assert.equal(normalizeCount("12"), 12);
  assert.equal(normalizeCount(3.9), 3);
  // presets are only suggestions — the list itself must contain the examples
  for (const p of [2, 12, 18, 50, 100, 125, 150, 200]) assert.ok(PCS_PER_SET_PRESETS.includes(p as never));
});

test("FT / CM dimensions convert to the same area as the equivalent inches", () => {
  // 9 × 29 INCH is also 0.75 × 29/12 FT
  const inFt = stairArea({ length: 0.75, width: 29 / 12, unit: "FT", totalPieces: 12 });
  assert.ok(inFt);
  assert.equal(formatAreaNumber(inFt.perPieceSqIn), "261");
  assert.equal(formatAreaNumber(inFt.totalSqIn), "3,132");

  // 1 ft × 1 ft = 1 sq ft = 144 sq in
  const oneSqFt = stairArea({ length: 1, width: 1, unit: "FT", totalPieces: 1 });
  assert.ok(oneSqFt);
  assert.equal(oneSqFt.totalSqIn, 144);
  assert.equal(formatAreaNumber(oneSqFt.totalSqFt), "1");

  // 22.86 × 73.66 CM is 9 × 29 inch
  const cm = stairArea({ length: 22.86, width: 73.66, unit: "CM", totalPieces: 12 });
  assert.ok(cm);
  assert.equal(formatAreaNumber(cm.totalSqIn), "3,132");
  assert.equal(formatAreaNumber(cm.totalSqFt), "21.75");
});

test("square-centimetre output matches the square-inch figure", () => {
  // 100 sq in = 645.16 sq cm exactly
  const a = stairArea({ length: 10, width: 10, unit: "INCH", totalPieces: 1 });
  assert.ok(a);
  assert.equal(a.totalSqCm, 645.16);
  assert.equal(formatAreaNumber(a.totalSqCm), "645.16");
});

test("missing or zero dimensions give no area instead of a guess", () => {
  assert.equal(stairArea({ length: null, width: 29, unit: "INCH", totalPieces: 12 }), null);
  assert.equal(stairArea({ length: 9, width: 0, unit: "INCH", totalPieces: 12 }), null);
  assert.equal(stairArea({ length: 9, width: 29, unit: "MM", totalPieces: 12 }), null);
});

test("the WhatsApp lines read like the owner's example", () => {
  const size = stairSizeFromRow({
    qty: 100,
    sets_count: 2,
    pieces_per_set: 50,
    dimension_length: 9,
    dimension_width: 29,
    dimension_unit: "INCH",
  });
  const lines = stairWhatsAppLines({ size });
  assert.equal(lines.number_of_sets, "2");
  assert.equal(lines.pieces_per_set, "50 PCS");
  assert.equal(lines.total_pieces, "100 PCS");
  assert.equal(lines.area_per_piece, "261 SQ INCH");
  assert.equal(lines.total_area_sq_in, "26,100 SQ INCH");
  assert.equal(lines.total_area_sq_ft, "181.25 SQ FT");
});

test("orders saved before this feature still read as one set of qty pieces", () => {
  const legacy = stairSizeFromRow({ qty: 12, sets_count: null, pieces_per_set: null });
  assert.equal(legacy.setsCount, 1);
  assert.equal(legacy.piecesPerSet, 12);
  assert.equal(legacy.totalPieces, 12);
  assert.equal(legacy.unit, null);
  assert.equal(stairWhatsAppLines({ size: legacy }).area_per_piece, "—");
});

test("category detection matches real product-type spellings only", () => {
  assert.equal(isStairRugCategory("Stair Rug"), true);
  assert.equal(isStairRugCategory("STAIR RUGS"), true);
  assert.equal(isStairRugCategory("Handmade Stair Rug"), true);
  assert.equal(isStairRugCategory("Staircase Runner"), true);
  assert.equal(isStairRugCategory("HANDMADE 100% COTTON RUG"), false);
  assert.equal(isStairRugCategory("Jute Rug"), false);
  assert.equal(isStairRugCategory("Tufted Rug"), false);
  assert.equal(isStairRugCategory(null), false);
});

test("auto size label only appears for real dimensions", () => {
  assert.equal(stairSizeLabel(9, 29, "INCH"), "9 × 29 INCH");
  assert.equal(stairSizeLabel(2.5, 4, "FT"), "2.5 × 4 FT");
  assert.equal(stairSizeLabel(0, 29, "INCH"), "");
  assert.equal(stairSizeLabel(null, 29, "INCH"), "");
});
