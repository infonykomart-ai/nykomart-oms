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
      "id, ref_no, company_id, store_id, buyer_name_address, contact_no, order_value_original, order_currency, order_value_usd, order_value_inr, invoice_id"
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
};

async function saveCreditNoteCore(
  employee: AuthedEmployee,
  supabase: ServiceClient,
  p: CreditNoteParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.companyId) return { error: "Select a company.", id: null, docNo: null };
  if (!employee.companyIds.includes(p.companyId)) return { error: "You do not have access to this company.", id: null, docNo: null };
  if (!p.creditNoteDate) return { error: "Credit Note Date is required.", id: null, docNo: null };

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
      created_by_employee_id: employee.id,
      remark: p.remark,
    })
    .select("id, cn_no")
    .single();

  if (error || !data) return { error: `Failed to save Credit Note: ${error?.message ?? "unknown error"}`, id: null, docNo: null };
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
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

type DebitNoteParams = {
  companyId: string;
  debitNoteDate: string;
  againstInvoiceBillNo: string | null;
  partyId: string;
  orderId: string | null;
  particulars: string | null;
  billNo: string | null;
  billDate: string | null;
  sqFt: number | null;
  qty: number | null;
  rate: number | null;
  debitAmount: number;
  remark: string | null;
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

  const { data, error } = await supabase
    .from("debit_notes")
    .insert({
      company_id: p.companyId,
      debit_note_date: p.debitNoteDate,
      against_invoice_bill_no: p.againstInvoiceBillNo,
      party_id: p.partyId,
      order_id: p.orderId,
      particulars: p.particulars,
      bill_no: p.billNo,
      bill_date: p.billDate,
      sq_ft: p.sqFt,
      qty: p.qty,
      rate: p.rate,
      debit_amount: p.debitAmount,
      remark: p.remark,
    })
    .select("id, debit_note_no")
    .single();

  if (error || !data) return { error: `Failed to save Debit Note: ${error?.message ?? "unknown error"}`, id: null, docNo: null };
  return { error: null, id: data.id, docNo: data.debit_note_no ?? "" };
}

