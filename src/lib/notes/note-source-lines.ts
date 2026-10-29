// 2026-10-29f — "DEBIT NOTE / CREDIT NOTE JIS ORDER KA BAN RAHA HAI USKA NAMO
// NISAN AARA KYA ... KYA ITEM THA, QTY, RATE, AMOUNT, GST, PO NO SAB DIKHA NAHI
// RAHA".
//
// WHY IT WAS BLANK: a Debit/Credit Note raised from Bill Payment only stores
// the NOTE's own numbers (amount, remark, GST slab). It does not copy the
// invoice's item lines — the link lives in bill_pass_register_adjustments
// (which invoice, how much) -> bill_pass_register (invoice no/date/source) ->
// purchase_bills (item, qty, unit, rate, GST) -> orders (PO ref). So the
// printed sheet showed a bare amount with nothing saying WHAT was debited.
//
// This resolver walks that chain once, for both note kinds, and returns the
// exact lines the printed sheet should show. Nothing is ever invented: a field
// that isn't in the data comes back null and the sheet prints "—".
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type NoteSourceLine = {
  billId: string | null;
  invoiceNo: string;
  invoiceDate: string | null;
  /** PO / Order ref(s) this invoice line was bought against. */
  poRefs: string[];
  /** Item description as entered on the vendor bill. */
  item: string | null;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  /** Item amount (qty × sq ft × rate), or the invoice total for a non-purchase bill. */
  amount: number | null;
  /** TOTAL GST % (CGST+SGST) or the IGST rate; 0 = billed without GST. */
  gstPctTotal: number | null;
  gstAmount: number | null;
  /** How much of THIS note sits on that invoice line. */
  applied: number | null;
};

export type NoteSourceInfo = {
  /** Every PO / order ref found behind this note (may be empty). */
  orderRefs: string[];
  lines: NoteSourceLine[];
  /** Sum of `applied` — the note amount that is backed by invoice lines. */
  appliedTotal: number;
};

const BILL_SOURCE_LABEL: Record<string, string> = {
  purchase_bill: "Purchase Bill",
  freight_bill: "Courier Bill (Freight)",
  duty_tax_bill: "Duty & Tax Bill",
  office_expense: "Office Expense Bill",
};

/**
 * The invoice lines behind one Debit/Credit Note.
 *
 * @param kind       which note table to read the adjustments from
 * @param noteId     the note's id
 * @param fallbackBillIds notes also carry a single bill_pass_register_id
 *                   (the "raised against" invoice) — used when no adjustment
 *                   row exists yet, so a freshly saved note is never blank.
 */
