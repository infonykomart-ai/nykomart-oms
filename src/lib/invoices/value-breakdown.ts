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

export const ITEM_COST_FRACTION = 0.3; // of invoice value (V)
export const FLAT_INSURANCE_USD = 0.75;

/**
 * Amazon -> 60%, everything else (Etsy/eBay/Website/etc.) -> 80% — per the
 * user's exact wording ("amazon ka koi order... uska 60%... etsy website
 * ebay ke liye order value ka 80%"). Detected from the store name, which
 * always contains the platform name in this app's data (e.g. "Amazon Arts
 * of Jaipur", "Etsy The Rugara", "Ebay Casa Arra", "CASA ARRA (Website)")
 * — confirmed against every store row in db/schema.sql's seed data.
 */
export function valuePercentForStore(storeName: string): number {
  return storeName.toLowerCase().includes("amazon") ? 60 : 80;
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
 * orderValueUsdSum = sum of order_value_usd across every order in this
 * invoice batch (all orders in one invoice always share the same store —
 * see generateInvoiceCore's same-store validation — so one valuePercent
 * applies to the whole invoice).
 */
export function computeValueBreakdown(orderValueUsdSum: number, storeName: string): ValueBreakdown {
  const valuePercent = valuePercentForStore(storeName);
  const invoiceValueUsd = round2(orderValueUsdSum * (valuePercent / 100));
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
 * order_value_usd within the batch. (valuePercent is fixed per invoice,
 * see above, so this is just orderValueUsd * valuePercent/100 * 30%.)
 */
export function itemCostForOrder(orderValueUsd: number, valuePercent: number): number {
  return round2(orderValueUsd * (valuePercent / 100) * ITEM_COST_FRACTION);
}
