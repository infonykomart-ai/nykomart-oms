import { test } from "node:test";
import assert from "node:assert/strict";
import { convertToInr, ratePerUnit } from "./calculator";

// Amounts/rates here are arbitrary test fixtures, not official customs rates.

test("per-unit rate: amount × rate", () => {
  const result = convertToInr({ amount: 1000, rate: 95.35, unit: 1 });
  assert.equal(result.inr, 95350);
});

test("per-100 rate divides by 100", () => {
  const result = convertToInr({ amount: 100, rate: 59.75, unit: 100 });
  assert.equal(result.inr, 59.75);
});

test("per-100 rate with a larger amount", () => {
  const result = convertToInr({ amount: 5000, rate: 59.75, unit: 100 });
  assert.equal(result.inr, 2987.5);
});

test("rounds to paise, half away from zero", () => {
  assert.equal(convertToInr({ amount: 3, rate: 1.005, unit: 1 }).inr, 3.02);
  assert.equal(convertToInr({ amount: 0.333, rate: 100, unit: 1 }).inr, 33.3);
});

test("zero amount is allowed and yields zero", () => {
  assert.equal(convertToInr({ amount: 0, rate: 95.35, unit: 1 }).inr, 0);
});

test("negative amount, zero rate and zero unit are rejected", () => {
  assert.throws(() => convertToInr({ amount: -1, rate: 95, unit: 1 }), /non-negative/);
  assert.throws(() => convertToInr({ amount: 1, rate: 0, unit: 1 }), /positive/);
  assert.throws(() => convertToInr({ amount: 1, rate: 95, unit: 0 }), /unit/);
});

test("ratePerUnit converts a per-100 quote to a per-1 figure", () => {
  assert.equal(ratePerUnit(59.75, 100), 0.5975);
  assert.equal(ratePerUnit(95.35, 1), 95.35);
  assert.throws(() => ratePerUnit(0, 1));
});