export async function saveDebitNote(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const result = await saveDebitNoteCore(employee, supabase, {
    companyId: str(formData, "company_id"),
    debitNoteDate: str(formData, "debit_note_date"),
    againstInvoiceBillNo: strOrNull(formData, "against_invoice_bill_no"),
    partyId: str(formData, "party_id"),
    orderId: strOrNull(formData, "order_id"),
    particulars: strOrNull(formData, "particulars"),
    billNo: strOrNull(formData, "bill_no"),
    billDate: strOrNull(formData, "bill_date"),
    sqFt: numOrNull(formData, "sq_ft"),
    qty: numOrNull(formData, "qty"),
    rate: numOrNull(formData, "rate"),
    debitAmount: numOrZero(formData, "debit_amount"),
    remark: strOrNull(formData, "remark"),
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
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
// required, AND — 2026-08-08: "YE LINK HONA CHAHIYE... SABHI CHEJE LINK
// RAHEGI" — the order link is now REQUIRED too, not optional. Every
// purchase must be tied to the PO/RF/RG it was bought for, so "which party
// this order's item came from" is always answerable from the order side
// (see the reverse lookup added to the Orders hub the same day).
// =============================================================================

type PurchaseBillParams = {
  vendorPartyId: string;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string | null;
  qty: number;
  sqFeet: number;
  workDescription: string | null;
  unitRate: number;
  orderId: string | null;
};

async function savePurchaseBillCore(
  employee: AuthedEmployee,
  supabase: ServiceClient,
  p: PurchaseBillParams
): Promise<{ error: string | null; id: string | null; docNo: string | null }> {
  if (!p.vendorPartyId) return { error: "Select a vendor party.", id: null, docNo: null };
  if (!p.vendorInvoiceNo) return { error: "Vendor Invoice No. is required.", id: null, docNo: null };
  if (!p.orderId) {
    return {
      error: "Look up and link the PO/RF/RG this purchase is for — every Purchase Bill must be tied to an order.",
      id: null,
      docNo: null,
    };
  }
  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", p.orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "The looked-up order is not accessible — clear it and try again.", id: null, docNo: null };
  }

  const { data, error } = await supabase
    .from("purchase_bills")
    .insert({
      vendor_party_id: p.vendorPartyId,
      vendor_invoice_no: p.vendorInvoiceNo,
      vendor_invoice_date: p.vendorInvoiceDate,
      qty: p.qty || 1,
      sq_feet: p.sqFeet,
      work_description: p.workDescription,
      unit_rate: p.unitRate,
      order_id: p.orderId,
    })
    .select("id, vendor_invoice_no")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key") ? "This vendor already has a bill with that invoice number." : error?.message;
    return { error: `Failed to save Purchase Bill: ${msg ?? "unknown error"}`, id: null, docNo: null };
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
    workDescription: strOrNull(formData, "work_description"),
    unitRate: numOrZero(formData, "unit_rate"),
    orderId: strOrNull(formData, "order_id"),
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

export async function updatePurchaseBill(_prev: DocEditState, formData: FormData): Promise<DocEditState> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id");
  if (!id) return { error: "Missing Purchase Bill.", success: false };
  const vendorPartyId = str(formData, "vendor_party_id");
  const vendorInvoiceNo = str(formData, "vendor_invoice_no");
  if (!vendorPartyId) return { error: "Select a vendor party.", success: false };
  if (!vendorInvoiceNo) return { error: "Vendor Invoice No. is required.", success: false };

  const { error } = await supabase
    .from("purchase_bills")
    .update({
      vendor_party_id: vendorPartyId,
      vendor_invoice_no: vendorInvoiceNo,
      vendor_invoice_date: strOrNull(formData, "vendor_invoice_date"),
      qty: numOrZero(formData, "qty") || 1,
      sq_feet: numOrZero(formData, "sq_feet"),
      work_description: strOrNull(formData, "work_description"),
      unit_rate: numOrZero(formData, "unit_rate"),
    })
    .eq("id", id);

  if (error) {
    const msg = error.message.includes("duplicate key") ? "This vendor already has a bill with that invoice number." : error.message;
    return { error: msg, success: false };
  }
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function deletePurchaseBill(id: string): Promise<SimpleResult> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("purchase_bills").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

// =============================================================================
// COURIER BILL (freight_bills) / DUTY & TAX BILL (duty_tax_bills) —
// invoice-level header + per-AWB assignment rows. lookupOrderForReconciliation
// is the shared PO/RF/RG-or-AWB lookup the "assign an AWB" step uses.
// =============================================================================

export type ReconciliationLookup = {
  error: string | null;
  order: { id: string; ref_no: string; company_id: string } | null;
  dispatch: {
    awb_no: string | null;
    courier_name: string | null;
    buyer_country: string | null;
    shipping_weight_kg: number | null;
    org_sale_amt_inr: number | null;
  } | null;
  alreadyAssigned: boolean;
};

const EMPTY_RECON: ReconciliationLookup = { error: null, order: null, dispatch: null, alreadyAssigned: false };

export async function lookupOrderForReconciliation(
  query: string,
  billKind: "freight" | "duty"
): Promise<ReconciliationLookup> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const trimmed = query.trim();
  if (!trimmed) return { ...EMPTY_RECON, error: "Enter a PO/RF/RG or AWB number." };

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
  if (!orderId) return { ...EMPTY_RECON, error: `No order found for "${trimmed}".` };

  const { data: order } = await supabase.from("orders").select("id, ref_no, company_id").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { ...EMPTY_RECON, error: `No order found for "${trimmed}".` };
  }

  const { data: dispatch } = await supabase
    .from("dispatch_invoices")
    .select("awb_no, courier_name, buyer_country, shipping_weight_kg, org_sale_amt_inr")
    .eq("order_id", order.id)
    .maybeSingle();

  const table = billKind === "freight" ? "freight_bill_awb_assignments" : "duty_bill_awb_assignments";
  const { data: existing } = await supabase.from(table).select("id").eq("order_id", order.id).maybeSingle();

  return { error: null, order, dispatch: dispatch ?? null, alreadyAssigned: !!existing };
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
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

export async function deleteFreightBill(id: string): Promise<SimpleResult> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: assigned } = await supabase.from("freight_bill_awb_assignments").select("id").eq("freight_bill_id", id).limit(1).maybeSingle();
  if (assigned) return { error: "This Courier Bill has AWBs assigned to it — remove those assignments first.", success: false };

  const { error } = await supabase.from("freight_bills").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function assignFreightAwb(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const freightBillId = str(formData, "freight_bill_id");
  const orderId = str(formData, "order_id");
  if (!freightBillId) return initialFail("Missing Courier Bill.");
  if (!orderId) return initialFail("Look up an order by PO/RF/RG or AWB first.");

  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return initialFail("That order is not accessible — look it up again.");
  }

  const { data, error } = await supabase
    .from("freight_bill_awb_assignments")
    .insert({
      freight_bill_id: freightBillId,
      order_id: orderId,
      bill_weight_kg: numOrNull(formData, "bill_weight_kg"),
      difference_amt: numOrNull(formData, "difference_amt"),
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
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("freight_bill_awb_assignments").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
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
  });

  if (result.error) return initialFail(result.error);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: result.id!, docNo: result.docNo ?? "" } };
}

