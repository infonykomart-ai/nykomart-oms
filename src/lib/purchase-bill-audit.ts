// 2026-10-21 — the edit-history diff for a Purchase Bill, kept pure and out of
// the server-action file so it can be tested without a database.
//
// updatePurchaseBill() snapshots the row BEFORE the write and the values it is
// about to write, then logs only the fields that actually MOVED (logAudit's
// documented {field: {from, to}} shape). Without the label map the Admin's
// History panel would read "gst_rate_pct: 5 → 0", which is not something a
// non-developer should have to decode.

/** Every field the History panel audits, with the label it is shown under. */
export const PURCHASE_BILL_AUDIT_LABELS: Record<string, string> = {
  vendor_party_id: "Vendor",
  vendor_invoice_no: "Vendor Invoice No.",
  vendor_invoice_date: "Invoice Date",
  qty: "Qty",
  sq_feet: "Sq. Feet",
  qty_unit: "Unit",
  work_description: "Work / Item",
  unit_rate: "Rate / Unit",
  gst_rate_pct: "GST %",
  gst_type: "GST Type",
  round_off_amt: "Round Off",
  // Only ever present on the "created" entry (the value the bill posted at
  // entry time); an edit never carries it, so a normal update diff simply
  // never includes this key. Kind: "what did they enter it at" is the one
  // number most worth keeping in the chain.
  grand_total: "Total (incl. GST)",
};

export type PurchaseBillChange = { label: string; from: unknown; to: unknown };

/**
 * Only the fields whose value actually changed, as {field: {label, from, to}}.
 *
 * Compared via String() on both sides on purpose: Postgres hands numbers back
 * as `number` while the form path may produce "5" for the same edit, and a
 * spurious "5 → 5" entry would make the chain unreadable. `null` and "" are
 * both treated as "empty" so clearing a description is one change, not two.
 */
export function purchaseBillChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, PurchaseBillChange> {
  const changes: Record<string, PurchaseBillChange> = {};
  for (const key of Object.keys(PURCHASE_BILL_AUDIT_LABELS)) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (from == null && (to == null || to === "")) continue;
    if (to == null && from === "") continue;
    if (String(from) === String(to)) continue;
    changes[key] = { label: PURCHASE_BILL_AUDIT_LABELS[key], from, to };
  }
  return changes;
}
