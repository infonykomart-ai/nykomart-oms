import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAvailability } from "./order-stock-math";

test("available is READY minus live reservations", () => {
  const s = summarizeAvailability({ readyPcs: 12, readySqft: 288, reservedPcs: 5, reservedSqft: 120, requestedPcs: 0 });
  assert.equal(s.availablePcs, 7);
  assert.equal(s.availableSqft, 168);
  assert.equal(s.shortfallPcs, 0);
  assert.equal(s.enough, true);
});

test("a reservation larger than READY never reports negative availability", () => {
  const s = summarizeAvailability({ readyPcs: 3, readySqft: 72, reservedPcs: 8, reservedSqft: 192, requestedPcs: 4 });
  assert.equal(s.availablePcs, 0);
  assert.equal(s.availableSqft, 0);
  assert.equal(s.shortfallPcs, 4);
  assert.equal(s.enough, false);
});

test("shortfall is the part of the order stock cannot cover", () => {
  const s = summarizeAvailability({ readyPcs: 10, readySqft: 240, reservedPcs: 7, reservedSqft: 168, requestedPcs: 9 });
  assert.equal(s.availablePcs, 3);
  assert.equal(s.shortfallPcs, 6);
  assert.equal(s.enough, false);
});

test("an exactly covered order has no shortfall", () => {
  const s = summarizeAvailability({ readyPcs: 10, readySqft: 240, reservedPcs: 4, reservedSqft: 96, requestedPcs: 6 });
  assert.equal(s.availablePcs, 6);
  assert.equal(s.shortfallPcs, 0);
  assert.equal(s.enough, true);
});

test("nothing typed yet never flags a shortage", () => {
  const s = summarizeAvailability({ readyPcs: 0, readySqft: 0, reservedPcs: 0, reservedSqft: 0, requestedPcs: 0 });
  assert.equal(s.shortfallPcs, 0);
  assert.equal(s.enough, true);
});

test("non-finite input is treated as zero rather than poisoning the sum", () => {
  const s = summarizeAvailability({
    readyPcs: Number.NaN,
    readySqft: Number.POSITIVE_INFINITY,
    reservedPcs: -4,
    reservedSqft: Number.NaN,
    requestedPcs: Number.NaN,
  });
  assert.equal(s.readyPcs, 0);
  assert.equal(s.reservedPcs, 0);
  assert.equal(s.requestedPcs, 0);
  assert.equal(s.shortfallPcs, 0);
});
