// Origin declaration text (bottom-of-invoice) — auto-selected by the
// order's destination country. Always editable afterward on the invoice
// itself (stored in sales_invoices.origin_declaration, not regenerated),
// same "generate once, never auto-resync" convention as HR Letters.
//
// Source: "Indian Exporter Origin Declarations Under Various Trade
// Agreements.docx" (re-uploaded 2026-08-11 to verify exact wording per
// country). REX Registration Number is fixed/shared across all 3
// companies (confirmed against the real sample invoices).
//
// 2026-08-11 history: briefly simplified to "EU only, blank for
// everything else" per "UK ME DECLARATION USA VALI AANE DO" — then
// explicitly reverted the same day ("DECLARATION UPDATE ALL" -> "Restore
// per-country FTA declarations for all countries") after re-checking
// against the source doc, which does give UK (and each of these other
// countries) its own specific FTA declaration, distinct from the EU's
// generic GSP wording. Every declaration below is copied verbatim from
// that doc (only the REX number prefix is added, per the real sample
// invoices).
const REX_NUMBER = "INREX1313001503EC024";

// "European Union (EU) Countries" list, exactly as the source doc has it —
// note this deliberately INCLUDES non-EU-customs-union countries (Norway,
// Switzerland, the Balkans, Ukraine, etc.) per the doc's own definition of
// "Europe" for THIS declaration purpose. This is intentionally broader
// than pid.ts's EU_27 (which is the real, narrower EU-customs-union list
// the PID/product-identifier rule legally applies to) — two different
// rules, two different country scopes, both taken from their own
// authoritative source. United Kingdom is excluded here even though the
// doc's heading nominally lists it — the doc gives UK its own separate,
// more specific declaration below, which takes precedence.
const EU_GROUP = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Czechia", "Denmark",
  "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia",
  "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia",
  "Slovenia", "Spain", "Sweden", "Albania", "Andorra", "Belarus", "Bosnia and Herzegovina", "Iceland",
  "Kosovo", "Liechtenstein", "Moldova", "Monaco", "Montenegro", "North Macedonia", "Norway",
  "San Marino", "Serbia", "Switzerland", "Ukraine", "Vatican City",
];

function withRex(text: string): string {
  return `The exporter (REX Registration Number: ${REX_NUMBER}) ${text}`;
}

const EU_DECLARATION = withRex(
  "of the products covered by this document declares that, unless otherwise clearly indicated, " +
    "these products are of Indian preferential origin according to rules of origin of the " +
    "Generalized System of Preferences of the European Union."
);

// Country name (as typed on the invoice) -> declaration text, copied
// verbatim from the source doc's own wording per country (deliberately
// NOT run through one generic template — the doc's phrasing genuinely
// differs country to country, e.g. Mauritius/Mexico/Canada use different
// sentence structure than the CEPA/ECTA/CECA countries). Matched
// case-insensitively; unmatched countries (including USA) return "" — no
// FTA/preferential declaration exists for the US, intentionally absent,
// not a gap.
const COUNTRY_DECLARATIONS: Record<string, string> = {
  "united kingdom": withRex(
    "of the products covered by this document declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-United Kingdom " +
      "Free Trade Agreement."
  ),
  "uk": withRex(
    "of the products covered by this document declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-United Kingdom " +
      "Free Trade Agreement."
  ),
  "uae": withRex(
    "of the products covered by this document declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-United Arab " +
      "Emirates Comprehensive Economic Partnership Agreement (CEPA)."
  ),
  "united arab emirates": withRex(
    "of the products covered by this document declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-United Arab " +
      "Emirates Comprehensive Economic Partnership Agreement (CEPA)."
  ),
  "malaysia": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-Malaysia CECA."
  ),
  "australia": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-Australia " +
      "Economic Cooperation and Trade Agreement (ECTA)."
  ),
  "mexico": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian origin and comply with the rules of origin under the India-Mexico " +
      "trade framework in the context of the United States-Mexico-Canada Agreement (USMCA)."
  ),
  "canada": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian origin and comply with the relevant rules of origin under the " +
      "United States-Mexico-Canada Agreement (USMCA) and/or the former North American Free Trade " +
      "Agreement (NAFTA)."
  ),
  "south korea": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-South Korea " +
      "Comprehensive Economic Partnership Agreement (CEPA)."
  ),
  "korea, south": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-South Korea " +
      "Comprehensive Economic Partnership Agreement (CEPA)."
  ),
  "japan": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-Japan Economic " +
      "Partnership Agreement (EPA)."
  ),
  "singapore": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-Singapore " +
      "Comprehensive Economic Cooperation Agreement (CECA)."
  ),
  "thailand": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the ASEAN-India Free Trade " +
      "Agreement (AIFTA)."
  ),
  "mauritius": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian origin and comply with the preferential trade and tax treatment " +
      "provisions under the India-Mauritius trade and investment cooperation agreements."
  ),
  "chile": withRex(
    "of the products covered by this invoice declares that, unless otherwise clearly indicated, " +
      "these products are of Indian preferential origin in accordance with the India-Chile " +
      "Comprehensive Economic Partnership Agreement (CEPA)."
  ),
  // USA: no FTA/preferential declaration exists — intentionally absent, not a gap.
};

export function originDeclarationFor(destinationCountry: string | null | undefined): string {
  const c = (destinationCountry ?? "").trim().toLowerCase();
  if (!c) return "";
  if (c === "usa" || c === "us" || c === "united states" || c === "united states of america") return "";
  if (COUNTRY_DECLARATIONS[c]) return COUNTRY_DECLARATIONS[c];
  if (EU_GROUP.some((n) => n.toLowerCase() === c)) return EU_DECLARATION;
  return "";
}
