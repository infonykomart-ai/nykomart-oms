import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateTotal,
  debitNoteTotal,
  money2,
  resolveDebitNoteAdjustmentAmount,
} from "./gst-allocation";

// The reported case: Debit Amount 4,140 (excl. GST), 5% GST = 207,
// note value 4,347. These are arithmetic fixtures, not official rates.

test("debitNoteTotal adds 5% GST to the pre-GST debit amount", () => {
  assert.equal(debitNoteTotal(4140), 4347);
  assert.equal(debitNoteTotal(4140, 0), 4347);
  assert.equal(debitNoteTotal(1000, 0.5), 1050.5);
  assert.equal(debitNoteTotal(4140, -0.5), 4346.5);
});

test("an adjustment equal to the pre-GST Debit Amount is grossed up", () => {
  assert.equal(
    resolveDebitNoteAdjustmentAmount({ requested: 4140, debitAmount: 4140, noteTotal: 4347 }),
    4347
  );
});

test("a deliberately partial adjustment is left alone", () => {
  assert.equal(
    resolveDebitNoteAdjustmentAmount({ requested: 2000, debitAmount: 4140, noteTotal: 4347 }),
    2000
  );
});

test("a blank adjustment means the whole note", () => {
  assert.equal(
    resolveDebitNoteAdjustmentAmount({ requested: null, debitAmount: 4140, noteTotal: 4347 }),
    4347
  );
  assert.equal(
    resolveDebitNoteAdjustmentAmount({ requested: 0, debitAmount: 4140, noteTotal: 4347 }),
    4347
  );
});

test("allocateTotal splits proportionally and sums exactly to the note total", () => {
  const parts = allocateTotal([1000, 2000], 3150);
  assert.deepEqual(parts, [1050, 2100]);
  assert.equal(money2(parts.reduce((s, p) => s + p, 0)), 3150);
});

test("allocateTotal puts rounding remainder on the last row", () => {
  const parts = allocateTotal([33.33, 33.33, 33.34], 100);
  assert.equal(money2(parts.reduce((s, p) => s + p, 0)), 100);
  assert.equal(parts.length, 3);
});

test("allocateTotal proportionally rescales an existing split", () => {
  const parts = allocateTotal([4140], 4347);
  assert.deepEqual(parts, [4347]);
});

test("money2 rounds to paise", () => {
  assert.equal(money2(0.1 + 0.2), 0.3);
  assert.equal(money2(4347.005), 4347.01);
});
