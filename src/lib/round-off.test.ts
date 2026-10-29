// 2026-10-29 — round-off rules used by every bill / invoice / note form.
// Run with `npm test` (node's test runner + tsx).
import assert from "node:assert/strict";
import { test } from "node:test";
import { baseFromRounded, isSaneRoundOff, netWithRoundOff, round2, roundOffForStep, roundOffLabel } from "./round-off";

test("round2 rounds to paise", () => {
  assert.equal(round2(12433.605), 12433.61);
  assert.equal(round2(12433.604), 12433.6);
  assert.equal(round2(Number.NaN), 0);
});

test("netWithRoundOff adds a signed adjustment to the base", () => {
  assert.equal(netWithRoundOff(12433.6, 0.4), 12434);
  assert.equal(netWithRoundOff(12433.6, -0.6), 12433);
  assert.equal(netWithRoundOff(1000, null), 1000);
});

test("baseFromRounded recovers the pre-round-off amount", () => {
  assert.equal(baseFromRounded(2000, 0.4), 1999.6);
  assert.equal(baseFromRounded(2000, 0), 2000);
  assert.equal(baseFromRounded(0, -0.5), 0.5);
});

test("roundOffForStep finds the difference to the nearest round figure", () => {
  assert.deepEqual(roundOffForStep(12433.6, 10), { target: 12430, difference: -3.6 });
  assert.deepEqual(roundOffForStep(12436, 10), { target: 12440, difference: 4 });
  assert.deepEqual(roundOffForStep(0, 10), { target: 0, difference: 0 });
});

test("roundOffLabel prints a signed label, and nothing at zero", () => {
  assert.equal(roundOffLabel(0.4), "+ 0.40");
  assert.equal(roundOffLabel(-0.6), "− 0.60");
  assert.equal(roundOffLabel(0), "");
});

test("isSaneRoundOff matches the DB CHECK (+/- 1000)", () => {
  assert.equal(isSaneRoundOff(0.4), true);
  assert.equal(isSaneRoundOff(-1000), true);
  assert.equal(isSaneRoundOff(1000.01), false);
  assert.equal(isSaneRoundOff(Number.NaN), false);
});
