import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvoiceDocument,
  buildOrderDocument,
  documentFileName,
  documentTotals,
  DOCUMENT_KINDS,
  LINES_PER_PAGE,
  DOCUMENT_TITLES,
  formatMoney,
  isDocumentKind,
  paginateLines,
  showsPrices,
  showsTaxColumns,
  type DocumentLine,
  type OrderSource,
} from "./order-document";

// 2026-11-22d — Phase 4: rules behind the Order / Invoice / Tax Invoice /
// Packing List PDFs (pure — no DB, no React, no PDF renderer).

function line(overrides: Partial<DocumentLine> = {}): DocumentLine {
  return {
    refNo: "PO-0001",
    description: null,
    sku: "RUG-1",
    size: "160x230",
    colour: "Beige",
    hsn: null,
    qty: 2,
    amount: 10,
    currency: "USD",
    amountInr: 830,
    ...overrides,
  };
}

function order(overrides: Partial<OrderSource> = {}): OrderSource {
  return {
    ref_no: "PO-0001",
    order_date: "2026-11-20",
    buyer_name_address: "Jane Doe, 12 High St, London",
    contact_no: "+44 7000 000000",
    destination_country: "United Kingdom",
    sku_label: "RUG-1",
    size_label: "160x230",
    colour: "Beige",
    qty: 2,
    order_currency: "USD",
    order_value_original: 10,
    order_value_inr: 830,
    photo_urls: ["https://cdn/main.jpg", "https://cdn/close-1.jpg"],
    ...overrides,
  };
}

test("only the four document kinds are accepted", () => {
  for (const kind of DOCUMENT_KINDS) assert.equal(isDocumentKind(kind), true);
  for (const value of ["", "Order", "tax_invoice", null, 3]) assert.equal(isDocumentKind(value), false);
});

test("each kind has its own title and column rules", () => {
  assert.deepEqual(
    DOCUMENT_KINDS.map((kind) => DOCUMENT_TITLES[kind]),
    ["Order Sheet", "Invoice", "Tax Invoice", "Packing List"]
  );
  assert.equal(showsPrices("packing-list"), false);
  for (const kind of ["order", "invoice", "tax-invoice"] as const) assert.equal(showsPrices(kind), true);
  assert.equal(showsTaxColumns("tax-invoice"), true);
  for (const kind of ["order", "invoice", "packing-list"] as const) assert.equal(showsTaxColumns(kind), false);
});

test("totals add money per currency and round to 2 decimals", () => {
  const totals = documentTotals([
    line({ amount: 10.005 }),
    line({ amount: 5.555 }),
  ]);
  assert.equal(totals.qty, 4);
  assert.deepEqual(totals.money, [{ currency: "USD", amount: 15.56 }]);
  assert.equal(totals.mixedCurrency, false);
  assert.equal(totals.inr, 1660);
});

test("totals never add different currencies together", () => {
  const totals = documentTotals([
    line({ amount: 10, currency: "USD", amountInr: 830 }),
    line({ amount: 20, currency: "GBP", amountInr: 2100 }),
  ]);
  assert.equal(totals.mixedCurrency, true);
  assert.deepEqual(totals.money, [
    { currency: "GBP", amount: 20 },
    { currency: "USD", amount: 10 },
  ]);
  // INR is only reported when every line has a stored equivalent.
  assert.equal(totals.inr, 2930);
});

test("a missing INR equivalent makes the INR total unknown, not zero", () => {
  const totals = documentTotals([line({ amountInr: 830 }), line({ amountInr: null })]);
  assert.equal(totals.inr, null);
});

test("lines without a recorded value are counted in qty only", () => {
  const totals = documentTotals([line({ amount: null, amountInr: null })]);
  assert.equal(totals.qty, 2);
  assert.deepEqual(totals.money, []);
  assert.equal(totals.inr, null);
});

