// 2026-11-19 — expense line units.
//
// The owner's requirement in one line: "KG QTY MTR SQ FT INCH SABHI SAHI SE
// KAAM KARE OR INKE SATH KYA HONA CHAHIYE." So these tests pin the exact
// numbers a bill carries with it — the bill's own unit and rate, the quantity
// the unit implies, and the base quantity every line is also stored in.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPENSE_UNIT_GROUPS,
  expenseBaseUnit,
  expenseQtyLabel,
  expenseRateLabel,
  expenseUnitFamily,
  expenseUnitGroups,
  expenseUnitLabel,
  normalizeExpenseUnit,
  resolveExpenseLineUnits,
  toBaseExpenseQuantity,
  type ExpenseUnit,
} from "./line-units";
import { calculateLine } from "./expense-calc";

test("a typed unit is normalised to the measurement engine's unit", () => {
  const cases: Array<[string, ExpenseUnit]> = [
    ["sq ft", "SQ_FT"],
    ["SQFT", "SQ_FT"],
    [" sq  ft ", "SQ_FT"],
    ["KGS", "KG"],
    ["kg", "KG"],
    ["mtr", "MTR"],
    ["Metres", "MTR"],
    ["in", "INCH"],
    ["inches", "INCH"],
    ["qty", "PCS"],
    ["nos", "PCS"],
    ["SQ_MTR", "SQ_MTR"],
    ["sqm", "SQ_MTR"],
  ];
  for (const [typed, expected] of cases) {
    assert.equal(normalizeExpenseUnit(typed), expected, `${typed} should be ${expected}`);
  }
});

test("an unknown unit is rejected instead of being stored as typed", () => {
  assert.equal(normalizeExpenseUnit("bundle"), null);
  assert.equal(normalizeExpenseUnit(""), null);
  assert.equal(normalizeExpenseUnit(null), null);

  const resolved = resolveExpenseLineUnits({ qty: 2, unit: "bundle", rate: 100 });
  assert.equal(resolved.unit, null);
  assert.match(resolved.error ?? "", /not a supported unit/);
});

test("10 MTR carries 32.808 FT as its base quantity", () => {
  const resolved = resolveExpenseLineUnits({ qty: "10", unit: "MTR", rate: "50" });
  assert.equal(resolved.unit, "MTR");
  assert.equal(resolved.family, "LENGTH");
  assert.equal(resolved.qty, 10);
  assert.equal(resolved.rate, 50);
  assert.equal(resolved.baseQty, 32.808);
  assert.equal(resolved.baseUnit, "FT");
  assert.equal(resolved.derivedFromSize, false);

  // Gross is the bill's own maths: qty in MTR × rate per MTR.
  const { line, errors } = calculateLine({ description: "Fabric", qty: "10", unit: "mtr", rate: "50" }, 1, false);
  assert.deepEqual(errors, []);
  assert.equal(line.unit, "MTR");
  assert.equal(line.baseQty, 32.808);
  assert.equal(line.baseUnit, "FT");
  assert.equal(line.grossPaise, 50_000); // ₹500 in paise
});

test("an area line carries SQ FT as its base quantity", () => {
  const resolved = resolveExpenseLineUnits({ qty: "240", unit: "SQ_FT", rate: "85" });
  assert.equal(resolved.family, "AREA");
  assert.equal(resolved.qty, 240);
  assert.equal(resolved.baseUnit, "SQ_FT");
  assert.equal(resolved.baseQty, 240);

  // SQ FT is itself the area base, so the conversion is checked directly:
  // 240 SQ MTR = 240 × 10.7639104167 SQ FT.
  const inMetres = resolveExpenseLineUnits({ qty: "240", unit: "SQ_MTR" });
  assert.equal(inMetres.baseQty, 2_583.339);
  assert.equal(inMetres.baseUnit, "SQ_FT");
  assert.equal(expenseBaseUnit("AREA"), "SQ_FT");
  // The converter itself does not round; the line resolution does (3 dp).
  assert.ok(Math.abs(toBaseExpenseQuantity(240, "SQ_MTR") - 2_583.3385) < 1e-6);
  assert.equal(toBaseExpenseQuantity(240, "SQ_FT"), 240);
});

