import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHIFT, resolveDirection, shiftMetrics, istMinutes } from "./attendance";

// 2026-11-06 — biometric direction/policy acceptance tests. These are the
// rules the punch webhook relies on, kept pure so they run without a database.

test("AUTO direction: first punch is IN, second is OUT", () => {
  assert.equal(resolveDirection("AUTO", "2026-11-06T04:02:00Z", { punchIn: null, punchOut: null }), "IN");
  assert.equal(
    resolveDirection("AUTO", "2026-11-06T12:45:00Z", { punchIn: "2026-11-06T04:02:00Z", punchOut: null }),
    "OUT"
  );
});

test("AUTO uses the shift: an evening first punch is OUT, not a fabricated IN", () => {
  // 19:00 IST on a 09:30–18:30 shift — likely a forgotten IN punch.
  assert.equal(resolveDirection("AUTO", "2026-11-06T13:30:00Z", { punchIn: null, punchOut: null }, DEFAULT_SHIFT), "OUT");
  // 09:32 IST is still IN.
  assert.equal(resolveDirection("AUTO", "2026-11-06T04:02:00Z", { punchIn: null, punchOut: null }, DEFAULT_SHIFT), "IN");
});

test("AUTO does not treat a near-duplicate second punch as OUT", () => {
  const first = { punchIn: "2026-11-06T04:02:00Z", punchOut: null };
  assert.equal(resolveDirection("AUTO", "2026-11-06T04:07:00Z", first, DEFAULT_SHIFT), "IN");
  assert.equal(resolveDirection("AUTO", "2026-11-06T12:45:00Z", first, DEFAULT_SHIFT), "OUT");
});

test("AUTO never invents a third state — late/extra punches update the nearest side", () => {
  const current = { punchIn: "2026-11-06T04:02:00Z", punchOut: "2026-11-06T12:45:00Z" };
  assert.equal(resolveDirection("AUTO", "2026-11-06T03:58:00Z", current), "IN");
  assert.equal(resolveDirection("AUTO", "2026-11-06T13:10:00Z", current), "OUT");
});

test("explicit IN/OUT from the device always wins", () => {
  const current = { punchIn: "2026-11-06T04:02:00Z", punchOut: null };
  assert.equal(resolveDirection("IN", "2026-11-06T04:02:00Z", current), "IN");
  assert.equal(resolveDirection("OUT", "2026-11-06T12:00:00Z", current), "OUT");
});

test("shift metrics: on-time 09:32–18:15 is 8h43m, present, 15m early", () => {
  const metrics = shiftMetrics("2026-11-06T04:02:00Z", "2026-11-06T12:45:00Z", DEFAULT_SHIFT);
  assert.equal(metrics.workedMinutes, 523);
  assert.equal(metrics.lateMinutes, 0);
  assert.equal(metrics.earlyDepartureMinutes, 15);
  assert.equal(metrics.status, "Present");
});

test("shift metrics: grace/late and overtime", () => {
  // 09:45 IST = 04:15Z. Grace ends at 09:45, so exactly on time.
  const grace = shiftMetrics("2026-11-06T04:15:00Z", "2026-11-06T13:30:00Z", DEFAULT_SHIFT);
  assert.equal(grace.lateMinutes, 0);
  assert.equal(grace.overtimeMinutes, 30);

  // 10:20 IST = 04:50Z -> 35 minutes late.
  const late = shiftMetrics("2026-11-06T04:50:00Z", "2026-11-06T13:30:00Z", DEFAULT_SHIFT);
  assert.equal(late.lateMinutes, 35);
  assert.equal(late.status, "Late");
});

test("shift metrics: short day becomes Half Day", () => {
  const metrics = shiftMetrics("2026-11-06T04:30:00Z", "2026-11-06T07:30:00Z", DEFAULT_SHIFT);
  assert.equal(metrics.workedMinutes, 180);
  assert.equal(metrics.status, "Half Day");
});

test("missing punches do not fabricate a work duration", () => {
  assert.equal(shiftMetrics("2026-11-06T04:30:00Z", null, DEFAULT_SHIFT).workedMinutes, null);
  assert.equal(shiftMetrics(null, "2026-11-06T12:30:00Z", DEFAULT_SHIFT).workedMinutes, null);
});

test("IST minutes are independent of the server timezone", () => {
  assert.equal(istMinutes("2026-11-06T04:02:00Z"), 9 * 60 + 32);
  assert.equal(istMinutes("2026-11-06T13:00:00Z"), 18 * 60 + 30);
});
