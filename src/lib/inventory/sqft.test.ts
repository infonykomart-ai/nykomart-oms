import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSqFt, resolveSqFt, roundQty, splitSqFt, sqftPerPiece } from "./sqft";

test("4×6 ft rug: 10 pcs = 240 sq ft", () => {
  const per = sqftPerPiece(4, 6);
  assert.equal(per, 24);
  assert.equal(computeSqFt(10, per), 240);
});

test("area is not silently rounded for irregular sizes", () => {
  assert.equal(roundQty(2.3456), 2.346);
  assert.equal(roundQty(0.0004), 0);
  assert.equal(sqftPerPiece(5.5, 8), 44);
});

test("missing dimensions return null rather than guessing", () => {
  assert.equal(sqftPerPiece(null, 6), null);
  assert.equal(sqftPerPiece(0, 6), null);
  assert.equal(computeSqFt(3, null), null);
});

test("manual override wins over derived area", () => {
  assert.equal(resolveSqFt({ pcs: 10, sqftPerPiece: 24, override: 239.5, sqftTracked: true }), 239.5);
});

test("derived area used when no override", () => {
  assert.equal(resolveSqFt({ pcs: 3, sqftPerPiece: 24, override: null, sqftTracked: true }), 72);
});

test("PCS-only products get zero area", () => {
  assert.equal(resolveSqFt({ pcs: 12, sqftPerPiece: null, override: null, sqftTracked: false }), 0);
});

test("SQ FT split always adds back to the total", () => {
  const parts = splitSqFt(100, [1, 1, 1]);
  assert.deepEqual(parts, [33.333, 33.333, 33.334]);
  assert.equal(roundQty(parts.reduce((a, b) => a + b, 0)), 100);
});

test("split with zero weights puts everything on the last line", () => {
  assert.deepEqual(splitSqFt(24, [0, 0]), [0, 24]);
});
