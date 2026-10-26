import { test } from "node:test";
import assert from "node:assert/strict";
import { toFeet, areaToSqFt, purchaseAreaSqFt, FT_PER_UNIT, PURCHASE_QTY_UNITS } from "./length-units";

// Area scales by the SQUARE of the length factor — the bug this suite
// exists to prevent (reporting 9 sq m as 29.53 sq ft instead of 96.88).

test("lengths use the plain factor", () => {
  assert.equal(toFeet(1, "MTR"), 3.28084);
  assert.equal(toFeet(12, "INCH"), 1);
  assert.equal(toFeet(3, "YARD"), 9);
  assert.ok(Math.abs(toFeet(30.48, "CM") - 1) < 1e-9);
  assert.equal(toFeet(0, "MTR"), 0);
  // Non-finite input never produces NaN downstream
  assert.equal(toFeet(0 / 0, "MTR"), 0);
});

test("areas use the SQUARE of the length factor", () => {
  assert.equal(areaToSqFt(60, "FT"), 60);
  // 9 sq m -> 9 * 3.28084^2 = 96.875 sq ft (NOT 9 * 3.28084 = 29.53)
  assert.ok(Math.abs(areaToSqFt(9, "MTR") - 96.875) < 0.01);
  // 8640 sq in -> 60 sq ft
  assert.ok(Math.abs(areaToSqFt(8640, "INCH") - 60) < 1e-9);
  // 1 sq yd -> 9 sq ft
  assert.ok(Math.abs(areaToSqFt(1, "YARD") - 9) < 1e-9);
  assert.equal(areaToSqFt(0 / 0, "MTR"), 0);
});

test("a square metre is 10.7639 square feet, not 3.28084", () => {
  const sqFt = areaToSqFt(1, "MTR");
  const linear = toFeet(1, "MTR");
  assert.ok(Math.abs(sqFt - linear * linear) < 1e-9);
  assert.ok(sqFt > 10.7 && sqFt < 10.77);
});

test("purchaseAreaSqFt converts the billed area into the report's Sq. Feet column", () => {
  assert.equal(purchaseAreaSqFt(60, "FT"), 60);
  assert.ok(Math.abs((purchaseAreaSqFt(9, "MTR") ?? 0) - 96.875) < 0.01);
  assert.ok(Math.abs((purchaseAreaSqFt(8640, "INCH") ?? 0) - 60) < 1e-9);
});

test("purchaseAreaSqFt treats PCS as 'no area' and defaults unknown units to FT", () => {
  assert.equal(purchaseAreaSqFt(1, "PCS"), null);
  // NULL unit keeps the historical FT meaning
  assert.equal(purchaseAreaSqFt(60, null), 60);
  // An unrecognised unit must not throw or produce NaN
  assert.equal(purchaseAreaSqFt(60, "SOMETHING_ELSE"), 60);
  assert.equal(purchaseAreaSqFt(null, "FT"), 0);
  assert.equal(purchaseAreaSqFt(undefined, "MTR"), 0);
  assert.equal(purchaseAreaSqFt(0 / 0, "FT"), null);
});

test("the two conversion tables stay in sync and cover the expected units", () => {
  assert.deepEqual([...PURCHASE_QTY_UNITS], ["FT", "MTR", "INCH", "YARD", "CM", "PCS"]);
  assert.deepEqual(Object.keys(FT_PER_UNIT).sort(), ["CM", "FT", "INCH", "MTR", "YARD"]);
  // Every factor must be a real, positive, finite number
  for (const [unit, factor] of Object.entries(FT_PER_UNIT)) {
    assert.ok(Number.isFinite(factor) && factor > 0, `${unit} factor must be positive`);
  }
});
