"use server";

// Document Entry module (2026-08-07) — Credit Note / Debit Note / Washing
// Entry / Internal Invoice. Answers a direct user question: "order,
// invoice, credit note, debit note — ye ek dusre se connected hai kya?"
// At the DB level they always were (credit_notes.order_id / debit_notes.
// order_id / credit_notes.debit_note_id / orders.invoice_id — see
// db/schema.sql section 9) but there was NO UI to actually create a
// Credit/Debit Note or see that connection — the "Document Entry" tile on
// the dashboard has pointed at /dashboard/documents since the invoice
// round, and that route 404'd because this module was never built in the
// Next.js rewrite (it existed in the old Apps Script system — see
// claude/document-entry-and-pending-work-notes.md — but wasn't migrated).
// This file is the missing piece: lookupOrderForEntry surfaces the FULL
// chain (order -> its invoice, if any -> its existing credit/debit notes)
// the moment you type a PO/RF/RG number, and the save actions below write
// new Credit/Debit Notes / Washing Entries linked to that same order_id.
//
// 2026-08-07 (later round): Purchase Bill / Courier Bill / Duty & Tax Bill
// added — see the bottom of this file. Purchase Bill reuses the exact same
// flat-form + optional-order-lookup pattern as Washing Entry. Courier Bill
// (= `freight_bills`) and Duty & Tax Bill (= `duty_tax_bills`) are a
// genuinely different shape: ONE bill invoice covers MANY AWBs/orders, so
// each is a header row (freight-bill-form.tsx / duty-bill-form.tsx) plus a
// separate "assign an AWB to this bill" step (freight_bill_awb_assignments
// / duty_bill_awb_assignments, UNIQUE(order_id) — one AWB can only ever be
// billed under ONE freight/duty invoice, matching the physical reality:
// a shipment's courier charge is billed once). lookupOrderForReconciliation
// below is the shared AWB/PO lookup for that assignment step. Note these 3
// tables have NO company_id of their own (unlike credit/debit notes etc.)
// — a single courier invoice can genuinely cover shipments across all 3
// companies, so the bill header itself isn't company-scoped; only the
// AWB lookup re-checks employee.companyIds (via the order it resolves to).

import { requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { parseSizeToSqFt } from "@/lib/size-parser";
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";
import { logAudit } from "@/lib/audit/log-audit";
import { groupBills } from "@/lib/bill-grouping";
import { saveOrderRefundCore } from "../orders/actions";
import { revalidatePath } from "next/cache";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}
function numOrNull(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  return v ? Number(v) : null;
}
function numOrZero(formData: FormData, key: string): number {
  const v = str(formData, key);
  return v ? Number(v) : 0;
}

export type OrderLookup = {
  error: string | null;
  order: {
    id: string;
    ref_no: string;
    company_id: string;
    store_id: string;
    buyer_name_address: string | null;
    contact_no: string | null;
    order_value_original: number;
    order_currency: string;
    order_value_usd: number | null;
    order_value_inr: number | null;
    invoice_id: string | null;
    // 2026-08-20 — Gap 2 of the 5-gaps plan: the "planned" vendor set at
    // order-entry/edit time (orders.vendor_party_id), used by
    // purchase-bill-form.tsx to PRE-FILL (not lock) the Vendor Party
    // dropdown when this order is looked up — still just a planning note,
    // not a guarantee the bill will actually come from this party.
    vendor_party_id: string | null;
  } | null;
  invoice: { id: string; invoice_no: string; master_invoice_no: string } | null;
  debitNotes: { id: string; debit_note_no: string | null; debit_amount: number }[];
  creditNotes: { id: string; cn_no: string | null; refund_amount: number }[];
};

const EMPTY_LOOKUP: OrderLookup = { error: null, order: null, invoice: null, debitNotes: [], creditNotes: [] };

/**
 * The shared PO/RF/RG lookup every doc-entry form uses — same idea as the
 * old lookupOrderForEntry() in the Apps Script version, but now it ALSO
 * surfaces the order's invoice (if generated) and any credit/debit notes
 * already raised against it, so the connection between modules is visible
 * right where someone is working, not just enforced silently in the DB.
 */
export async function lookupOrderForEntry(refNo: string): Promise<OrderLookup> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const trimmed = refNo.trim();
  if (!trimmed) return { ...EMPTY_LOOKUP, error: "Enter a PO/RF/RG number." };

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, ref_no, company_id, store_id, buyer_name_address, contact_no, order_value_original, order_currency, order_value_usd, order_value_inr, invoice_id, vendor_party_id"
    )
    .ilike("ref_no", trimmed)
    .in("company_id", employee.companyIds)
    .maybeSingle();

  if (!order) return { ...EMPTY_LOOKUP, error: `No order found for "${trimmed}".` };

  const [{ data: invoice }, { data: debitNotes }, { data: creditNotes }] = await Promise.all([
    order.invoice_id
      ? supabase.from("sales_invoices").select("id, invoice_no, master_invoice_no").eq("id", order.invoice_id).single()
      : Promise.resolve({ data: null }),
    supabase.from("debit_notes").select("id, debit_note_no, debit_amount").eq("order_id", order.id),
    supabase.from("credit_notes").select("id, cn_no, refund_amount").eq("order_id", order.id),
  ]);

  return {
    error: null,
    order,
    invoice: invoice ?? null,
    debitNotes: (debitNotes ?? []).map((d) => ({ ...d, debit_amount: Number(d.debit_amount) })),
    creditNotes: (creditNotes ?? []).map((c) => ({ ...c, refund_amount: Number(c.refund_amount) })),
  };
}

export type DocFormState = { error: string | null; success: { id: string; docNo: string } | null };
const initialFail = (error: string): DocFormState => ({ error, success: null });

type CreditNoteParams = {
  companyId: string;
  storeId: string | null;
  creditNoteDate: string;
  orderId: string | null;
  itemId: string | null;
  buyerName: string | null;
  refundDate: string | null;
  itemName: string | null;
  itemPrice: number | null;
  invoiceNo: string | null;
  invoiceValueUsd: number | null;
  invoiceValueInr: number | null;
  refundAmount: number;
  refundAmtUsd: number | null;
  refundAmtInr: number | null;
  creditNoteStatus: string | null;
  refundType: string | null;
  debitNoteId: string | null;
  remark: string | null;
  // 2026-08-27 (later same day) — "esa hi credite note me karo esa hi
  // courior ke credit note debit note me karo": vendor-side link, mirroring
  // DebitNoteParams below. partyId is optional here (unlike Debit Note's
  // required partyId) since Credit Note is still ALSO used for the
  // original sales/buyer-refund flow, which has no vendor party at all.
  partyId: string | null;
  billPassRegisterId: string | null;
  adjustTargetBillPassRegisterId: string | null;
  adjustAmount: number | null;
  adjustRemark: string | null;
  // 2026-08-29 — "ab esa system credit note ke liye bhi banao": same Rate
  // Difference Calculator as Debit Note (see DebitNoteParams above /
  // db/2026-08-29-credit-note-rate-difference.sql), but ONLY for the
  // vendor-side ("Party") flow above — per the user's own scoping ("credit
  // note po ke against me rahega ye vala, lekin agar kisi party ko bhi
  // issue karna pad gaya to uske hisab se sahi se banao"), the original
  // PO/buyer-refund fields (orderId/buyerName/itemPrice/refundAmount) are
  // untouched. All three are nullable/optional so the buyer-refund flow
  // (and any existing row) is unaffected.
  qty: number | null;
  poRate: number | null;
  billedRate: number | null;
};

async function saveCreditNoteCore(
  employee: AuthedEmployee,
  supabase: ServiceClient,
  p: CreditNoteParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.companyId) return { error: "Select a company.", id: null, docNo: null };
  if (!employee.companyIds.includes(p.companyId)) return { error: "You do not have access to this company.", id: null, docNo: null };
  if (!p.creditNoteDate) return { error: "Credit Note Date is required.", id: null, docNo: null };
  if (p.adjustTargetBillPassRegisterId && (!p.adjustAmount || p.adjustAmount <= 0)) {
    return { error: "Enter a positive adjustment amount, or clear the target invoice.", id: null, docNo: null };
  }

  const { data, error } = await supabase
    .from("credit_notes")
    .insert({
      company_id: p.companyId,
      store_id: p.storeId,
      credit_note_date: p.creditNoteDate,
      order_id: p.orderId,
      item_id: p.itemId,
      buyer_name: p.buyerName,
      refund_date: p.refundDate,
      item_name: p.itemName,
      item_price: p.itemPrice,
      invoice_no: p.invoiceNo,
      invoice_value_usd: p.invoiceValueUsd,
      invoice_value_inr: p.invoiceValueInr,
      refund_amount: p.refundAmount,
      refund_amt_usd: p.refundAmtUsd,
      refund_amt_inr: p.refundAmtInr,
      credit_note_status: p.creditNoteStatus,
      refund_type: p.refundType as never,
      debit_note_id: p.debitNoteId,
      party_id: p.partyId,
      bill_pass_register_id: p.billPassRegisterId,
      qty: p.qty,
      po_rate: p.poRate,
      billed_rate: p.billedRate,
      created_by_employee_id: employee.id,
      remark: p.remark,
    })
    .select("id, cn_no")
    .single();

  if (error || !data) return { error: `Failed to save Credit Note: ${error?.message ?? "unknown error"}`, id: null, docNo: null };

  if (p.adjustTargetBillPassRegisterId && p.adjustAmount) {
    const { error: adjError } = await supabase.from("bill_pass_register_adjustments").insert({
      bill_pass_register_id: p.adjustTargetBillPassRegisterId,
      credit_note_id: data.id,
      amount: p.adjustAmount,
      remark: p.adjustRemark,
      created_by_employee_id: employee.id,
    });
    if (adjError) {
      // Same "don't roll back what already succeeded" approach as
      // saveDebitNoteCore's own adjustment-insert failure handling.
      return {
        error: null,
        id: data.id,
        docNo: `${data.cn_no ?? ""} (saved, but the invoice adjustment failed: ${adjError.message} — apply it manually)`,
      };
    }
  }

  return { error: null, id: data.id, docNo: data.cn_no ?? "" };
}

