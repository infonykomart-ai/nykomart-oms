// WooCommerce REST API connector. Chosen as the FIRST connector to build
// because it needs no OAuth dance — just a consumer key + secret generated
// once in WP Admin (WooCommerce -> Settings -> Advanced -> REST API ->
// "Add key", permissions = Read). Get those two values and this file
// works with zero other setup.
//
// Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/#orders

import type { MarketplaceConnector, NormalizedOrder } from "./types";

type WooOrder = {
  id: number;
  date_created: string;
  currency: string;
  total: string;
  billing: {
    first_name: string;
    last_name: string;
    address_1: string;
    address_2: string;
    city: string;
    state: string;
    postcode: string;
    country: string;
    phone: string;
    email: string;
  };
  line_items: Array<{ name: string; quantity: number; sku: string }>;
};

export class WooCommerceConnector implements MarketplaceConnector {
  constructor(
    private storeUrl: string,      // e.g. "https://nykomart.com" — no trailing slash
    private consumerKey: string,
    private consumerSecret: string
  ) {}

  async fetchNewOrders(since: Date): Promise<NormalizedOrder[]> {
    const results: NormalizedOrder[] = [];
    let page = 1;
    const perPage = 50;

    while (true) {
      const url = new URL(`${this.storeUrl}/wp-json/wc/v3/orders`);
      url.searchParams.set("after", since.toISOString());
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));
      url.searchParams.set("status", "processing,completed"); // skip carts/pending-payment/cancelled

      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString("base64");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Basic ${auth}` },
      });

      if (!res.ok) {
        throw new Error(`WooCommerce API error ${res.status}: ${await res.text()}`);
      }

      const orders: WooOrder[] = await res.json();
      if (orders.length === 0) break;

      for (const o of orders) {
        const addressParts = [
          o.billing.address_1,
          o.billing.address_2,
          o.billing.city,
          o.billing.state,
          o.billing.postcode,
          o.billing.country,
        ].filter(Boolean);

        results.push({
          marketplaceOrderNo: String(o.id),
          orderDate: o.date_created.slice(0, 10),
          buyerNameAddress: `${o.billing.first_name} ${o.billing.last_name}\n${addressParts.join(", ")}`,
          contactNo: o.billing.phone || null,
          emailId: o.billing.email || null,
          qty: o.line_items.reduce((sum, li) => sum + li.quantity, 0) || 1,
          skuLabel: o.line_items.map((li) => li.sku || li.name).join(", ") || null,
          orderCurrency: o.currency,
          orderValueOriginal: parseFloat(o.total),
          addressType: "Residential",
          rawPayload: o,
        });
      }

      if (orders.length < perPage) break; // last page
      page += 1;
    }

    return results;
  }
}
