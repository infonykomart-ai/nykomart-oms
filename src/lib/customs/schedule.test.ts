import { test } from "node:test";
import assert from "node:assert/strict";
import { isCustomsSyncDue, nextScheduledCheck } from "./schedule";

test("no previous attempt means a check is due", () => {
  assert.equal(isCustomsSyncDue(null, new Date("2026-11-14T06:00:00Z")), true);
});

test("a recent attempt on a non-publication day is not due", () => {
  // 2026-11-14 is a Saturday; 06:00Z = 11:30 IST.
  assert.equal(isCustomsSyncDue("2026-11-14T04:00:00Z", new Date("2026-11-14T06:00:00Z")), false);
});

test("an attempt older than 12 hours is due", () => {
  assert.equal(isCustomsSyncDue("2026-11-13T16:00:00Z", new Date("2026-11-14T06:00:00Z")), true);
});

test("Thursday after the 18:00 IST publication is due if today's window is unchecked", () => {
  // Thursday 2026-11-12. 14:00Z = 19:30 IST. Last attempt 03:30Z = 09:00 IST.
  assert.equal(isCustomsSyncDue("2026-11-12T03:30:00Z", new Date("2026-11-12T14:00:00Z")), true);
});

test("Thursday before 18:00 IST is not due", () => {
  // 11:30Z = 17:00 IST, last attempt 2 hours earlier.
  assert.equal(isCustomsSyncDue("2026-11-12T09:30:00Z", new Date("2026-11-12T11:30:00Z")), false);
});

test("Thursday after 18:00 IST is not due when today's window was already checked", () => {
  // Now 20:00 IST, last attempt 19:00 IST the same day.
  assert.equal(isCustomsSyncDue("2026-11-12T13:30:00Z", new Date("2026-11-12T14:30:00Z")), false);
});

test("nextScheduledCheck is 12 hours ahead", () => {
  const now = new Date("2026-11-14T06:00:00Z");
  assert.equal(nextScheduledCheck(now), "2026-11-14T18:00:00.000Z");
});