export async function loadNoteSourceLines(
  supabase: Client,
  args: { kind: "debit_note" | "credit_note"; noteId: string; fallbackBillIds?: (string | null | undefined)[] }
): Promise<NoteSourceInfo> {
  const empty: NoteSourceInfo = { orderRefs: [], lines: [], appliedTotal: 0 };

  const noteColumn = args.kind === "debit_note" ? "debit_note_id" : "credit_note_id";
  const { data: adjustments } = await supabase
    .from("bill_pass_register_adjustments")
    .select("bill_pass_register_id, amount")
    .eq(noteColumn, args.noteId);

  const appliedByBill = new Map<string, number>();
  for (const a of adjustments ?? []) {
    const id = a.bill_pass_register_id;
    if (!id) continue;
    appliedByBill.set(id, (appliedByBill.get(id) ?? 0) + Number(a.amount ?? 0));
  }
  for (const fallback of args.fallbackBillIds ?? []) {
    if (fallback && !appliedByBill.has(fallback)) appliedByBill.set(fallback, 0);
  }

  const billIds = Array.from(appliedByBill.keys());
  if (billIds.length === 0) return empty;

  const { data: bills } = await supabase
    .from("bill_pass_register")
    .select("id, invoice_no, vendor_invoice_no, invoice_date, invoice_type, source, source_id, total_amt")
    .in("id", billIds);
  if (!bills || bills.length === 0) return empty;

  const purchaseIds = bills
    .filter((b) => b.source === "purchase_bill" && b.source_id)
    .map((b) => b.source_id as string);
  type PurchaseItemRow = {
    id: string;
    work_description: string | null;
    qty: number;
    qty_unit: string;
    sq_feet: number;
    unit_rate: number;
    gst_rate_pct: number | null;
    gst_type: string | null;
    total_amount: number | null;
    order_id: string | null;
    vendor_invoice_no: string;
    vendor_invoice_date: string | null;
  };
  const purchaseRes = purchaseIds.length
    ? await supabase
        .from("purchase_bills")
        .select("id, work_description, qty, qty_unit, sq_feet, unit_rate, gst_rate_pct, gst_type, total_amount, order_id, vendor_invoice_no, vendor_invoice_date")
        .in("id", purchaseIds)
    : null;
  const purchaseItems: PurchaseItemRow[] = purchaseRes?.data ?? [];

  const orderIds = Array.from(new Set(purchaseItems.map((p) => p.order_id).filter((v): v is string => !!v)));
  const ordersRes = orderIds.length ? await supabase.from("orders").select("id, ref_no").in("id", orderIds) : null;
  const refById = new Map((ordersRes?.data ?? []).map((o) => [o.id, o.ref_no ?? ""]));

  const itemsBySource = new Map<string, PurchaseItemRow[]>();
  for (const item of purchaseItems) {
    const list = itemsBySource.get(item.id) ?? [];
    list.push(item);
    itemsBySource.set(item.id, list);
  }

  const lines: NoteSourceLine[] = [];
  const orderRefs: string[] = [];
  const addRef = (ref: string | null | undefined) => {
    if (!ref) return;
    if (!orderRefs.includes(ref)) orderRefs.push(ref);
  };

  for (const bill of bills) {
    const applied = appliedByBill.get(bill.id) ?? null;
    const items = bill.source === "purchase_bill" && bill.source_id ? itemsBySource.get(bill.source_id) ?? [] : [];
    const invoiceNo = bill.vendor_invoice_no ?? bill.invoice_no ?? "—";

    if (items.length > 0) {
      items.forEach((item, index) => {
        const gstIndividual = item.gst_rate_pct == null ? null : Number(item.gst_rate_pct);
        // gst_rate_pct is the CGST/SGST INDIVIDUAL rate (2.5 = 5% total) for a
        // CGST+SGST bill; for IGST it already IS the whole rate. Same
        // convention as bill-statement-document.tsx.
        const gstPctTotal =
          gstIndividual == null ? null : item.gst_type === "IGST" ? gstIndividual : gstIndividual * 2;
        const amount = Number(item.total_amount ?? 0);
        const poRef = item.order_id ? refById.get(item.order_id) ?? null : null;
        addRef(poRef);
        lines.push({
          billId: bill.id,
          invoiceNo: item.vendor_invoice_no || invoiceNo,
          invoiceDate: item.vendor_invoice_date ?? bill.invoice_date ?? null,
          poRefs: poRef ? [poRef] : [],
          item: item.work_description?.trim() || null,
          qty: item.qty == null ? null : Number(item.qty),
          unit: item.qty_unit ?? null,
          rate: item.unit_rate == null ? null : Number(item.unit_rate),
          amount,
          gstPctTotal,
          gstAmount: gstPctTotal != null && gstPctTotal > 0 ? Math.round(amount * gstPctTotal) / 100 : 0,
          // the note amount belongs to the INVOICE, so it is shown on the
          // invoice's first line only — never repeated per item.
          applied: index === 0 ? applied : null,
        });
      });
      continue;
    }

    lines.push({
      billId: bill.id,
      invoiceNo,
      invoiceDate: bill.invoice_date,
      poRefs: [],
      item: bill.source ? BILL_SOURCE_LABEL[bill.source] ?? bill.invoice_type ?? null : bill.invoice_type ?? null,
      qty: null,
      unit: null,
      rate: null,
      amount: Number(bill.total_amt ?? 0),
      gstPctTotal: null,
      gstAmount: null,
      applied,
    });
  }

  return {
    orderRefs,
    lines,
    appliedTotal: lines.reduce((s, l) => s + (l.applied ?? 0), 0),
  };
}
