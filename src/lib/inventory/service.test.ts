import assert from "node:assert/strict";
import { test } from "node:test";
import { friendlyDbError } from "./errors";
import { INWARD_STAGES, STAGE_LABELS, TX_TYPE_LABELS, stageLabel, txTypeLabel } from "./stages";

test("insufficient-stock errors are translated into readable text", () => {
  const message = 'INSUFFICIENT_STOCK: 6c6c at stage READY has 4.000 PCS / 96.000 SQ FT, movement needs -6 PCS / -144 SQ FT.';
  assert.match(friendlyDbError(message), /^Not enough stock — /);
  assert.match(friendlyDbError(message), /96\.000 SQ FT/);
});

test("insufficient-ready errors are distinguished from general stock", () => {
  assert.match(friendlyDbError("INSUFFICIENT_READY: only 2 PCS available (5 in READY minus 3 reserved)."), /^Not enough ready stock — /);
});

test("duplicate-key errors do not leak constraint names", () => {
  assert.equal(
    friendlyDbError('duplicate key value violates unique constraint "inventory_product_variants_sku_key"'),
    "This entry already exists"
  );
});

test("unknown errors are passed through with whitespace collapsed", () => {
  assert.equal(friendlyDbError("some   odd\nmessage"), "some odd message");
  assert.equal(friendlyDbError(""), "The database rejected that change.");
});

test("a manual inward can only land in RAW, QC or READY", () => {
  assert.deepEqual([...INWARD_STAGES], ["RAW", "QC", "READY"]);
  assert.equal(INWARD_STAGES.includes("DISPATCHED"), false);
  assert.equal(INWARD_STAGES.includes("PRINTING"), false);
});

test("every stage and transaction type has a human label", () => {
  for (const stage of Object.values(STAGE_LABELS)) assert.ok(stage.length > 0);
  for (const type of Object.values(TX_TYPE_LABELS)) assert.ok(type.length > 0);
  assert.equal(stageLabel("READY"), "Ready to dispatch");
  assert.equal(stageLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(txTypeLabel("CHALLAN_ISSUE"), "Challan issued");
});