test("an order sheet uses the order reference, and its close-up list is carried over", () => {
  const model = buildOrderDocument({
    kind: "order",
    order: order(),
    company: { name: "NYKO MART", logo_url: "https://cdn/logo.png" },
    profile: { address: "Delhi", phone: "011", email: "ops@nyko.test", gstin: "07AAAA" },
    hsnCode: "5703",
    storeName: "Main Store",
  });
  assert.equal(model.title, "Order Sheet");
  assert.equal(model.docNo, "PO-0001");
  assert.equal(model.docDate, "2026-11-20");
  assert.equal(model.lines.length, 1);
  assert.equal(model.lines[0].hsn, "5703");
  assert.equal(model.showPrices, true);
  assert.equal(model.company.name, "NYKO MART");
  assert.equal(model.company.logoUrl, "https://cdn/logo.png");
  assert.deepEqual(model.photos, ["https://cdn/main.jpg", "https://cdn/close-1.jpg"]);
  assert.deepEqual(model.totals.money, [{ currency: "USD", amount: 10 }]);
});

test("an invoice document uses the invoice number and date, not the order's", () => {
  const model = buildOrderDocument({
    kind: "invoice",
    order: order(),
    invoice: { invoice_no: "INV-0007", invoice_date: "2026-11-21", master_invoice_no: "M-1" },
  });
  assert.equal(model.docNo, "INV-0007");
  assert.equal(model.docDate, "2026-11-21");
  assert.equal(model.secondaryNo, "M-1");
  assert.equal(model.title, "Invoice");
});

test("a packing list keeps quantities and photos but no money", () => {
  const model = buildInvoiceDocument({
    kind: "packing-list",
    invoice: { invoice_no: "INV-0007", invoice_date: "2026-11-21" },
    orders: [order(), order({ ref_no: "PO-0002", qty: 3 })],
  });
  assert.equal(model.showPrices, false);
  assert.equal(model.totals.qty, 5);
  assert.deepEqual(model.totals.money, []);
  assert.equal(model.totals.inr, null);
  assert.equal(model.lines.length, 2);
  assert.equal(model.photos.length, 2);
});

test("a tax invoice exposes HSN per line", () => {
  const model = buildInvoiceDocument({
    kind: "tax-invoice",
    invoice: { invoice_no: "INV-0007", invoice_date: "2026-11-21" },
    orders: [order()],
    hsnByRef: { "PO-0001": "5703" },
  });
  assert.equal(model.showTaxColumns, true);
  assert.equal(model.lines[0].hsn, "5703");
});

test("a multi-currency invoice reports no single currency", () => {
  const model = buildInvoiceDocument({
    kind: "invoice",
    invoice: { invoice_no: "INV-0007", invoice_date: "2026-11-21" },
    orders: [order(), order({ ref_no: "PO-0002", order_currency: "GBP" })],
  });
  assert.equal(model.currency, null);
  assert.equal(model.totals.mixedCurrency, true);
});

test("photos are de-duplicated across the invoice's orders", () => {
  const model = buildInvoiceDocument({
    kind: "invoice",
    invoice: { invoice_no: "INV-0007", invoice_date: "2026-11-21" },
    orders: [order(), order({ ref_no: "PO-0002" })],
  });
  assert.deepEqual(model.photos, ["https://cdn/main.jpg", "https://cdn/close-1.jpg"]);
});

test("file names are document-type prefixed and filesystem-safe", () => {
  assert.equal(documentFileName({ kind: "invoice", docNo: "INV-0007" }), "INVOICE-INV-0007.pdf");
  assert.equal(documentFileName({ kind: "tax-invoice", docNo: "INV/2026 07" }), "TAX-INVOICE-INV-2026-07.pdf");
  assert.equal(documentFileName({ kind: "packing-list", docNo: "  " }), "PACKING-LIST-document.pdf");
  assert.equal(documentFileName({ kind: "order", docNo: "PO-0001-1/2" }), "ORDER-SHEET-PO-0001-1-2.pdf");
});

test("paginateLines splits explicitly, including the empty and exact-fit cases", () => {
  assert.deepEqual(paginateLines([]), [[]]);
  assert.deepEqual(paginateLines([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(paginateLines([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
  assert.deepEqual(paginateLines([1, 2, 3], 0), [[1, 2, 3]]);
  assert.equal(paginateLines(Array.from({ length: 55 }, (_, i) => i)).length, Math.ceil(55 / LINES_PER_PAGE));
  assert.equal(LINES_PER_PAGE, 20);
});

test("formatMoney groups thousands and never prints NaN", () => {
  assert.equal(formatMoney(1234.5), "1,234.50");
  assert.equal(formatMoney(0), "0.00");
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(Number.NaN), "—");
});
