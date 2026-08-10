// Every marketplace connector (WooCommerce, Amazon, Etsy, eBay, Walmart)
// implements this ONE interface. The sync job (src/app/api/cron/
// sync-orders/route.ts) only ever talks to this shape — it never knows
// about WooCommerce's JSON structure vs. Amazon SP-API's XML-ish quirks.
// Adding a new marketplace later = writing one new file that implements
// this interface, nothing else changes.

export type NormalizedOrder = {
  // The marketplace's own order id — this is what goes into
  // orders.marketplace_order_no, and is also the de-duplication key so
  // the same order is never inserted twice on repeated syncs.
  marketplaceOrderNo: string;
  orderDate: string;              // ISO date, e.g. "2026-08-08"
  buyerNameAddress: string;       // matches orders.buyer_name_address (free text, see SCHEMA_NOTES.md #3)
  contactNo: string | null;
  emailId: string | null;
  qty: number;
  skuLabel: string | null;        // raw SKU/title text from the marketplace; matched against `skus` later if possible
  orderCurrency: string;          // ISO 4217, e.g. "USD"
  orderValueOriginal: number;
  addressType: "Residential" | "Commercial";
  rawPayload: unknown;            // full original API response, stored as-is for audit/debugging
};

export interface MarketplaceConnector {
  /**
   * Fetch every order placed after `since`. Implementations should page
   * through the marketplace's API until exhausted and return everything —
   * the caller (sync route) handles de-duplication and DB writes, not the
   * connector.
   */
  fetchNewOrders(since: Date): Promise<NormalizedOrder[]>;
}
