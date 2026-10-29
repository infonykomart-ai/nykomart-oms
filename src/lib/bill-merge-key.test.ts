// 2026-10-29b — the merge rule that decides what a "duplicate bill" is.
// Written after two DIFFERENT bills (same vendor invoice number, different
// invoice date + amount) were folded into one and the party ledger started
// showing one company's bill with another company's money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { billMergeKey, pickRowsSummingTo, parseMergeOriginalTotal } from "./bill-merge-key";

const base = {
  party_id: "p1",
  vendor_invoice_no: "82",
  invoice_no: "BP-82",
  invoice_date: "2026-10-19",
  total_amt: 1386.75,
};

test("same party + invoice no + date + amount is the same bill", () => {
  assert.equal(billMergeKey(base), billMergeKey({ ...base, invoice_no: "BP-999" }));
});

test("same invoice number on another date is a DIFFERENT bill", () => {
  assert.notEqual(billMergeKey(base), billMergeKey({ ...base, invoice_date: "2026-08-02" }));
});

test("same invoice number with another amount is a DIFFERENT bill", () => {
  assert.notEqual(billMergeKey(base), billMergeKey({ ...base, total_amt: 2887.5 }));
});

test("another party is a DIFFERENT bill", () => {
  assert.notEqual(billMergeKey(base), billMergeKey({ ...base, party_id: "p2" }));
});

test("numeric strings from PostgREST compare equal to numbers", () => {
  assert.equal(billMergeKey(base), billMergeKey({ ...base, total_amt: "1386.75" }));
});

test("invoice number matching is case/space insensitive, date keeps only yyyy-mm-dd", () => {
  assert.equal(
    billMergeKey({ ...base, vendor_invoice_no: " abc/1 " }),
    billMergeKey({ ...base, vendor_invoice_no: "ABC/1", invoice_date: "2026-10-19T00:00:00" })
  );
});

test("falls back to invoice_no when there is no vendor invoice number", () => {
  assert.equal(
    billMergeKey({ ...base, vendor_invoice_no: null, invoice_no: "X/1" }),
    billMergeKey({ ...base, vendor_invoice_no: "x/1", invoice_no: null })
  );
});

test("undo helper finds the exact payment rows that belonged to the restored bill", () => {
  const rows = [
    { id: "a", amount: 5000 },
    { id: "b", amount: 1386.75 },
    { id: "c", amount: 200 },
  ];
  const picked = pickRowsSummingTo(rows, 1586.75);
  assert.deepEqual(picked?.map((r) => r.id), ["b", "c"]);
});

test("undo helper takes a single matching payment", () => {
  const rows = [
    { id: "a", amount: 2887.5 },
    { id: "b", amount: 100 },
  ];
  assert.deepEqual(pickRowsSummingTo(rows, 2887.5)?.map((r) => r.id), ["a"]);
});

test("undo helper returns null (never a guess) when no combination matches", () => {
  assert.equal(pickRowsSummingTo([{ id: "a", amount: 100 }, { id: "b", amount: 250 }], 999), null);
});

test("audit remark gives back the amount the merged bill carried", () => {
  assert.equal(parseMergeOriginalTotal("[merged into 82 — Nyko Mart; original total 1386.75]"), 1386.75);
  assert.equal(
    parseMergeOriginalTotal("net 15 days | [merged into INV/9 — Rugara; original total 28800.00]"),
    28800
  );
  assert.equal(parseMergeOriginalTotal("no merge here"), 0);
  assert.equal(parseMergeOriginalTotal(null), 0);
});
