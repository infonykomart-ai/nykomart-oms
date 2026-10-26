import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fyLabel,
  fyStartYear,
  fyWindow,
  fyOptions,
  fyDateWindow,
  validateBusinessDate,
  validateDateFields,
  MAX_FY_OPTIONS,
} from "./fy-date";

const NOW = new Date("2026-10-26T12:00:00Z");

// ---------------------------------------------------------------------------
// The Indian financial year: 1 April → 31 March, mirroring fy_label() in
// db/schema.sql.
// ---------------------------------------------------------------------------

test("fyLabel matches the documented examples", () => {
  assert.equal(fyLabel("2026-07-15"), "26-27");
  assert.equal(fyLabel("2026-03-31"), "25-26");
  assert.equal(fyLabel("2026-04-01"), "26-27"); // 1 April starts the new FY
  assert.equal(fyLabel("2026-01-01"), "25-26");
  assert.equal(fyLabel("2026-12-31"), "26-27");
});

test("fyStartYear identifies the year the FY starts in", () => {
  assert.equal(fyStartYear("2026-04-01"), 2026);
  assert.equal(fyStartYear("2027-03-31"), 2026);
  assert.equal(fyStartYear("2026-03-31"), 2025);
});

test("fyWindow is 1 April → 31 March with both label forms", () => {
  assert.deepEqual(fyWindow(2026), {
    start: "2026-04-01",
    end: "2027-03-31",
    label: "2026-27",
    shortLabel: "26-27",
  });
  assert.deepEqual(fyWindow(2025).label, "2025-26");
});

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

test("fyOptions is newest-first, flags the current FY and caps its length", () => {
  const one = fyOptions(null, NOW);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0], { startYear: 2026, value: "2026-27", label: "FY 2026-27 (current)" });

  const widened = fyOptions(2000, NOW);
  assert.equal(widened.length, MAX_FY_OPTIONS);
  assert.equal(widened[0].startYear, 2026);
  assert.equal(widened[MAX_FY_OPTIONS - 1].startYear, 2026 - (MAX_FY_OPTIONS - 1));
  assert.ok(widened.every((o) => o.label.includes("FY")));
});

test("fyDateWindow stays relative to today, never a frozen year", () => {
  const w = fyDateWindow(NOW);
  assert.equal(w.min, "2016-04-01");
  assert.equal(w.max, "2028-03-31");
  assert.ok(w.min < "2026-10-26" && w.max > "2026-10-26");
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("a usable date passes", () => {
  assert.equal(validateBusinessDate("2026-10-06"), null);
  assert.equal(validateBusinessDate("2026-04-01"), null);
  assert.equal(validateBusinessDate(""), null); // required-ness is the caller's job
});

test("impossible and malformed dates are rejected before any window check", () => {
  assert.ok(validateBusinessDate("2026-02-31")?.includes("not a real calendar date"));
  assert.ok(validateBusinessDate("2026-13-05")?.includes("not a real calendar date"));
  assert.ok(validateBusinessDate("20026-09-01")?.includes("not a valid date"));
  assert.ok(validateBusinessDate("06/10/2026")?.includes("not a valid date"));
});

test("dates outside the allowed financial-year window are rejected", () => {
  const err = validateBusinessDate("1999-04-01");
  assert.ok(err?.includes("outside the allowed financial-year window"), err ?? "");
});

test("validateDateFields reports the first failing field", () => {
  assert.equal(
    validateDateFields([
      { value: "2026-10-06", label: "Invoice Date" },
      { value: "2026-11-01", label: "Due Date" },
    ]),
    null
  );
  const err = validateDateFields([
    { value: "2026-10-06", label: "Invoice Date" },
    { value: "2026-02-31", label: "Due Date" },
  ]);
  assert.ok(err?.startsWith('Due Date "2026-02-31"'), err ?? "");
});
