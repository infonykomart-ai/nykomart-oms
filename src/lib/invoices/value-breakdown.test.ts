import assert from "node:assert/strict";
import test from "node:test";
import {
  computeValueBreakdown,
  computeValueBreakdownAt,
  itemCostForOrder,
  normalizeValueBasisPercent,
  VALUE_BASIS_PERCENTS,
  valueBasisOptions,
} from "./value-breakdown";

// 2026-11-23 — the invoice value breakdown. These numbers were originally
// verified against a real customs invoice (total 138.60 -> cost 41.58,
// insurance 0.75, freight 96.27), so the first test pins that sample.

test("reproduces the verified sample invoice", () => {
  const b = computeValueBreakdown(231, "Amazon Arts of Jaipur");
  assert.equal(b.valuePercent, 60);
  assert.equal(b.invoiceValueUsd, 138.6);
  assert.equal(b.itemCostTotal, 41.58);
  assert.equal(b.insuranceTotal, 0.75);
  assert.equal(b.freightTotal, 96.27);
});

test("the three line items always add up to the total exactly", () => {
  for (const sum of [1, 7.77, 99.99, 231, 1234.56, 99999.99]) {
    const b = computeValueBreakdown(sum, "Etsy The Rugara");
    assert.equal(
      Math.round((b.itemCostTotal + b.insuranceTotal + b.freightTotal) * 100) / 100,
      b.invoiceValueUsd,
      `breakdown for ${sum} must net to its own total`
    );
  }
});

test("every store currently uses 60%", () => {
  for (const store of ["Amazon Arts of Jaipur", "Etsy The Rugara", "Ebay Casa Arra", "CASA ARRA (Website)"]) {
    assert.equal(computeValueBreakdown(100, store).valuePercent, 60);
  }
});

test("computeValueBreakdownAt uses the percentage it is given", () => {
  const b = computeValueBreakdownAt(100, 80);
  assert.equal(b.valuePercent, 80);
  assert.equal(b.invoiceValueUsd, 80);
  assert.equal(b.itemCostTotal, 24);
  assert.equal(b.freightTotal, 55.25);
});

test("the 100% basis puts the full order value on the invoice", () => {
  const b = computeValueBreakdownAt(500, 100);
  assert.equal(b.valuePercent, 100);
  assert.equal(b.invoiceValueUsd, 500);
  assert.equal(b.itemCostTotal, 150);
  assert.equal(b.freightTotal, 349.25);
});

test("a value basis is only accepted inside 1..100, otherwise the fallback wins", () => {
  assert.deepEqual([...VALUE_BASIS_PERCENTS], [60, 100]);
  assert.equal(normalizeValueBasisPercent(100, 60), 100);
  assert.equal(normalizeValueBasisPercent("100", 60), 100);
  assert.equal(normalizeValueBasisPercent(60, 100), 60);
  assert.equal(normalizeValueBasisPercent(null, 60), 60);
  assert.equal(normalizeValueBasisPercent(undefined, 60), 60);
  assert.equal(normalizeValueBasisPercent("", 60), 60);
  assert.equal(normalizeValueBasisPercent(0, 60), 60);
  assert.equal(normalizeValueBasisPercent(-5, 60), 60);
  assert.equal(normalizeValueBasisPercent(101, 60), 60);
  assert.equal(normalizeValueBasisPercent("abc", 60), 60);
  assert.equal(normalizeValueBasisPercent(99.6, 60), 100);
});

test("the basis picker keeps an invoice's own percentage instead of showing blank", () => {
  assert.deepEqual(valueBasisOptions(60), [60, 100]);
  assert.deepEqual(valueBasisOptions(100), [60, 100]);
  assert.deepEqual(valueBasisOptions(null), [60, 100]);
  assert.deepEqual(valueBasisOptions(undefined), [60, 100]);
  // An invoice saved at another basis (older rule, bulk upload) stays visible.
  assert.deepEqual(valueBasisOptions(80), [60, 100, 80]);
  assert.deepEqual(valueBasisOptions(59.6), [60, 100]);
  assert.deepEqual(valueBasisOptions(NaN), [60, 100]);
  assert.deepEqual(valueBasisOptions(0), [60, 100]);
});

test("an order's own row value is its share of the item cost", () => {
  const b = computeValueBreakdown(200, "Amazon Arts of Jaipur");
  assert.equal(itemCostForOrder(100, b.valuePercent), 18);
  assert.equal(itemCostForOrder(200, b.valuePercent), 36);
  assert.equal(b.itemCostTotal, 36);
});
