// Invoice value breakdown — 2026-08-10. See db/2026-08-10-invoice-value-
// breakdown.sql's header comment for the full derivation; this file is the
// single source of truth for the formula so it's identical for every
// company/store ("sabhi company me yahi fanda rahega").
//
// Verified against a real sample invoice (NL1712627.pdf):
//   Order was on a store whose invoice_value_usd worked out to $138.60.
//   COST=41.58, INSURANCE=0.75, FREIGHT=96.27, TOTAL=138.60 — every number
//   below reproduces that exactly: 0.30*138.60=41.58; freight = 138.60 -
//   41.58 - 0.75 = 96.27 (the BALANCING remainder, not an independent %
//   — see the SQL migration's comment for why "69.25%" as a literal
//   multiplier would NOT reproduce the sample).
//
// 2026-08-11: made currency-agnostic. The formula was always just
// arithmetic on a number V (30% / flat 0.75 / remainder) — it never
// actually required V to be in USD. The caller now passes orderValueSum
// in the ORDER'S OWN order_currency (order_value_original), not always
// order_value_usd, per the user's explicit choice to have CSB-V invoices
// follow the order's original currency instead of forcing USD. For a
// USD order, order_value_original === order_value_usd, so this is a
// zero-behavior-change no-op for every invoice this formula was originally
// verified against. The flat "0.75" insurance figure is applied literally
// as 0.75 IN WHATEVER CURRENCY V IS (same flat-figure convention as
// before, just no longer hardcoded to mean USD specifically) — it is NOT
// FX-converted from a "true" $0.75 into the invoice currency. Field/const
// names below keep their historical "Usd" naming for compatibility with
// existing callers and the `invoice_value_usd` DB column (see
// db/2026-08-11-order-tax-destination-and-invoice-currency.sql's comment
// on that column) — the actual currency is recorded separately as
// invoice_currency on sales_invoices.

export const ITEM_COST_FRACTION = 0.3; // of invoice value (V)
export const FLAT_INSURANCE_USD = 0.75; // literal flat figure, in whatever currency V is — see note above

// Every marketplace is 60% of order value for now — Amazon was 60% from
// the original spec; Etsy/eBay/Website were originally 80%, then
// corrected 2026-08-10 ("Etsy/Website/eBay → 60% kar do") to match Amazon.
// `storeName` is kept as the function's input (rather than dropping this
// to a bare constant elsewhere in the codebase) so a future per-platform
// split is a one-line change here, in the single place this percentage is
// decided — see db/schema.sql's stores seed data for how store names
// reliably contain the platform name (e.g. "Amazon Arts of Jaipur",
// "Etsy The Rugara", "Ebay Casa Arra", "CASA ARRA (Website)").
export function valuePercentForStore(storeName: string): number {
  void storeName;
  return 60;
}

export type ValueBreakdown = {
  valuePercent: number;
  invoiceValueUsd: number; // "V" / "Total"
  itemCostTotal: number;
  insuranceTotal: number;
  freightTotal: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * orderValueSum = sum of order_value_original (in the invoice's own
 * currency — see generateInvoiceCore's currency-uniformity validation)
 * across every order in this invoice batch. All orders in one invoice
 * always share the same store (see generateInvoiceCore's same-store
 * validation) so one valuePercent applies to the whole invoice.
 */
export function computeValueBreakdown(orderValueSum: number, storeName: string): ValueBreakdown {
  const valuePercent = valuePercentForStore(storeName);
  const invoiceValueUsd = round2(orderValueSum * (valuePercent / 100));
  const itemCostTotal = round2(invoiceValueUsd * ITEM_COST_FRACTION);
  const insuranceTotal = FLAT_INSURANCE_USD;
  // Balancing remainder — guarantees the 3 line items always sum to
  // EXACTLY invoiceValueUsd, which a real customs invoice requires (no
  // rounding-error gap between the line items and the printed total).
  const freightTotal = round2(invoiceValueUsd - itemCostTotal - insuranceTotal);
  return { valuePercent, invoiceValueUsd, itemCostTotal, insuranceTotal, freightTotal };
}

/**
 * Per-item "Rate"/"Amount" value shown in the invoice's item table — this
 * order's own share of item_cost_total, proportional to its own
 * order_value_original (in the invoice's currency) within the batch.
 * (valuePercent is fixed per invoice, see above, so this is just
 * orderValue * valuePercent/100 * 30%.)
 */
export function itemCostForOrder(orderValue: number, valuePercent: number): number {
  return round2(orderValue * (valuePercent / 100) * ITEM_COST_FRACTION);
}