export async function saveCreditNote(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const result = await saveCreditNoteCore(employee, supabase, {
    companyId: str(formData, "company_id"),
    storeId: strOrNull(formData, "store_id"),
    creditNoteDate: str(formData, "credit_note_date"),
    orderId: strOrNull(formData, "order_id"),
    itemId: strOrNull(formData, "item_id"),
    buyerName: strOrNull(formData, "buyer_name"),
    refundDate: strOrNull(formData, "refund_date"),
    itemName: strOrNull(formData, "item_name"),
    itemPrice: numOrNull(formData, "item_price"),
    invoiceNo: strOrNull(formData, "invoice_no"),
    invoiceValueUsd: numOrNull(formData, "invoice_value_usd"),
    invoiceValueInr: numOrNull(formData, "invoice_value_inr"),
    refundAmount: numOrZero(formData, "refund_amount"),
    refundAmtUsd: numOrNull(formData, "refund_amt_usd"),
    refundAmtInr: numOrNull(formData, "refund_amt_inr"),
    creditNoteStatus: strOrNull(formData, "credit_note_status"),
    refundType: strOrNull(formData, "refund_type"),
    debitNoteId: strOrNull(formData, "debit_note_id"),
    remark: strOrNull(formData, "remark"),
    partyId: strOrNull(formData, "party_id"),
    billPassRegisterId: strOrNull(formData, "bill_pass_register_id"),
    adjustTargetBillPassRegisterId: strOrNull(formData, "adjust_target_bill_pass_register_id"),
    adjustAmount: numOrNull(formData, "adjust_amount"),
    adjustRemark: strOrNull(formData, "adjust_remark"),
    qty: numOrNull(formData, "qty"),
    poRate: numOrNull(formData, "po_rate"),
    billedRate: numOrNull(formData, "billed_rate"),
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  revalidatePath("/dashboard/bill-payment");
  revalidatePath("/dashboard/approvals/l1");
  revalidatePath("/dashboard/approvals/l2");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

// 2026-08-27 — "credite note ya debit note agar us invoice se related ho to
// vaha dikhna cahiye sath hi link bhi hona chahiye" + "dropdown-based bill
// selection (not free-text matching)" (user's confirmed choice via
// AskUserQuestion): the Debit Note form's old "Against Invoice/Bill No."
// was a free-text field with zero real link to the bill it was about. This
// is the search behind its replacement dropdown — searches
// bill_pass_register by vendor invoice no./invoice no./party name, scoped
// to the employee's accessible companies, and GROUPS results by invoice
// (see src/lib/bill-grouping.ts) so a multi-item Purchase Bill shows as
// ONE candidate, not N. `primaryBillId` is the specific bill_pass_register
// row a note/adjustment actually attaches to (the group's first member —
// see this file's own note on bill_pass_register_adjustments below for why
// picking just one member is safe: Bill Payment/Party Ledger/P&L all sum
// adj_amt across every row in a group, so it doesn't matter WHICH member
// carries it).
export type BillSearchHit = {
  primaryBillId: string;
  companyId: string;
  partyId: string | null;
  partyName: string | null;
  label: string;
  itemCount: number;
  totalAmt: number;
  balanceDue: number;
};

export async function searchBillsForNote(query: string): Promise<BillSearchHit[]> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const [{ data: byInvoice }, { data: parties }] = await Promise.all([
    supabase
      .from("bill_pass_register")
      .select("id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, source, total_amt, balance_due")
      .in("company_id", employee.companyIds)
      .or(`vendor_invoice_no.ilike.%${trimmed}%,invoice_no.ilike.%${trimmed}%`)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("parties").select("id, name"),
  ]);

  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const groups = groupBills(byInvoice ?? []);

  return groups.slice(0, 15).map((g) => {
    const first = g.bills[0];
    const ref = first.vendor_invoice_no ?? first.invoice_no ?? "—";
    const partyLabel = first.party_id ? partyName.get(first.party_id) ?? "—" : "—";
    return {
      primaryBillId: first.id,
      companyId: first.company_id,
      partyId: first.party_id,
      partyName: partyLabel,
      label: `${ref} — ${partyLabel}${g.isGroup ? ` (${g.bills.length} items)` : ""} — ${first.invoice_type ?? ""}`.trim(),
      itemCount: g.bills.length,
      totalAmt: g.bills.reduce((sum, b) => sum + Number(b.total_amt), 0),
      balanceDue: g.bills.reduce((sum, b) => sum + Number(b.balance_due ?? 0), 0),
    };
  });
}

// 2026-08-27 (follow-up) — "party select karte hi uske invocie no drop
// down aajaye us invoice me kya itme hai ya kis item par debit lagana
// ahi": typing into searchBillsForNote's box was still an extra step —
// once Company + Party are picked on the form, their bills should just
// appear as a plain dropdown with no typing, AND for a multi-item invoice
// (grouped — see src/lib/bill-grouping.ts) show WHICH item the debit
// actually belongs to, not just the invoice as a whole, so it attaches to
// the correct bill_pass_register row (the specific item), not an
// arbitrary "first member" pick.
export type PartyBillItem = {
  billPassRegisterId: string;
  description: string;
  qty: number | null;
  qtyUnit: string | null;
  unitRate: number | null;
  amount: number;
  balanceDue: number;
};

export type PartyBillOption = {
  key: string;
  label: string;
  totalAmt: number;
  balanceDue: number;
  isGroup: boolean;
  items: PartyBillItem[];
};

export async function listBillsForParty(companyId: string, partyId: string): Promise<PartyBillOption[]> {
  const employee = await requireCapability("doc_entry");
  if (!companyId || !partyId || !employee.companyIds.includes(companyId)) return [];
  const supabase = createServiceRoleClient();

  const { data: bills } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, source, source_id, total_amt, balance_due")
    .eq("company_id", companyId)
    .eq("party_id", partyId)
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const purchaseBillIds = (bills ?? []).filter((b) => b.source === "purchase_bill" && b.source_id).map((b) => b.source_id as string);
  const itemDetail = new Map<string, { work_description: string | null; qty: number; qty_unit: string; unit_rate: number }>();
  if (purchaseBillIds.length > 0) {
    const { data: purchaseBills } = await supabase
      .from("purchase_bills")
      .select("id, work_description, qty, qty_unit, unit_rate")
      .in("id", purchaseBillIds);
    for (const pb of purchaseBills ?? []) {
      itemDetail.set(pb.id, { work_description: pb.work_description, qty: pb.qty, qty_unit: pb.qty_unit, unit_rate: Number(pb.unit_rate) });
    }
  }

  return groupBills(bills ?? []).map((g) => {
    const first = g.bills[0];
    const ref = first.vendor_invoice_no ?? first.invoice_no ?? "—";
    return {
      key: g.key,
      label: `${ref}${first.invoice_date ? ` · ${first.invoice_date}` : ""}${g.isGroup ? ` (${g.bills.length} items)` : ""} — ${first.invoice_type ?? ""}`.trim(),
      totalAmt: g.bills.reduce((sum, b) => sum + Number(b.total_amt), 0),
      balanceDue: g.bills.reduce((sum, b) => sum + Number(b.balance_due ?? 0), 0),
      isGroup: g.isGroup,
      items: g.bills.map((b) => {
        const detail = b.source === "purchase_bill" && b.source_id ? itemDetail.get(b.source_id) : undefined;
        return {
          billPassRegisterId: b.id,
          description: detail?.work_description || ref,
          qty: detail?.qty ?? null,
          qtyUnit: detail?.qty_unit ?? null,
          unitRate: detail?.unit_rate ?? null,
          amount: Number(b.total_amt),
          balanceDue: Number(b.balance_due ?? 0),
        };
      }),
    };
  });
}

// 2026-08-27 (later same day) — "jese invoice ka preview hota hai vese hi
// credit note debit note show hone chahiye / purchase bill ho ya kisi bhi
// party ka bill ho agar apni trf se ho ya samne party ki traf se ho
// credite note ya debit note agar us invoice se related ho to vaha dikhna
// cahiye sath hi link bhi hona chahiye": one call covering a whole page's
// worth of bill_pass_register rows at once (never call this per-row — see
// every call site below, which always passes the full visible id list).
// A note is "related" to a bill two ways: RAISED_AGAINST (its own
// bill_pass_register_id link) or ADJUSTED_AGAINST (a
// bill_pass_register_adjustments row targeting it — see
// db/2026-08-27-note-linking-and-adjustments.sql). Both show, since both
// answer "is there a credit/debit note connected to this invoice."
export type RelatedNote = {
  billPassRegisterId: string;
  id: string;
  kind: "debit" | "credit";
  docNo: string | null;
  date: string | null;
  amount: number;
  relation: "raised_against" | "adjusted_against";
};

export async function listRelatedNotesForBills(billPassRegisterIds: string[]): Promise<RelatedNote[]> {
  const ids = Array.from(new Set(billPassRegisterIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const supabase = createServiceRoleClient();

  const [{ data: dn }, { data: cn }, { data: adj }] = await Promise.all([
    supabase
      .from("debit_notes")
      .select("id, debit_note_no, debit_note_date, debit_amount, bill_pass_register_id")
      .in("bill_pass_register_id", ids),
    supabase
      .from("credit_notes")
      .select("id, cn_no, credit_note_date, refund_amount, bill_pass_register_id")
      .in("bill_pass_register_id", ids),
    supabase.from("bill_pass_register_adjustments").select("bill_pass_register_id, amount, debit_note_id, credit_note_id").in("bill_pass_register_id", ids),
  ]);

  const notes: RelatedNote[] = [
    ...(dn ?? []).map((d) => ({
      billPassRegisterId: d.bill_pass_register_id as string,
      id: d.id,
      kind: "debit" as const,
      docNo: d.debit_note_no,
      date: d.debit_note_date,
      amount: Number(d.debit_amount),
      relation: "raised_against" as const,
    })),
    ...(cn ?? []).map((c) => ({
      billPassRegisterId: c.bill_pass_register_id as string,
      id: c.id,
      kind: "credit" as const,
      docNo: c.cn_no,
      date: c.credit_note_date,
      amount: Number(c.refund_amount),
      relation: "raised_against" as const,
    })),
  ];

  const adjRows = adj ?? [];
  const adjDebitIds = Array.from(new Set(adjRows.filter((a) => a.debit_note_id).map((a) => a.debit_note_id as string)));
  const adjCreditIds = Array.from(new Set(adjRows.filter((a) => a.credit_note_id).map((a) => a.credit_note_id as string)));
  const [{ data: adjDebitNotes }, { data: adjCreditNotes }] = await Promise.all([
    adjDebitIds.length
      ? supabase.from("debit_notes").select("id, debit_note_no, debit_note_date").in("id", adjDebitIds)
      : Promise.resolve({ data: [] as { id: string; debit_note_no: string | null; debit_note_date: string }[] }),
    adjCreditIds.length
      ? supabase.from("credit_notes").select("id, cn_no, credit_note_date").in("id", adjCreditIds)
      : Promise.resolve({ data: [] as { id: string; cn_no: string | null; credit_note_date: string }[] }),
  ]);
  const debitById = new Map((adjDebitNotes ?? []).map((d) => [d.id, d]));
  const creditById = new Map((adjCreditNotes ?? []).map((c) => [c.id, c]));

  for (const a of adjRows) {
    if (a.debit_note_id) {
      const d = debitById.get(a.debit_note_id);
      notes.push({
        billPassRegisterId: a.bill_pass_register_id,
        id: a.debit_note_id,
        kind: "debit",
        docNo: d?.debit_note_no ?? null,
        date: d?.debit_note_date ?? null,
        amount: Number(a.amount),
        relation: "adjusted_against",
      });
    } else if (a.credit_note_id) {
      const c = creditById.get(a.credit_note_id);
      notes.push({
        billPassRegisterId: a.bill_pass_register_id,
        id: a.credit_note_id,
        kind: "credit",
        docNo: c?.cn_no ?? null,
        date: c?.credit_note_date ?? null,
        amount: Number(a.amount),
        relation: "adjusted_against",
      });
    }
  }

  return notes;
}

type DebitNoteParams = {
  companyId: string;
  debitNoteDate: string;
  againstInvoiceBillNo: string | null;
  billPassRegisterId: string | null;
  partyId: string;
  orderId: string | null;
  particulars: string | null;
  billNo: string | null;
  billDate: string | null;
  sqFt: number | null;
  qty: number | null;
  rate: number | null;
  // 2026-08-29 — "20 pcs liye 260 ki rate se lekin usne 270 ki rate se
  // lagaya hai" — rate-difference reference fields, see
  // db/2026-08-29-debit-note-rate-difference.sql. Purely informational
  // (not used to derive debit_amount server-side — the form computes and
  // fills debit_amount client-side so it's still one plain required number
  // here, matching every other Debit Note that has no per-unit rate at all).
  poRate: number | null;
  billedRate: number | null;
  debitAmount: number;
  remark: string | null;
  // 2026-08-27 — "kisi bill me agar credit debit adjust karna pade kisi
  // dusre invocie me to vo bhi hona chahiye": a note's amount can be
  // applied to REDUCE a DIFFERENT invoice's payable than the one it was
  // raised against (billPassRegisterId above) — see
  // bill_pass_register_adjustments / trg_bpr_adjustments_sync() in
  // db/2026-08-27-note-linking-and-adjustments.sql. Optional: a note can
  // be saved with no adjustment at all (just the "raised against" link),
  // and applied later from wherever the target bill is shown.
  adjustTargetBillPassRegisterId: string | null;
  adjustAmount: number | null;
  adjustRemark: string | null;
};

async function saveDebitNoteCore(
  employee: AuthedEmployee,
  supabase: ServiceClient,
  p: DebitNoteParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.companyId) return { error: "Select a company.", id: null, docNo: null };
  if (!employee.companyIds.includes(p.companyId)) return { error: "You do not have access to this company.", id: null, docNo: null };
  if (!p.debitNoteDate) return { error: "Debit Note Date is required.", id: null, docNo: null };
  if (!p.partyId) return { error: "Select a party.", id: null, docNo: null };
  if (p.adjustTargetBillPassRegisterId && (!p.adjustAmount || p.adjustAmount <= 0)) {
    return { error: "Enter a positive adjustment amount, or clear the target invoice.", id: null, docNo: null };
  }

  const { data, error } = await supabase
    .from("debit_notes")
    .insert({
      company_id: p.companyId,
      debit_note_date: p.debitNoteDate,
      against_invoice_bill_no: p.againstInvoiceBillNo,
      bill_pass_register_id: p.billPassRegisterId,
      party_id: p.partyId,
      order_id: p.orderId,
      particulars: p.particulars,
      bill_no: p.billNo,
      bill_date: p.billDate,
      sq_ft: p.sqFt,
      qty: p.qty,
      rate: p.rate,
      po_rate: p.poRate,
      billed_rate: p.billedRate,
      debit_amount: p.debitAmount,
      remark: p.remark,
    })
    .select("id, debit_note_no")
    .single();

  if (error || !data) return { error: `Failed to save Debit Note: ${error?.message ?? "unknown error"}`, id: null, docNo: null };

  if (p.adjustTargetBillPassRegisterId && p.adjustAmount) {
    const { error: adjError } = await supabase.from("bill_pass_register_adjustments").insert({
      bill_pass_register_id: p.adjustTargetBillPassRegisterId,
      debit_note_id: data.id,
      amount: p.adjustAmount,
      remark: p.adjustRemark,
      created_by_employee_id: employee.id,
    });
    if (adjError) {
      // Debit Note itself is saved and valid — surface the adjustment
      // failure distinctly rather than losing the note behind a generic
      // error (same "don't roll back what already succeeded" approach as
      // savePurchaseBillCore's own Finance-mirror-insert failure handling).
      return {
        error: null,
        id: data.id,
        docNo: `${data.debit_note_no ?? ""} (saved, but the invoice adjustment failed: ${adjError.message} — apply it manually)`,
      };
    }
  }

  return { error: null, id: data.id, docNo: data.debit_note_no ?? "" };
}

export async function saveDebitNote(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const result = await saveDebitNoteCore(employee, supabase, {
    companyId: str(formData, "company_id"),
    debitNoteDate: str(formData, "debit_note_date"),
    againstInvoiceBillNo: strOrNull(formData, "against_invoice_bill_no"),
    billPassRegisterId: strOrNull(formData, "bill_pass_register_id"),
    partyId: str(formData, "party_id"),
    orderId: strOrNull(formData, "order_id"),
    particulars: strOrNull(formData, "particulars"),
    billNo: strOrNull(formData, "bill_no"),
    billDate: strOrNull(formData, "bill_date"),
    sqFt: numOrNull(formData, "sq_ft"),
    qty: numOrNull(formData, "qty"),
    rate: numOrNull(formData, "rate"),
    poRate: numOrNull(formData, "po_rate"),
    billedRate: numOrNull(formData, "billed_rate"),
    debitAmount: numOrZero(formData, "debit_amount"),
    remark: strOrNull(formData, "remark"),
    adjustTargetBillPassRegisterId: strOrNull(formData, "adjust_target_bill_pass_register_id"),
    adjustAmount: numOrNull(formData, "adjust_amount"),
    adjustRemark: strOrNull(formData, "adjust_remark"),
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  revalidatePath("/dashboard/bill-payment");
  revalidatePath("/dashboard/approvals/l1");
  revalidatePath("/dashboard/approvals/l2");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

type WashingEntryParams = {
  companyId: string;
  partyId: string;
  chalanDate: string;
  orderId: string | null;
  itemSize: string | null;
  pcs: number | null;
  sqMtrFt: number | null;
  rate: number | null;
  debitCharges: number | null;
  storeId: string | null;
};

async function saveWashingEntryCore(
  employee: AuthedEmployee,
  supabase: ServiceClient,
  p: WashingEntryParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.companyId) return { error: "Select a company.", id: null, docNo: null };
  if (!employee.companyIds.includes(p.companyId)) return { error: "You do not have access to this company.", id: null, docNo: null };
  if (!p.partyId) return { error: "Select a party.", id: null, docNo: null };
  if (!p.chalanDate) return { error: "Chalan Date is required.", id: null, docNo: null };

  const { data, error } = await supabase
    .from("washing_entries")
    .insert({
      company_id: p.companyId,
      party_id: p.partyId,
      chalan_date: p.chalanDate,
      order_id: p.orderId,
      item_size: p.itemSize,
      pcs: p.pcs,
      sq_mtr_ft: p.sqMtrFt,
      rate: p.rate,
      debit_charges: p.debitCharges,
      store_id: p.storeId,
    })
    .select("id, chalan_no")
    .single();

  if (error || !data) return { error: `Failed to save Washing Entry: ${error?.message ?? "unknown error"}`, id: null, docNo: null };
  return { error: null, id: data.id, docNo: data.chalan_no ?? "" };
}

export async function saveWashingEntry(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const result = await saveWashingEntryCore(employee, supabase, {
    companyId: str(formData, "company_id"),
    partyId: str(formData, "party_id"),
    chalanDate: str(formData, "chalan_date"),
    orderId: strOrNull(formData, "order_id"),
    itemSize: strOrNull(formData, "item_size"),
    pcs: numOrNull(formData, "pcs"),
    sqMtrFt: numOrNull(formData, "sq_mtr_ft"),
    rate: numOrNull(formData, "rate"),
    debitCharges: numOrNull(formData, "debit_charges"),
    storeId: strOrNull(formData, "store_id"),
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

export async function saveInternalInvoice(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const fromCompanyId = str(formData, "from_company_id");
  const toCompanyId = str(formData, "to_company_id");
  const invoiceDate = str(formData, "invoice_date");
  const description = str(formData, "description");
  const qty = numOrNull(formData, "qty");
  const rate = numOrNull(formData, "rate");

  if (!fromCompanyId || !toCompanyId) return initialFail("Select both the From and To companies.");
  if (fromCompanyId === toCompanyId) return initialFail("The From and To companies must be different.");
  if (!employee.companyIds.includes(fromCompanyId)) return initialFail("You do not have access to the From company.");
  if (!invoiceDate) return initialFail("Invoice Date is required.");
  if (!description) return initialFail("Description is required.");
  if (!qty || !rate) return initialFail("Qty and Rate are required.");

  const { data, error } = await supabase
    .from("internal_invoices")
    .insert({
      from_company_id: fromCompanyId,
      to_company_id: toCompanyId,
      invoice_date: invoiceDate,
      description,
      qty,
      rate,
      prepared_by_employee_id: employee.id,
      remark: strOrNull(formData, "remark"),
    } as never)
    .select("id, invoice_no")
    .single();

  if (error || !data) return initialFail(`Failed to save Internal Invoice: ${error?.message ?? "unknown error"}`);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: data.id, docNo: data.invoice_no ?? "" } };
}

// 2026-08-07: "edit modify delet sabhi section me rahega" — extending the
// same edit/modify/delete pattern built for Orders to the 4 Document Entry
// types. Unlike Orders, none of these tables have a status/soft-delete
// concept, so the rule here is simpler: delete is a straightforward hard
// delete UNLESS another table still points at this row (bill_pass_register
// / refunds -> credit_notes, credit_notes -> debit_notes — see
// db/schema.sql sections 9/11/13), in which case it's blocked with a
// message telling the user to unlink it there first, exactly like Postgres
// itself would refuse the delete via the FK — just with a readable message
// instead of a raw constraint error. Doc numbers (cn_no/debit_note_no/
// chalan_no/invoice_no) and the order_id link are never editable, same
// reasoning as ref_no on Orders: they're assigned once and other rows
// (and the order <-> document chain this whole module exists to show)
// key off them.
export type DocEditState = { error: string | null; success: boolean };
export type SimpleResult = { error: string | null; success: boolean };

export async function updateCreditNote(_prev: DocEditState, formData: FormData): Promise<DocEditState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id");
  if (!id) return { error: "Missing Credit Note.", success: false };
  const { data: existing } = await supabase.from("credit_notes").select("id, company_id").eq("id", id).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Credit Note not found or you don't have access to this company.", success: false };
  }
  const creditNoteDate = str(formData, "credit_note_date");
  if (!creditNoteDate) return { error: "Credit Note Date is required.", success: false };

  const { error } = await supabase
    .from("credit_notes")
    .update({
      store_id: strOrNull(formData, "store_id"),
      credit_note_date: creditNoteDate,
      item_id: strOrNull(formData, "item_id"),
      buyer_name: strOrNull(formData, "buyer_name"),
      refund_date: strOrNull(formData, "refund_date"),
      item_name: strOrNull(formData, "item_name"),
      item_price: numOrNull(formData, "item_price"),
      invoice_no: strOrNull(formData, "invoice_no"),
      invoice_value_usd: numOrNull(formData, "invoice_value_usd"),
      invoice_value_inr: numOrNull(formData, "invoice_value_inr"),
      refund_amount: numOrZero(formData, "refund_amount"),
      refund_amt_usd: numOrNull(formData, "refund_amt_usd"),
      refund_amt_inr: numOrNull(formData, "refund_amt_inr"),
      credit_note_status: strOrNull(formData, "credit_note_status"),
      refund_type: strOrNull(formData, "refund_type") as never,
      remark: strOrNull(formData, "remark"),
      // 2026-08-29 — Rate Difference Calculator fields, edit-side (see
      // CreditNoteParams above): shown on the edit form as suggestion-only
      // for vendor-side notes, same convention as Debit Note's edit form —
      // never silently overwrites an already-typed Refund Amount.
      qty: numOrNull(formData, "qty"),
      po_rate: numOrNull(formData, "po_rate"),
      billed_rate: numOrNull(formData, "billed_rate"),
    })
    .eq("id", id);

  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function deleteCreditNote(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase.from("credit_notes").select("id, company_id").eq("id", id).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Credit Note not found or you don't have access to this company.", success: false };
  }

  const [billPass, refund] = await Promise.all([
    supabase.from("bill_pass_register").select("id").eq("credit_note_id", id).limit(1).maybeSingle(),
    supabase.from("refunds").select("id").eq("credit_note_id", id).limit(1).maybeSingle(),
  ]);
  if (billPass.data || refund.data) {
    return { error: "This Credit Note is linked to a Bill Pass Register or Refund entry — remove that link first.", success: false };
  }

  const { error } = await supabase.from("credit_notes").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function updateDebitNote(_prev: DocEditState, formData: FormData): Promise<DocEditState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id");
  if (!id) return { error: "Missing Debit Note.", success: false };
  const { data: existing } = await supabase.from("debit_notes").select("id, company_id").eq("id", id).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Debit Note not found or you don't have access to this company.", success: false };
  }
  const debitNoteDate = str(formData, "debit_note_date");
  const partyId = str(formData, "party_id");
  if (!debitNoteDate) return { error: "Debit Note Date is required.", success: false };
  if (!partyId) return { error: "Select a party.", success: false };

  const { error } = await supabase
    .from("debit_notes")
    .update({
      debit_note_date: debitNoteDate,
      against_invoice_bill_no: strOrNull(formData, "against_invoice_bill_no"),
      party_id: partyId,
      particulars: strOrNull(formData, "particulars"),
      bill_no: strOrNull(formData, "bill_no"),
      bill_date: strOrNull(formData, "bill_date"),
      sq_ft: numOrNull(formData, "sq_ft"),
      qty: numOrNull(formData, "qty"),
      rate: numOrNull(formData, "rate"),
      po_rate: numOrNull(formData, "po_rate"),
      billed_rate: numOrNull(formData, "billed_rate"),
      debit_amount: numOrZero(formData, "debit_amount"),
      remark: strOrNull(formData, "remark"),
    })
    .eq("id", id);

  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function deleteDebitNote(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase.from("debit_notes").select("id, company_id").eq("id", id).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Debit Note not found or you don't have access to this company.", success: false };
  }

  const { data: linkedCreditNote } = await supabase
    .from("credit_notes")
    .select("id")
    .eq("debit_note_id", id)
    .limit(1)
    .maybeSingle();
  if (linkedCreditNote) {
    return { error: "This Debit Note is linked to a Credit Note — unlink it there first.", success: false };
  }

  const { error } = await supabase.from("debit_notes").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function updateWashingEntry(_prev: DocEditState, formData: FormData): Promise<DocEditState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id");
  if (!id) return { error: "Missing Washing Entry.", success: false };
  const { data: existing } = await supabase.from("washing_entries").select("id, company_id").eq("id", id).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Washing Entry not found or you don't have access to this company.", success: false };
  }
  const partyId = str(formData, "party_id");
  const chalanDate = str(formData, "chalan_date");
  if (!partyId) return { error: "Select a party.", success: false };
  if (!chalanDate) return { error: "Chalan Date is required.", success: false };

  const { error } = await supabase
    .from("washing_entries")
    .update({
      party_id: partyId,
      chalan_date: chalanDate,
      item_size: strOrNull(formData, "item_size"),
      pcs: numOrNull(formData, "pcs"),
      sq_mtr_ft: numOrNull(formData, "sq_mtr_ft"),
      rate: numOrNull(formData, "rate"),
      debit_charges: numOrNull(formData, "debit_charges"),
      store_id: strOrNull(formData, "store_id"),
    })
    .eq("id", id);

  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function deleteWashingEntry(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase.from("washing_entries").select("id, company_id").eq("id", id).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Washing Entry not found or you don't have access to this company.", success: false };
  }

  const { error } = await supabase.from("washing_entries").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function updateInternalInvoice(_prev: DocEditState, formData: FormData): Promise<DocEditState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id");
  if (!id) return { error: "Missing Internal Invoice.", success: false };
  const { data: existing } = await supabase.from("internal_invoices").select("id, company_id").eq("id", id).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Internal Invoice not found or you don't have access to this company.", success: false };
  }
  const invoiceDate = str(formData, "invoice_date");
  const description = str(formData, "description");
  const qty = numOrNull(formData, "qty");
  const rate = numOrNull(formData, "rate");
  if (!invoiceDate) return { error: "Invoice Date is required.", success: false };
  if (!description) return { error: "Description is required.", success: false };
  if (!qty || !rate) return { error: "Qty and Rate are required.", success: false };

  const { error } = await supabase
    .from("internal_invoices")
    .update({
      invoice_date: invoiceDate,
      description,
      qty,
      rate,
      remark: strOrNull(formData, "remark"),
    } as never)
    .eq("id", id);

  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function deleteInternalInvoice(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase.from("internal_invoices").select("id, company_id").eq("id", id).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Internal Invoice not found or you don't have access to this company.", success: false };
  }

  const { error } = await supabase.from("internal_invoices").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

// =============================================================================
// PURCHASE BILL — vendor raw-material purchase log. A party (vendor) is
// always required. 2026-08-08: "YE LINK HONA CHAHIYE... SABHI CHEJE LINK
// RAHEGI" made the order link REQUIRED — every purchase tied to the
// PO/RF/RG it was bought for, so "which party this order's item came from"
// is answerable from the order side (see the reverse lookup on the Orders
// hub). 2026-08-17: "KACHA MAAL... GENERAL STOCK KE LIYE — KOI FIXED PO
// NAHI" — raw-material vendor purchases (e.g. Aaradhya Fabrics) are bought
// as general stock, not for one specific order, so the order link is back
// to OPTIONAL — but purchase_bills has no company_id of its own; it was
// always derived from order_id -> orders.company_id. An orderless bill has
// no order to derive it from, so company_id is now a real column on
// purchase_bills: set from the linked order when there is one (unchanged
// behavior), or from the employee's currently-selected company
// (employee.currentCompanyId) when there isn't. See
// db/2026-08-17-purchase-bills-optional-order-company-id.sql.
// =============================================================================

type PurchaseBillParams = {
  vendorPartyId: string;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string | null;
  qty: number;
  sqFeet: number;
  qtyUnit: string;
  workDescription: string | null;
  unitRate: number;
  orderId: string | null;
  gstRatePct: number | null;
  gstType: string | null;
  // 2026-08-17: manual round-off so the system total can match a vendor
  // invoice that itself rounds by a few paise (e.g. AF/145: -0.30). See
  // db/2026-08-17-purchase-bills-round-off.sql. Defaults to 0 (no-op) for
  // any caller that doesn't pass one — e.g. the multi-PO form, where one
  // shared invoice becomes several rows and a single round-off figure
  // can't be unambiguously split across them.
  roundOffAmt: number;
};

async function savePurchaseBillCore(
  employee: AuthedEmployee,
  supabase: ServiceClient,
  p: PurchaseBillParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.vendorPartyId) return { error: "Select a vendor party.", id: null, docNo: null };
  if (!p.vendorInvoiceNo) return { error: "Vendor Invoice No. is required.", id: null, docNo: null };

  // Order link is optional (see section header comment above) — when given,
  // it still pins down the company unambiguously and must be one the
  // employee can access; when absent, fall back to whichever company is
  // currently selected in the top-nav switcher.
  let companyId: string;
  if (p.orderId) {
    const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", p.orderId).maybeSingle();
    if (!order || !employee.companyIds.includes(order.company_id)) {
      return { error: "The looked-up order is not accessible — clear it and try again.", id: null, docNo: null };
    }
    companyId = order.company_id;
  } else {
    companyId = employee.currentCompanyId;
  }

  const { data, error } = await supabase
    .from("purchase_bills")
    .insert({
      vendor_party_id: p.vendorPartyId,
      vendor_invoice_no: p.vendorInvoiceNo,
      vendor_invoice_date: p.vendorInvoiceDate,
      qty: p.qty || 1,
      sq_feet: p.sqFeet,
      qty_unit: p.qtyUnit || "FT",
      work_description: p.workDescription,
      unit_rate: p.unitRate,
      order_id: p.orderId,
      company_id: companyId,
      gst_rate_pct: p.gstRatePct,
      gst_type: p.gstType,
      round_off_amt: p.roundOffAmt || 0,
    })
    .select("id, vendor_invoice_no, total_amount, g_total_plus_gst")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key")
      ? "This order already has a Purchase Bill under that vendor invoice number."
      : error?.message;
    return { error: `Failed to save Purchase Bill: ${msg ?? "unknown error"}`, id: null, docNo: null };
  }

  // 2026-08-12 (round 10): auto-mirror into the Finance ledger, same as
  // Salary/Advance — "koi pata nahi chal raha ki bill pass register mein
  // ye chala gaya ya nahi" was a real gap (a stale comment elsewhere
  // claimed Purchase Bill already did this; it never actually did).
  // 2026-08-17: company_id now comes from the resolved value above (order's
  // company, or the employee's current company for orderless general-stock
  // purchases) rather than assuming an order always exists.
  // 2026-08-18 fix — this used to mirror `total_amount` (the PRE-GST base,
  // qty*sq_feet*unit_rate), which understates what's actually owed to the
  // vendor by the entire GST amount whenever gst_rate_pct is set.
  // `g_total_plus_gst` (base + GST + round_off_amt) is the real payable
  // total and is what Bill Payment / Party Ledger should show as
  // outstanding — see db/2026-08-18-bill-pass-register-purchase-sync-fix.sql
  // for the one-time repair of rows already mirrored with the wrong value.
  const { data: bprData, error: bprError } = await supabase
    .from("bill_pass_register")
    .insert({
      company_id: companyId,
      invoice_type: "Purchase",
      vendor_invoice_no: p.vendorInvoiceNo,
      invoice_date: p.vendorInvoiceDate,
      invoice_recv_date: p.vendorInvoiceDate,
      total_amt: Number(data.g_total_plus_gst ?? data.total_amount ?? 0),
      party_id: p.vendorPartyId,
      party_type: "Purchase",
      source: "purchase_bill",
      source_id: data.id,
    })
    .select("id")
    .single();
  if (bprError) {
    return {
      error: null,
      id: data.id,
      docNo: `${data.vendor_invoice_no} (saved, but Finance ledger entry failed: ${bprError.message} — add it manually)`,
    };
  }

  // 2026-08-29 (evening) — "ek genral voutcher banega jo bhi bills honge
  // unke liye ... jab send to bill pass register me bhejte hai ... us par
  // click karne par auto mentic JV genrate kare": every bill landing in the
  // Finance ledger auto-gets a Journal Voucher. Best-effort — a JV failure
  // must never roll back or block the Purchase Bill itself, which is
  // already fully saved at this point (same "don't lose what already
  // succeeded" approach as the bprError handling just above).
  if (bprData) {
    await createJournalVoucherForBill(supabase, bprData.id, {
      itemDetails: p.workDescription,
      qty: p.qty || 1,
      qtyUnit: p.qtyUnit || "FT",
    });
    // 2026-08-29 (evening, follow-up round) — "Received Chalan": every
    // Purchase Bill landing in the Finance ledger also gets a Received
    // Chalan, same best-effort/non-blocking philosophy as the JV call just
    // above (a failure here must never roll back or block the Purchase
    // Bill, already fully saved by this point). See
    // createReceivedChalanForBillGroup's own header comment for why this
    // is a paperwork document only, never a stock_in mutation.
    await createReceivedChalanForBillGroup(supabase, bprData.id);
  }

  return { error: null, id: data.id, docNo: data.vendor_invoice_no };
}

