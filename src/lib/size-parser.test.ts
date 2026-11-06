import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSizeToSqFt } from "./size-parser";

// 2026-11-06 — regression for the Document Entry screenshot: a 95 × 370 CM
// order showed Qty 1153.215 FT in the multi-PO purchase form. That number
// treated 95 as feet and only 370 as CM; both sides must share CM first.
test("attached trailing unit applies to both dimensions", () => {
  assert.equal(parseSizeToSqFt("95x370cm").sqFt, 37.835);
  assert.equal(parseSizeToSqFt("100X200CM").sqFt, 21.528);
  assert.equal(parseSizeToSqFt("70CMX2 MTR").sqFt, 15.069);
});

test("historical size formats still parse to the same sq ft", () => {
  assert.equal(parseSizeToSqFt("5X5 ft").sqFt, 25);
  assert.equal(parseSizeToSqFt("30 INCH X 5 FT").sqFt, 12.5);
  assert.equal(parseSizeToSqFt("51 INX8 FT").sqFt, 34);
  assert.equal(parseSizeToSqFt("3*90 FT").sqFt, 270);
  assert.equal(parseSizeToSqFt("2X37 FEET RUNNER").sqFt, 74);
});

test("ambiguous sizes are never guessed", () => {
  assert.equal(parseSizeToSqFt("CUSTOME SIZE").sqFt, null);
  assert.equal(parseSizeToSqFt("XL - 44 INCH").sqFt, null);
  assert.equal(parseSizeToSqFt("5 FT SCALLOPED").sqFt, null);
});
