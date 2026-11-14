import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidIsoDate, selectRateInForce, type DateRangeRow } from "./lookup";

function r(overrides: Partial<DateRangeRow>): DateRangeRow {
  return {
    id: "id-1",
    currencyCode: "USD",
    effectiveStartDate: "2026-11-07",
    effectiveEndDate: null,
    verificationStatus: "verified",
    verifiedAt: "2026-11-06T12:00:00Z",
    ...overrides,
  };
}

test("selects the row whose range contains the date", () => {
  const rows = [
    r({ id: "old", effectiveStartDate: "2026-10-24", effectiveEndDate: "2026-11-06" }),
    r({ id: "new", effectiveStartDate: "2026-11-07", effectiveEndDate: null }),
  ];
  assert.equal(selectRateInForce(rows, "2026-11-07")?.id, "new");
  assert.equal(selectRateInForce(rows, "2026-11-06")?.id, "old");
});

test("boundary: the start date is included and the day before is not covered", () => {
  const rows = [r({ id: "a", effectiveStartDate: "2026-11-07" })];
  assert.equal(selectRateInForce(rows, "2026-11-07")?.id, "a");
  assert.equal(selectRateInForce(rows, "2026-11-06"), null);
});

test("boundary: the end date is inclusive", () => {
  const rows = [r({ id: "a", effectiveStartDate: "2026-10-24", effectiveEndDate: "2026-11-06" })];
  assert.equal(selectRateInForce(rows, "2026-11-06")?.id, "a");
  assert.equal(selectRateInForce(rows, "2026-11-07"), null);
});

test("unverified rows are never used, even when the date matches", () => {
  const rows = [
    r({ id: "pending", verificationStatus: "pending" }),
    r({ id: "rejected", verificationStatus: "rejected" }),
    r({ id: "superseded", verificationStatus: "superseded" }),
  ];
  assert.equal(selectRateInForce(rows, "2026-11-10"), null);
});

test("latest effective start wins when ranges overlap", () => {
  const rows = [
    r({ id: "older", effectiveStartDate: "2026-10-24" }),
    r({ id: "newer", effectiveStartDate: "2026-11-07" }),
  ];
  assert.equal(selectRateInForce(rows, "2026-11-20")?.id, "newer");
});

test("a date before every notification has no rate (no backward fallback)", () => {
  const rows = [r({ id: "a", effectiveStartDate: "2026-11-07" })];
  assert.equal(selectRateInForce(rows, "2025-01-01"), null);
});

test("isValidIsoDate accepts real dates and rejects impossible ones", () => {
  assert.equal(isValidIsoDate("2026-11-14"), true);
  assert.equal(isValidIsoDate("2024-02-29"), true); // leap year
  assert.equal(isValidIsoDate("2026-02-29"), false);
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("14-11-2026"), false);
  assert.equal(isValidIsoDate("2026-1-4"), false);
});
