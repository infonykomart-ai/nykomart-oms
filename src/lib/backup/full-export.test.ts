import assert from "node:assert/strict";
import test from "node:test";
import { groupTablesForBackup, buildFullBackupZip } from "./full-export";
import type { SnapshotData, SnapshotTable } from "./snapshot";

function table(name: string, rows = 1): SnapshotTable {
  return { name, rows: Array.from({ length: rows }, (_, i) => ({ id: i + 1, value: `${name}-${i + 1}` })), truncated: false };
}

test("every table lands in exactly one workbook, unknown tables included", () => {
  const tables = [
    table("orders"),
    table("dispatch_invoices"),
    table("inventory_stock_entries"),
    table("employees"),
    table("store_ad_spend"),
    table("parties"),
    table("messages"),
    table("roles"),
    table("a_brand_new_module"),
  ];
  const groups = groupTablesForBackup(tables);
  const seen = groups.flatMap((group) => group.tables.map((t) => t.name));
  assert.deepEqual(seen.slice().sort(), tables.map((t) => t.name).sort());
  assert.equal(new Set(seen).size, seen.length, "no table may be duplicated across workbooks");
  assert.ok(groups.some((group) => group.fileName === "Orders.xlsx" && group.tables.some((t) => t.name === "dispatch_invoices")));
  assert.ok(groups.some((group) => group.fileName === "Other.xlsx" && group.tables.some((t) => t.name === "a_brand_new_module")));
});

test("an untouched snapshot still produces a summary and an archive", () => {
  const snapshot: SnapshotData = {
    generatedAt: "2026-11-21T10:00:00.000Z",
    tables: [table("orders", 2), table("stores", 1)],
    skipped: [{ name: "some_view", reason: "Derived view" }],
    totalRows: 3,
  };
  const built = buildFullBackupZip(snapshot, new Date("2026-11-21T10:00:00Z"));
  assert.match(built.fileName, /^nyko-oms-full-backup-2026-11-21\.zip$/);
  assert.ok(built.buffer.length > 0);
  assert.deepEqual(built.receipt, { tables: 2, rows: 3, workbooks: 2, skipped: 1, bytes: built.buffer.byteLength });
});
