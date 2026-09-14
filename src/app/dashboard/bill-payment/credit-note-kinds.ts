// Shared, pure vocabulary for the TWO kinds of credit notes
// ("BHAI 2 PARKAR KE CREDIT NOTE HONGE") and the GST slabs that go with
// them. Lives OUTSIDE the "use server" actions file because Server Action
// modules may only export async functions — the panel (client) and the
// actions (server) both import from here, so the numbers exist in exactly
// one place.

export type CnKind = "buyer_refund" | "supplier";

/**
 * "PURCHASE BILL JISME COTTON CLOTH RUG ... US PAR 5% GST LAGEGA, AGAR
 * KURTI KA AMMOUNT PURCHASE ME 1000 SE JYADA KA AMMOUNT HAI PER PCS KA TO
 * PHIR 12% LAGEGA, LEKIN AGAR OFFICE EXPANCES OR BAKI SABHI PAR 18% GST
 * LAGEGA" + courier CNs: "JISME AMMOUNT + 18 GST LAGTA HAI" — the user's
 * own slab table, expressed in the app's INDIVIDUAL cgst/sgst-rate
 * convention (total GST = double the stored rate, same as
 * purchase_bills.gst_rate_pct):
 *   total  5% → stored 2.5  (rugs / cotton cloth purchase)
 *   total 12% → stored 6    (kurti > Rs.1000 per pc purchase)
 *   total 18% → stored 9    (ALL courier/duty CNs; office & other)
 * Returned as the panel's PRE-SELECTED rate — always editable, since a
 * party's own CN can cite a different rate than their bill did.
 */
export function defaultGstRatePct(invoiceType: string | null): number {
  return invoiceType === "FREIGHT INVOICE" || invoiceType === "DUTY TAX" ? 9 : 2.5;
}

export const SUPPLIER_GST_OPTIONS: { value: number; total: number; label: string }[] = [
  { value: 2.5, total: 5, label: "5% — rugs / cloth" },
  { value: 6, total: 12, label: "12% — kurti > ₹1000/pc" },
  { value: 9, total: 18, label: "18% — courier / other" },
];

export function cnKindLabel(kind: string | null): string {
  if (kind === "buyer_refund") return "Buyer refund";
  if (kind === "supplier") return "Supplier / courier";
  return "—";
}
