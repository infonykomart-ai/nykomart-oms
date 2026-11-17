// 2026-11-18 — The English product facts the AI may restate but must never
// change (spec §3 "Product accuracy rule"). One type, shared by the form, the
// prompt builder and the export, so a field can never be sent under two names.

export type EtsyProductFacts = {
  productName?: string;
  productType?: string;
  category?: string;
  material?: string;
  technique?: string;
  colour?: string;
  shape?: string;
  pattern?: string;
  sizes?: string;
  thickness?: string;
  weight?: string;
  originCountry?: string;
  reversible?: string;
  backing?: string;
  care?: string;
  customization?: string;
  usage?: string;
  targetCustomer?: string;
  features?: string;
  shipping?: string;
  processingTime?: string;
};

export const PRODUCT_FIELDS: Array<{ key: keyof EtsyProductFacts; label: string; placeholder?: string; multiline?: boolean }> = [
  { key: "productName", label: "Product name", placeholder: "Handmade Cotton Rug" },
  { key: "productType", label: "Product type", placeholder: "Area rug" },
  { key: "material", label: "Main material", placeholder: "100% cotton" },
  { key: "technique", label: "Manufacturing technique", placeholder: "Hand block printed" },
  { key: "colour", label: "Colour", placeholder: "Natural beige with indigo" },
  { key: "shape", label: "Shape", placeholder: "Rectangular" },
  { key: "pattern", label: "Pattern / design", placeholder: "Floral block print" },
  { key: "sizes", label: "Available sizes", placeholder: "60x90 cm, 90x150 cm" },
  { key: "thickness", label: "Thickness", placeholder: "5 mm" },
  { key: "weight", label: "Weight", placeholder: "1.2 kg" },
  { key: "originCountry", label: "Country of origin", placeholder: "India" },
  { key: "reversible", label: "Reversible?", placeholder: "Reversible" },
  { key: "backing", label: "Backing details", placeholder: "No backing" },
  { key: "usage", label: "Intended usage", placeholder: "Living room, bedroom" },
  { key: "targetCustomer", label: "Target customer", placeholder: "Home décor buyers" },
  { key: "care", label: "Care instructions", placeholder: "Gentle hand wash, line dry", multiline: true },
  { key: "customization", label: "Customization options", placeholder: "Custom sizes on request", multiline: true },
  { key: "features", label: "Product features", placeholder: "Lightweight, foldable", multiline: true },
  { key: "shipping", label: "Shipping information", placeholder: "Ships from India", multiline: true },
  { key: "processingTime", label: "Processing time", placeholder: "3–5 business days", multiline: true },
];

/** Facts as an ordered label/value list, empty values dropped. */
export function factLines(facts: EtsyProductFacts): string[] {
  return PRODUCT_FIELDS.map((field) => {
    const value = (facts[field.key] ?? "").toString().trim();
    return value ? `${field.label}: ${value}` : null;
  }).filter((line): line is string => !!line);
}

/** Names of the facts that are missing — shown to the user, never invented. */
export function missingFacts(facts: EtsyProductFacts): string[] {
  return PRODUCT_FIELDS.filter((field) => !(facts[field.key] ?? "").toString().trim()).map((f) => f.label);
}
