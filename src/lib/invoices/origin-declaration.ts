// Origin declaration text (bottom-of-invoice) — auto-selected by the
// order's destination country. Always editable afterward on the invoice
// itself (stored in sales_invoices.origin_declaration, not regenerated),
// same "generate once, never auto-resync" convention as HR Letters.
//
// Source: "Indian Exporter Origin Declarations Under Various Trade
// Agreements.docx". REX Registration Number is fixed/shared across all 3
// companies (confirmed against the real sample invoices).
//
// 2026-08-11 simplification, per explicit user correction:
//   "UK ME DECLARATION USA VALI AANE DO" — UK's declaration should be
//   blank/normal like USA's, NOT the UK-FTA-specific text this used to
//   auto-fill.
//   "USA CANADA MEXICO & OTHER (NOT UK & EUROPE) ... DECLEARATION NORMAL"
//   — every destination outside the EU gets a blank/normal declaration,
//   full stop — not just USA. The per-country FTA text this file used to
//   generate for UAE/Malaysia/Australia/Mexico/Canada/South Korea/Japan/
//   Singapore/Thailand/Mauritius/Chile is gone; the preparer can still type
//   in a specific FTA declaration by hand on the invoice's Edit panel for
//   the rare case it's needed — it just isn't auto-generated anymore.
// Only the EU keeps a special auto-filled declaration (the GSP wording
// below), using the SAME "is this the EU" check as the PID feature
// (EU_27, imported from pid.ts) — one shared source of truth instead of
// two slightly different European country lists, per "sabhi chije
// according to buyer destination map hojaye" (2026-08-10).
import { EU_27 } from "./pid";

const REX_NUMBER = "INREX1313001503EC024";

const EU_DECLARATION =
  `The exporter (REX Registration Number: ${REX_NUMBER}) of the products covered by this document ` +
  `declares that, unless otherwise clearly indicated, these products are of Indian preferential origin ` +
  `according to rules of origin of the Generalized System of Preferences of the European Union.`;

export function originDeclarationFor(destinationCountry: string | null | undefined): string {
  const c = (destinationCountry ?? "").trim().toLowerCase();
  if (!c) return "";
  if (EU_27.some((n) => n.toLowerCase() === c)) return EU_DECLARATION;
  return "";
}