export async function savePurchaseBill(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const result = await savePurchaseBillCore(employee, supabase, {
    vendorPartyId: str(formData, "vendor_party_id"),
    vendorInvoiceNo: str(formData, "vendor_invoice_no"),
    vendorInvoiceDate: strOrNull(formData, "vendor_invoice_date"),
    qty: numOrZero(formData, "qty"),
    sqFeet: numOrZero(formData, "sq_feet"),
    qtyUnit: str(formData, "qty_unit") || "FT",
    workDescription: strOrNull(formData, "work_description"),
    unitRate: numOrZero(formData, "unit_rate"),
    orderId: strOrNull(formData, "order_id"),
    gstRatePct: strOrNull(formData, "gst_rate_pct") ? Number(str(formData, "gst_rate_pct")) : null,
    gstType: strOrNull(formData, "gst_type"),
    roundOffAmt: numOrZero(formData, "round_off_amt"),
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

// =============================================================================
// PURCHASE BILL — MULTI-PO SELECT. 2026-08-12 (round 10): "JIS JIS PO RF
// RG NO KO SELECT KARE UNKE LIYE JO PARTY INVOICE DALE VO SABHI ME UPDATE
// HO JAYE... ORDER ME PATA CHAL RHA HAI KI KITNE SQ FT MAAL HUA" — one
// vendor invoice commonly covers several orders; instead of retyping the
// same vendor/invoice/rate once per order, an admin now searches/adds
// several orders, enters the shared vendor + invoice + rate ONCE, and gets
// one purchase_bills row per order (qty/sq_feet still per-order — sq_feet
// defaults from the order's own Size field via src/lib/size-parser.ts,
// editable). Reuses savePurchaseBillCore per row — same validation,
// same Finance-ledger mirror — nothing duplicated.
// =============================================================================

export type PurchaseOrderPickResult = {
  error: string | null;
  order: {
    id: string;
    ref_no: string;
    company_id: string;
    size_label: string | null;
    qty: number;
    item_category_name: string | null;
    suggested_sq_feet: number | null;
  } | null;
  existingBillCount: number;
};

/** Lookup used by the Purchase Bill multi-PO picker — adds size/category/qty (not needed by the single-PO form's own OrderLookupBox) and a suggested sq ft parsed from the order's Size field. */
export async function lookupOrderForPurchaseBill(refNo: string): Promise<PurchaseOrderPickResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const trimmed = refNo.trim();
  if (!trimmed) return { error: "Enter a PO/RF/RG number.", order: null, existingBillCount: 0 };

  const { data: order } = await supabase
    .from("orders")
    .select("id, ref_no, company_id, size_label, qty, item_categories(name)")
    .ilike("ref_no", trimmed)
    .in("company_id", employee.companyIds)
    .maybeSingle();

  if (!order) return { error: `No order found for "${trimmed}".`, order: null, existingBillCount: 0 };

  const { count } = await supabase
    .from("purchase_bills")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);

  const category = order.item_categories as unknown as { name: string } | { name: string }[] | null;
  const categoryName = Array.isArray(category) ? category[0]?.name ?? null : category?.name ?? null;
  const { sqFt } = parseSizeToSqFt(order.size_label);

  return {
    error: null,
    order: {
      id: order.id,
      ref_no: order.ref_no,
      company_id: order.company_id,
      size_label: order.size_label,
      qty: order.qty,
      item_category_name: categoryName,
      suggested_sq_feet: sqFt,
    },
    existingBillCount: count ?? 0,
  };
}

// 2026-08-26 — "PO NO select karne ka option nahi aata ek ek kar ke karna
// padta hai jisse kaafi time consume hota hai" — the multi-PO picker above
// required typing the FULL exact ref_no (lookupOrderForPurchaseBill uses
// plain ILIKE, no wildcards — exact match only) with no way to browse or
// autocomplete. This is the typeahead search behind that: partial ref_no,
// several candidates back, so the picker can show a dropdown to click
// instead of needing the whole number memorized. Deliberately lightweight
// (no existingBillCount/suggested_sq_feet here — those still come from
// lookupOrderForPurchaseBill once a specific result is actually picked,
// reusing that already-proven lookup rather than duplicating its logic).
export type PurchaseOrderSearchHit = {
  id: string;
  ref_no: string;
  size_label: string | null;
  item_category_name: string | null;
};

export async function searchOrdersForPurchaseBill(query: string): Promise<PurchaseOrderSearchHit[]> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const { data } = await supabase
    .from("orders")
    .select("id, ref_no, size_label, item_categories(name)")
    .ilike("ref_no", `%${trimmed}%`)
    .in("company_id", employee.companyIds)
    .order("ref_no")
    .limit(15);

  return (data ?? []).map((order) => {
    const category = order.item_categories as unknown as { name: string } | { name: string }[] | null;
    return {
      id: order.id,
      ref_no: order.ref_no,
      size_label: order.size_label,
      item_category_name: Array.isArray(category) ? category[0]?.name ?? null : category?.name ?? null,
    };
  });
}

// 2026-08-26 — "purchase party ek baar choose kar ke invoice no daal de
// invoice date daal de PO NO select karne ka option aaye har PO me alag
// alag rate aayegi baaki fourmula vahi rahega" — Unit Rate used to be ONE
// value shared across every order on the invoice (2026-08-17 decision, see
// this form's own header comment); real vendor invoices don't always price
// every PO the same per sq ft, so rate is now per-line like Qty/Sq. Feet
// already were. qty_unit stays shared (still just one FT/MTR/etc across
// the whole invoice) — that part of the original 2026-08-17 fix (don't mix
// units under one invoice) is unrelated to this and still holds.
export type PurchaseBillMultiLine = { orderId: string; qty: number; sqFeet: number; unitRate: number };
export type PurchaseBillMultiState = {
  error: string | null;
  results: { orderId: string; ok: boolean; docNo: string | null; error: string | null }[] | null;
};

export async function savePurchaseBillMulti(_prev: PurchaseBillMultiState, formData: FormData): Promise<PurchaseBillMultiState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const vendorPartyId = str(formData, "vendor_party_id");
  const vendorInvoiceNo = str(formData, "vendor_invoice_no");
  const vendorInvoiceDate = strOrNull(formData, "vendor_invoice_date");
  const workDescription = strOrNull(formData, "work_description");
  // 2026-08-26 — unit_rate is no longer shared (see PurchaseBillMultiLine's
  // comment above) — each line carries its own rate now. qty_unit is still
  // shared: ONE unit for the whole invoice, so every line's Sq. Feet stays
  // comparable (see purchase-bill-multi-form.tsx's header comment).
  const qtyUnit = str(formData, "qty_unit") || "FT";
  const gstRatePct = strOrNull(formData, "gst_rate_pct") ? Number(str(formData, "gst_rate_pct")) : null;
  const gstType = strOrNull(formData, "gst_type");
  const linesRaw = str(formData, "lines_json");

  if (!vendorPartyId) return { error: "Select a vendor party.", results: null };
  if (!vendorInvoiceNo) return { error: "Vendor Invoice No. is required.", results: null };
  if (!linesRaw) return { error: "Add at least one PO/RF/RG order.", results: null };

  let lines: PurchaseBillMultiLine[];
  try {
    lines = JSON.parse(linesRaw);
  } catch {
    return { error: "Could not read the selected orders — try re-adding them.", results: null };
  }
  if (!Array.isArray(lines) || lines.length === 0) return { error: "Add at least one PO/RF/RG order.", results: null };

  const results: PurchaseBillMultiState["results"] = [];
  for (const line of lines) {
    const result = await savePurchaseBillCore(employee, supabase, {
      vendorPartyId,
      vendorInvoiceNo,
      vendorInvoiceDate,
      qty: line.qty || 1,
      sqFeet: line.sqFeet || 0,
      qtyUnit,
      workDescription,
      unitRate: line.unitRate || 0,
      orderId: line.orderId,
      gstRatePct,
      gstType,
      // Round Off isn't offered on the multi-PO form — one shared invoice
      // becomes several rows here, and a single round-off figure can't be
      // unambiguously split across them (see PurchaseBillParams comment).
      roundOffAmt: 0,
    });
    results!.push({ orderId: line.orderId, ok: !result.error, docNo: result.docNo, error: result.error });
  }

  revalidatePath("/dashboard/documents");
  return { error: null, results };
}

// =============================================================================
// PURCHASE BILL — MULTI-ITEM, ONE INVOICE. 2026-08-26: "agar purchase me ek
// se jyada item ho ... item name Plain rug 3*90 ft qty 1 price/unit 7155,
// item name Plain rug 3*50 ft qty 1 price/unit ..." — one vendor invoice
// with several DIFFERENT items on it (each its own size, its own price,
// so each its own rate/sq ft — unlike Multiple-Orders above, where every
// line intentionally shares ONE rate). Not order-linked — this is the
// general-stock case (see savePurchaseBillCore's own comment on
// order_id being optional): each item becomes its own purchase_bills row
// with order_id NULL, vendor + invoice + date + GST entered once and
// shared. Multiple NULL order_id rows under the same (vendor,
// invoice_no) don't collide — UNIQUE(vendor_party_id, vendor_invoice_no,
// order_id) treats each NULL as distinct, same as this project's
// existing single-order-less Purchase Bill entry already relies on.
// =============================================================================

export type PurchaseBillMultiItemLine = {
  workDescription: string | null;
  qty: number;
  sqFeet: number;
  qtyUnit: string;
  unitRate: number;
};
export type PurchaseBillMultiItemsState = {
  error: string | null;
  results: { index: number; label: string; ok: boolean; docNo: string | null; error: string | null }[] | null;
};

export async function savePurchaseBillMultiItems(
  _prev: PurchaseBillMultiItemsState,
  formData: FormData
): Promise<PurchaseBillMultiItemsState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const vendorPartyId = str(formData, "vendor_party_id");
  const vendorInvoiceNo = str(formData, "vendor_invoice_no");
  const vendorInvoiceDate = strOrNull(formData, "vendor_invoice_date");
  const gstRatePct = strOrNull(formData, "gst_rate_pct") ? Number(str(formData, "gst_rate_pct")) : null;
  const gstType = strOrNull(formData, "gst_type");
  const itemsRaw = str(formData, "items_json");

  if (!vendorPartyId) return { error: "Select a vendor party.", results: null };
  if (!vendorInvoiceNo) return { error: "Vendor Invoice No. is required.", results: null };
  if (!itemsRaw) return { error: "Add at least one item.", results: null };

  let items: PurchaseBillMultiItemLine[];
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    return { error: "Could not read the item rows — try re-adding them.", results: null };
  }
  if (!Array.isArray(items) || items.length === 0) return { error: "Add at least one item.", results: null };

  const results: PurchaseBillMultiItemsState["results"] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const result = await savePurchaseBillCore(employee, supabase, {
      vendorPartyId,
      vendorInvoiceNo,
      vendorInvoiceDate,
      qty: item.qty || 1,
      sqFeet: item.sqFeet || 0,
      qtyUnit: item.qtyUnit || "FT",
      workDescription: item.workDescription,
      unitRate: item.unitRate,
      orderId: null,
      gstRatePct,
      gstType,
      // Round Off isn't offered here, same reasoning as Multiple-Orders
      // above — one shared invoice becomes several rows; a single
      // round-off figure can't be unambiguously split across them.
      roundOffAmt: 0,
    });
    results!.push({
      index: i,
      label: item.workDescription?.trim() || `Item ${i + 1}`,
      ok: !result.error,
      docNo: result.docNo,
      error: result.error,
    });
  }

  revalidatePath("/dashboard/documents");
  return { error: null, results };
}

