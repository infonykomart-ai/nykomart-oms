import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePurchaseArea,
  convertWeight,
  measureDimensions,
  quantityAmount,
  roundTo,
  weightToKg,
  isQuantityUnit,
  isRoundingMode,
} from "./measurement";

// 2026-11-06 — weight / quantity / rounding additions to the universal
// measurement engine. Exact constants: 1 KG = 1000 G, 1 TON = 1000 KG.

test("100 × 200 CM gives 20,000 SQ CM = 2 SQM = 21.53 SQ FT", () => {
  const out = measureDimensions({ length: 100, lengthUnit: "CM", width: 200, widthUnit: "CM", outputUnit: "SQ_FT" });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.result.breakdown.SQ_CM, 20000);
  assert.equal(out.result.breakdown.SQ_MTR, 2);
  assert.ok(Math.abs(out.result.breakdown.SQ_FT - 21.527820833) < 1e-9);
  assert.equal(roundTo(out.result.area, 2), 21.53);
  // Billing uses the precise (4dp) stored area; the 2dp figure is display.
  assert.ok(Math.abs(out.result.area * 50 - 1076.3910417) < 1e-6);
});

test("the configured rounding rule changes stored money/area values", () => {
  const base = {
    length: 100,
    lengthUnit: "CM" as const,
    width: 200,
    widthUnit: "CM" as const,
    qty: 1,
    outputUnit: "SQ_MTR" as const,
    rate: 914.932,
    rateUnit: "SQ_MTR" as const,
    precision: 2,
  };
  const up = computePurchaseArea({ ...base, rounding: "UP" });
  const down = computePurchaseArea({ ...base, rounding: "DOWN" });
  assert.equal(up.ok && up.result.unitRate, 914.94);
  assert.equal(down.ok && down.result.unitRate, 914.93);
});

test("weight conversions use exact kilogram factors", () => {
  assert.equal(weightToKg(1, "TON"), 1000);
  assert.equal(weightToKg(500, "G"), 0.5);
  assert.equal(convertWeight(1, "TON", "KG"), 1000);
  assert.equal(convertWeight(2500, "G", "KG"), 2.5);
  assert.equal(convertWeight(2.5, "KG", "G"), 2500);
  assert.equal(convertWeight(1, "KG", "TON"), 0.001);
  assert.ok(Number.isNaN(convertWeight(1, "LB" as never, "KG")));
});

test("quantity amount is quantity × rate, rounded to paise", () => {
  assert.equal(quantityAmount(12, "PCS", 15.5), 186);
  assert.equal(quantityAmount(3, "BOX", 33.333), 100);
  assert.ok(Number.isNaN(quantityAmount(-1, "PCS", 10)));
  assert.ok(Number.isNaN(quantityAmount(2, "BOX", -5)));
  assert.ok(Number.isNaN(quantityAmount(2, "KG" as never, 10)));
});

test("quantity/rounding validators reject unknown values", () => {
  assert.equal(isQuantityUnit("PCS"), true);
  assert.equal(isQuantityUnit("SET"), true);
  assert.equal(isQuantityUnit("BOX"), true);
  assert.equal(isQuantityUnit("UNIT"), true);
  assert.equal(isQuantityUnit("KG"), false);
  assert.equal(isRoundingMode("HALF_UP"), true);
  assert.equal(isRoundingMode("UP"), true);
  assert.equal(isRoundingMode("DOWN"), true);
  assert.equal(isRoundingMode("BANKERS"), false);
});

test("rounding modes behave as labelled", () => {
  assert.equal(roundTo(1.234, 2, "HALF_UP"), 1.23);
  assert.equal(roundTo(1.235, 2, "HALF_UP"), 1.24);
  // Binary floats store these just below the exact half — must still round up.
  assert.equal(roundTo(1.005, 2, "HALF_UP"), 1.01);
  assert.equal(roundTo(2.675, 2, "HALF_UP"), 2.68);
  assert.equal(roundTo(1.231, 2, "UP"), 1.24);
  assert.equal(roundTo(1.239, 2, "DOWN"), 1.23);
  assert.equal(roundTo(-1.239, 2, "DOWN"), -1.24);
});
