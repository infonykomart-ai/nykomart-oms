import assert from "node:assert/strict";
import test from "node:test";
import { buildPoNumber, isPoStatus, parsePoLines, poTotal, PO_STATUSES } from "./lines";

// 2026-11-22c — Phase 3: Purchase Order rules (no DB, no Next, no React).

test("blank rows are ignored, real rows are kept in order", () => {
  const { lines, error } = parsePoLines(
    ["RUG-1", "", "  RUG-3  "],
    ["2", "", "1"],
    ["10.5", "", "3.333"]
  );
  assert.equal(error, null);
  assert.deepEqual(lines, [
    { sku_label: "RUG-1", qty: 2, unit_cost: 10.5, sort_order: 0 },
    { sku_label: "RUG-3", qty: 1, unit_cost: 3.33, sort_order: 1 },
  ]);
});

test("a row with only a cost is not treated as blank", () => {
  const { lines, error } = parsePoLines([""], ["1"], ["9"]);
  assert.equal(error, null);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].sku_label, null);
  assert.equal(lines[0].unit_cost, 9);
});

test("quantities must be positive", () => {
  for (const qty of ["0", "-2", "abc", ""]) {
    const { lines, error } = parsePoLines(["A"], [qty], ["1"]);
    assert.equal(lines.length, 0);
    assert.match(error ?? "", /quantity must be greater than 0/);
  }
});

test("unit cost may be zero but never negative", () => {
  const zero = parsePoLines(["A"], ["1"], ["0"]);
  assert.equal(zero.error, null);
  assert.equal(zero.lines[0].unit_cost, 0);

  const negative = parsePoLines(["A"], ["1"], ["-0.01"]);
  assert.equal(negative.lines.length, 0);
  assert.match(negative.error ?? "", /unit cost must be 0 or more/);
});

test("at least one line is required", () => {
  const result = parsePoLines([""], [""], [""]);
  assert.deepEqual(result.lines, []);
  assert.equal(result.error, "Add at least one line item.");
});

test("line numbers in error messages ignore blank rows above", () => {
  const { error } = parsePoLines(["", "A", "B"], ["", "1", "0"], ["", "5", "5"]);
  assert.equal(error, "Line 2: quantity must be greater than 0.");
});

test("the total is the sum of qty × unit cost, rounded to 2 decimals", () => {
  assert.equal(poTotal([{ qty: 2, unit_cost: 10.5 }, { qty: 3, unit_cost: 0.1 }]), 21.3);
  assert.equal(poTotal([]), 0);
  // Floating-point noise is removed, not displayed.
  assert.equal(poTotal([{ qty: 3, unit_cost: 0.1 }]), 0.3);
});

test("PO numbers are NPO-<FY>-#### and pad the sequence", () => {
  assert.equal(buildPoNumber("26-27", 1), "NPO-26-27-0001");
  assert.equal(buildPoNumber("26-27", 42), "NPO-26-27-0042");
  assert.equal(buildPoNumber("26-27", 10000), "NPO-26-27-10000");
  assert.equal(buildPoNumber("", 7), "NPO-NA-0007");
  assert.equal(buildPoNumber("26-27", Number.NaN), "NPO-26-27-0000");
});

test("only the four known statuses are accepted", () => {
  for (const status of PO_STATUSES) assert.equal(isPoStatus(status), true);
  for (const status of ["draft", "Pending", "", "Received ", null, 3]) assert.equal(isPoStatus(status), false);
});