export async function updatePurchaseBill(_prev: DocEditState, formData: FormData): Promise<DocEditState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id");
  if (!id) return { error: "Missing Purchase Bill.", success: false };
  // 2026-08-12 (round 11 security review): every sibling update/delete pair
  // in this file (Credit Note, Debit Note, Washing Entry, Internal Invoice)
  // verifies company access before writing; this one previously didn't.
  // 2026-08-17: purchase_bills now has its own company_id column (see
  // savePurchaseBillCore's comment above) — for a bill WITH an order, the
  // order's own company is still the source of truth (unchanged, in case
  // the two ever drift); for an orderless general-stock bill, company_id
  // itself is the only source, so it's checked directly.
  const { data: existingBill } = await supabase.from("purchase_bills").select("id, order_id, company_id").eq("id", id).single();
  if (!existingBill) return { error: "Purchase Bill not found.", success: false };
  if (existingBill.order_id) {
    const { data: order } = await supabase.from("orders").select("company_id").eq("id", existingBill.order_id).single();
    if (!order || !employee.companyIds.includes(order.company_id)) {
      return { error: "You don't have access to this bill's company.", success: false };
    }
  } else if (!existingBill.company_id || !employee.companyIds.includes(existingBill.company_id)) {
    return { error: "You don't have access to this bill's company.", success: false };
  }
  const vendorPartyId = str(formData, "vendor_party_id");
  const vendorInvoiceNo = str(formData, "vendor_invoice_no");
  if (!vendorPartyId) return { error: "Select a vendor party.", success: false };
  if (!vendorInvoiceNo) return { error: "Vendor Invoice No. is required.", success: false };

  const { data: updated, error } = await supabase
    .from("purchase_bills")
    .update({
      vendor_party_id: vendorPartyId,
      vendor_invoice_no: vendorInvoiceNo,
      vendor_invoice_date: strOrNull(formData, "vendor_invoice_date"),
      qty: numOrZero(formData, "qty") || 1,
      sq_feet: numOrZero(formData, "sq_feet"),
      qty_unit: str(formData, "qty_unit") || "FT",
      work_description: strOrNull(formData, "work_description"),
      unit_rate: numOrZero(formData, "unit_rate"),
      gst_rate_pct: strOrNull(formData, "gst_rate_pct") ? Number(str(formData, "gst_rate_pct")) : null,
      gst_type: strOrNull(formData, "gst_type"),
      round_off_amt: numOrZero(formData, "round_off_amt"),
    })
    .eq("id", id)
    .select("id, vendor_party_id, vendor_invoice_no, vendor_invoice_date, g_total_plus_gst, total_amount")
    .single();

  if (error) {
    const msg = error.message.includes("duplicate key") ? "This vendor already has a bill with that invoice number." : error.message;
    return { error: msg, success: false };
  }

  // 2026-08-18 fix — "why to cannot update": editing a Purchase Bill (e.g.
  // fixing qty/rate/GST) updated purchase_bills correctly, but the mirrored
  // bill_pass_register row (source='purchase_bill') was NEVER re-synced, so
  // Bill Payment / Party Ledger kept showing whatever total_amt was frozen
  // at from the ORIGINAL save — looking like the edit silently did nothing.
  // This is the exact "source discriminator" sync-back rule (see BRAIN.md
  // §4) that every other mirrored-row edit path already follows; Purchase
  // Bill's edit path was the one that never got it. Also carries
  // vendor_party_id/vendor_invoice_no/invoice_date through in case those
  // were changed too — matches what the ledger row should reflect either
  // way. Missing mirror row (e.g. the original insert's Finance-ledger step
  // failed, see savePurchaseBillCore) is not an error here — nothing to
  // sync in that case, the bill just was never in Finance to begin with.
  if (updated) {
    await supabase
      .from("bill_pass_register")
      .update({
        total_amt: Number(updated.g_total_plus_gst ?? updated.total_amount ?? 0),
        party_id: updated.vendor_party_id,
        vendor_invoice_no: updated.vendor_invoice_no,
        invoice_date: updated.vendor_invoice_date,
        invoice_recv_date: updated.vendor_invoice_date,
      })
      .eq("source", "purchase_bill")
      .eq("source_id", id);
  }

  revalidatePath("/dashboard/documents");
  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: true };
}

export async function deletePurchaseBill(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  // 2026-08-12 (round 11 security review): see updatePurchaseBill's identical comment above.
  const { data: existingBill } = await supabase.from("purchase_bills").select("id, order_id, vendor_invoice_no").eq("id", id).single();
  if (!existingBill) return { error: "Purchase Bill not found.", success: false };
  let companyId: string | null = null;
  if (existingBill.order_id) {
    const { data: order } = await supabase.from("orders").select("company_id").eq("id", existingBill.order_id).single();
    if (!order || !employee.companyIds.includes(order.company_id)) {
      return { error: "You don't have access to this bill's company.", success: false };
    }
    companyId = order.company_id;
  }

  // 2026-08-26 — "koi entry delete kar de to jaha jaha reflect hui hai
  // vaha se automatic hat jaye": deleting a Purchase Bill left its
  // auto-mirrored bill_pass_register row (source='purchase_bill',
  // savePurchaseBillCore) behind untouched — the bill vanished from
  // Documents but kept showing in Bill Payment / Party Ledger forever,
  // pointing at a purchase_bills row that no longer existed. updatePurchaseBill
  // already re-syncs this mirror on EDIT (2026-08-18 fix); delete never got
  // the equivalent fix until now.
  //
  // Not a blind cascade, though: bill_pass_register_payments references
  // this mirror ON DELETE CASCADE, and there is no UI anywhere in this app
  // to remove a recorded payment — so if money has actually been paid
  // against this bill, silently deleting the mirror would silently erase
  // real payment history with it. That case blocks instead, same
  // "unlink first" convention deleteCreditNote already uses for its own
  // bill_pass_register link — except here there's genuinely nothing to
  // unlink from the UI yet, so the message says so plainly rather than
  // sending the user looking for a button that doesn't exist.
  const { data: mirrorRow } = await supabase
    .from("bill_pass_register")
    .select("id, total_paid")
    .eq("source", "purchase_bill")
    .eq("source_id", id)
    .maybeSingle();

  if (mirrorRow) {
    const { count: paymentCount } = await supabase
      .from("bill_pass_register_payments")
      .select("id", { count: "exact", head: true })
      .eq("bill_pass_register_id", mirrorRow.id);

    if ((paymentCount ?? 0) > 0 || Number(mirrorRow.total_paid) > 0) {
      return {
        error:
          "This Purchase Bill has payment(s) already recorded against it in Bill Payment — it can't be deleted without also losing that payment history. Contact an admin to resolve the Finance entry first.",
        success: false,
      };
    }
  }

  const { error } = await supabase.from("purchase_bills").delete().eq("id", id);
  if (error) return { error: error.message, success: false };

  if (mirrorRow) {
    await supabase.from("bill_pass_register").delete().eq("id", mirrorRow.id);
  }

  await logAudit(supabase, {
    companyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "purchase_bill.deleted",
    entityType: "purchase_bill",
    entityId: id,
    entityLabel: existingBill.vendor_invoice_no,
  });

  revalidatePath("/dashboard/documents");
  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: true };
}

// =============================================================================
// COURIER BILL (freight_bills) / DUTY & TAX BILL (duty_tax_bills) —
// invoice-level header + per-AWB assignment rows. lookupOrderForReconciliation
// is the shared PO/RF/RG-or-AWB lookup the "assign an AWB" step uses.
// =============================================================================

export type ReconciliationLookup = {
  error: string | null;
  // 2026-08-20 (order-value fix): order_value_inr added here — the
  // "Sale Amt" this lookup box shows now comes from the order itself
  // (app-computed, always populated), not dispatch_invoices.org_sale_amt_inr
  // (dead — nothing writes it post-historical-import). See freight-bills/
  // [id]/report/page.tsx's comment for the full why.
  order: { id: string; ref_no: string; company_id: string; order_value_inr: number | null } | null;
  orderShipmentId: string | null;
  dispatch: {
    awb_no: string | null;
    courier_name: string | null;
    buyer_country: string | null;
    shipping_weight_kg: number | null;
  } | null;
  alreadyAssigned: boolean;
  // 2026-09-01: what this shipment was booked for (any real courier
  // booking flow) — freight bills only (see the reconciliation migration's
  // comment on why duty bills don't get this). Surfaced in the manual
  // Assign-AWB form so the "recheck" comparison isn't PDF-import-only.
  bookedFreightAmt: number | null;
  bookedCurrency: string | null;
  bookedAmountSource: "api" | "rate_card_estimate" | null;
};

const EMPTY_RECON: ReconciliationLookup = {
  error: null,
  order: null,
  orderShipmentId: null,
  dispatch: null,
  alreadyAssigned: false,
  bookedFreightAmt: null,
  bookedCurrency: null,
  bookedAmountSource: null,
};

// Gap 1 (2026-08-20): a courier bill is billed PER AWB, and an order can
// now have more than one (see claude/gap1-multipackage-design-2026-08-20.md)
// — so this needs to resolve a specific order_shipments row, not just an
// order. Two lookup paths:
//   - by AWB: order_shipments.awb_no is unambiguous by construction (one
//     real AWB = one order_shipments row) — resolves directly.
//   - by PO/RF/RG: unambiguous ONLY when that order has exactly one
//     shipment (true for every order today, and for any order that stays
//     single-package going forward) — auto-picks it, same zero-friction
//     behavior as before this change. An order with >1 shipment can't be
//     resolved by ref_no alone (which AWB would "PO-0001" even mean?), so
//     that case returns an error asking to search by AWB instead, rather
//     than silently guessing shipment 1.
export async function lookupOrderForReconciliation(
  query: string,
  billKind: "freight" | "duty"
): Promise<ReconciliationLookup> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const trimmed = query.trim();
  if (!trimmed) return { ...EMPTY_RECON, error: "Enter a PO/RF/RG or AWB number." };

  let orderId: string | null = null;
  let orderShipmentId: string | null = null;

  const { data: byAwb } = await supabase.from("order_shipments").select("id, order_id").ilike("awb_no", trimmed).maybeSingle();
  if (byAwb) {
    orderId = byAwb.order_id;
    orderShipmentId = byAwb.id;
  }

  if (!orderId) {
    const { data: byRef } = await supabase
      .from("orders")
      .select("id, ref_no, company_id, order_value_inr")
      .ilike("ref_no", trimmed)
      .in("company_id", employee.companyIds)
      .maybeSingle();
    if (byRef) {
      orderId = byRef.id;
      const { data: shipments } = await supabase.from("order_shipments").select("id").eq("order_id", byRef.id);
      if (!shipments || shipments.length === 0) {
        // 2026-08-24: return the order (not just the error) so the caller
        // can offer an inline "add shipment" box right here instead of a
        // dead end — see createShipmentForMatch below and
        // claude/tracking-manual-match-no-shipment-gap-2026-08-24.md.
        return { ...EMPTY_RECON, order: byRef, error: `Order "${trimmed}" has no shipment/AWB entered yet — add one below.` };
      }
      if (shipments.length > 1) {
        return { ...EMPTY_RECON, error: `Order "${trimmed}" has ${shipments.length} shipments/AWBs — search by AWB instead to pick the specific one.` };
      }
      orderShipmentId = shipments[0].id;
    }
  }

  if (!orderId || !orderShipmentId) return { ...EMPTY_RECON, error: `No order found for "${trimmed}".` };

  const { data: order } = await supabase.from("orders").select("id, ref_no, company_id, order_value_inr").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { ...EMPTY_RECON, error: `No order found for "${trimmed}".` };
  }

  const { data: dispatch } = await supabase
    .from("dispatch_invoices")
    .select("awb_no, courier_name, buyer_country, shipping_weight_kg")
    .eq("order_id", order.id)
    .maybeSingle();

  const table = billKind === "freight" ? "freight_bill_awb_assignments" : "duty_bill_awb_assignments";
  const { data: existing } = await supabase.from(table).select("id").eq("order_shipment_id", orderShipmentId).maybeSingle();

  let bookedFreightAmt: number | null = null;
  let bookedCurrency: string | null = null;
  let bookedAmountSource: "api" | "rate_card_estimate" | null = null;
  if (billKind === "freight") {
    const { data: shipmentRow } = await supabase
      .from("order_shipments")
      .select("booked_freight_amt, booked_currency, booked_amount_source")
      .eq("id", orderShipmentId)
      .maybeSingle();
    bookedFreightAmt = shipmentRow?.booked_freight_amt ?? null;
    bookedCurrency = shipmentRow?.booked_currency ?? null;
    bookedAmountSource = shipmentRow?.booked_amount_source ?? null;
  }

  return {
    error: null,
    order,
    orderShipmentId,
    dispatch: dispatch ?? null,
    alreadyAssigned: !!existing,
    bookedFreightAmt,
    bookedCurrency,
    bookedAmountSource,
  };
}

export type CreateShipmentResult = { error: string | null; orderShipmentId: string | null };

/**
 * 2026-08-24: inline "add shipment/AWB" escape hatch for the Courier Bill /
 * Duty & Tax Bill manual-match screens (hand-entry AssignAwbForm and the
 * PDF-upload FixMatchBox). Gap 1 (2026-08-20) made
 * lookupOrderForReconciliation require an existing order_shipments row
 * before a bill can be matched to an order, but the only way to create
 * that row was a separate, unlinked page (Order Shipments & Packages) —
 * confirmed to be the root cause behind the user's "manual ka option nahi
 * hai" report (see claude/tracking-manual-match-no-shipment-gap-2026-08-24.md).
 * This lets staff create the shipment right here instead. Deliberately
 * minimal (Shipment No / AWB / Courier only) — full package/weight detail
 * is still entered via Order Shipments & Packages.
 */
export async function createShipmentForMatch(_prev: CreateShipmentResult, formData: FormData): Promise<CreateShipmentResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  const shipmentNoRaw = str(formData, "shipment_no");
  const shipmentNo = shipmentNoRaw ? parseInt(shipmentNoRaw, 10) : 1;
  if (!orderId) return { error: "Missing order.", orderShipmentId: null };
  if (!Number.isInteger(shipmentNo) || shipmentNo < 1) {
    return { error: "Shipment No. must be a positive whole number.", orderShipmentId: null };
  }

  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "That order is not accessible — look it up again.", orderShipmentId: null };
  }

  const { data, error } = await supabase
    .from("order_shipments")
    .upsert(
      {
        order_id: orderId,
        shipment_no: shipmentNo,
        awb_no: strOrNull(formData, "awb_no"),
        courier_name: strOrNull(formData, "courier_name"),
        created_by_employee_id: employee.id,
      },
      { onConflict: "order_id,shipment_no" }
    )
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not save shipment.", orderShipmentId: null };

  await resyncDispatchSummary(supabase, orderId);
  revalidatePath("/dashboard/order-packages");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/documents");
  return { error: null, orderShipmentId: data.id };
}

type FreightBillParams = {
  invoiceNo: string;
  invoiceDate: string | null;
  billWeightKg: number | null;
  freightAmt: number;
  fuelAmt: number;
  otherCharges: number;
  // 2026-08-12: "shipment ke against me courier ka credit note aagya" —
  // optional (PDF-extracted and bulk-CSV bills never have these; only the
  // manual entry form below collects them), captured against THIS bill.
  creditNoteNo?: string | null;
  creditNoteDate?: string | null;
  creditNoteAmt?: number;
  // 2026-08-17: "SABHI PARTY KE LADGER BHI NAHI BANE" — Courier Bills had no
  // vendor/party linkage at all, so a Courier Bill sent to the Finance
  // ledger could never surface under any specific party's ledger (party_id
  // stayed NULL). Optional (existing bills + PDF/CSV imports won't have
  // this filled in) — but selecting it here is what lets this bill show up
  // in that courier's Party Ledger later.
  vendorPartyId?: string | null;
};

async function saveFreightBillCore(
  supabase: ServiceClient,
  p: FreightBillParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.invoiceNo) return { error: "Invoice No. is required.", id: null, docNo: null };

  const { data, error } = await supabase
    .from("freight_bills")
    .insert({
      invoice_no: p.invoiceNo,
      invoice_date: p.invoiceDate,
      bill_weight_kg: p.billWeightKg,
      freight_amt: p.freightAmt,
      fuel_amt: p.fuelAmt,
      other_charges: p.otherCharges,
      credit_note_no: p.creditNoteNo ?? null,
      credit_note_date: p.creditNoteDate ?? null,
      credit_note_amt: p.creditNoteAmt ?? 0,
      vendor_party_id: p.vendorPartyId ?? null,
    })
    .select("id, invoice_no")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key") ? "A Courier Bill with that Invoice No. already exists." : error?.message;
    return { error: `Failed to save Courier Bill: ${msg ?? "unknown error"}`, id: null, docNo: null };
  }
  return { error: null, id: data.id, docNo: data.invoice_no };
}

export async function saveFreightBill(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const result = await saveFreightBillCore(supabase, {
    invoiceNo: str(formData, "invoice_no"),
    invoiceDate: strOrNull(formData, "invoice_date"),
    billWeightKg: numOrNull(formData, "bill_weight_kg"),
    freightAmt: numOrZero(formData, "freight_amt"),
    fuelAmt: numOrZero(formData, "fuel_amt"),
    otherCharges: numOrZero(formData, "other_charges"),
    creditNoteNo: strOrNull(formData, "credit_note_no"),
    creditNoteDate: strOrNull(formData, "credit_note_date"),
    creditNoteAmt: numOrZero(formData, "credit_note_amt"),
    vendorPartyId: strOrNull(formData, "vendor_party_id"),
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

/**
 * 2026-08-17 (round 1): "purane bills me edit option bana do" — narrowly
 * scoped to vendor/party at the time, since that was the one brand-new
 * column with no way to backfill it. Superseded by updateFreightBillDetails
 * below (2026-08-17 round 2 — "SABHI PARKAR KE BILL" edit option), which
 * covers this plus every other field. Left in place, unused, rather than
 * deleted — no functional reason to remove a working action.
 */
export async function updateFreightBillVendor(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const freightBillId = str(formData, "freight_bill_id");
  const vendorPartyId = strOrNull(formData, "vendor_party_id");
  if (!freightBillId) return { error: "Missing Courier Bill.", success: false };

  const { error } = await supabase.from("freight_bills").update({ vendor_party_id: vendorPartyId }).eq("id", freightBillId);
  if (error) return { error: error.message, success: false };

  await supabase.from("bill_pass_register").update({ party_id: vendorPartyId }).eq("source", "freight_bill").eq("source_id", freightBillId);

  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

/**
 * 2026-08-17 (round 2): "SABHI PARKAR KE BILL" ke liye update option chahiye
 * — Courier Bill ka full header edit (invoice no/date, weight, freight/fuel/
 * other charges, whole-bill credit note, vendor) — sirf vendor tak simit
 * nahi. total_amt/gst_18pct_amt/gross_total_amt STORED generated columns
 * hain (freight_amt+fuel_amt+other_charges se), isliye wo khud recalculate
 * ho jate hain — unhe direct set nahi kiya ja sakta aur karne ki zaroorat
 * bhi nahi.
 *
 * Agar ye bill pehle se "Sent to Bill Pass Register" ho chuka hai, to
 * invoice_no/invoice_date bill_pass_register ke mirror row (source=
 * 'freight_bill') me bhi sync karte hain — vendor sync (updateFreightBillVendor)
 * jaisa hi pattern, taaki edit karne ke baad Finance ledger wala row purana
 * (stale) invoice no/date na dikhaye. total_amt jaan-bujhkar NAHI chhedte —
 * wo "Send to Finance" ke time par ek insaan ne review karke set kiya tha
 * (credit note wagera adjust karke), aur bill ke raw total se alag ho sakta
 * hai jaan-bujhkar — usi tarah jaise total_paid ko is session me payment-
 * reconciliation kaam me jaan-bujhkar nahi chheda (already-reviewed numbers
 * ko silently overwrite karna galat data bana sakta hai).
 */
export async function updateFreightBillDetails(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const freightBillId = str(formData, "freight_bill_id");
  if (!freightBillId) return { error: "Missing Courier Bill.", success: false };
  const invoiceNo = str(formData, "invoice_no");
  if (!invoiceNo) return { error: "Invoice No. is required.", success: false };
  const invoiceDate = strOrNull(formData, "invoice_date");
  const vendorPartyId = strOrNull(formData, "vendor_party_id");

  const { error } = await supabase
    .from("freight_bills")
    .update({
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      bill_weight_kg: numOrNull(formData, "bill_weight_kg"),
      freight_amt: numOrZero(formData, "freight_amt"),
      fuel_amt: numOrZero(formData, "fuel_amt"),
      other_charges: numOrZero(formData, "other_charges"),
      credit_note_no: strOrNull(formData, "credit_note_no"),
      credit_note_date: strOrNull(formData, "credit_note_date"),
      credit_note_amt: numOrZero(formData, "credit_note_amt"),
      vendor_party_id: vendorPartyId,
    })
    .eq("id", freightBillId);
  if (error) {
    const msg = error.message.includes("duplicate key") ? "A Courier Bill with that Invoice No. already exists." : error.message;
    return { error: msg, success: false };
  }

  await supabase
    .from("bill_pass_register")
    .update({ party_id: vendorPartyId, vendor_invoice_no: invoiceNo, invoice_date: invoiceDate, invoice_recv_date: invoiceDate })
    .eq("source", "freight_bill")
    .eq("source_id", freightBillId);

  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function deleteFreightBill(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: assigned } = await supabase.from("freight_bill_awb_assignments").select("id").eq("freight_bill_id", id).limit(1).maybeSingle();
  if (assigned) return { error: "This Courier Bill has AWBs assigned to it — remove those assignments first.", success: false };
  const { data: inFinance } = await supabase.from("bill_pass_register").select("id").eq("source", "freight_bill").eq("source_id", id).limit(1).maybeSingle();
  if (inFinance) return { error: "This Courier Bill is already in the Finance ledger (Bill Pass Register) — remove that entry first.", success: false };

  const { data: bill } = await supabase.from("freight_bills").select("invoice_no").eq("id", id).maybeSingle();
  const { error } = await supabase.from("freight_bills").delete().eq("id", id);
  if (error) return { error: error.message, success: false };

  await logAudit(supabase, {
    employeeId: employee.id,
    employeeName: employee.name,
    action: "freight_bill.deleted",
    entityType: "freight_bill",
    entityId: id,
    entityLabel: bill?.invoice_no ?? null,
  });

  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function assignFreightAwb(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const freightBillId = str(formData, "freight_bill_id");
  const orderId = str(formData, "order_id");
  const orderShipmentId = str(formData, "order_shipment_id");
  if (!freightBillId) return initialFail("Missing Courier Bill.");
  if (!orderId || !orderShipmentId) return initialFail("Look up an order by PO/RF/RG or AWB first.");

  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return initialFail("That order is not accessible — look it up again.");
  }

  const { data, error } = await supabase
    .from("freight_bill_awb_assignments")
    .insert({
      freight_bill_id: freightBillId,
      order_id: orderId,
      order_shipment_id: orderShipmentId,
      bill_weight_kg: numOrNull(formData, "bill_weight_kg"),
      dimensional_weight_kg: numOrNull(formData, "dimensional_weight_kg"),
      difference_amt: numOrNull(formData, "difference_amt"),
      // 2026-09-01: booking-cost-vs-billed-cost recheck — see
      // db/2026-09-01-multi-courier-booking-and-freight-recon.sql.
      billed_freight_amt: numOrNull(formData, "billed_freight_amt"),
      remark: strOrNull(formData, "remark"),
    })
    .select("id")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key")
      ? "This order/AWB is already assigned to a Courier Bill (an AWB can only be billed once)."
      : error?.message;
    return initialFail(`Failed to assign AWB: ${msg ?? "unknown error"}`);
  }
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: data.id, docNo: "" } };
}

export async function deleteFreightAwbAssignment(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  // 2026-08-12 (round 11 security review): same assignment->order->company
  // check updateFreightAwbAssignmentNotes already does below — this delete
  // previously skipped it.
  const { data: assignment } = await supabase.from("freight_bill_awb_assignments").select("id, order_id").eq("id", id).maybeSingle();
  if (!assignment) return { error: "Assignment not found.", success: false };
  const { data: order } = await supabase.from("orders").select("company_id").eq("id", assignment.order_id).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "You don't have access to this assignment's company.", success: false };
  }
  const { error } = await supabase.from("freight_bill_awb_assignments").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

