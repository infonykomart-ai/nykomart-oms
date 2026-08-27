// 2026-08-27 — user found multi-item/multi-order Purchase Bills (one vendor
// invoice -> N purchase_bills rows, one per item/order, established
// 2026-08-26 — see claude/purchase-bill-multi-item-2026-08-26.md) were
// surfacing as N separate, disconnected entries in every downstream
// bill_pass_register consumer (Approvals L1/L2, Bill Payment, Party
// Ledger) — "jab ek invoice ka part hai to alag alag entry kyu ja rahi...
// approval me bhi ek bill ki 4 entry ja rahi item ke according jo galat
// hai na." This groups those rows back into ONE logical entry per invoice
// for display + bulk actions, without changing how they're stored (each
// item still needs its own purchase_bills + bill_pass_register row for its
// own qty/rate/GST — see db/2026-08-27-note-linking-and-adjustments.sql's
// header and the PCS round's notes for why the storage stays per-item).
//
// Grouping key: (company_id, party_id, vendor_invoice_no) — but ONLY for
// source = 'purchase_bill' rows. That's the one path that inserts more
// than one bill_pass_register row per real-world invoice
// (savePurchaseBillCore in documents/actions.ts, called once per
// item/order in a loop by the Multi-Item and Multi-Order Purchase Bill
// forms). Every other source (Freight/Courier, Duty, Salary, Advance, and
// manual Bill Payment entries — source IS NULL) inserts exactly one row
// per document, so restricting grouping to that one source avoids ever
// accidentally merging two unrelated manual/freight/salary entries that
// happen to reuse an invoice number. A row with no vendor_invoice_no is
// never grouped — always its own singleton group, keyed by its own id.
export type GroupableBill = {
  id: string;
  company_id: string;
  party_id: string | null;
  vendor_invoice_no: string | null;
  source: string | null;
};

export type BillGroup<T> = {
  key: string;
  bills: T[];
  isGroup: boolean; // true when this "group" is actually >1 underlying row
};

export function groupBills<T extends GroupableBill>(bills: T[]): BillGroup<T>[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const bill of bills) {
    const isGroupable = bill.source === "purchase_bill" && !!bill.vendor_invoice_no;
    const key = isGroupable ? `grp:${bill.company_id}|${bill.party_id ?? ""}|${bill.vendor_invoice_no}` : `single:${bill.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(bill);
  }

  return order.map((key) => {
    const memberBills = groups.get(key)!;
    return { key, bills: memberBills, isGroup: memberBills.length > 1 };
  });
}

/** Comma-joined id list for a group — the wire format the grouped server actions (approvals, bill payment) expect in their `bill_ids` field. */
export function groupBillIds<T extends { id: string }>(group: BillGroup<T>): string {
  return group.bills.map((b) => b.id).join(",");
}
