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
//   3. Standardised Manufacturer Product ID (GTIN/EAN/ISBN) — only if one
//      exists (exact label per the guide's own column headers).
//
// User-approved defaults (2026-08-10, since none of this app's products
// have a separate manufacturer code or GTIN tracked anywhere):
//   Merchant Product ID = the order's own sku_label.
//   Non-Standardised Manufacturer Product ID = same sku_label (reused,
//     not a distinct value — there's nowhere else to get one from).
//   Standardised Manufacturer Product ID = "NO" (no GTIN/EAN/ISBN tracked).
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
// This is EU-customs-union-specific — deliberately narrower than a general
// "Europe" list (excludes non-EU countries like Switzerland/Norway/UK/
// Balkan states, which are outside the EU customs union PIDs apply to).
// PIDs only apply to the actual 27 EU member states. Exported so
// origin-declaration.ts can share the SAME "is this the EU" check — "sabhi
// chije according to buyer destination map hojaye" (2026-08-10) — instead
// of maintaining two slightly different European country lists.
export const EU_27 = [
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

// 2026-08-11: user corrected the label to match the source guide's own
// column headers exactly — "Standardised Manufacturer Product ID", not
// "Standardised Product ID". Also switched from a single suffix string
// appended under the item description to 3 SEPARATE COLUMNS in the item
// table ("...COLLOM IN INVOICE") — see invoice-view.tsx's item table,
// gated on isEuDestination like everything else PID-related.
export function merchantProductId(skuLabel: string | null | undefined): string {
  return (skuLabel ?? "").trim() || "N/A";
}

export function nonStandardisedManufacturerProductId(skuLabel: string | null | undefined): string {
  // Reused from the SKU — there's no separate manufacturer/supplier code
  // tracked anywhere in this app, same 2026-08-10 user-approved default.
  return merchantProductId(skuLabel);
}

export function standardisedManufacturerProductId(): string {
  // No GTIN/EAN/ISBN tracked anywhere in this app — "NO" is the guide's
  // own documented fallback text for "not having the 3rd PID".
  return "NO";
}