// =============================================================================
// COURIER BILL — BULK AWB ASSIGN + AWB-LEVEL NOTES + FINANCE HAND-OFF.
// 2026-08-12 (round 10): "SUPOSE KARO PICHLE MAHINE 200 SHIPMENT GAYI...
// AWB TRACKING NO KO SELECT KARNE KA OPTION HO PHIR UNKE AGAINST ME DETAIL
// DALNE KA OPTION HO" — assigning AWBs to a bill one at a time (the
// existing AssignAwbForm) doesn't scale to a real month's shipment count;
// bulkAssignFreightAwbs takes a list of PO/RF/RG-or-AWB queries + per-row
// figures and assigns them all in one submit, tolerating individual
// failures (a typo'd number in a list of 50 shouldn't block the other 49).
// =============================================================================

export type BulkAwbRow = {
  query: string; // whatever the admin typed — PO/RF/RG or AWB
  billWeightKg: number | null;
  dimensionalWeightKg: number | null;
  differenceAmt: number | null;
  remark: string | null;
};
export type BulkAwbResult = { query: string; ok: boolean; refNo: string | null; error: string | null };

export async function bulkAssignFreightAwbs(freightBillId: string, rows: BulkAwbRow[]): Promise<{ error: string | null; results: BulkAwbResult[] }> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  if (!freightBillId) return { error: "Missing Courier Bill.", results: [] };

  const results: BulkAwbResult[] = [];
  for (const row of rows) {
    const lookup = await lookupOrderForReconciliation(row.query, "freight");
    if (lookup.error || !lookup.order || !lookup.orderShipmentId) {
      results.push({ query: row.query, ok: false, refNo: null, error: lookup.error ?? "Not found." });
      continue;
    }
    if (!employee.companyIds.includes(lookup.order.company_id)) {
      results.push({ query: row.query, ok: false, refNo: lookup.order.ref_no, error: "Not accessible." });
      continue;
    }
    const { error } = await supabase.from("freight_bill_awb_assignments").insert({
      freight_bill_id: freightBillId,
      order_id: lookup.order.id,
      order_shipment_id: lookup.orderShipmentId,
      bill_weight_kg: row.billWeightKg,
      dimensional_weight_kg: row.dimensionalWeightKg,
      difference_amt: row.differenceAmt,
      remark: row.remark,
    });
    if (error) {
      const msg = error.message.includes("duplicate key") ? "Already assigned to a Courier Bill." : error.message;
      results.push({ query: row.query, ok: false, refNo: lookup.order.ref_no, error: msg });
    } else {
      results.push({ query: row.query, ok: true, refNo: lookup.order.ref_no, error: null });
    }
  }
  revalidatePath("/dashboard/documents");
  return { error: null, results };
}

/** Attach a credit/debit note to one already-assigned AWB — "TRACKING NUMBER KE AGAINST ME AAYEGA", entered whenever the note actually arrives, not necessarily at assignment time. */
export async function updateFreightAwbAssignmentNotes(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  const id = str(formData, "id");
  if (!id) return { error: "Missing assignment.", success: false };

  const { data: assignment } = await supabase.from("freight_bill_awb_assignments").select("id, order_id").eq("id", id).maybeSingle();
  if (!assignment) return { error: "Assignment not found.", success: false };
  const { data: order } = await supabase.from("orders").select("company_id").eq("id", assignment.order_id).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "That AWB is not accessible.", success: false };
  }

  const { error } = await supabase
    .from("freight_bill_awb_assignments")
    .update({
      credit_note_no: strOrNull(formData, "credit_note_no"),
      credit_note_date: strOrNull(formData, "credit_note_date"),
      credit_note_amt: numOrNull(formData, "credit_note_amt"),
      debit_note_no: strOrNull(formData, "debit_note_no"),
      debit_note_date: strOrNull(formData, "debit_note_date"),
      debit_note_amt: numOrNull(formData, "debit_note_amt"),
    })
    .eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

/**
 * "Send to Bill Pass Register" — explicit, reviewed hand-off to Finance.
 * NOT automatic on save: freight_bills has no company_id of its own (one
 * invoice can span AWBs across all 3 companies with no stored split — see
 * schema.sql's comment on bill_pass_register), so an admin picks the
 * company and reviews the amount here rather than the app guessing a
 * split. Idempotent — a second submit for the same bill is blocked once
 * one Finance entry already exists for it.
 */
export async function sendFreightBillToFinance(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const freightBillId = str(formData, "freight_bill_id");
  const companyId = str(formData, "company_id");
  const totalAmt = numOrZero(formData, "total_amt");
  if (!freightBillId) return { error: "Missing Courier Bill.", success: false };
  if (!companyId || !employee.companyIds.includes(companyId)) return { error: "Select a valid company.", success: false };
  if (!totalAmt || totalAmt <= 0) return { error: "Amount must be a positive number.", success: false };

  const { data: existing } = await supabase
    .from("bill_pass_register")
    .select("id")
    .eq("source", "freight_bill")
    .eq("source_id", freightBillId)
    .limit(1)
    .maybeSingle();
  if (existing) return { error: "This Courier Bill has already been sent to the Finance ledger.", success: false };

  const { data: bill } = await supabase
    .from("freight_bills")
    .select("invoice_no, invoice_date, vendor_party_id")
    .eq("id", freightBillId)
    .maybeSingle();

  const { data: bprData, error } = await supabase
    .from("bill_pass_register")
    .insert({
      company_id: companyId,
      invoice_type: "FREIGHT INVOICE",
      vendor_invoice_no: bill?.invoice_no ?? null,
      invoice_date: bill?.invoice_date ?? null,
      invoice_recv_date: bill?.invoice_date ?? null,
      total_amt: totalAmt,
      // 2026-08-17: carry the Courier Bill's own vendor/party through to the
      // Finance ledger — previously this stayed NULL even when the bill had
      // a vendor selected, which is why Courier Bills could never appear in
      // a Party Ledger. party_type stays "Courier" either way (still useful
      // for bills sent before a vendor was ever selected).
      party_id: bill?.vendor_party_id ?? null,
      party_type: "Courier",
      source: "freight_bill",
      source_id: freightBillId,
      remark: strOrNull(formData, "remark"),
    })
    .select("id")
    .single();
  if (error) {
    // Backstopped by uq_bill_pass_register_source — the check above has a
    // race window (two submits landing between check and insert); this
    // catches that instead of surfacing a raw constraint-violation error.
    if (error.message.includes("duplicate key")) return { error: "This Courier Bill has already been sent to the Finance ledger.", success: false };
    return { error: error.message, success: false };
  }
  // 2026-08-29 (evening) — auto-generate a Journal Voucher, same as
  // Purchase Bill above; best-effort, never blocks the send.
  if (bprData) await createJournalVoucherForBill(supabase, bprData.id);
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

type DutyBillParams = {
  invoiceNo: string;
  invoiceDate: string | null;
  dutyTaxAmtUsd: number | null;
  dutyTaxAmtInr: number;
  gst18pctAmt: number;
  // 2026-08-12: same courier-credit-note capture as FreightBillParams above.
  creditNoteNo?: string | null;
  creditNoteDate?: string | null;
  creditNoteAmt?: number;
  // 2026-08-12 (round 10): manual bottom-summary fields off the real Duty
  // Tax Bill document — see schema.sql's comment on these columns.
  disbursementFee?: number;
  courierDutyChargesAdj?: number;
  totalPayableAmt?: number | null;
  // 2026-08-17: same optional vendor/party linkage as FreightBillParams
  // above, for the same Party Ledger reason.
  vendorPartyId?: string | null;
};

async function saveDutyBillCore(
  supabase: ServiceClient,
  p: DutyBillParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.invoiceNo) return { error: "Invoice No. is required.", id: null, docNo: null };

  const { data, error } = await supabase
    .from("duty_tax_bills")
    .insert({
      invoice_no: p.invoiceNo,
      invoice_date: p.invoiceDate,
      duty_tax_amt_usd: p.dutyTaxAmtUsd,
      duty_tax_amt_inr: p.dutyTaxAmtInr,
      gst_18pct_amt: p.gst18pctAmt,
      credit_note_no: p.creditNoteNo ?? null,
      credit_note_date: p.creditNoteDate ?? null,
      credit_note_amt: p.creditNoteAmt ?? 0,
      disbursement_fee: p.disbursementFee ?? 0,
      courier_duty_charges_adj: p.courierDutyChargesAdj ?? 0,
      total_payable_amt: p.totalPayableAmt ?? null,
      vendor_party_id: p.vendorPartyId ?? null,
    })
    .select("id, invoice_no")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key") ? "A Duty & Tax Bill with that Invoice No. already exists." : error?.message;
    return { error: `Failed to save Duty & Tax Bill: ${msg ?? "unknown error"}`, id: null, docNo: null };
  }
  return { error: null, id: data.id, docNo: data.invoice_no };
}

export async function saveDutyBill(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const result = await saveDutyBillCore(supabase, {
    invoiceNo: str(formData, "invoice_no"),
    invoiceDate: strOrNull(formData, "invoice_date"),
    dutyTaxAmtUsd: numOrNull(formData, "duty_tax_amt_usd"),
    dutyTaxAmtInr: numOrZero(formData, "duty_tax_amt_inr"),
    gst18pctAmt: numOrZero(formData, "gst_18pct_amt"),
    creditNoteNo: strOrNull(formData, "credit_note_no"),
    creditNoteDate: strOrNull(formData, "credit_note_date"),
    creditNoteAmt: numOrZero(formData, "credit_note_amt"),
    disbursementFee: numOrZero(formData, "disbursement_fee"),
    courierDutyChargesAdj: numOrZero(formData, "courier_duty_charges_adj"),
    totalPayableAmt: numOrNull(formData, "total_payable_amt"),
    vendorPartyId: strOrNull(formData, "vendor_party_id"),
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

/**
 * 2026-08-17 (round 1): same narrowly-scoped "purane bills me edit option"
 * as updateFreightBillVendor above. Superseded by updateDutyBillDetails
 * below (round 2 — "SABHI PARKAR KE BILL"); left in place, unused.
 */
export async function updateDutyBillVendor(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const dutyTaxBillId = str(formData, "duty_tax_bill_id");
  const vendorPartyId = strOrNull(formData, "vendor_party_id");
  if (!dutyTaxBillId) return { error: "Missing Duty & Tax Bill.", success: false };

  const { error } = await supabase.from("duty_tax_bills").update({ vendor_party_id: vendorPartyId }).eq("id", dutyTaxBillId);
  if (error) return { error: error.message, success: false };

  await supabase.from("bill_pass_register").update({ party_id: vendorPartyId }).eq("source", "duty_tax_bill").eq("source_id", dutyTaxBillId);

  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

/**
 * 2026-08-17 (round 2): full Duty & Tax Bill header edit — same reasoning
 * and same total_payable_amt-not-touched-on-mirror caveat as
 * updateFreightBillDetails above (gross_total_amt IS a generated column
 * here so it recalculates itself; total_payable_amt is NOT generated —
 * schema.sql notes real bills don't reconcile to one clean formula — so it
 * stays a plain editable field, same as at creation).
 */
export async function updateDutyBillDetails(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const dutyTaxBillId = str(formData, "duty_tax_bill_id");
  if (!dutyTaxBillId) return { error: "Missing Duty & Tax Bill.", success: false };
  const invoiceNo = str(formData, "invoice_no");
  if (!invoiceNo) return { error: "Invoice No. is required.", success: false };
  const invoiceDate = strOrNull(formData, "invoice_date");
  const vendorPartyId = strOrNull(formData, "vendor_party_id");

  const { error } = await supabase
    .from("duty_tax_bills")
    .update({
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      duty_tax_amt_usd: numOrNull(formData, "duty_tax_amt_usd"),
      duty_tax_amt_inr: numOrZero(formData, "duty_tax_amt_inr"),
      gst_18pct_amt: numOrZero(formData, "gst_18pct_amt"),
      credit_note_no: strOrNull(formData, "credit_note_no"),
      credit_note_date: strOrNull(formData, "credit_note_date"),
      credit_note_amt: numOrZero(formData, "credit_note_amt"),
      disbursement_fee: numOrZero(formData, "disbursement_fee"),
      courier_duty_charges_adj: numOrZero(formData, "courier_duty_charges_adj"),
      total_payable_amt: numOrNull(formData, "total_payable_amt"),
      vendor_party_id: vendorPartyId,
    })
    .eq("id", dutyTaxBillId);
  if (error) {
    const msg = error.message.includes("duplicate key") ? "A Duty & Tax Bill with that Invoice No. already exists." : error.message;
    return { error: msg, success: false };
  }

  await supabase
    .from("bill_pass_register")
    .update({ party_id: vendorPartyId, vendor_invoice_no: invoiceNo, invoice_date: invoiceDate, invoice_recv_date: invoiceDate })
    .eq("source", "duty_tax_bill")
    .eq("source_id", dutyTaxBillId);

  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function deleteDutyBill(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: assigned } = await supabase.from("duty_bill_awb_assignments").select("id").eq("duty_tax_bill_id", id).limit(1).maybeSingle();
  if (assigned) return { error: "This Duty & Tax Bill has AWBs assigned to it — remove those assignments first.", success: false };
  const { data: inFinance } = await supabase.from("bill_pass_register").select("id").eq("source", "duty_tax_bill").eq("source_id", id).limit(1).maybeSingle();
  if (inFinance) return { error: "This Duty & Tax Bill is already in the Finance ledger (Bill Pass Register) — remove that entry first.", success: false };

  const { data: bill } = await supabase.from("duty_tax_bills").select("invoice_no").eq("id", id).maybeSingle();
  const { error } = await supabase.from("duty_tax_bills").delete().eq("id", id);
  if (error) return { error: error.message, success: false };

  await logAudit(supabase, {
    employeeId: employee.id,
    employeeName: employee.name,
    action: "duty_tax_bill.deleted",
    entityType: "duty_tax_bill",
    entityId: id,
    entityLabel: bill?.invoice_no ?? null,
  });

  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function assignDutyAwb(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const dutyTaxBillId = str(formData, "duty_tax_bill_id");
  const orderId = str(formData, "order_id");
  const orderShipmentId = str(formData, "order_shipment_id");
  if (!dutyTaxBillId) return initialFail("Missing Duty & Tax Bill.");
  if (!orderId || !orderShipmentId) return initialFail("Look up an order by PO/RF/RG or AWB first.");

  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return initialFail("That order is not accessible — look it up again.");
  }

  const { data, error } = await supabase
    .from("duty_bill_awb_assignments")
    .insert({
      duty_tax_bill_id: dutyTaxBillId,
      order_id: orderId,
      order_shipment_id: orderShipmentId,
      duty_tax_amt_usd: numOrNull(formData, "duty_tax_amt_usd"),
      duty_tax_amt_inr: numOrNull(formData, "duty_tax_amt_inr"),
      other_charge: numOrNull(formData, "other_charge"),
      gst_18pct: numOrNull(formData, "gst_18pct"),
      remark: strOrNull(formData, "remark"),
    })
    .select("id")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key")
      ? "This order/AWB is already assigned to a Duty & Tax Bill (an AWB can only be billed once)."
      : error?.message;
    return initialFail(`Failed to assign AWB: ${msg ?? "unknown error"}`);
  }
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: data.id, docNo: "" } };
}

export async function deleteDutyAwbAssignment(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  // 2026-08-12 (round 11 security review): same as deleteFreightAwbAssignment above.
  const { data: assignment } = await supabase.from("duty_bill_awb_assignments").select("id, order_id").eq("id", id).maybeSingle();
  if (!assignment) return { error: "Assignment not found.", success: false };
  const { data: order } = await supabase.from("orders").select("company_id").eq("id", assignment.order_id).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "You don't have access to this assignment's company.", success: false };
  }
  const { error } = await supabase.from("duty_bill_awb_assignments").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

