import { test } from "node:test";
import assert from "node:assert/strict";
import { billInvoiceKey, fetchBillsInCompanyView, resolveBillCompanyOwners, type BillCompanyRow } from "./bill-company";

// 2026-10-31 — the rule that decides which company books a bill decides real
// money on the ledger, so it is pinned here: a Purchase/Printing invoice's item
// rows all belong to the company that registered the bill (never split), the
// legacy fallback is the biggest share, and two REAL documents that happen to
// share a vendor invoice number (different dates) stay apart.

type Client = Parameters<typeof resolveBillCompanyOwners>[0];

/** Just enough of the Supabase client for the one lookup this module makes. */
function fakeClient(purchaseBills: { id: string; company_id: string }[]): Client {
  const queriedIds: string[][] = [];
  const builder = {
    select: () => builder,
    in: (_column: string, ids: string[]) => {
      queriedIds.push(ids);
      return Promise.resolve({ data: purchaseBills.filter((pb) => ids.includes(pb.id)) });
    },
  };
  const client = { from: (table: string) => (assert.equal(table, "purchase_bills"), builder) };
  return client as unknown as Client;
}

const NYKO = "company-nyko";
const RUGARA = "company-rugara";

function row(over: Partial<BillCompanyRow> & { id: string; company_id: string }): BillCompanyRow {
  return {
    vendor_invoice_no: null,
    invoice_date: null,
    invoice_recv_date: null,
    source: null,
    source_id: null,
    total_amt: 0,
    created_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

function purchaseRow(id: string, company: string, amount: number, invoice: string, date = "2026-10-01", sourceId = `pb-${id}`): BillCompanyRow {
  return row({ id, company_id: company, total_amt: amount, vendor_invoice_no: invoice, invoice_date: date, source: "purchase_bill", source_id: sourceId });
}

test("the document's own company wins even when the item rows sit elsewhere", async () => {
  const rows = [purchaseRow("b1", NYKO, 400, "INV-3", "2026-10-03", "pb-1"), purchaseRow("b2", RUGARA, 600, "INV-3", "2026-10-03", "pb-2")];
  // purchase_bills says BOTH items were registered in Nyko.
  const owners = await resolveBillCompanyOwners(fakeClient([{ id: "pb-1", company_id: NYKO }, { id: "pb-2", company_id: NYKO }]), rows);
  assert.equal(owners.get("b1"), NYKO);
  assert.equal(owners.get("b2"), NYKO, "the Rugara row must follow the document, not its own company_id");
});

test("legacy rows with disagreeing stamps fall back to the biggest share", async () => {
  const rows = [purchaseRow("b1", NYKO, 1000, "INV-1", "2026-10-01", "pb-1"), purchaseRow("b2", NYKO, 1000, "INV-1", "2026-10-01", "pb-2"), purchaseRow("b3", RUGARA, 500, "INV-1", "2026-10-01", "pb-3")];
  const owners = await resolveBillCompanyOwners(
    fakeClient([
      { id: "pb-1", company_id: NYKO },
      { id: "pb-2", company_id: NYKO },
      { id: "pb-3", company_id: RUGARA },
    ]),
    rows
  );
  assert.deepEqual([owners.get("b1"), owners.get("b2"), owners.get("b3")], [NYKO, NYKO, NYKO]);
});

test("the same vendor invoice number on two dates stays two documents", async () => {
  const rows = [purchaseRow("b1", NYKO, 100, "INV-4", "2026-09-01", "pb-1"), purchaseRow("b2", RUGARA, 200, "INV-4", "2026-10-05", "pb-2")];
  const owners = await resolveBillCompanyOwners(fakeClient([{ id: "pb-1", company_id: NYKO }, { id: "pb-2", company_id: RUGARA }]), rows);
  assert.equal(owners.get("b1"), NYKO);
  assert.equal(owners.get("b2"), RUGARA, "a reused invoice number in another financial year is a different bill");
});

test("one-row documents (courier / duty / manual) keep their own company", async () => {
  const rows = [
    row({ id: "f1", company_id: RUGARA, vendor_invoice_no: "CR-9", source: "freight_bill", source_id: "f-1", total_amt: 900 }),
    row({ id: "m1", company_id: NYKO, vendor_invoice_no: "CR-9", total_amt: 900 }),
  ];
  const owners = await resolveBillCompanyOwners(fakeClient([]), rows);
  assert.equal(owners.get("f1"), RUGARA);
  assert.equal(owners.get("m1"), NYKO);
});

test("billInvoiceKey groups purchase invoices by number + date", () => {
  assert.equal(billInvoiceKey(purchaseRow("b1", NYKO, 1, "INV-7", "2026-10-01")), "pb|inv-7|2026-10-01");
  assert.notEqual(
    billInvoiceKey(purchaseRow("b1", NYKO, 1, "INV-7", "2026-10-01")),
    billInvoiceKey(purchaseRow("b2", NYKO, 1, "INV-7", "2026-10-02"))
  );
  assert.equal(billInvoiceKey(row({ id: "x", company_id: NYKO, vendor_invoice_no: "INV-7", source: "freight_bill" })), "row|x");
});

test("fetchBillsInCompanyView pulls the split invoice's other rows in, then keeps one company", async () => {
  const nykoRow = purchaseRow("b1", NYKO, 1000, "INV-1", "2026-10-01", "pb-1");
  const rugaraRow = purchaseRow("b2", RUGARA, 500, "INV-1", "2026-10-01", "pb-2");
  const calls: { companyIds: string[]; invoiceNos?: string[] }[] = [];

  const result = await fetchBillsInCompanyView({
    supabase: fakeClient([
      { id: "pb-1", company_id: NYKO },
      { id: "pb-2", company_id: NYKO },
    ]),
    viewCompanyIds: [NYKO],
    allCompanyIds: [NYKO, RUGARA],
    fetch: async (companyIds, invoiceNos) => {
      calls.push({ companyIds, invoiceNos });
      if (!invoiceNos) return [nykoRow];
      return [rugaraRow];
    },
  });

  assert.deepEqual(calls, [{ companyIds: [NYKO], invoiceNos: undefined }, { companyIds: [RUGARA], invoiceNos: ["INV-1"] }], "the sibling read is limited to the invoices in view");
  assert.deepEqual(result.map((r) => r.id), ["b1", "b2"], "the whole invoice comes back together");
  assert.ok(result.every((r) => r.company_id === NYKO), "and only in the company that registered the bill");
});

test("fetchBillsInCompanyView skips the sibling read when nothing is split", async () => {
  const calls: (string[] | undefined)[] = [];
  const result = await fetchBillsInCompanyView({
    supabase: fakeClient([]),
    viewCompanyIds: [NYKO],
    allCompanyIds: [NYKO, RUGARA],
    fetch: async (_companyIds, invoiceNos) => {
      calls.push(invoiceNos);
      return [row({ id: "f1", company_id: NYKO, vendor_invoice_no: "CR-9", source: "freight_bill", source_id: "f-1", total_amt: 100 })];
    },
  });
  assert.deepEqual(calls, [undefined], "a courier bill never triggers a second read");
  assert.deepEqual(result.map((r) => r.id), ["f1"]);
});
