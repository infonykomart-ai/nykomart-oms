// 2026-10-15 — Unified Printing register ("Printing gap"). Printing job
// work was spread over three unrelated tables with nothing tying them
// together, so "printing ka poora hisaab" meant opening each one
// separately:
//
//   1. Material OUT Chalan  (src/app/dashboard/stock)   — kacha maal sent
//      to the printer, grouped under one auto-numbered chalan, one
//      stock_out row per SKU line + optional PO links
//      (stock_out_order_links, "kacha maal ja nahi sakta bina PO ke").
//   2. Received Chalan      (src/app/dashboard/documents) — printed maal
//      coming back, free-text item lines with qty/rate, optional PO.
//   3. bill_pass_register   — the printing CHARGES: rows typed
//      `invoice_type = 'Printing'` (the finance ledger's own Printing
//      bucket) plus every bill of a vendor whose Party Master says
//      `invoice_type = 'Printing'` (job-work returns billed as a normal
//      Purchase bill, which mirrors in here as 'Purchase' — see
//      documents/actions.ts's createPurchaseBill → invoice_type: "Purchase").
//
// This module holds the row shapes + the one party-wise aggregation both
// the register page and any future export share, so the numbers can never
// disagree between renderers. Pure functions only — no Supabase here.
import { toFeet, type LengthUnit } from "@/lib/length-units";

export type PrintingOutLine = {
  skuCode: string;
  productName: string | null;
  qtyFt: number;
  orderRefs: string[];
};

export type PrintingOutChalan = {
  id: string;
  chalanNo: string;
  chalanDate: string;
  partyId: string;
  through: string | null;
  noOfPackages: number | null;
  remark: string | null;
  lines: PrintingOutLine[];
};

export type PrintingInItem = {
  description: string;
  qty: number;
  unit: string;
  rate: number | null;
  /** qty × rate when a rate was entered, else 0 — informational only. */
  amount: number;
};

export type PrintingInChalan = {
  id: string;
  chalanNo: string;
  chalanDate: string;
  partyId: string;
  orderRefNo: string | null;
  remark: string | null;
  items: PrintingInItem[];
};

export type PrintingBill = {
  id: string;
  partyId: string | null;
  invoiceNo: string | null;
  vendorInvoiceNo: string | null;
  invoiceType: string | null;
  /** invoice_recv_date ?? invoice_date — either may be null on old imports. */
  date: string | null;
  totalAmt: number;
  paidAmt: number;
  balanceDue: number;
  /** Why this bill is in the register — see buildPrintingRegister's docs. */
  matchedBy: "invoice_type" | "printing_vendor";
};

/** One row of the register's unified per-party table. */
export type PrintingRegisterRow =
  | {
      kind: "out";
      date: string;
      docNo: string;
      docId: string;
      details: string;
      orders: string[];
      qtyLabel: string;
      amount: null;
    }
  | {
      kind: "in";
      date: string;
      docNo: string;
      docId: string;
      details: string;
      orders: string[];
      qtyLabel: string;
      amount: number;
    }
  | {
      kind: "bill";
      date: string;
      docNo: string;
      docId: string;
      details: string;
      orders: [];
      qtyLabel: null;
      amount: number;
      paidAmt: number;
      balanceDue: number;
      invoiceType: string | null;
      matchedBy: "invoice_type" | "printing_vendor";
    };

export type PrintingPartyGroup = {
  partyId: string | null;
  partyName: string;
  /** Party Master's own invoice_type = 'Printing' — badge in the UI. */
  isPrintingVendor: boolean;
  rows: PrintingRegisterRow[];
  outChalanCount: number;
  inChalanCount: number;
  billCount: number;
  /** Stock OUT is always stored in feet (see length-units.ts). */
  outQtyFt: number;
  /** Received-chalan quantities converted to feet (PCS excluded). */
  inQtyFt: number;
  /** PCS has no feet equivalent — tracked separately, never converted. */
  inQtyPcs: number;
  /** outQtyFt − inQtyFt: still lying with the printer (negative = more came back than went out). */
  pendingFt: number;
  /** Value of received lines that carried a rate (qty × rate). */
  inAmount: number;
  billTotal: number;
  billPaid: number;
  billDue: number;
};

export type PrintingRegisterTotals = {
  partyCount: number;
  outChalanCount: number;
  inChalanCount: number;
  billCount: number;
  outQtyFt: number;
  inQtyFt: number;
  inQtyPcs: number;
  billTotal: number;
  billPaid: number;
  billDue: number;
};

export type PrintingRegister = {
  groups: PrintingPartyGroup[];
  totals: PrintingRegisterTotals;
};

