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
// Purchase Bill is deliberately NOT part of this module — see the
// 2026-08-03 note (document-entry-and-pending-work-notes.md): it's a
// vendor-side raw-material purchase log with an optional order_id already
// (added later), not something that needs a lookup-driven entry screen.
// Courier Bill / Duty & Tax Bill are also not part of this first round —
// their real "connection" is the AWB assignment tables (freight_bill_awb_
// assignments / duty_bill_awb_assignments), a materially different,
// reconciliation-style UI from the other four types; flagged as a
// follow-up rather than bolted on here half-built.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

export async function saveCreditNote(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const creditNoteDate = str(formData, "credit_note_date");
  if (!companyId) return initialFail("Select a company.");
  if (!employee.companyIds.includes(companyId)) return initialFail("You do not have access to this company.");
  if (!creditNoteDate) return initialFail("Credit Note Date is required.");

  const { data, error } = await supabase
    .from("credit_notes")
    .insert({
      company_id: companyId,
      store_id: strOrNull(formData, "store_id"),
      credit_note_date: creditNoteDate,
      order_id: strOrNull(formData, "order_id"),
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
      debit_note_id: strOrNull(formData, "debit_note_id"),
      created_by_employee_id: employee.id,
      remark: strOrNull(formData, "remark"),
    })
    .select("id, cn_no")
    .single();

  if (error || !data) return initialFail(`Failed to save Credit Note: ${error?.message ?? "unknown error"}`);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: data.id, docNo: data.cn_no ?? "" } };
}

export async function saveDebitNote(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const debitNoteDate = str(formData, "debit_note_date");
  const partyId = str(formData, "party_id");
  if (!companyId) return initialFail("Select a company.");
  if (!employee.companyIds.includes(companyId)) return initialFail("You do not have access to this company.");
  if (!debitNoteDate) return initialFail("Debit Note Date is required.");
  if (!partyId) return initialFail("Select a party.");

  const { data, error } = await supabase
    .from("debit_notes")
    .insert({
      company_id: companyId,
      debit_note_date: debitNoteDate,
      against_invoice_bill_no: strOrNull(formData, "against_invoice_bill_no"),
      party_id: partyId,
      order_id: strOrNull(formData, "order_id"),
      particulars: strOrNull(formData, "particulars"),
      bill_no: strOrNull(formData, "bill_no"),
      bill_date: strOrNull(formData, "bill_date"),
      sq_ft: numOrNull(formData, "sq_ft"),
      qty: numOrNull(formData, "qty"),
      rate: numOrNull(formData, "rate"),
      debit_amount: numOrZero(formData, "debit_amount"),
      remark: strOrNull(formData, "remark"),
    })
    .select("id, debit_note_no")
    .single();

  if (error || !data) return initialFail(`Failed to save Debit Note: ${error?.message ?? "unknown error"}`);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: data.id, docNo: data.debit_note_no ?? "" } };
}

export async function saveWashingEntry(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const partyId = str(formData, "party_id");
  const chalanDate = str(formData, "chalan_date");
  if (!companyId) return initialFail("Select a company.");
  if (!employee.companyIds.includes(companyId)) return initialFail("You do not have access to this company.");
  if (!partyId) return initialFail("Select a party.");
  if (!chalanDate) return initialFail("Chalan Date is required.");

  const { data, error } = await supabase
    .from("washing_entries")
    .insert({
      company_id: companyId,
      party_id: partyId,
      chalan_date: chalanDate,
      order_id: strOrNull(formData, "order_id"),
      item_size: strOrNull(formData, "item_size"),
      pcs: numOrNull(formData, "pcs"),
      sq_mtr_ft: numOrNull(formData, "sq_mtr_ft"),
      rate: numOrNull(formData, "rate"),
      debit_charges: numOrNull(formData, "debit_charges"),
      store_id: strOrNull(formData, "store_id"),
    })
    .select("id, chalan_no")
    .single();

  if (error || !data) return initialFail(`Failed to save Washing Entry: ${error?.message ?? "unknown error"}`);
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: data.id, docNo: data.chalan_no ?? "" } };
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
