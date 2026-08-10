// EU Product Identifiers (PIDs) — 2026-08-10, built from FedEx's official
// "Change to EU import rules: Product Identifiers (PIDs)" guide (accurate
// as of June 9, 2026; the user re-uploaded this exact PDF to confirm
// building it now — it was originally deferred in
// claude/invoice-origin-declarations-and-numbering.md section 1b pending
// this sign-off).
//
// Rule (per FedEx's guide): from 1 Jul 2026 (enforced 1 Nov 2026), EU B2C
// shipments with an item's intrinsic (declared) value not exceeding €150
// require 3 Product Identifiers per line item on the commercial invoice:
//   1. Merchant Product ID — the seller's own SKU/item code.
//   2. Non-Standardised Manufacturer Product ID — a manufacturer/supplier
//      code, no such data tracked in this app.
//   3. Standardised Product ID (GTIN/EAN/ISBN) — only if one exists.
//
// User-approved defaults (2026-08-10, since none of this app's products
// have a separate manufacturer code or GTIN tracked anywhere):
//   Merchant Product ID = the order's own sku_label.
//   Non-Standardised Manufacturer Product ID = same sku_label (reused,
//     not a distinct value — there's nowhere else to get one from).
//   Standardised Product ID = "NO" (no GTIN/EAN/ISBN tracked).
//
// €150 threshold — deliberately NOT converted/checked precisely: this
// app's order values are tracked in USD, not EUR, and a fragile currency-
// threshold check risks the wrong failure mode (a shipment that actually
// needed PIDs printing without them, and per FedEx's own guide: "your
// shipments can't be cleared and your customers won't receive their
// goods"). Since including PIDs on an invoice that technically didn't
// need them is harmless (just slightly more information, not a
// compliance problem), this always includes PIDs for every line item on
// every EU-destination invoice, regardless of declared value. If this
// starts feeling too broad in practice (e.g. large high-value EU B2B
// shipments where PIDs are explicitly not required), revisit with an
// actual EUR conversion at that point.
//
// This is EU-customs-union-specific — deliberately a NARROWER list than
// origin-declaration.ts's EU_GROUP (which also includes non-EU countries
// like Switzerland/Norway/UK/Balkan states for GSP-declaration purposes).
// PIDs only apply to the actual 27 EU member states.
const EU_27 = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark", "Estonia",
  "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania",
  "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia",
  "Spain", "Sweden",
];

export function isEuDestination(destinationCountry: string | null | undefined): boolean {
  const c = (destinationCountry ?? "").trim().toLowerCase();
  if (!c) return false;
  return EU_27.some((n) => n.toLowerCase() === c);
}

/**
 * Formats the 3 PIDs as suggested by FedEx's own guide ("Ensure PIDs are
 * included in the item description field, following the suggested
 * order..."), appended after the item's own description text.
 */
export function pidSuffixFor(skuLabel: string | null | undefined): string {
  const merchantId = (skuLabel ?? "").trim() || "N/A";
  return `Merchant Product ID ${merchantId} Non-Standardised Manufacturer Product ID ${merchantId} Standardised Product ID NO`;
}
