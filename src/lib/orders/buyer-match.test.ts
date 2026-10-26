import { test } from "node:test";
import assert from "node:assert/strict";
import { buyerMatchKey } from "./buyer-match";

// Shared by BUYER-BATCH SUFFIX and DUPLICATE-DISPATCHED-ORDER REUSE:
// contact number wins, name only when there is no contact number.

test("the same phone number matches however it is punctuated", () => {
  assert.equal(buyerMatchKey("+91 98765 43210", "A"), "phone:919876543210");
  assert.equal(buyerMatchKey("91-98765-43210", "B"), "phone:919876543210");
  assert.equal(buyerMatchKey("919876543210", "C"), "phone:919876543210");
  assert.equal(buyerMatchKey("(98765) 43210", "D"), "phone:9876543210");
  assert.equal(
    buyerMatchKey("+91 98765 43210", "Completely Different Shop"),
    buyerMatchKey("919876543210", "Same Shop")
  );
});

test("a contact number always beats the name", () => {
  const withPhone = buyerMatchKey("9876543210", "Totally Irrelevant Name");
  assert.ok(withPhone.startsWith("phone:"));
  assert.notEqual(withPhone, buyerMatchKey(null, "Totally Irrelevant Name"));
});

test("with no contact number the name is trimmed and lower-cased", () => {
  assert.equal(buyerMatchKey("", "  John DOE "), "name:john doe");
  assert.equal(buyerMatchKey(null, "SHARMA  RUGS"), "name:sharma  rugs");
  assert.equal(buyerMatchKey(undefined, undefined), "name:");
  assert.equal(buyerMatchKey("   ", "  John DOE "), "name:john doe");
  assert.equal(buyerMatchKey("", "A"), buyerMatchKey(null, " a "));
});

test("blank contact numbers that contain no digits fall through to the name", () => {
  // Symbols only — no digits to build a phone key from
  assert.equal(buyerMatchKey("N/A", "Rugara"), "name:rugara");
});