// =============================================================================
// DUTY & TAX BILL — BULK AWB ASSIGN + AWB-LEVEL NOTES + FINANCE HAND-OFF.
// Same shapes/reasoning as the Courier Bill trio above.
// =============================================================================

export type BulkDutyAwbRow = {
  query: string;
  dutyTaxAmtUsd: number | null;
  dutyTaxAmtInr: number | null;
  otherCharge: number | null;
  gst18pct: number | null;
  remark: string | null;
};

export async function bulkAssignDutyAwbs(dutyTaxBillId: string, rows: BulkDutyAwbRow[]): Promise<{ error: string | null; results: BulkAwbResult[] }> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  if (!dutyTaxBillId) return { error: "Missing Duty & Tax Bill.", results: [] };

  const results: BulkAwbResult[] = [];
  for (const row of rows) {
    const lookup = await lookupOrderForReconciliation(row.query, "duty");
    if (lookup.error || !lookup.order || !lookup.orderShipmentId) {
      results.push({ query: row.query, ok: false, refNo: null, error: lookup.error ?? "Not found." });
      continue;
    }
    if (!employee.companyIds.includes(lookup.order.company_id)) {
      results.push({ query: row.query, ok: false, refNo: lookup.order.ref_no, error: "Not accessible." });
      continue;
    }
    const { error } = await supabase.from("duty_bill_awb_assignments").insert({
      duty_tax_bill_id: dutyTaxBillId,
      order_id: lookup.order.id,
      order_shipment_id: lookup.orderShipmentId,
      duty_tax_amt_usd: row.dutyTaxAmtUsd,
      duty_tax_amt_inr: row.dutyTaxAmtInr,
      other_charge: row.otherCharge,
      gst_18pct: row.gst18pct,
      remark: row.remark,
    });
    if (error) {
      const msg = error.message.includes("duplicate key") ? "Already assigned to a Duty & Tax Bill." : error.message;
      results.push({ query: row.query, ok: false, refNo: lookup.order.ref_no, error: msg });
    } else {
      results.push({ query: row.query, ok: true, refNo: lookup.order.ref_no, error: null });
    }
  }
  revalidatePath("/dashboard/documents");
  return { error: null, results };
}

export async function updateDutyAwbAssignmentNotes(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  const id = str(formData, "id");
  if (!id) return { error: "Missing assignment.", success: false };

  const { data: assignment } = await supabase.from("duty_bill_awb_assignments").select("id, order_id").eq("id", id).maybeSingle();
  if (!assignment) return { error: "Assignment not found.", success: false };
  const { data: order } = await supabase.from("orders").select("company_id").eq("id", assignment.order_id).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "That AWB is not accessible.", success: false };
  }

  const { error } = await supabase
    .from("duty_bill_awb_assignments")
    .update({
      credit_note_no: strOrNull(formData, "credit_note_no"),
      credit_note_date: strOrNull(formData, "credit_note_date"),
      credit_note_amt: numOrNull(formData, "credit_note_amt"),
      debit_note_no: strOrNull(formData, "debit_note_no"),
      debit_note_date: strOrNull(formData, "debit_note_date"),
      debit_note_amt: numOrNull(formData, "debit_note_amt"),
    })
    .eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function sendDutyBillToFinance(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const dutyTaxBillId = str(formData, "duty_tax_bill_id");
  const companyId = str(formData, "company_id");
  const totalAmt = numOrZero(formData, "total_amt");
  if (!dutyTaxBillId) return { error: "Missing Duty & Tax Bill.", success: false };
  if (!companyId || !employee.companyIds.includes(companyId)) return { error: "Select a valid company.", success: false };
  if (!totalAmt || totalAmt <= 0) return { error: "Amount must be a positive number.", success: false };

  const { data: existing } = await supabase
    .from("bill_pass_register")
    .select("id")
    .eq("source", "duty_tax_bill")
    .eq("source_id", dutyTaxBillId)
    .limit(1)
    .maybeSingle();
  if (existing) return { error: "This Duty & Tax Bill has already been sent to the Finance ledger.", success: false };

  const { data: bill } = await supabase
    .from("duty_tax_bills")
    .select("invoice_no, invoice_date, vendor_party_id")
    .eq("id", dutyTaxBillId)
    .maybeSingle();

  const { data: bprData, error } = await supabase
    .from("bill_pass_register")
    .insert({
      company_id: companyId,
      invoice_type: "DUTY TAX",
      vendor_invoice_no: bill?.invoice_no ?? null,
      invoice_date: bill?.invoice_date ?? null,
      invoice_recv_date: bill?.invoice_date ?? null,
      total_amt: totalAmt,
      // 2026-08-17: same vendor/party carry-through as sendFreightBillToFinance above.
      party_id: bill?.vendor_party_id ?? null,
      party_type: "Courier",
      source: "duty_tax_bill",
      source_id: dutyTaxBillId,
      remark: strOrNull(formData, "remark"),
    })
    .select("id")
    .single();
  if (error) {
    if (error.message.includes("duplicate key")) return { error: "This Duty & Tax Bill has already been sent to the Finance ledger.", success: false };
    return { error: error.message, success: false };
  }
  // 2026-08-29 (evening) — auto-generate a Journal Voucher, same as
  // Purchase Bill / Courier Bill above; best-effort, never blocks the send.
  if (bprData) await createJournalVoucherForBill(supabase, bprData.id);
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

// =============================================================================
// JOURNAL VOUCHER (JV) — 2026-08-29 (evening). User (Hindi, verbatim):
// "ek genral voutcher banega jo bhi bills honge unke liye kisi me debit
// note lagana padega to vo bhi adjustment hoyega credit note bhi
// adjustment hoyega uska bhi apna serial hoyega sath me jiska jiske sath
// JV/GRN katega uske sath link hoyega" — a JV should exist for every bill,
// its own serial number, linked back to whichever bill it belongs to.
// Follow-up (AskUserQuestion): auto-generates the instant a bill lands in
// bill_pass_register (see the 3 call sites above — savePurchaseBillCore,
// sendFreightBillToFinance, sendDutyBillToFinance — each now calls
// createJournalVoucherForBill right after its own bill_pass_register
// insert). Second follow-up: "JV no automatic ke sath sath manual option
// bhi hona chahiye" — saveJournalVoucherCore below is the manual path, its
// own Document Entry tab, optionally linked to an existing bill via the
// same PartyBillPicker UI Debit Note uses, or left unlinked entirely.
//
// See db/2026-08-29-journal-voucher.sql for the full schema-design
// rationale (why Vendor/Invoice/Debit Amount are snapshotted here but
// Passed Amount prefers a LIVE bill_pass_register.to_be_pay join when
// linked, so a JV never goes stale after a Debit/Credit Note is raised
// against its bill afterward).
// =============================================================================

/**
 * Best-effort auto-create: ONE Journal Voucher per real vendor invoice.
 *
 * 2026-08-29 (later, same evening) — user (Hindi, verbatim): "INVOICE ME JO
 * ITEM HOGA UN SABKI EK HI JV BANEGI CHAHHE PURCHASE HO, OURIOUR HO, DUTY
 * HO" — whatever items are on an invoice, they all share just ONE JV,
 * regardless of bill type. A multi-item/multi-order Purchase Bill inserts N
 * separate `bill_pass_register` rows for ONE real vendor invoice — one per
 * item/order line, each with its own qty/rate/GST (see
 * src/lib/bill-grouping.ts's header comment for why storage stays
 * per-item) — so `savePurchaseBillCore` runs, and this function gets
 * called, once per item in a loop. Without this grouping step that would
 * create N Journal Vouchers for one invoice. Resolve the full sibling
 * group with the EXACT SAME key/condition `groupBills()` already uses
 * everywhere else (Bill Payment, Approvals, Party Ledger) — source =
 * 'purchase_bill' AND a vendor_invoice_no present, grouped by (company_id,
 * party_id, vendor_invoice_no) — before checking for an existing JV or
 * computing the amount, so every item's call converges on the same one JV.
 * Courier/Duty Bill and manual Bill Pass Register rows are never grouped
 * (each already inserts exactly one row per document), so for them this is
 * just the original single-row behavior.
 *
 * Idempotent — if a JV already exists for this invoice (created by an
 * earlier call for a sibling item, a manual entry that linked to one of
 * the group's bills, or a race between two concurrent calls caught by the
 * partial unique index), returns its id instead of erroring. Returns null
 * only if the bill itself doesn't exist or the insert failed for a real
 * reason — callers at the 3 "send to Finance" sites deliberately ignore a
 * null return rather than surfacing it, since a JV is a value-add side
 * effect, not a reason to fail the underlying bill save (same philosophy
 * as those functions' own bprError handling).
 */
async function createJournalVoucherForBill(
  supabase: ServiceClient,
  billPassRegisterId: string,
  prefill?: { itemDetails?: string | null; qty?: number | null; qtyUnit?: string | null }
): Promise<string | null> {
  const { data: bill } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, party_id, vendor_invoice_no, invoice_date, invoice_type, credit_note_amt, adj_amt, source, source_id")
    .eq("id", billPassRegisterId)
    .maybeSingle();
  if (!bill) return null;

  // Resolve the invoice group — see comment above. Matches groupBills()'s
  // own isGroupable condition exactly.
  //
  // 2026-09-02 fix — "jab kisi invoice me debit kuchhua hi nahi hai to
  // ammount kyu aara hai": Debit Amount was wrongly being set to the
  // invoice's full total_amt (so it always showed a nonzero figure, even
  // for a bill with no Debit/Credit Note against it at all). Debit Amount
  // is supposed to be the amount actually adjusted against this invoice —
  // credit_note_amt (a credit note received from the vendor, adjusted
  // here) plus adj_amt (a Debit/Credit Note's cross-invoice adjustment,
  // see bill_pass_register's own column comment) — same two columns
  // to_be_pay already nets out. Zero when neither exists, matching the
  // user's own description of the field.
  let groupIds = [bill.id];
  let groupDebitAdjustment = Number(bill.credit_note_amt ?? 0) + Number(bill.adj_amt ?? 0);
  let groupItemDetails = prefill?.itemDetails ?? null;
  let groupQty = prefill?.qty ?? null;
  let groupQtyUnit = prefill?.qtyUnit ?? null;
  if (bill.source === "purchase_bill" && bill.vendor_invoice_no && bill.party_id) {
    const { data: siblings } = await supabase
      .from("bill_pass_register")
      .select("id, credit_note_amt, adj_amt, source_id")
      .eq("company_id", bill.company_id)
      .eq("party_id", bill.party_id)
      .eq("source", "purchase_bill")
      .eq("vendor_invoice_no", bill.vendor_invoice_no)
      .order("id", { ascending: true }); // deterministic — same set/order regardless of which item's call got here first
    if (siblings && siblings.length > 0) {
      groupIds = siblings.map((s) => s.id);
      groupDebitAdjustment = siblings.reduce((sum, s) => sum + Number(s.credit_note_amt ?? 0) + Number(s.adj_amt ?? 0), 0);

      const sourceIds = siblings.map((s) => s.source_id).filter((id): id is string => !!id);
      if (sourceIds.length > 0) {
        const { data: items } = await supabase
          .from("purchase_bills")
          .select("id, work_description, qty, qty_unit")
          .in("id", sourceIds);
        if (items && items.length > 0) {
          groupItemDetails = items
            .map((it) => `${it.work_description ?? "Item"} (Qty ${it.qty ?? "—"} ${it.qty_unit ?? ""})`.trim())
            .join("; ");
        }
      }
    }
  }

  // "item details me jo item hai vo aana jaruri nahi hai agar vo purchse ka
  // hai freight ka hai duty ka hai ya koi or hai" — when there's no specific
  // item to list (Courier/Duty Bill and manual entries never join back to
  // purchase_bills), fall back to the bill's own type so the column isn't
  // just blank.
  if (!groupItemDetails) groupItemDetails = bill.invoice_type ?? null;

  // "qty me us invoice me kitne item hai ya kitne awb hai" — Qty means the
  // COUNT of items on this invoice (Purchase Bill) or the count of AWBs
  // (Courier/Duty Bill), not a single item's own qty×unit (that detail
  // already lives in item_details above). Overrides whatever the caller's
  // prefill passed for these two bill types.
  if (bill.source === "purchase_bill") {
    groupQty = groupIds.length;
    groupQtyUnit = "Item";
  } else if (bill.source === "freight_bill" && bill.source_id) {
    const { count: awbCount } = await supabase
      .from("freight_bill_awb_assignments")
      .select("id", { count: "exact", head: true })
      .eq("freight_bill_id", bill.source_id);
    if (awbCount != null && awbCount > 0) {
      groupQty = awbCount;
      groupQtyUnit = "AWB";
    }
  } else if (bill.source === "duty_tax_bill" && bill.source_id) {
    const { count: awbCount } = await supabase
      .from("duty_bill_awb_assignments")
      .select("id", { count: "exact", head: true })
      .eq("duty_tax_bill_id", bill.source_id);
    if (awbCount != null && awbCount > 0) {
      groupQty = awbCount;
      groupQtyUnit = "AWB";
    }
  }

  const { data: existing } = await supabase
    .from("journal_vouchers")
    .select("id")
    .in("bill_pass_register_id", groupIds)
    .limit(1);
  if (existing && existing.length > 0) return existing[0].id;

  // Representative row the JV links to — deterministic (first id in the
  // sorted group), so a concurrent duplicate insert always collides on the
  // exact same bill_pass_register_id and gets caught by the partial unique
  // index below, regardless of which sibling's call reaches here first.
  const representativeId = groupIds[0];

  const { data, error } = await supabase
    .from("journal_vouchers")
    .insert({
      company_id: bill.company_id,
      bill_pass_register_id: representativeId,
      party_id: bill.party_id,
      vendor_invoice_no: bill.vendor_invoice_no,
      invoice_date: bill.invoice_date,
      debit_amount: groupDebitAdjustment,
      item_details: groupItemDetails,
      qty: groupQty,
      qty_unit: groupQtyUnit,
      // "perticular me vahi item vala & remark me ok" / "quility ok agr koi
      // dispute nahi ho to" — sensible defaults for an auto-generated JV
      // (previously left blank/"—" on the printed voucher). Whoever reviews
      // the bill can still edit these via the JV edit form if there
      // actually is a dispute — this is just the default, not a locked-in
      // value.
      particulars: groupItemDetails,
      qlty: "OK",
      remark: "OK",
    })
    .select("id")
    .single();

  if (error || !data) {
    // Race window between the existence check above and this insert —
    // the partial unique index on bill_pass_register_id catches it (both
    // concurrent calls resolve the same representativeId, see above).
    if (error?.message.includes("duplicate key")) {
      const { data: retry } = await supabase
        .from("journal_vouchers")
        .select("id")
        .in("bill_pass_register_id", groupIds)
        .limit(1);
      return retry?.[0]?.id ?? null;
    }
    return null;
  }
  return data.id;
}

/**
 * Lazy fallback for the "🖨 JV" link on Bill Payment rows created before
 * this feature existed (or where the eager create above somehow didn't
 * run) — looks up or creates a JV for the given bill and returns its id,
 * or null if the bill itself doesn't exist. Used by
 * journal-vouchers/by-bill/[billId]/route.ts.
 */
export async function ensureJournalVoucherForBill(billPassRegisterId: string): Promise<string | null> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  return createJournalVoucherForBill(supabase, billPassRegisterId);
}

type JournalVoucherParams = {
  companyId: string;
  jvDate: string;
  billPassRegisterId: string | null;
  partyId: string;
  vendorInvoiceNo: string | null;
  invoiceDate: string | null;
  debitAmount: number;
  passedAmount: number | null;
  itemDetails: string | null;
  qty: number | null;
  qtyUnit: string | null;
  qlty: string | null;
  particulars: string | null;
  remark: string | null;
};

async function saveJournalVoucherCore(
  employee: AuthedEmployee,
  supabase: ServiceClient,
  p: JournalVoucherParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.companyId) return { error: "Select a company.", id: null, docNo: null };
  if (!employee.companyIds.includes(p.companyId)) return { error: "You do not have access to this company.", id: null, docNo: null };
  if (!p.partyId) return { error: "Select a party (vendor).", id: null, docNo: null };
  if (!p.jvDate) return { error: "JV Date is required.", id: null, docNo: null };

  const { data, error } = await supabase
    .from("journal_vouchers")
    .insert({
      company_id: p.companyId,
      jv_date: p.jvDate,
      bill_pass_register_id: p.billPassRegisterId,
      party_id: p.partyId,
      vendor_invoice_no: p.vendorInvoiceNo,
      invoice_date: p.invoiceDate,
      debit_amount: p.debitAmount,
      passed_amount: p.passedAmount,
      item_details: p.itemDetails,
      qty: p.qty,
      qty_unit: p.qtyUnit,
      qlty: p.qlty,
      particulars: p.particulars,
      remark: p.remark,
      created_by_employee_id: employee.id,
    })
    .select("id, jv_no")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key")
      ? "This bill already has a Journal Voucher linked to it — edit that one instead, or unlink here."
      : error?.message;
    return { error: `Failed to save Journal Voucher: ${msg ?? "unknown error"}`, id: null, docNo: null };
  }
  return { error: null, id: data.id, docNo: data.jv_no ?? "" };
}

