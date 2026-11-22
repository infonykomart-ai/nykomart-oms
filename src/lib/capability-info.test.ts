import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilityTilesFor } from "./capability-info";

// 2026-11-22 — the launcher/sidebar/dock all render these tiles, so this is the
// access path being asserted: a role granted ONLY the P&L overhead log must
// still get an Office Expenses tile that opens it, and a role that also holds
// an accounts capability must see exactly ONE Office Expenses tile.

function officeTiles(capabilities: string[]) {
  return capabilityTilesFor(capabilities).filter(
    (c) => c.href === "/dashboard/accounts" || c.href === "/dashboard/expenses"
  );
}

test("a role with only internal_expense_entry gets one Office Expenses tile to the P&L log", () => {
  const tiles = officeTiles(["internal_expense_entry"]);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].href, "/dashboard/expenses");
});

test("accounts_view alone gets one Office Expenses tile into the accounts module", () => {
  const tiles = officeTiles(["accounts_view"]);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].href, "/dashboard/accounts");
});

test("accounts_view + internal_expense_entry does not duplicate the Office Expenses tile", () => {
  const tiles = officeTiles(["accounts_view", "internal_expense_entry"]);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].href, "/dashboard/accounts");
});

test("unrelated capabilities don't remove the P&L-only Office Expenses tile", () => {
  const tiles = officeTiles(["order_entry", "internal_expense_entry"]);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].href, "/dashboard/expenses");
});

test("hidden registry entries never become tiles", () => {
  assert.equal(officeTiles(["accounts_expense_approve"]).filter((t) => t.hidden).length, 0);
  assert.equal(capabilityTilesFor(["accounts_expense_approve"]).length, 0);
});