test("an area line's quantity comes from Length × Width × pieces", () => {
  const resolved = resolveExpenseLineUnits({
    unit: "SQ_FT",
    length: "4",
    width: "6",
    lengthUnit: "FT",
    widthUnit: "FT",
    pieces: "12",
  });
  assert.equal(resolved.error, null);
  assert.equal(resolved.derivedFromSize, true);
  assert.equal(resolved.qty, 288);
  assert.equal(resolved.pieceArea, 24);
  assert.equal(resolved.baseQty, 288);

  // Mixed length units are converted before multiplying: 1 MTR × 100 CM = 1
  // SQ MTR, not 100.
  const mixed = resolveExpenseLineUnits({
    unit: "SQ_MTR",
    length: "1",
    width: "100",
    lengthUnit: "MTR",
    widthUnit: "CM",
    pieces: "1",
  });
  assert.equal(mixed.error, null);
  assert.equal(mixed.qty, 1);
  assert.equal(mixed.baseQty, 10.764);

  // Pieces default to the typed qty when left blank.
  const piecesFromQty = resolveExpenseLineUnits({ unit: "SQ_FT", qty: "10", length: "2", width: "3" });
  assert.equal(piecesFromQty.qty, 60);
  assert.equal(piecesFromQty.derivedFromSize, true);

  // The size wins over a hand-typed total, so the client cannot post an area
  // the size does not support.
  const typedTotal = resolveExpenseLineUnits({
    unit: "SQ_FT",
    qty: "999",
    length: "2",
    width: "3",
    pieces: "5",
  });
  assert.equal(typedTotal.qty, 30);

  // No size at all = the qty box IS the total area.
  const statedArea = resolveExpenseLineUnits({ unit: "SQ_FT", qty: "240", length: "", width: "" });
  assert.equal(statedArea.qty, 240);
  assert.equal(statedArea.derivedFromSize, false);
});

test("weight converts to KG, count stays as pieces", () => {
  assert.equal(resolveExpenseLineUnits({ qty: "2500", unit: "G" }).baseQty, 2.5);
  assert.equal(resolveExpenseLineUnits({ qty: "1.5", unit: "TON" }).baseQty, 1_500);
  assert.equal(resolveExpenseLineUnits({ qty: "2500", unit: "G" }).baseUnit, "KG");

  const count = resolveExpenseLineUnits({ qty: "7", unit: "QTY" });
  assert.equal(count.unit, "PCS");
  assert.equal(count.family, "COUNT");
  assert.equal(count.baseQty, 7);
  assert.equal(count.baseUnit, "PCS");
});

test("the line's labels name the unit the vendor billed in", () => {
  assert.equal(expenseUnitLabel("SQ_FT"), "SQ FT");
  assert.equal(expenseUnitLabel("INCH"), "INCH");
  assert.equal(expenseUnitLabel("KG"), "KG");
  assert.equal(expenseUnitLabel(null), "");
  assert.equal(expenseRateLabel("MTR"), "Rate / MTR");
  assert.equal(expenseRateLabel(null), "Rate");
  assert.equal(expenseQtyLabel("INCH"), "Qty (INCH)");
  assert.equal(expenseQtyLabel(""), "Qty");

  assert.equal(expenseUnitFamily("SQ_FT"), "AREA");
  assert.equal(expenseUnitFamily("G"), "WEIGHT");
  assert.equal(expenseUnitFamily("FT"), "LENGTH");
  assert.equal(expenseUnitFamily("SET"), "COUNT");
  assert.equal(expenseUnitFamily("bundle"), null);
});

test("the dropdown offers only the units the company enabled", () => {
  // No settings = every engine unit, grouped by family.
  assert.equal(expenseUnitGroups(undefined), EXPENSE_UNIT_GROUPS);
  assert.equal(expenseUnitGroups([]), EXPENSE_UNIT_GROUPS);

  const filtered = expenseUnitGroups(["KG", "sq ft", "INCH", "nonsense"]);
  const units = filtered.flatMap((group) => group.units);
  assert.deepEqual(units.sort(), ["INCH", "KG", "SQ_FT"].sort());
  assert.deepEqual(
    filtered.map((group) => group.family),
    ["WEIGHT", "LENGTH", "AREA"]
  );

  // Settings that filter everything out fall back to the full list rather
  // than leaving the user with an empty dropdown.
  assert.equal(expenseUnitGroups(["nonsense"]), EXPENSE_UNIT_GROUPS);
});

test("a unit-less flat bill still needs no unit", () => {
  const resolved = resolveExpenseLineUnits({ amount: "500", unit: "" });
  assert.equal(resolved.unit, null);
  assert.equal(resolved.baseQty, null);
  assert.equal(resolved.baseUnit, null);
  assert.equal(resolved.error, null);
});
