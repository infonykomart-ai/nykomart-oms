// 2026-08-12 (round 10): "DEBIT NOTE ME PARTY SELECTION ME ONLY PURCHASE
// PARTY AARI HAI AGAR COURIOR COMPANY KO DEBIT NOTE JARI KARENGE TO" —
// turned out every Document Entry form already gets the SAME unfiltered
// `parties` list (see documents/page.tsx:59 and page.tsx's DocumentsPage
// query) — there was never a code filter hiding couriers. The real
// problem was findability: a long flat alphabetical list buries the 7
// courier parties among 30+ purchase vendors. This groups the dropdown
// into optgroups instead of filtering anything out.
export type PartyOption = { id: string; name: string; invoice_type: string | null; party_type: string | null };

export type PartyGroup = { label: string; parties: PartyOption[] };

export function groupPartyOptions(parties: PartyOption[]): PartyGroup[] {
  const courier: PartyOption[] = [];
  const purchase: PartyOption[] = [];
  const other: PartyOption[] = [];

  for (const p of parties) {
    if (p.invoice_type === "FREIGHT INVOICE" || p.invoice_type === "DUTY TAX" || p.party_type === "Courier") {
      courier.push(p);
    } else if (p.invoice_type === "Purchase") {
      purchase.push(p);
    } else {
      other.push(p);
    }
  }

  const groups: PartyGroup[] = [];
  if (courier.length) groups.push({ label: "🚚 Courier", parties: courier });
  if (purchase.length) groups.push({ label: "📦 Purchase / Vendor", parties: purchase });
  if (other.length) groups.push({ label: "Other", parties: other });
  return groups;
}
