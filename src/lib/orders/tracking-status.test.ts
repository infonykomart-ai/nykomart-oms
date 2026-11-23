import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrackingState,
  nextOrderStatus,
  shouldApplyTrackingState,
  TRACKING_STATES,
} from "./tracking-status";

// 2026-11-23 — the tracking → order-status rules shared by the manual
// shipping form, the courier webhooks and the nightly poll.

test("isTrackingState accepts only the four shipping states", () => {
  for (const state of TRACKING_STATES) assert.equal(isTrackingState(state), true);
  assert.equal(isTrackingState("Order Placed"), false);
  assert.equal(isTrackingState(""), false);
  assert.equal(isTrackingState(null), false);
});

test("Shipped and In Transit both land the order in Dispatched", () => {
  assert.equal(nextOrderStatus("Shipped"), "Dispatched");
  assert.equal(nextOrderStatus("In Transit"), "Dispatched");
  assert.equal(nextOrderStatus("Delivered"), "Delivered");
  assert.equal(nextOrderStatus("Returned"), "Returned");
});

test("a moving parcel never downgrades a delivered or returned order", () => {
  assert.equal(shouldApplyTrackingState({ status: "Delivered", shipment_status: "Delivered" }, "In Transit"), false);
  assert.equal(shouldApplyTrackingState({ status: "Returned", shipment_status: "Returned" }, "Shipped"), false);
  assert.equal(shouldApplyTrackingState({ status: "Dispatched", shipment_status: "Delivered" }, "Shipped"), false);
});

test("a parcel still moving is moved forward to Dispatched", () => {
  assert.equal(shouldApplyTrackingState({ status: "Confirmed", shipment_status: "Shipped" }, "In Transit"), true);
  assert.equal(shouldApplyTrackingState({ status: null, shipment_status: null }, "Shipped"), true);
});

test("Delivered and Returned always apply, but a Cancelled order needs an explicit staff action", () => {
  assert.equal(shouldApplyTrackingState({ status: "Dispatched", shipment_status: "Shipped" }, "Delivered"), true);
  assert.equal(shouldApplyTrackingState({ status: "Cancelled", shipment_status: "Shipped" }, "Delivered"), false);
  assert.equal(shouldApplyTrackingState({ status: "Cancelled", shipment_status: "Shipped" }, "Delivered", true), true);
});
