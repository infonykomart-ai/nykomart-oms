// 2026-11-25 — The split that Finance-ledger item rows depend on.
import test from "node:test";
import assert from "node:assert/strict";
import { apportionByWeight, nextGroupTotal } from "./apportion";

const sum = (xs: number[]) => Math.round(xs.reduce((s, n) => s + n, 0) * 100) / 100;

test("parts add up to the total exactly, in proportion", () => {
  const parts = apportionByWeight([1159.93, 1362.45, 1179.05], 20989.5);
  assert.equal(sum(parts), 20989.5);
  // Proportional: the same order and the same rough ratios as the weights.
  assert.ok(parts[0] < parts[1] && parts[1] > parts[2]);
  assert.ok(Math.abs(parts[0] / parts[1] - 1159.93 / 1362.45) < 0.001);
});

test("the last row absorbs the paise, not the first", () => {
  const parts = apportionByWeight([1, 1, 1], 10);
  assert.deepEqual(parts, [3.33, 3.33, 3.34]);
  assert.equal(sum(parts), 10);
});

test("a single row gets the whole group total", () => {
  assert.deepEqual(apportionByWeight([37978.29], 37978.29), [37978.29]);
});

test("useless weights yield zeros instead of NaN", () => {
  assert.deepEqual(apportionByWeight([0, 0], 500), [0, 0]);
  assert.deepEqual(apportionByWeight([Number.NaN, -5], 500), [0, 0]);
  assert.deepEqual(apportionByWeight([], 500), []);
});

test("a group in step with its bills follows the edit", () => {
  // posted 1000 = bills 1000; the edited item grows by 250.
  assert.equal(nextGroupTotal({ postedTotal: 1000, billSumBefore: 1000, billSumAfter: 1250 }), 1250);
});

test("a rounded posting counts as in step", () => {
  assert.equal(nextGroupTotal({ postedTotal: 30946, billSumBefore: 30945.99, billSumAfter: 30945.99 }), 30945.99);
});

test("a group already out of step keeps the money finance reviewed", () => {
  // posted 20989.50 against bills of 36194: the edit re-splits, the total stays.
  assert.equal(nextGroupTotal({ postedTotal: 20989.5, billSumBefore: 36194, billSumAfter: 37000 }), 20989.5);
});
