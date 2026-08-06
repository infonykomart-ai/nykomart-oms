// Origin declaration text (bottom-of-invoice) — auto-selected by the
// order's destination country, per claude/invoice-origin-declarations-and-
// numbering.md section 1. Always editable afterward on the invoice itself
// (stored in sales_invoices.origin_declaration, not regenerated), same
// "generate once, never auto-resync" convention as HR Letters.
//
// Source: "Indian Exporter Origin Declarations Under Various Trade
// Agreements.docx". REX Registration Number is fixed/shared across all 3
// companies (confirmed against the real sample invoices).

const REX_NUMBER = "INREX1313001503EC024";

const EU_GROUP = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark", "Estonia",
  "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania",
  "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia",
  "Spain", "Sweden", "Albania", "Andorra", "Belarus", "Bosnia and Herzegovina", "Iceland", "Kosovo",
  "Liechtenstein", "Moldova", "Monaco", "Montenegro", "North Macedonia", "Norway", "San Marino",
  "Serbia", "Switzerland", "Ukraine", "Vatican City",
  // Note: United Kingdom is NOT in this group — it has its own more specific declaration below.
];

const EU_DECLARATION =
  `The exporter (REX Registration Number: ${REX_NUMBER}) of the products covered by this document ` +
  `declares that, unless otherwise clearly indicated, these products are of Indian preferential origin ` +
  `according to rules of origin of the Generalized System of Preferences of the European Union.`;

function fta(agreementName: string): string {
  return (
    `The exporter (REX Registration Number: ${REX_NUMBER}) of the products covered by this document ` +
    `declares that, unless otherwise clearly indicated, these products are of Indian origin according to ` +
    `rules of origin under the ${agreementName}.`
  );
}

// Country name (as typed on the invoice) -> declaration text. Matched
// case-insensitively; unmatched countries return "" (no default — leave
// blank/editable, per the doc).
const COUNTRY_DECLARATIONS: Record<string, string> = {
  "united kingdom": fta("India-United Kingdom Free Trade Agreement"),
  "uk": fta("India-United Kingdom Free Trade Agreement"),
  "uae": fta("India-United Arab Emirates Comprehensive Economic Partnership Agreement (CEPA)"),
  "united arab emirates": fta("India-United Arab Emirates Comprehensive Economic Partnership Agreement (CEPA)"),
  "malaysia": fta("India-Malaysia CECA"),
  "australia": fta("India-Australia Economic Cooperation and Trade Agreement (ECTA)"),
  "mexico": fta("India-Mexico trade framework / USMCA"),
  "canada": fta("USMCA and/or NAFTA"),
  "south korea": fta("India-South Korea CEPA"),
  "korea, south": fta("India-South Korea CEPA"),
  "japan": fta("India-Japan EPA"),
  "singapore": fta("India-Singapore CECA"),
  "thailand": fta("ASEAN-India Free Trade Agreement (AIFTA)"),
  "mauritius": fta("India-Mauritius trade and investment cooperation agreements"),
  "chile": fta("India-Chile CEPA"),
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