export async function deleteDutyBill(id: string): Promise<SimpleResult> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: assigned } = await supabase.from("duty_bill_awb_assignments").select("id").eq("duty_tax_bill_id", id).limit(1).maybeSingle();
  if (assigned) return { error: "This Duty & Tax Bill has AWBs assigned to it — remove those assignments first.", success: false };

  const { error } = await supabase.from("duty_tax_bills").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/documents");
  return { error: null, success: true };
}

export async function assignDutyAwb(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const dutyTaxBillId = str(formData, "duty_tax_bill_id");
  const orderId = str(formData, "order_id");
  if (!dutyTaxBillId) return initialFail("Missing Duty & Tax Bill.");
  if (!orderId) return initialFail("Look up an order by PO/RF/RG or AWB first.");

  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return initialFail("That order is not accessible — look it up again.");
  }

  const { data, error } = await supabase
    .from("duty_bill_awb_assignments")
    .insert({
      duty_tax_bill_id: dutyTaxBillId,
      order_id: orderId,
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
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("duty_bill_awb_assignments").delete().eq("id", id);
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
      partyId,
      orderId,
      particulars: cellStr(raw, byHeader, "Particulars") || null,
      billNo: cellStr(raw, byHeader, "Bill No") || null,
      billDate: cellStr(raw, byHeader, "Bill Date") || null,
      sqFt: cellStr(raw, byHeader, "SQ FT") ? Number(cellStr(raw, byHeader, "SQ FT")) : null,
      qty: cellStr(raw, byHeader, "Qty") ? Number(cellStr(raw, byHeader, "Qty")) : null,
      rate: cellStr(raw, byHeader, "Rate") ? Number(cellStr(raw, byHeader, "Rate")) : null,
      debitAmount: Number(cellStr(raw, byHeader, "Debit Amount")) || 0,
      remark: cellStr(raw, byHeader, "Remark") || null,
    });

    results.push({ row: rowNum, label, docNo: result.docNo, error: result.error });
  }

  if (results.some((r) => !r.error)) revalidatePath("/dashboard/documents");
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
      workDescription: cellStr(raw, byHeader, "Work Description") || null,
      unitRate: Number(cellStr(raw, byHeader, "Unit Rate")) || 0,
      orderId: order.id,
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
