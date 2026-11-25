import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEMPLATES,
  buildStatusMessage,
  checkPhone,
  isStatusTransition,
  nextAttemptAt,
  retryDelayMinutes,
  statusEventId,
  triggerForStatus,
} from "./order-status";

test("only the three approved statuses trigger a message", () => {
  assert.equal(triggerForStatus("Hold"), "hold");
  assert.equal(triggerForStatus("Cancelled"), "cancel");
  assert.equal(triggerForStatus("In Production"), "process");
  // Everything else stays silent — including the OMS statuses that look
  // similar but are not one of the three triggers.
  for (const status of ["Pending", "Confirmed", "Dispatched", "Delivered", "Returned", "Process", "", null, undefined]) {
    assert.equal(triggerForStatus(status), null, `${String(status)} must not trigger`);
  }
});

test("saving the same status again is not a transition", () => {
  assert.equal(isStatusTransition("Hold", "Hold"), false);
  assert.equal(isStatusTransition("Pending", "Pending"), false);
  assert.equal(isStatusTransition("Hold", "In Production"), true);
  assert.equal(isStatusTransition("In Production", "Hold"), true);
  assert.equal(isStatusTransition(null, "Hold"), true);
  assert.equal(isStatusTransition("Hold", ""), false);
});

test("the three messages read exactly as specified, with the real PO number", () => {
  assert.equal(buildStatusMessage(DEFAULT_TEMPLATES.hold, "PO-1052"), "Hold this order PO-1052");
  assert.equal(buildStatusMessage(DEFAULT_TEMPLATES.cancel, "PO-1052"), "Cancel This Order PO-1052");
  assert.equal(buildStatusMessage(DEFAULT_TEMPLATES.process, "PO-1052"), "Process This Order PO-1052");
  assert.equal(buildStatusMessage(DEFAULT_TEMPLATES.hold, "PO-A1154"), "Hold this order PO-A1154");
});

test("a message is never built with a placeholder or an empty PO number", () => {
  assert.equal(buildStatusMessage(DEFAULT_TEMPLATES.hold, null), null);
  assert.equal(buildStatusMessage(DEFAULT_TEMPLATES.hold, "   "), null);
  assert.equal(buildStatusMessage("Hold this order {po} {extra}", "PO-1"), null);
  // A template that lost its {po} token still names the order exactly once.
  assert.equal(buildStatusMessage("Hold this order", "PO-1"), "Hold this order PO-1");
  // Extra whitespace from an admin-edited template collapses.
  assert.equal(buildStatusMessage("  Hold   this order  {po} ", "PO-1"), "Hold this order PO-1");
});

test("customer numbers are validated, not guessed", () => {
  // Local Indian mobile → country code added (unambiguous, common case).
  assert.deepEqual(checkPhone("9876543210"), { ok: true, digits: "919876543210" });
  // Already international passes through unchanged.
  assert.deepEqual(checkPhone("+91 98765 43210"), { ok: true, digits: "919876543210" });
  assert.deepEqual(checkPhone("0044 7700 900123"), { ok: true, digits: "447700900123" });
  assert.deepEqual(checkPhone("+1 (516) 555-0199"), { ok: true, digits: "15165550199" });
  // No number at all, or a number that cannot be international.
  assert.equal(checkPhone(null).ok, false);
  assert.equal(checkPhone("").ok, false);
  assert.equal(checkPhone("12345").ok, false);
  assert.equal(checkPhone("1234567890123456").ok, false);
  // A 10-digit number starting 0/1–5 is not a mobile: refuse instead of
  // sending to a guessed country.
  assert.equal(checkPhone("0123456789").ok, false);
});

test("idempotency keys are unique per transition event", () => {
  const a = statusEventId("order-1", "Pending", "Hold", 1000);
  const b = statusEventId("order-1", "Pending", "Hold", 2000);
  assert.notEqual(a, b);
  assert.match(a, /^status:order-1:Pending->Hold:1000$/);
});

test("retry backoff grows and stops at six hours", () => {
  assert.equal(retryDelayMinutes(0), 5);
  assert.equal(retryDelayMinutes(1), 10);
  assert.equal(retryDelayMinutes(3), 40);
  assert.equal(retryDelayMinutes(20), 360);
  const now = new Date("2026-11-25T00:00:00.000Z");
  assert.equal(nextAttemptAt(1, now), "2026-11-25T00:10:00.000Z");
});
