// 2026-10-20 — ONE place that decides what a Purchase Bill's GST figure is,
// shared by the Document Entry list, its A4 preview and the bill statement.
//
// Why this exists at all: purchase_bills.gst_rate_pct has three meanings —
//   >0    a real CGST/SGST (or IGST) rate was picked (2.5/3/4/9),
//   0     the user explicitly picked "No GST" (stored since 2026-10-20,
//         see db/2026-10-20-purchase-bill-no-gst-and-audit.sql),
//   NULL  a legacy bill entered before the GST picker existed, which keeps
//         the historical flat-5% default baked into the
//         g_total_plus_gst generated column.
// Every screen used to re-implement that logic slightly differently (the
// list and the A4 sheet showed the un-taxed base for "No GST" while Bill
// Payment / Party Ledger read g_total_plus_gst, which added 5%), which is
// exactly the mismatch reported on invoice 170 / SHARDA INTERNATIONAL RUGS.
// They now all call these helpers, and the STORED g_total_plus_gst always
// wins so the document can never disagree with the money in Finance.

export type PurchaseBillMoneyFields = {
  total_amount: number | null;
  gst_rate_pct: number | string | null;
  gst_type: string | null;
  round_off_amt: number | null;
  g_total_plus_gst: number | null;
};

/** The stored rate, normalised to a number; 0 means "No GST", non-null. */
export function purchaseGstRate(rate: number | string | null | undefined): number {
  const n = rate == null || rate === "" ? 0 : Number(rate);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** True when this line/invoice actually carries GST. */
export function purchaseHasGst(rate: number | string | null | undefined): boolean {
  return purchaseGstRate(rate) > 0;
}

/** Total GST percentage: 2× the individual CGST/SGST rate, or the IGST rate as-is. */
export function purchaseGstTotalPct(rate: number | string | null | undefined, gstType: string | null | undefined): number {
  const r = purchaseGstRate(rate);
  if (r === 0) return 0;
  return gstType === "IGST" ? r : r * 2;
}

/** GST rupee amount on a taxable (pre-GST) line amount. */
export function purchaseGstAmount(line: PurchaseBillMoneyFields, taxable: number): number {
  const pct = purchaseGstTotalPct(line.gst_rate_pct, line.gst_type);
  return pct === 0 ? 0 : Math.round(taxable * pct) / 100;
}

/**
 * The payable amount for ONE purchase bill row. The stored generated column
 * is authoritative (it is what savePurchaseBillCore mirrors to
 * bill_pass_register); the fallback only covers a caller that somehow lacks
 * it, and follows the exact same formula minus the legacy NULL=5% rule.
 */
export function purchaseBillGrandTotal(r: PurchaseBillMoneyFields): number {
  if (r.g_total_plus_gst != null) return Number(r.g_total_plus_gst);
  const taxable = Number(r.total_amount ?? 0);
  return taxable + purchaseGstAmount(r, taxable) + Number(r.round_off_amt ?? 0);
}

/** "₹1,200 + GST (CGST+SGST 5%) = ₹1,260" / "₹1,200" — the list's amount text. */
export function purchaseBillAmountLabel(r: PurchaseBillMoneyFields): string {
  const taxable = Number(r.total_amount ?? 0);
  const roundOff = Number(r.round_off_amt ?? 0);
  const money = (n: number) => `₹${n.toFixed(2)}`;
  if (purchaseHasGst(r.gst_rate_pct)) {
    const pct = purchaseGstTotalPct(r.gst_rate_pct, r.gst_type);
    return `${money(taxable)} + GST (${r.gst_type === "IGST" ? "IGST" : "CGST+SGST"} ${pct}%)${
      roundOff ? ` ${roundOff > 0 ? "+" : "−"} Round Off ${money(Math.abs(roundOff))}` : ""
    } = ₹${purchaseBillGrandTotal(r).toFixed(2)}`;
  }
  if (roundOff) {
    return `${money(taxable)} ${roundOff > 0 ? "+" : "−"} Round Off ${money(Math.abs(roundOff))} = ₹${purchaseBillGrandTotal(r).toFixed(2)}`;
  }
  return money(purchaseBillGrandTotal(r));
}

/** "20 Oct 2026, 3:42 pm" in IST — the audit line the Admin sees on each invoice. */
export function formatAuditStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