export async function saveJournalVoucher(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const result = await saveJournalVoucherCore(employee, supabase, {
    companyId: str(formData, "company_id"),
    jvDate: str(formData, "jv_date"),
    billPassRegisterId: strOrNull(formData, "bill_pass_register_id"),
    partyId: str(formData, "party_id"),
    vendorInvoiceNo: strOrNull(formData, "vendor_invoice_no"),
    invoiceDate: strOrNull(formData, "invoice_date"),
    debitAmount: numOrZero(formData, "debit_amount"),
    passedAmount: numOrNull(formData, "passed_amount"),
    itemDetails: strOrNull(formData, "item_details"),
    qty: numOrNull(formData, "qty"),
    qtyUnit: strOrNull(formData, "qty_unit"),
    qlty: strOrNull(formData, "qlty"),
    particulars: strOrNull(formData, "particulars"),
    remark: strOrNull(formData, "remark"),
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

export type EditJournalVoucherState = { error: string | null; success: boolean };

export async function updateJournalVoucherDetails(_prev: EditJournalVoucherState, formData: FormData): Promise<EditJournalVoucherState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id");
  if (!id) return { error: "Missing Journal Voucher.", success: false };

  const { data: existing } = await supabase.from("journal_vouchers").select("id, company_id").eq("id", id).maybeSingle();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Journal Voucher not found or you don't have access to this company.", success: false };
  }

  const { error } = await supabase
    .from("journal_vouchers")
    .update({
      party_id: str(formData, "party_id"),
      vendor_invoice_no: strOrNull(formData, "vendor_invoice_no"),
      invoice_date: strOrNull(formData, "invoice_date"),
      debit_amount: numOrZero(formData, "debit_amount"),
      passed_amount: numOrNull(formData, "passed_amount"),
      item_details: strOrNull(formData, "item_details"),
      qty: numOrNull(formData, "qty"),
      qty_unit: strOrNull(formData, "qty_unit"),
      qlty: strOrNull(formData, "qlty"),
      particulars: strOrNull(formData, "particulars"),
      remark: strOrNull(formData, "remark"),
    })
    .eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function deleteJournalVoucher(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase.from("journal_vouchers").select("id, company_id").eq("id", id).maybeSingle();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Journal Voucher not found or you don't have access to this company.", success: false };
  }

  const { error } = await supabase.from("journal_vouchers").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

// =============================================================================
// RECEIVED CHALAN — 2026-08-29 (evening, follow-up round). "Party -> company"
// counterpart to Material OUT Chalan (src/app/dashboard/stock/actions.ts) —
// see db/2026-08-29-received-chalan-and-moc-fields.sql for the full design
// rationale: this is a paperwork/proof-of-receipt document ONLY, deliberately
// NOT wired to stock_in (Purchase Bill and Stock In are two entirely
// separate, unlinked systems in this app — auto-creating stock_in rows here
// would risk double-counting for anyone who also does a manual Stock In for
// the same delivery). Two ways in:
//   1. Auto — the instant a Purchase Bill lands in the Finance ledger (see
//      savePurchaseBillCore's call to createReceivedChalanForBillGroup
//      above). Mirrors createJournalVoucherForBill's exact invoice-group
//      resolution (same key as src/lib/bill-grouping.ts's groupBills()) —
//      learned from the JV "one JV per invoice, not per item" fix earlier
//      the same evening — but builds one received_chalan_items ROW per
//      sibling item instead of a single summed line, since a chalan is
//      meant to show a real per-item breakdown when printed.
//   2. Manual — for job-work returns (printing/washing done) that have no
//      Purchase Bill at all, via createReceivedChalanManual below.
// =============================================================================

type ReceivedChalanItemInput = {
  description: string;
  qty: number;
  qtyUnit: string;
  rate: number | null;
  remark: string | null;
};

async function createReceivedChalanForBillGroup(supabase: ServiceClient, billPassRegisterId: string): Promise<string | null> {
  const { data: bill } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, party_id, vendor_invoice_no, invoice_date, source")
    .eq("id", billPassRegisterId)
    .maybeSingle();
  if (!bill || bill.source !== "purchase_bill" || !bill.party_id) return null;

  // Resolve the invoice group — identical key/condition to
  // createJournalVoucherForBill / groupBills().
  let groupIds = [bill.id];
  if (bill.vendor_invoice_no) {
    const { data: siblings } = await supabase
      .from("bill_pass_register")
      .select("id")
      .eq("company_id", bill.company_id)
      .eq("party_id", bill.party_id)
      .eq("source", "purchase_bill")
      .eq("vendor_invoice_no", bill.vendor_invoice_no)
      .order("id", { ascending: true }); // deterministic, same as createJournalVoucherForBill
    if (siblings && siblings.length > 0) groupIds = siblings.map((s) => s.id);
  }
  const representativeId = groupIds[0];

  const { data: existing } = await supabase.from("received_chalans").select("id").eq("source_id", representativeId).maybeSingle();
  if (existing) return existing.id;

  const { data: pbItems } = await supabase
    .from("purchase_bills")
    .select("id, work_description, qty, qty_unit, unit_rate, order_id")
    .in("id", groupIds);
  if (!pbItems || pbItems.length === 0) return null; // nothing to put on the chalan — bail quietly, non-blocking

  const items: ReceivedChalanItemInput[] = pbItems.map((it) => ({
    description: it.work_description || "Item",
    qty: Number(it.qty ?? 1),
    qtyUnit: it.qty_unit ?? "FT",
    rate: it.unit_rate != null ? Number(it.unit_rate) : null,
    remark: null,
  }));
  // A single-item group's order link carries through — a multi-item group
  // can span several different orders, too ambiguous to pick just one.
  const orderId = pbItems.length === 1 ? pbItems[0].order_id ?? null : null;

  const { data: chalan, error } = await supabase
    .from("received_chalans")
    .insert({
      company_id: bill.company_id,
      party_id: bill.party_id,
      chalan_date: bill.invoice_date ?? new Date().toISOString().slice(0, 10),
      order_id: orderId,
      source: "purchase_bill",
      source_id: representativeId,
    })
    .select("id")
    .single();

  if (error || !chalan) {
    // Race window between the existence check above and this insert — the
    // partial unique index on source_id catches it (same pattern as
    // createJournalVoucherForBill's own duplicate-key retry).
    if (error?.message.includes("duplicate key")) {
      const { data: retry } = await supabase.from("received_chalans").select("id").eq("source_id", representativeId).maybeSingle();
      return retry?.id ?? null;
    }
    return null;
  }

  await supabase.from("received_chalan_items").insert(
    items.map((it) => ({
      chalan_id: chalan.id,
      description: it.description,
      qty: it.qty,
      qty_unit: it.qtyUnit,
      rate: it.rate,
      remark: it.remark,
    }))
  );

  return chalan.id;
}

export type ReceivedChalanState = { error: string | null; success: { chalanNo: string } | null };

export async function createReceivedChalanManual(_prev: ReceivedChalanState, formData: FormData): Promise<ReceivedChalanState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const partyId = str(formData, "party_id");
  const chalanDate = strOrNull(formData, "chalan_date") ?? new Date().toISOString().slice(0, 10);
  const orderId = strOrNull(formData, "order_id");
  const through = strOrNull(formData, "through");
  const noOfPackages = numOrNull(formData, "no_of_packages");
  const remark = strOrNull(formData, "remark");

  if (!companyId) return { error: "Select a company.", success: null };
  if (!employee.companyIds.includes(companyId)) return { error: "You do not have access to this company.", success: null };
  if (!partyId) return { error: "Select a party.", success: null };

  let items: ReceivedChalanItemInput[];
  try {
    items = JSON.parse(str(formData, "items_json") || "[]");
  } catch {
    return { error: "Invalid item data — please retry.", success: null };
  }
  if (!items.length) return { error: "Add at least one item to the chalan.", success: null };
  for (const it of items) {
    if (!it.description?.trim()) return { error: "Every item needs a description.", success: null };
    if (!it.qty || it.qty <= 0) return { error: `Quantity must be greater than 0 for "${it.description}".`, success: null };
  }

  const { data: chalan, error } = await supabase
    .from("received_chalans")
    .insert({
      company_id: companyId,
      party_id: partyId,
      chalan_date: chalanDate,
      order_id: orderId,
      through,
      no_of_packages: noOfPackages,
      source: "manual",
      remark,
    })
    .select("id, chalan_no")
    .single();
  if (error || !chalan?.chalan_no) {
    return { error: `Failed to save Received Chalan: ${error?.message ?? "unknown error"}`, success: null };
  }

  const { error: itemsError } = await supabase.from("received_chalan_items").insert(
    items.map((it) => ({
      chalan_id: chalan.id,
      description: it.description.trim(),
      qty: it.qty,
      qty_unit: it.qtyUnit || "FT",
      rate: it.rate ?? null,
      remark: it.remark ?? null,
    }))
  );
  if (itemsError) {
    return { error: `Chalan ${chalan.chalan_no} saved, but items failed: ${itemsError.message}`, success: null };
  }

  revalidatePath("/dashboard/documents");
  return { error: null, success: { chalanNo: chalan.chalan_no } };
}

export async function deleteReceivedChalan(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase.from("received_chalans").select("id, company_id").eq("id", id).maybeSingle();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "Received Chalan not found or you don't have access to this company.", success: false };
  }

  const { error } = await supabase.from("received_chalans").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

// =============================================================================
// BULK CSV UPLOAD — 2026-08-08 ("CSV UPLOAD OR TEMPLATE VALA SECTION HAR
// JAGH CHAHIYE APNE KO" — the user's ask, after Invoices, to roll the same
// CSV-upload + downloadable-template pattern out everywhere; this batch
// covers all 6 Document Entry types). Every bulkSave* below calls the EXACT
// same *Core() function the single-entry form action uses — nothing
// reimplemented, same as bulkGenerateInvoices/bulkCreateOrders elsewhere.
// None of these doc numbers (cn_no/debit_note_no/chalan_no/vendor_invoice_
// no/freight+duty invoice_no) depend on cross-row ordering the way Orders'
// buyer-batch suffixing does — each is assigned by its own DB trigger/
// unique-constraint independently per row — so rows are processed
// sequentially here only for simple, readable per-row error reporting, not
// because order matters.
// =============================================================================

function normalizeHeader(h: string): string {
  return h.replace(/\*/g, "").trim().toLowerCase();
}
function cellStr(row: Record<string, unknown>, byHeader: Map<string, string>, label: string): string {
  const key = byHeader.get(normalizeHeader(label));
  if (!key) return "";
  const v = row[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

const MAX_BULK_DOC_ROWS = 500;

export type BulkDocResult = { row: number; label: string; docNo: string | null; error: string | null };
export type BulkDocState = { error: string | null; results: BulkDocResult[] | null };

async function readBulkFile(
  formData: FormData
): Promise<{ error: string | null; rows: Record<string, unknown>[]; byHeader: Map<string, string> }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV or Excel file first.", rows: [], byHeader: new Map() };
  }

  let rows: Record<string, unknown>[];
  let headerKeys: string[];
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) as Record<string, unknown>[];
    const headerRow = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][])[0];
    headerKeys = headerRow ?? (rows.length ? Object.keys(rows[0]) : []);
  } catch {
    return {
      error: "Could not read that file — make sure it's the CSV/Excel template, unmodified in structure.",
      rows: [],
      byHeader: new Map(),
    };
  }

  if (!rows.length) return { error: "No data rows found in the file.", rows: [], byHeader: new Map() };
  if (rows.length > MAX_BULK_DOC_ROWS) {
    return { error: `${rows.length} rows — please upload ${MAX_BULK_DOC_ROWS} or fewer at a time.`, rows: [], byHeader: new Map() };
  }

  const byHeader = new Map<string, string>();
  for (const k of headerKeys) byHeader.set(normalizeHeader(k), k);
  return { error: null, rows, byHeader };
}

type BulkOrderRef = {
  id: string;
  company_id: string;
  store_id: string;
  buyer_name_address: string | null;
  order_value_original: number;
  order_value_usd: number | null;
  order_value_inr: number | null;
  invoice_id: string | null;
};

/** Shared PO/RF/RG resolver for bulk rows — same lookup lookupOrderForEntry does, just by exact ref_no match instead of live-typed. */
async function resolveOrderByRefNo(
  supabase: ServiceClient,
  employee: AuthedEmployee,
  refNo: string
): Promise<{ error: string | null; order: BulkOrderRef | null }> {
  if (!refNo) return { error: "PO/RF/RG No. is required.", order: null };
  const { data: order } = await supabase
    .from("orders")
    .select("id, company_id, store_id, buyer_name_address, order_value_original, order_value_usd, order_value_inr, invoice_id")
    .ilike("ref_no", refNo)
    .in("company_id", employee.companyIds)
    .maybeSingle();
  if (!order) return { error: `No order found for "${refNo}".`, order: null };
  return {
    error: null,
    order: { ...order, order_value_original: Number(order.order_value_original) },
  };
}

// ---- Credit Note ------------------------------------------------------

export async function bulkSaveCreditNotes(_prev: BulkDocState, formData: FormData): Promise<BulkDocState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { error: fileError, rows, byHeader } = await readBulkFile(formData);
  if (fileError) return { error: fileError, results: null };

  const results: BulkDocResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const refNo = cellStr(raw, byHeader, "PO/RF/RG No");
    const { error: lookupError, order } = await resolveOrderByRefNo(supabase, employee, refNo);
    if (lookupError || !order) {
      results.push({ row: rowNum, label: refNo, docNo: null, error: lookupError });
      continue;
    }

    let invoiceNo: string | null = null;
    if (order.invoice_id) {
      const { data: inv } = await supabase.from("sales_invoices").select("invoice_no").eq("id", order.invoice_id).maybeSingle();
      invoiceNo = inv?.invoice_no ?? null;
    }

    const refundAmount = Number(cellStr(raw, byHeader, "Refund Amount")) || 0;
    const refundCurrency = cellStr(raw, byHeader, "Refund Currency").toUpperCase() || "INR";
    const refundTypeCell = cellStr(raw, byHeader, "Refund Type");
    const refundType = refundTypeCell || (refundAmount >= order.order_value_original ? "FULL REFUND" : "PARTIAL REFUND");

    const result = await saveCreditNoteCore(employee, supabase, {
      companyId: order.company_id,
      storeId: order.store_id,
      creditNoteDate: cellStr(raw, byHeader, "Credit Note Date"),
      orderId: order.id,
      itemId: null,
      buyerName: order.buyer_name_address,
      refundDate: cellStr(raw, byHeader, "Refund Date") || null,
      itemName: cellStr(raw, byHeader, "Item Name") || null,
      itemPrice: cellStr(raw, byHeader, "Item Price") ? Number(cellStr(raw, byHeader, "Item Price")) : null,
      invoiceNo,
      invoiceValueUsd: order.order_value_usd,
      invoiceValueInr: order.order_value_inr,
      refundAmount,
      refundAmtUsd: refundCurrency === "USD" ? refundAmount : null,
      refundAmtInr: refundCurrency === "USD" ? null : refundAmount,
      creditNoteStatus: null,
      refundType,
      debitNoteId: null,
      remark: cellStr(raw, byHeader, "Remark") || null,
      // Bulk import is the sales/buyer-refund flow (Amazon/Etsy report rows
      // resolved by PO/RF/RG No.) — no vendor party or bill dropdown here,
      // same reasoning as bulkSaveDebitNotes below. Same for the Rate
      // Difference Calculator fields — that's vendor-side (Party) only.
      partyId: null,
      billPassRegisterId: null,
      adjustTargetBillPassRegisterId: null,
      adjustAmount: null,
      adjustRemark: null,
      qty: null,
      poRate: null,
      billedRate: null,
    });

    results.push({ row: rowNum, label: refNo, docNo: result.docNo, error: result.error });
  }

  if (results.some((r) => !r.error)) revalidatePath("/dashboard/documents");
  return { error: null, results };
}

// ---- Debit Note ---------------------------------------------------------

export async function bulkSaveDebitNotes(_prev: BulkDocState, formData: FormData): Promise<BulkDocState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { error: fileError, rows, byHeader } = await readBulkFile(formData);
  if (fileError) return { error: fileError, results: null };

  const [{ data: companies }, { data: parties }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds),
    supabase.from("parties").select("id, name"),
  ]);
  const companyIdByName = new Map((companies ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));
  const partyIdByName = new Map((parties ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));

  const results: BulkDocResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const companyName = cellStr(raw, byHeader, "Company Name");
    const partyName = cellStr(raw, byHeader, "Party Name");
    const label = companyName || partyName;

    const companyId = companyIdByName.get(companyName.trim().toLowerCase());
    if (!companyId) {
      results.push({ row: rowNum, label, docNo: null, error: `Company "${companyName}" not found or not accessible.` });
      continue;
    }
    const partyId = partyIdByName.get(partyName.trim().toLowerCase());
    if (!partyId) {
      results.push({ row: rowNum, label, docNo: null, error: `Party "${partyName}" not found.` });
      continue;
    }

    let orderId: string | null = null;
    const refNo = cellStr(raw, byHeader, "PO/RF/RG No");
    if (refNo) {
      const { order } = await resolveOrderByRefNo(supabase, employee, refNo);
      orderId = order?.id ?? null;
    }

    const result = await saveDebitNoteCore(employee, supabase, {
      companyId,
      debitNoteDate: cellStr(raw, byHeader, "Debit Note Date"),
      againstInvoiceBillNo: cellStr(raw, byHeader, "Against Invoice/Bill No") || null,
      // Bulk-imported debit notes have no dropdown to pick a specific
      // bill_pass_register row from (the source file only has free text) —
      // billPassRegisterId stays null, same as a manually-entered note
      // that isn't linked to a bill yet; the "raised against" text above
      // still round-trips. No adjustment is applied from a bulk import
      // either — see saveDebitNoteCore's own comment on why that's a
      // separate, explicit action.
      billPassRegisterId: null,
      partyId,
      orderId,
      particulars: cellStr(raw, byHeader, "Particulars") || null,
      billNo: cellStr(raw, byHeader, "Bill No") || null,
      billDate: cellStr(raw, byHeader, "Bill Date") || null,
      sqFt: cellStr(raw, byHeader, "SQ FT") ? Number(cellStr(raw, byHeader, "SQ FT")) : null,
      qty: cellStr(raw, byHeader, "Qty") ? Number(cellStr(raw, byHeader, "Qty")) : null,
      rate: cellStr(raw, byHeader, "Rate") ? Number(cellStr(raw, byHeader, "Rate")) : null,
      // 2026-08-29 — optional, same rate-difference reference fields as the
      // manual form (see DebitNoteParams's comment); a bulk row can leave
      // both blank and just fill Debit Amount directly, same as before.
      poRate: cellStr(raw, byHeader, "PO Rate") ? Number(cellStr(raw, byHeader, "PO Rate")) : null,
      billedRate: cellStr(raw, byHeader, "Billed Rate") ? Number(cellStr(raw, byHeader, "Billed Rate")) : null,
      debitAmount: Number(cellStr(raw, byHeader, "Debit Amount")) || 0,
      remark: cellStr(raw, byHeader, "Remark") || null,
      adjustTargetBillPassRegisterId: null,
      adjustAmount: null,
      adjustRemark: null,
    });

    results.push({ row: rowNum, label, docNo: result.docNo, error: result.error });
  }

  if (results.some((r) => !r.error)) revalidatePath("/dashboard/documents");
  return { error: null, results };
}

// ---- Refund ---------------------------------------------------------------

// 2026-08-27 — "jese order ki sheet bani hai vesi har section ki sheet
// banegi ... refund and any other all": the one true gap in the "every
// section gets a bulk-upload sheet like Orders has" ask — everything else
// named (Invoice generation, Credit Note, Debit Note, Freight/Courier
// Bill, Duty & Tax Bill, Purchase Bill) already had one. Drives the exact
// same saveOrderRefundCore (orders/actions.ts) the manual Cancel refund
// screen uses — nothing approximated for bulk.
export async function bulkSaveRefunds(_prev: BulkDocState, formData: FormData): Promise<BulkDocState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { error: fileError, rows, byHeader } = await readBulkFile(formData);
  if (fileError) return { error: fileError, results: null };

  const results: BulkDocResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const refNo = cellStr(raw, byHeader, "PO/RF/RG No");
    const { error: lookupError, order } = await resolveOrderByRefNo(supabase, employee, refNo);
    if (lookupError || !order) {
      results.push({ row: rowNum, label: refNo, docNo: null, error: lookupError });
      continue;
    }

    const result = await saveOrderRefundCore(employee, supabase, {
      orderId: order.id,
      refundAmount: Number(cellStr(raw, byHeader, "Refund Amount")) || 0,
      refundCurrency: cellStr(raw, byHeader, "Refund Currency").toUpperCase() || "USD",
      refundDate: cellStr(raw, byHeader, "Refund Date"),
      reason: cellStr(raw, byHeader, "Reason") || null,
    });

    results.push({ row: rowNum, label: refNo, docNo: result.success?.creditNoteNo ?? "Refund recorded", error: result.error });
  }

  if (results.some((r) => !r.error)) {
    revalidatePath("/dashboard/orders");
    revalidatePath("/dashboard/documents");
    revalidatePath("/dashboard/inventory");
  }
  return { error: null, results };
}

// ---- Washing Entry --------------------------------------------------------

