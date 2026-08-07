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
// PURCHASE BILL — vendor raw-material purchase log. Same shape as Washing
// Entry: a party (vendor) is required, an order lookup is optional (only
// meaningful for make-to-order purchases).
// =============================================================================

export async function savePurchaseBill(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const vendorPartyId = str(formData, "vendor_party_id");
  const vendorInvoiceNo = str(formData, "vendor_invoice_no");
  if (!vendorPartyId) return initialFail("Select a vendor party.");
  if (!vendorInvoiceNo) return initialFail("Vendor Invoice No. is required.");

  const orderId = strOrNull(formData, "order_id");
  if (orderId) {
    const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
    if (!order || !employee.companyIds.includes(order.company_id)) {
      return initialFail("The looked-up order is not accessible — clear it and try again.");
    }
  }

  const { data, error } = await supabase
    .from("purchase_bills")
    .insert({
      vendor_party_id: vendorPartyId,
      vendor_invoice_no: vendorInvoiceNo,
      vendor_invoice_date: strOrNull(formData, "vendor_invoice_date"),
      qty: numOrZero(formData, "qty") || 1,
      sq_feet: numOrZero(formData, "sq_feet"),
      work_description: strOrNull(formData, "work_description"),
      unit_rate: numOrZero(formData, "unit_rate"),
      order_id: orderId,
    })
    .select("id, vendor_invoice_no")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key") ? "This vendor already has a bill with that invoice number." : error?.message;
    return initialFail(`Failed to save Purchase Bill: ${msg ?? "unknown error"}`);
  }
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: data.id, docNo: data.vendor_invoice_no } };
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

export async function saveFreightBill(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const invoiceNo = str(formData, "invoice_no");
  if (!invoiceNo) return initialFail("Invoice No. is required.");

  const { data, error } = await supabase
    .from("freight_bills")
    .insert({
      invoice_no: invoiceNo,
      invoice_date: strOrNull(formData, "invoice_date"),
      bill_weight_kg: numOrNull(formData, "bill_weight_kg"),
      freight_amt: numOrZero(formData, "freight_amt"),
      fuel_amt: numOrZero(formData, "fuel_amt"),
      other_charges: numOrZero(formData, "other_charges"),
    })
    .select("id, invoice_no")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key") ? "A Courier Bill with that Invoice No. already exists." : error?.message;
    return initialFail(`Failed to save Courier Bill: ${msg ?? "unknown error"}`);
  }
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: data.id, docNo: data.invoice_no } };
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

export async function saveDutyBill(_prev: DocFormState, formData: FormData): Promise<DocFormState> {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const invoiceNo = str(formData, "invoice_no");
  if (!invoiceNo) return initialFail("Invoice No. is required.");

  const { data, error } = await supabase
    .from("duty_tax_bills")
    .insert({
      invoice_no: invoiceNo,
      invoice_date: strOrNull(formData, "invoice_date"),
      duty_tax_amt_usd: numOrNull(formData, "duty_tax_amt_usd"),
      duty_tax_amt_inr: numOrZero(formData, "duty_tax_amt_inr"),
      gst_18pct_amt: numOrZero(formData, "gst_18pct_amt"),
    })
    .select("id, invoice_no")
    .single();

  if (error || !data) {
    const msg = error?.message.includes("duplicate key") ? "A Duty & Tax Bill with that Invoice No. already exists." : error?.message;
    return initialFail(`Failed to save Duty & Tax Bill: ${msg ?? "unknown error"}`);
  }
  revalidatePath("/dashboard/documents");
  return { error: null, success: { id: data.id, docNo: data.invoice_no } };
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
