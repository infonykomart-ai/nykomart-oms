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

// =============================================================================
// 2026-10-20 — Document Entry → Purchase Bill grouping.
//
// "agar document entry section me kisi bhi parkar ke invoice ki entry karte
// hai to alag alag entry kyu hoti hai, ek invoice me agar 10 entry hai to vaha
// par single entry aaye or usi se link me dikh jaye ki kon kon si entry hai"
//
// Bill Payment / Party Ledger already regroup purchase_bills rows back into
// one invoice (groupBills above), but the Document Entry list itself — the
// place the entries are actually made — still showed one card per ITEM, so a
// 6-item vendor invoice read as six unrelated bills. This groups those rows
// for that list WITHOUT touching storage: each item keeps its own
// purchase_bills + bill_pass_register row (its own qty/rate/GST), and the
// group is only a view over them.
//
// Deliberately a separate, narrower key than groupBills(): a vendor invoice
// number is only meaningful inside one company, so the key includes
// company_id. Rows with no vendor_invoice_no (not possible through the forms,
// but the column is NOT NULL for a reason) stay singletons.
// =============================================================================
export type PurchaseBillGroupableRow = {
  id: string;
  company_id: string | null;
  vendor_party_id: string;
  vendor_invoice_no: string;
  vendor_invoice_date: string | null;
  created_at: string;
  /** Added 2026-10-20 (db/2026-10-20-purchase-bill-no-gst-and-audit.sql) — null on a caller that predates it. */
  updated_at?: string | null;
};

export type PurchaseBillInvoiceGroup<T extends PurchaseBillGroupableRow> = {
  /** Stable React key / A4 print scope — company + vendor + invoice number. */
  key: string;
  vendor_invoice_no: string;
  vendor_invoice_date: string | null;
  company_id: string | null;
  vendor_party_id: string;
  items: T[];
  /** true when more than one item row belongs to this invoice. */
  isGroup: boolean;
  /** When the FIRST item of this invoice was entered. */
  createdAt: string;
  /** Most recent edit of ANY item, or null when nothing has ever been edited. */
  updatedAt: string | null;
};

const ONE_SECOND = 1000;

/** Groups purchase_bills rows into one entry per (company, vendor, vendor invoice no.). */
export function groupPurchaseBillInvoices<T extends PurchaseBillGroupableRow>(rows: T[]): PurchaseBillInvoiceGroup<T>[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const row of rows) {
    const inv = (row.vendor_invoice_no ?? "").trim().toLowerCase();
    const key = inv ? `inv:${row.company_id ?? ""}|${row.vendor_party_id}|${inv}` : `item:${row.id}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else {
      groups.set(key, [row]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const items = groups.get(key)!;
    const first = items[0];
    const createdTimes = items.map((i) => new Date(i.created_at).getTime()).filter((t) => Number.isFinite(t));
    const createdAt = createdTimes.length ? new Date(Math.min(...createdTimes)).toISOString() : first.created_at;
    // An untouched bill has updated_at === created_at (the migration sets it
    // that way), so "never edited" must stay null rather than claim an edit
    // that never happened.
    let updatedAt: string | null = null;
    for (const item of items) {
      if (!item.updated_at) continue;
      const u = new Date(item.updated_at).getTime();
      const c = new Date(item.created_at).getTime();
      if (!Number.isFinite(u) || !Number.isFinite(c) || u - c < ONE_SECOND) continue;
      if (!updatedAt || u > new Date(updatedAt).getTime()) updatedAt = new Date(u).toISOString();
    }
    return {
      key,
      vendor_invoice_no: first.vendor_invoice_no,
      vendor_invoice_date: first.vendor_invoice_date,
      company_id: first.company_id,
      vendor_party_id: first.vendor_party_id,
      items,
      isGroup: items.length > 1,
      createdAt,
      updatedAt,
    };
  });
}