export async function bulkSaveWashingEntries(_prev: BulkDocState, formData: FormData): Promise<BulkDocState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { error: fileError, rows, byHeader } = await readBulkFile(formData);
  if (fileError) return { error: fileError, results: null };

  const [{ data: companies }, { data: parties }, { data: stores }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds),
    supabase.from("parties").select("id, name"),
    supabase.from("stores").select("id, name, company_id").in("company_id", employee.companyIds),
  ]);
  const companyIdByName = new Map((companies ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));
  const partyIdByName = new Map((parties ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));
  const storeIdByName = new Map((stores ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]));

  const results: BulkDocResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const companyName = cellStr(raw, byHeader, "Company Name");
    const partyName = cellStr(raw, byHeader, "Party Name");
    const label = companyName || partyName;

    const companyId = companyIdByName.get(companyName.trim().toLowerCase());
    if (!companyId) {
      results.push({ row: rowNum, label, docNo: null, error: `Company "${companyName}" not found or not accessible.` });
      continue;
    }
    const partyId = partyIdByName.get(partyName.trim().toLowerCase());
    if (!partyId) {
      results.push({ row: rowNum, label, docNo: null, error: `Party "${partyName}" not found.` });
      continue;
    }

    let orderId: string | null = null;
    const refNo = cellStr(raw, byHeader, "PO/RF/RG No");
    if (refNo) {
      const { order } = await resolveOrderByRefNo(supabase, employee, refNo);
      orderId = order?.id ?? null;
    }

    const storeName = cellStr(raw, byHeader, "Store Name");
    const storeId = storeName ? (storeIdByName.get(storeName.trim().toLowerCase()) ?? null) : null;

    const result = await saveWashingEntryCore(employee, supabase, {
      companyId,
      partyId,
      chalanDate: cellStr(raw, byHeader, "Chalan Date"),
      orderId,
      itemSize: cellStr(raw, byHeader, "Item Size") || null,
      pcs: cellStr(raw, byHeader, "Pcs") ? Number(cellStr(raw, byHeader, "Pcs")) : null,
      sqMtrFt: cellStr(raw, byHeader, "SQ MTR/FT") ? Number(cellStr(raw, byHeader, "SQ MTR/FT")) : null,
      rate: cellStr(raw, byHeader, "Rate") ? Number(cellStr(raw, byHeader, "Rate")) : null,
      debitCharges: cellStr(raw, byHeader, "Debit Charges") ? Number(cellStr(raw, byHeader, "Debit Charges")) : null,
      storeId,
    });

    results.push({ row: rowNum, label, docNo: result.docNo, error: result.error });
  }

  if (results.some((r) => !r.error)) revalidatePath("/dashboard/documents");
  return { error: null, results };
}

// ---- Purchase Bill --------------------------------------------------------

export async function bulkSavePurchaseBills(_prev: BulkDocState, formData: FormData): Promise<BulkDocState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { error: fileError, rows, byHeader } = await readBulkFile(formData);
  if (fileError) return { error: fileError, results: null };

  const { data: parties } = await supabase.from("parties").select("id, name");
  const partyIdByName = new Map((parties ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));

  const results: BulkDocResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const vendorName = cellStr(raw, byHeader, "Vendor Party Name");
    const refNo = cellStr(raw, byHeader, "PO/RF/RG No");

    const vendorPartyId = partyIdByName.get(vendorName.trim().toLowerCase());
    if (!vendorPartyId) {
      results.push({ row: rowNum, label: refNo || vendorName, docNo: null, error: `Vendor party "${vendorName}" not found.` });
      continue;
    }

    const { error: lookupError, order } = await resolveOrderByRefNo(supabase, employee, refNo);
    if (lookupError || !order) {
      results.push({ row: rowNum, label: refNo, docNo: null, error: lookupError });
      continue;
    }

    const result = await savePurchaseBillCore(employee, supabase, {
      vendorPartyId,
      vendorInvoiceNo: cellStr(raw, byHeader, "Vendor Invoice No"),
      vendorInvoiceDate: cellStr(raw, byHeader, "Vendor Invoice Date") || null,
      qty: Number(cellStr(raw, byHeader, "Qty")) || 0,
      sqFeet: Number(cellStr(raw, byHeader, "SQ Feet")) || 0,
      // Bulk CSV template has no unit column yet — "SQ Feet" header means
      // exactly that, same as always.
      qtyUnit: "FT",
      workDescription: cellStr(raw, byHeader, "Work Description") || null,
      unitRate: Number(cellStr(raw, byHeader, "Unit Rate")) || 0,
      orderId: order.id,
      // Bulk CSV template has no GST or Round Off columns yet — leave
      // unset, same as every bill entered before those features existed.
      gstRatePct: null,
      gstType: null,
      roundOffAmt: 0,
    });

    results.push({ row: rowNum, label: refNo, docNo: result.docNo, error: result.error });
  }

  if (results.some((r) => !r.error)) revalidatePath("/dashboard/documents");
  return { error: null, results };
}

// ---- Courier Bill (freight_bills header) -----------------------------------

export async function bulkSaveFreightBills(_prev: BulkDocState, formData: FormData): Promise<BulkDocState> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { error: fileError, rows, byHeader } = await readBulkFile(formData);
  if (fileError) return { error: fileError, results: null };

  const results: BulkDocResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const invoiceNo = cellStr(raw, byHeader, "Invoice No");

    const result = await saveFreightBillCore(supabase, {
      invoiceNo,
      invoiceDate: cellStr(raw, byHeader, "Invoice Date") || null,
      billWeightKg: cellStr(raw, byHeader, "Bill Weight (kg)") ? Number(cellStr(raw, byHeader, "Bill Weight (kg)")) : null,
      freightAmt: Number(cellStr(raw, byHeader, "Freight Amount")) || 0,
      fuelAmt: Number(cellStr(raw, byHeader, "Fuel Amount")) || 0,
      otherCharges: Number(cellStr(raw, byHeader, "Other Charges")) || 0,
    });

    results.push({ row: rowNum, label: invoiceNo, docNo: result.docNo, error: result.error });
  }

  if (results.some((r) => !r.error)) revalidatePath("/dashboard/documents");
  return { error: null, results };
}

// ---- Duty & Tax Bill (duty_tax_bills header) -------------------------------

export async function bulkSaveDutyBills(_prev: BulkDocState, formData: FormData): Promise<BulkDocState> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { error: fileError, rows, byHeader } = await readBulkFile(formData);
  if (fileError) return { error: fileError, results: null };

  const results: BulkDocResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const invoiceNo = cellStr(raw, byHeader, "Invoice No");

    const result = await saveDutyBillCore(supabase, {
      invoiceNo,
      invoiceDate: cellStr(raw, byHeader, "Invoice Date") || null,
      dutyTaxAmtUsd: cellStr(raw, byHeader, "Duty/Tax Amount USD") ? Number(cellStr(raw, byHeader, "Duty/Tax Amount USD")) : null,
      dutyTaxAmtInr: Number(cellStr(raw, byHeader, "Duty/Tax Amount INR")) || 0,
      gst18pctAmt: Number(cellStr(raw, byHeader, "GST 18% Amount")) || 0,
    });

    results.push({ row: rowNum, label: invoiceNo, docNo: result.docNo, error: result.error });
  }

  if (results.some((r) => !r.error)) revalidatePath("/dashboard/documents");
  return { error: null, results };
}

// =============================================================================
// CSB FILING (csb_filings) — 2026-08-14: customs CSB-V filing confirmation
// register, built from the user's "NYKO_MART_Output.xlsx" (an OCR/PDF-
// extraction output of CSB-V filing PDFs). Standalone header row, NOT
// FK-linked to sales_invoices/orders — invoice_no is free text, same
// pattern as freight_bills/duty_tax_bills above. See
// db/2026-08-14-csb-filings.sql for the full decision writeup. Both the
// single-entry form (saveCsbFiling) and the bulk xlsx upload
// (bulkSaveCsbFilings) share saveCsbFilingCore, same convention as every
// other doc type in this file.
// =============================================================================

export type CsbFilingParams = {
  csbNumber: string;
  exchangeRate: number | null;
  totalTaxableValue: number | null;
  taxableValueCurrency: string | null;
  fobValueInr: number | null;
  filingDate: string | null;
  egmNumber: string | null;
  egmDate: string | null;
  hawbNumber: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  entryByEmployeeId: string | null;
};

async function saveCsbFilingCore(
  supabase: ServiceClient,
  p: CsbFilingParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.csbNumber) return { error: "CSB Number is required.", id: null, docNo: null };

  const { data, error } = await supabase
    .from("csb_filings")
    .insert({
      csb_number: p.csbNumber,
      exchange_rate: p.exchangeRate,
      total_taxable_value: p.totalTaxableValue,
      taxable_value_currency: p.taxableValueCurrency,
      fob_value_inr: p.fobValueInr,
      filing_date: p.filingDate,
      egm_number: p.egmNumber,
      egm_date: p.egmDate,
      hawb_number: p.hawbNumber,
      invoice_no: p.invoiceNo,
      invoice_date: p.invoiceDate,
      entry_by_employee_id: p.entryByEmployeeId,
    })
    .select("id, csb_number")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key")
      ? "A CSB Filing with this CSB Number already exists."
      : error?.message;
    return { error: `Failed to save CSB Filing: ${msg ?? "unknown error"}`, id: null, docNo: null };
  }

  return { error: null, id: data.id, docNo: data.csb_number };
}

export async function saveCsbFiling(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const result = await saveCsbFilingCore(supabase, {
    csbNumber: str(formData, "csb_number"),
    exchangeRate: numOrNull(formData, "exchange_rate"),
    totalTaxableValue: numOrNull(formData, "total_taxable_value"),
    taxableValueCurrency: strOrNull(formData, "taxable_value_currency"),
    fobValueInr: numOrNull(formData, "fob_value_inr"),
    filingDate: strOrNull(formData, "filing_date"),
    egmNumber: strOrNull(formData, "egm_number"),
    egmDate: strOrNull(formData, "egm_date"),
    hawbNumber: strOrNull(formData, "hawb_number"),
    invoiceNo: strOrNull(formData, "invoice_no"),
    invoiceDate: strOrNull(formData, "invoice_date"),
    entryByEmployeeId: employee.id,
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

export async function updateCsbFiling(_prev: DocEditState, formData: FormData): Promise<DocEditState> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id");
  if (!id) return { error: "Missing CSB Filing.", success: false };
  const csbNumber = str(formData, "csb_number");
  if (!csbNumber) return { error: "CSB Number is required.", success: false };

  const { error } = await supabase
    .from("csb_filings")
    .update({
      csb_number: csbNumber,
      exchange_rate: numOrNull(formData, "exchange_rate"),
      total_taxable_value: numOrNull(formData, "total_taxable_value"),
      taxable_value_currency: strOrNull(formData, "taxable_value_currency"),
      fob_value_inr: numOrNull(formData, "fob_value_inr"),
      filing_date: strOrNull(formData, "filing_date"),
      egm_number: strOrNull(formData, "egm_number"),
      egm_date: strOrNull(formData, "egm_date"),
      hawb_number: strOrNull(formData, "hawb_number"),
      invoice_no: strOrNull(formData, "invoice_no"),
      invoice_date: strOrNull(formData, "invoice_date"),
    })
    .eq("id", id);

  if (error) {
    const msg = error.message.includes("duplicate key") ? "A CSB Filing with this CSB Number already exists." : error.message;
    return { error: msg, success: false };
  }
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function deleteCsbFiling(id: string): Promise<SimpleResult> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("csb_filings").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

// ---- CSB Filing bulk upload ------------------------------------------------
// Accepts the same shape of xlsx as the user's "NYKO_MART_Output.xlsx"
// (columns A "File Name" and M "Goods Description" are simply not in
// CSB_FILING_COLUMNS below, so readBulkFile/cellStr ignore them if
// present — matching is by column HEADER TEXT, same as every other bulk
// doc type here, not by fixed column position).
export async function bulkSaveCsbFilings(_prev: BulkDocState, formData: FormData): Promise<BulkDocState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { error: fileError, rows, byHeader } = await readBulkFile(formData);
  if (fileError) return { error: fileError, results: null };

  const results: BulkDocResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const csbNumber = cellStr(raw, byHeader, "CSB Number");

    const result = await saveCsbFilingCore(supabase, {
      csbNumber,
      exchangeRate: cellStr(raw, byHeader, "Exchange Rate") ? Number(cellStr(raw, byHeader, "Exchange Rate")) : null,
      totalTaxableValue: cellStr(raw, byHeader, "Total Taxable Value") ? Number(cellStr(raw, byHeader, "Total Taxable Value")) : null,
      taxableValueCurrency: cellStr(raw, byHeader, "Taxable Value Currency") || null,
      fobValueInr: cellStr(raw, byHeader, "FOB Value (In INR)") ? Number(cellStr(raw, byHeader, "FOB Value (In INR)")) : null,
      filingDate: cellStr(raw, byHeader, "Filing Date") || null,
      egmNumber: cellStr(raw, byHeader, "EGM Number") || null,
      egmDate: cellStr(raw, byHeader, "EGM Date") || null,
      hawbNumber: cellStr(raw, byHeader, "HAWB Number") || null,
      invoiceNo: cellStr(raw, byHeader, "Invoice Number") || null,
      invoiceDate: cellStr(raw, byHeader, "Invoice Date") || null,
      entryByEmployeeId: employee.id,
    });

    results.push({ row: rowNum, label: csbNumber, docNo: result.docNo, error: result.error });
  }

  if (results.some((r) => !r.error)) revalidatePath("/dashboard/documents");
  return { error: null, results };
}

// =============================================================================
// SHIPMENT HANDOVER CHALAN — 2026-08-17. "SHIPMENT BHI AGAR JAYEGI KI AAJ
// FEDEX 5 SHIPMENT DI TO USKA BHI CHALAN KATE KI IS CHALAN NO SE 5 SHIPMENT
// FDEX KO GAYA" — groups however many existing orders (which already have
// an AWB/tracking) were physically handed to one courier at once under a
// single auto-numbered chalan (NM/SHC/26-27/0001, same
// reserve_next_number()/format_document_no() machinery as Washing Entry).
// Order lookup reuses lookupOrderForReconciliation's PO/RF/RG-or-AWB
// pattern. Each order can only be on ONE handover chalan ever
// (shipment_handover_chalan_lines' UNIQUE(order_id), same reasoning as
// freight_bill_awb_assignments — a shipment physically leaves once). See
// db/2026-08-17-material-out-and-shipment-handover-chalans.sql.
// =============================================================================

export type ChalanHandoverLookup = {
  error: string | null;
  order: { id: string; ref_no: string; company_id: string } | null;
  dispatch: { awb_no: string | null; courier_name: string | null } | null;
  alreadyHandedOver: boolean;
};

export async function lookupOrderForShipmentChalan(query: string): Promise<ChalanHandoverLookup> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const trimmed = query.trim();
  if (!trimmed) return { error: "Enter a PO/RF/RG or AWB number.", order: null, dispatch: null, alreadyHandedOver: false };

  let orderId: string | null = null;
  const { data: byRef } = await supabase
    .from("orders")
    .select("id")
    .ilike("ref_no", trimmed)
    .in("company_id", employee.companyIds)
    .maybeSingle();
  orderId = byRef?.id ?? null;

  if (!orderId) {
    const { data: byAwb } = await supabase.from("dispatch_invoices").select("order_id").ilike("awb_no", trimmed).maybeSingle();
    if (byAwb) orderId = byAwb.order_id;
  }
  if (!orderId) return { error: `No order found for "${trimmed}".`, order: null, dispatch: null, alreadyHandedOver: false };

  const { data: order } = await supabase.from("orders").select("id, ref_no, company_id").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: `No order found for "${trimmed}".`, order: null, dispatch: null, alreadyHandedOver: false };
  }

  const { data: dispatch } = await supabase
    .from("dispatch_invoices")
    .select("awb_no, courier_name")
    .eq("order_id", order.id)
    .maybeSingle();

  const { data: existing } = await supabase
    .from("shipment_handover_chalan_lines")
    .select("id")
    .eq("order_id", order.id)
    .maybeSingle();

  return { error: null, order, dispatch: dispatch ?? null, alreadyHandedOver: !!existing };
}

export type ShipmentHandoverChalanState = {
  error: string | null;
  success: { chalanNo: string; results: { refNo: string; ok: boolean; error: string | null }[] } | null;
};

export async function createShipmentHandoverChalan(
  _prev: ShipmentHandoverChalanState,
  formData: FormData
): Promise<ShipmentHandoverChalanState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const courierPartyId = str(formData, "courier_party_id");
  const chalanDate = strOrNull(formData, "chalan_date") ?? new Date().toISOString().slice(0, 10);
  const remark = strOrNull(formData, "remark");

  if (!courierPartyId) return { error: "Select a courier.", success: null };

  let orderIds: string[];
  try {
    orderIds = JSON.parse(str(formData, "order_ids_json") || "[]");
  } catch {
    return { error: "Invalid line data — please retry.", success: null };
  }
  if (!orderIds.length) return { error: "Add at least one shipment/order.", success: null };

  const { data: chalan, error: chalanError } = await supabase
    .from("shipment_handover_chalans")
    .insert({ company_id: employee.currentCompanyId, courier_party_id: courierPartyId, chalan_date: chalanDate, remark })
    .select("id, chalan_no")
    .single();

  if (chalanError || !chalan?.chalan_no) {
    return { error: `Failed to create chalan: ${chalanError?.message ?? "unknown error"}`, success: null };
  }

  const { data: orders } = await supabase.from("orders").select("id, ref_no").in("id", orderIds);
  const refNoById = new Map((orders ?? []).map((o) => [o.id, o.ref_no]));

  // Same "header already committed, keep going and report per-line" pattern
  // as Purchase Bill Multi / Material OUT Chalan — one order that's already
  // on another handover chalan (UNIQUE(order_id)) shouldn't hide whether
  // the rest of the day's shipments still went through.
  const results: { refNo: string; ok: boolean; error: string | null }[] = [];
  for (const orderId of orderIds) {
    const { error: lineError } = await supabase
      .from("shipment_handover_chalan_lines")
      .insert({ chalan_id: chalan.id, order_id: orderId });
    const label = refNoById.get(orderId) ?? orderId;
    if (lineError) {
      const msg = lineError.message.includes("duplicate key") ? "Already handed over on another chalan." : lineError.message;
      results.push({ refNo: label, ok: false, error: msg });
      continue;
    }
    results.push({ refNo: label, ok: true, error: null });
  }

  revalidatePath("/dashboard/documents");
  return { error: null, success: { chalanNo: chalan.chalan_no, results } };
}

export async function deleteShipmentHandoverChalan(chalanId: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: chalan } = await supabase
    .from("shipment_handover_chalans")
    .select("id, company_id")
    .eq("id", chalanId)
    .single();
  if (!chalan) return { error: "Chalan not found.", success: false };
  if (!employee.companyIds.includes(chalan.company_id)) {
    return { error: "You don't have access to this chalan's company.", success: false };
  }

  // shipment_handover_chalan_lines has ON DELETE CASCADE, so deleting the
  // header alone also removes its lines — unlike Material OUT Chalan,
  // whose lines are real stock_out ledger rows that need explicit cleanup
  // to actually undo the stock movement, a handover line has no ledger
  // side effect of its own to unwind.
  const { error } = await supabase.from("shipment_handover_chalans").delete().eq("id", chalanId);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}
