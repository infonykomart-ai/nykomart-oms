import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AREA_UNITS,
  convertArea,
  convertAreaRate,
  convertLength,
  computePurchaseArea,
  formatMeasurement,
  measureDimensions,
  qtyUnitToAreaUnit,
  roundTo,
} from "./measurement";

// 2026-11-05 — acceptance cases for the universal measurement engine, taken
// from the owner's own examples (including the mixed-unit list). Every
// expected number below is derived from the exact constants
// 1 FT = 30.48 CM, 1 INCH = 2.54 CM, 1 SQ MTR = 10.7639104167 SQ FT,
// not from a rounded intermediate, so a future "optimisation" that loses
// precision fails here.

function area(
  length: number,
  lengthUnit: Parameters<typeof measureDimensions>[0]["lengthUnit"],
  width: number,
  widthUnit: Parameters<typeof measureDimensions>[0]["lengthUnit"],
  outputUnit: Parameters<typeof measureDimensions>[0]["outputUnit"],
  qty = 1
): number {
  const out = measureDimensions({ length, lengthUnit, width, widthUnit, qty, outputUnit });
  assert.equal(out.ok, true, out.ok ? "" : out.error);
  return out.ok ? out.result.area : NaN;
}

function assertClose(actual: number, expected: number, tolerance = 0.005, label = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected} ± ${tolerance}, got ${actual}`
  );
}

test("4 × 8 FT in every area unit", () => {
  const out = measureDimensions({ length: 4, lengthUnit: "FT", width: 8, widthUnit: "FT" });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.result.lengthCm, 121.92);
  assert.equal(out.result.widthCm, 243.84);
  assertClose(out.result.breakdown.SQ_FT, 32, 1e-9, "sq ft");
  assertClose(out.result.breakdown.SQ_MTR, 2.97289728, 1e-9, "sq mtr");
  assertClose(out.result.breakdown.SQ_CM, 29728.9728, 1e-9, "sq cm");
  assertClose(out.result.breakdown.SQ_INCH, 4608, 1e-9, "sq inch");
  assertClose(out.result.area, 32, 1e-9);
});

test("95 × 370 CM in every area unit", () => {
  assertClose(area(95, "CM", 370, "CM", "SQ_MTR"), 3.515, 1e-9, "sq mtr");
  assertClose(area(95, "CM", 370, "CM", "SQ_FT"), 37.835145, 1e-5, "sq ft");
  assertClose(area(95, "CM", 370, "CM", "SQ_CM"), 35150, 1e-6, "sq cm");
  assertClose(area(95, "CM", 370, "CM", "SQ_INCH"), 5448.2609, 1e-4, "sq inch");
});

test("36 × 48 INCH and 2 × 3 MTR", () => {
  assertClose(area(36, "INCH", 48, "INCH", "SQ_FT"), 12, 1e-9, "36x48 sq ft");
  assertClose(area(36, "INCH", 48, "INCH", "SQ_INCH"), 1728, 1e-9, "36x48 sq inch");
  assertClose(area(2, "MTR", 3, "MTR", "SQ_MTR"), 6, 1e-9, "2x3 sq mtr");
  assertClose(area(2, "MTR", 3, "MTR", "SQ_FT"), 64.5834625, 1e-6, "2x3 sq ft");
});

test("mixed units: 30 INCH × 5 FT", () => {
  const out = measureDimensions({
    length: 30,
    lengthUnit: "INCH",
    width: 5,
    widthUnit: "FT",
    outputUnit: "SQ_FT",
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.result.lengthCm, 76.2);
  assert.equal(out.result.widthCm, 152.4);
  assertClose(out.result.breakdown.SQ_FT, 12.5, 1e-9, "sq ft");
  assertClose(out.result.breakdown.SQ_MTR, 1.161288, 1e-9, "sq mtr");
  assertClose(out.result.breakdown.SQ_CM, 11612.88, 1e-9, "sq cm");
  assertClose(out.result.breakdown.SQ_INCH, 1800, 1e-9, "sq inch");
});

test("mixed units: 3 FT × 150 CM", () => {
  assertClose(area(3, "FT", 150, "CM", "SQ_MTR"), 1.3716, 1e-9, "sq mtr");
  assertClose(area(3, "FT", 150, "CM", "SQ_FT"), 14.7637795276, 1e-9, "sq ft");
});

test("every mixed combination in the request is correct and order-independent", () => {
  const cases: [number, Parameters<typeof measureDimensions>[0]["lengthUnit"], number, Parameters<typeof measureDimensions>[0]["lengthUnit"], number][] = [
    [30, "INCH", 5, "FT", 12.5],
    [24, "INCH", 6, "FT", 12],
    [3, "FT", 150, "CM", 14.7637795276],
    [100, "CM", 2, "MTR", 21.527820833],
    [36, "INCH", 2, "MTR", 19.68503937],
    [500, "MM", 3, "FT", 4.9212598425],
    [2, "MTR", 48, "INCH", 26.24671916],
    [5, "FT", 30, "INCH", 12.5],
    [36, "INCH", 3, "FT", 9],
    [500, "MM", 2, "FT", 3.280839895],
    [1.5, "MTR", 48, "INCH", 19.68503937],
  ];
  for (const [l, lu, w, wu, expectedSqFt] of cases) {
    const forward = area(l, lu, w, wu, "SQ_FT");
    const reverse = area(w, wu, l, lu, "SQ_FT");
    assertClose(forward, expectedSqFt, 1e-5, `${l} ${lu} x ${w} ${wu}`);
    assertClose(reverse, forward, 1e-12, `reversed ${w} ${wu} x ${l} ${lu}`);
  }
});

test("quantity multiplies the area and only then converts", () => {
  const one = measureDimensions({ length: 4, lengthUnit: "FT", width: 8, widthUnit: "FT", outputUnit: "SQ_FT" });
  const three = measureDimensions({ length: 4, lengthUnit: "FT", width: 8, widthUnit: "FT", qty: 3, outputUnit: "SQ_FT" });
  assert.equal(one.ok && three.ok, true);
  if (!one.ok || !three.ok) return;
  assertClose(one.result.area, 32, 1e-9);
  assertClose(three.result.area, 96, 1e-9);
  assertClose(three.result.breakdown.SQ_MTR, 8.91869184, 1e-9);
});

test("unit conversion helpers are exact and reciprocal", () => {
  assertClose(convertLength(1, "MTR", "CM"), 100, 1e-12);
  assertClose(convertLength(1, "INCH", "CM"), 2.54, 1e-12);
  assertClose(convertLength(1, "FT", "CM"), 30.48, 1e-12);
  assertClose(convertLength(1, "MTR", "FT"), 3.280839895, 1e-9);
  assertClose(convertArea(1, "SQ_MTR", "SQ_FT"), 10.7639104167, 1e-9);
  assertClose(convertArea(1, "SQ_FT", "SQ_CM"), 929.0304, 1e-9);
  assertClose(convertArea(1, "SQ_INCH", "SQ_CM"), 6.4516, 1e-12);
  assertClose(convertArea(1, "SQ_MM", "SQ_CM"), 0.01, 1e-12);
  // Round trip through every pair never drifts.
  for (const from of AREA_UNITS) {
    for (const to of AREA_UNITS) {
      assertClose(convertArea(convertArea(7.25, from, to), to, from), 7.25, 1e-9, `${from}->${to}`);
    }
  }
});

test("rate conversion matches the per-unit area ratio", () => {
  // ₹85/sq ft is ₹914.84/sq mtr (85 / 0.09290304 = 914.8444...).
  assertClose(convertAreaRate(85, "SQ_FT", "SQ_MTR"), 914.9323854, 1e-6);
  // ...and converting back returns the quoted rate.
  assertClose(convertAreaRate(914.9323854, "SQ_MTR", "SQ_FT"), 85, 1e-6);
});

test("purchase bridge fills sq_feet/qty_unit/unit_rate exactly as the totals expect", () => {
  const out = computePurchaseArea({
    length: 4,
    lengthUnit: "FT",
    width: 8,
    widthUnit: "FT",
    qty: 1,
    outputUnit: "SQ_FT",
    rate: 85,
    rateUnit: "SQ_FT",
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.result.area, 32);
  assert.equal(out.result.qtyUnit, "FT");
  assert.equal(out.result.unitRate, 85);
  // qty × sq_feet × unit_rate = 1 × 32 × 85 = ₹2,720, the request's example.
  assert.equal(out.result.measurement.qty * out.result.area * out.result.unitRate, 2720);
  assert.equal(out.result.totalArea, 32);

  // 2026-11-05 — the stored area is PER PIECE: with Qty 3 the generated
  // formula (qty × area × rate) must equal 3 × 32 × 85, never 3 × 96 × 85.
  const threePieces = computePurchaseArea({
    length: 4,
    lengthUnit: "FT",
    width: 8,
    widthUnit: "FT",
    qty: 3,
    outputUnit: "SQ_FT",
    rate: 85,
    rateUnit: "SQ_FT",
  });
  assert.equal(threePieces.ok, true);
  if (!threePieces.ok) return;
  assert.equal(threePieces.result.area, 32);
  assert.equal(threePieces.result.totalArea, 96);
  assert.equal(3 * threePieces.result.area * threePieces.result.unitRate, 8160);

  // Same size, but displayed AND priced in sq mtr: 2.9729 sq mtr × ₹914.84.
  const metric = computePurchaseArea({
    length: 4,
    lengthUnit: "FT",
    width: 8,
    widthUnit: "FT",
    outputUnit: "SQ_MTR",
    rate: 85,
    rateUnit: "SQ_FT",
  });
  assert.equal(metric.ok, true);
  if (!metric.ok) return;
  assert.equal(metric.result.qtyUnit, "MTR");
  assertClose(metric.result.area, 2.9729, 1e-9);
  assert.equal(metric.result.unitRate, 914.93);
  assertClose(1 * metric.result.area * metric.result.unitRate, 2720, 0.01);
});

test("invalid or missing dimensions are rejected, never guessed", () => {
  assert.equal(measureDimensions({ length: 0, lengthUnit: "FT", width: 5, widthUnit: "FT" }).ok, false);
  assert.equal(measureDimensions({ length: 5, lengthUnit: "FT", width: -1, widthUnit: "FT" }).ok, false);
  assert.equal(measureDimensions({ length: 5, lengthUnit: "FT", width: 5, widthUnit: "FT", qty: 0 }).ok, false);
  assert.equal(
    measureDimensions({ length: 5, lengthUnit: "YARD" as never, width: 5, widthUnit: "FT" }).ok,
    false
  );
  assert.equal(
    measureDimensions({ length: 5, lengthUnit: "FT", width: 5, widthUnit: "FT", outputUnit: "ACRE" as never }).ok,
    false
  );
  assert.equal(
    computePurchaseArea({ length: 5, lengthUnit: "FT", width: 5, widthUnit: "FT", rate: -1 }).ok,
    false
  );
});

test("purchase unit mapping knows which units are areas", () => {
  assert.equal(qtyUnitToAreaUnit("FT"), "SQ_FT");
  assert.equal(qtyUnitToAreaUnit("mtr"), "SQ_MTR");
  assert.equal(qtyUnitToAreaUnit("INCH"), "SQ_INCH");
  assert.equal(qtyUnitToAreaUnit("CM"), "SQ_CM");
  assert.equal(qtyUnitToAreaUnit("MM"), "SQ_MM");
  assert.equal(qtyUnitToAreaUnit("YARD"), null);
  assert.equal(qtyUnitToAreaUnit("PCS"), null);
  assert.equal(qtyUnitToAreaUnit(null), null);
});

test("display precision and formatting", () => {
  assert.equal(roundTo(2.97289728, 2), 2.97);
  assert.equal(roundTo(2.97289728, 3), 2.973);
  assert.equal(roundTo(2.97289728, 4), 2.9729);
  assert.equal(formatMeasurement(35150, 2), "35,150.00");
  assert.equal(formatMeasurement(32.5, 0), "33");
  assert.equal(formatMeasurement(Number.NaN, 2), "—");
});