/** "12,400 ft" / "1,200 ft · 300 pcs" — always shows the pcs split. */
export function qtyLabel(ft: number, pcs: number): string {
  const parts: string[] = [];
  if (ft) parts.push(`${Math.round(ft).toLocaleString("en-IN")} ft`);
  if (pcs) parts.push(`${pcs.toLocaleString("en-IN")} pcs`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Received-chalan line → feet; PCS passes through untouched (no conversion exists). */
export function itemQtyFt(qty: number, unit: string): { ft: number; pcs: number } {
  if (unit === "PCS") return { ft: 0, pcs: qty };
  return { ft: toFeet(qty, unit as LengthUnit), pcs: 0 };
}

const NO_PARTY_NAME = "(No party)";

/**
 * Folds the three streams into one party-wise register. Every party that
 * appears in ANY stream gets its own group — never just the ones that
 * happen to have a bill — because the whole point of this page is that a
 * printing entry can no longer be invisible.
 *
 * Row order inside a group: newest first; undated bills (old imports)
 * sink to the bottom instead of being dropped.
 */
export function buildPrintingRegister({
  outChalans,
  inChalans,
  bills,
  parties,
}: {
  outChalans: PrintingOutChalan[];
  inChalans: PrintingInChalan[];
  bills: PrintingBill[];
  parties: { id: string; name: string; invoiceType: string | null }[];
}): PrintingRegister {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const printingVendorIds = new Set(
    parties.filter((p) => p.invoiceType === "Printing").map((p) => p.id)
  );

  type Acc = PrintingPartyGroup;
  const groups = new Map<string, Acc>();

  function groupFor(partyId: string | null): Acc {
    const key = partyId ?? "__no_party__";
    const existing = groups.get(key);
    if (existing) return existing;
    const party = partyId ? partyById.get(partyId) : undefined;
    const acc: Acc = {
      partyId,
      partyName: party?.name ?? (partyId ? "(deleted party)" : NO_PARTY_NAME),
      isPrintingVendor: partyId !== null && printingVendorIds.has(partyId),
      rows: [],
      outChalanCount: 0,
      inChalanCount: 0,
      billCount: 0,
      outQtyFt: 0,
      inQtyFt: 0,
      inQtyPcs: 0,
      pendingFt: 0,
      inAmount: 0,
      billTotal: 0,
      billPaid: 0,
      billDue: 0,
    };
    groups.set(key, acc);
    return acc;
  }

  for (const c of outChalans) {
    const g = groupFor(c.partyId);
    g.outChalanCount += 1;
    const ft = c.lines.reduce((s, l) => s + l.qtyFt, 0);
    g.outQtyFt += ft;
    const orderRefs = Array.from(
      new Set(c.lines.flatMap((l) => l.orderRefs))
    );
    g.rows.push({
      kind: "out",
      date: c.chalanDate,
      docNo: c.chalanNo,
      docId: c.id,
      details:
        c.lines.length > 0
          ? c.lines
              .map((l) =>
                l.productName
                  ? `${l.skuCode} — ${l.productName}`
                  : l.skuCode
              )
              .join(", ")
          : c.remark ?? "—",
      orders: orderRefs,
      qtyLabel: qtyLabel(ft, 0),
      amount: null,
    });
  }

  for (const c of inChalans) {
    const g = groupFor(c.partyId);
    g.inChalanCount += 1;
    let ft = 0;
    let pcs = 0;
    let amount = 0;
    for (const it of c.items) {
      const q = itemQtyFt(it.qty, it.unit);
      ft += q.ft;
      pcs += q.pcs;
      amount += it.amount;
    }
    g.inQtyFt += ft;
    g.inQtyPcs += pcs;
    g.inAmount += amount;
    g.rows.push({
      kind: "in",
      date: c.chalanDate,
      docNo: c.chalanNo,
      docId: c.id,
      details:
        c.items.length > 0
          ? c.items
              .map((it) =>
                it.rate != null
                  ? `${it.description} (${it.qty} ${it.unit} @ ₹${it.rate})`
                  : `${it.description} (${it.qty} ${it.unit})`
              )
              .join(", ")
          : c.remark ?? "—",
      orders: c.orderRefNo ? [c.orderRefNo] : [],
      qtyLabel: qtyLabel(ft, pcs),
      amount,
    });
  }

  for (const b of bills) {
    const g = groupFor(b.partyId);
    g.billCount += 1;
    g.billTotal += b.totalAmt;
    g.billPaid += b.paidAmt;
    g.billDue += b.balanceDue;
    g.rows.push({
      kind: "bill",
      date: b.date ?? "",
      docNo: b.invoiceNo ?? b.vendorInvoiceNo ?? "—",
      docId: b.id,
      details:
        b.invoiceType === "Printing"
          ? "Printing bill"
          : `Printing vendor — ${b.invoiceType ?? "bill"}`,
      orders: [],
      qtyLabel: null,
      amount: b.totalAmt,
      paidAmt: b.paidAmt,
      balanceDue: b.balanceDue,
      invoiceType: b.invoiceType,
      matchedBy: b.matchedBy,
    });
  }

  const result: PrintingPartyGroup[] = [];
  for (const g of groups.values()) {
    g.pendingFt = g.outQtyFt - g.inQtyFt;
    g.rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.docNo < b.docNo ? -1 : a.docNo > b.docNo ? 1 : 0;
    });
    result.push(g);
  }
  result.sort((a, b) =>
    a.partyName.localeCompare(b.partyName, "en", { sensitivity: "base" })
  );

  const totals: PrintingRegisterTotals = result.reduce<PrintingRegisterTotals>(
    (t, g) => ({
      partyCount: result.length,
      outChalanCount: t.outChalanCount + g.outChalanCount,
      inChalanCount: t.inChalanCount + g.inChalanCount,
      billCount: t.billCount + g.billCount,
      outQtyFt: t.outQtyFt + g.outQtyFt,
      inQtyFt: t.inQtyFt + g.inQtyFt,
      inQtyPcs: t.inQtyPcs + g.inQtyPcs,
      billTotal: t.billTotal + g.billTotal,
      billPaid: t.billPaid + g.billPaid,
      billDue: t.billDue + g.billDue,
    }),
    {
      partyCount: 0,
      outChalanCount: 0,
      inChalanCount: 0,
      billCount: 0,
      outQtyFt: 0,
      inQtyFt: 0,
      inQtyPcs: 0,
      billTotal: 0,
      billPaid: 0,
      billDue: 0,
    }
  );

  return { groups: result, totals };
}
