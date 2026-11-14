import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBatch, validateExtractedRate, UNEXPECTED_CHANGE_PCT } from "./validate";
import type { ExtractionContext, ExtractedRate } from "./types";

// All figures below are arbitrary TEST FIXTURES — they are not official
// customs rates and must not be treated as such.

const officialFeed: ExtractionContext = { source: "icegate" };

function row(overrides: Partial<ExtractedRate> = {}): ExtractedRate {
  return {
    currencyCode: "USD",
    currencyName: "US Dollar",
    currencyUnit: 1,
    importRate: "90.12345678",
    exportRate: "88.65432100",
    effectiveStartDate: "2026-11-06",
    notificationNo: "30/2026",
    notificationDate: "2026-11-06",
    ...overrides,
  };
}

test("a complete official feed row is verified and keeps the published precision", () => {
  const outcome = validateExtractedRate(row(), officialFeed);
  assert.equal(outcome.ok, true);
  assert.ok(outcome.row);
  assert.equal(outcome.row.suggestedStatus, "verified");
  assert.equal(outcome.row.exportRate, "88.65432100"); // no float round-trip
  assert.equal(outcome.row.importRate, "90.12345678");
  assert.equal(outcome.row.confidence, 100);
});

test("unsupported currency is rejected rather than guessed", () => {
  const outcome = validateExtractedRate(row({ currencyCode: "XYZ", currencyName: "Unknown" }), officialFeed);
  assert.equal(outcome.ok, false);
  assert.match(outcome.errors.join(" "), /not a supported customs currency/i);
});

test("non-positive and malformed rates are rejected", () => {
  assert.equal(validateExtractedRate(row({ importRate: "0" }), officialFeed).ok, false);
  assert.equal(validateExtractedRate(row({ exportRate: "-2" }), officialFeed).ok, false);
  assert.equal(validateExtractedRate(row({ exportRate: "abc" }), officialFeed).ok, false);
  assert.equal(validateExtractedRate(row({ exportRate: null }), officialFeed).ok, false);
});

test("more decimals than the register can store is an error, never a silent round", () => {
  const outcome = validateExtractedRate(row({ exportRate: "88.123456789" }), officialFeed);
  assert.equal(outcome.ok, false);
  assert.match(outcome.errors.join(" "), /decimal places/i);
});

test("a missing import rate stays an independent field and lowers confidence", () => {
  const outcome = validateExtractedRate(row({ importRate: null }), officialFeed);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.row?.importRate, null);
  assert.notEqual(outcome.row?.exportRate, null);
  assert.ok((outcome.row?.confidence ?? 100) < 100);
  assert.match(outcome.warnings.join(" "), /Import rate is missing/i);
});

test("currency unit is taken from the published name", () => {
  const outcome = validateExtractedRate(
    row({
      currencyCode: "JPY",
      currencyName: "Japanese Yen (100)",
      currencyUnit: null,
      importRate: "0.5900",
      exportRate: "0.5800",
    }),
    officialFeed
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.row?.currencyUnit, 100);
});

test("an out-of-range currency unit is rejected", () => {
  const outcome = validateExtractedRate(row({ currencyUnit: 7 }), officialFeed);
  assert.equal(outcome.ok, false);
  assert.match(outcome.errors.join(" "), /Currency unit/i);
});

test("date validation: bad calendar date and end-before-start are errors", () => {
  assert.equal(validateExtractedRate(row({ effectiveStartDate: "2026-02-30" }), officialFeed).ok, false);

  const backwards = validateExtractedRate(
    row({ effectiveStartDate: "2026-11-06", effectiveEndDate: "2026-11-01" }),
    officialFeed
  );
  assert.equal(backwards.ok, false);
  assert.match(backwards.errors.join(" "), /before the effective start/i);
});

test("date validation: the start date may fall back to the document header", () => {
  const outcome = validateExtractedRate(
    row({ effectiveStartDate: "" }),
    { ...officialFeed, effectiveStartDate: "2026-11-07" }
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.row?.effectiveStartDate, "2026-11-07");
});

test("admin CSV rows are always pending, even when every field is present", () => {
  const outcome = validateExtractedRate(row(), { source: "admin_csv" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.row?.suggestedStatus, "pending");
  assert.match(outcome.warnings.join(" "), /pending until an administrator approves/i);
});

test("PDF-parsed rows are always pending", () => {
  const outcome = validateExtractedRate(row(), { source: "admin_document", fromDocument: true });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.row?.suggestedStatus, "pending");
  assert.match(outcome.warnings.join(" "), /PDF parser/i);
});

test("a mirror/unofficial feed never auto-verifies", () => {
  const outcome = validateExtractedRate(row(), { source: "mirror" });
  assert.equal(outcome.row?.suggestedStatus, "pending");
});

test("an unexpected jump against the last verified rate forces review", () => {
  const outcome = validateExtractedRate(row({ exportRate: "150.00000000" }), {
    ...officialFeed,
    previousByCurrency: {
      USD: { currencyCode: "USD", importRate: 90, exportRate: 100, effectiveStartDate: "2026-10-23" },
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.row?.suggestedStatus, "pending");
  assert.match(outcome.warnings.join(" "), new RegExp(`more than ${UNEXPECTED_CHANGE_PCT}%`));
});

test("a normal move against the previous rate stays verified", () => {
  const outcome = validateExtractedRate(row({ exportRate: "88.65432100" }), {
    ...officialFeed,
    previousByCurrency: {
      USD: { currencyCode: "USD", importRate: 90, exportRate: 88, effectiveStartDate: "2026-10-23" },
    },
  });
  assert.equal(outcome.row?.suggestedStatus, "verified");
});

test("a duplicate currency + effective date inside one batch is rejected", () => {
  const { outcomes, duplicateCount } = validateBatch([row(), row()], officialFeed);
  assert.equal(duplicateCount, 2);
  assert.equal(outcomes.filter((o) => o.ok).length, 0);
});

test("distinct currencies in one batch all pass", () => {
  const eur: ExtractedRate = row({ currencyCode: "EUR", currencyName: "Euro", exportRate: "95.10000000" });
  const gbp: ExtractedRate = row({ currencyCode: "GBP", currencyName: "Pound Sterling", exportRate: "110.20000000" });
  const { outcomes, duplicateCount } = validateBatch([row(), eur, gbp], officialFeed);
  assert.equal(duplicateCount, 0);
  assert.equal(outcomes.filter((o) => o.ok).length, 3);
});
