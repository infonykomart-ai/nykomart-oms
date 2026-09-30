"use server";

// 2026-09-30 — B2B Inquiry Management. Implements "B2B INQUIRY HANDLE /
// REPORT / INVOICE / AND RELATED SECTION PAYMENT MODE & MANY MORE — MAKE
// MANAGING SYSTEM" as the /dashboard/b2b module: an inquiry register with
// folio numbers, a 1:1 quotation per inquiry (the "invoice"), money
// received mode-wise, and a report view.
//
// Capability: b2b_inquiry (MD/Admin seeded; grant wider via Roles &
// Permissions — zero code change, same narrow-then-expand pattern as
// audit_log_view / team_directory).
//
// Numbering (B2B-26-27-0001 / Q-26-27-0001): reserved through the SAME
// reserve_next_number() RPC every other document in this app uses, with
// fy_label() from the document's own date (a backdated entry gets the
// right year — same rule as the BEFORE-INSERT document triggers). Scope
// sentinels: 'B2B_INQ' and 'B2B_QUOTE', fy_label='' (no FY reset on the
// counter itself — the FY lives in the formatted number, like ORDER_REF).
// reserve_next_number is INSERT..ON CONFLICT DO UPDATE atomically inside
// Postgres (row-locked), so two concurrent creators can never draw the
// same number — no client-side guard is needed or used.
//
// Every action is company-scoped through the caller's own companyIds
// (requireCapability → employee.companyIds), the same guard every other
// module uses — a caller can never read or write another company's
// pipeline, even by guessing ids.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import { todayIST } from "@/lib/attendance/ist-date";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type B2BInquiryStatus = "Open" | "In Discussion" | "Quotation Sent" | "Won" | "Lost" | "Converted";
export type B2BPaymentMode = "Cash" | "Bank Transfer" | "UPI" | "Cheque" | "Card" | "Advance";

export const B2B_STATUSES: B2BInquiryStatus[] = ["Open", "In Discussion", "Quotation Sent", "Won", "Lost", "Converted"];
export const B2B_PAYMENT_MODES: B2BPaymentMode[] = ["Cash", "Bank Transfer", "UPI", "Cheque", "Card", "Advance"];

// ── formatting helpers (mirror format_order_ref_no / format_document_no) ────
function formatB2BNo(prefix: string, fy: string, num: number): string {
  return `${prefix}-${fy}-${String(num).padStart(4, "0")}`;
}

// Reserves the next number for the scope and formats it with the FY label
// of the document's own date — the app-layer equivalent of the DB's
// format_document_no triggers, which is exactly how sales_invoices does it.
async function reserveB2BNo(
  supabase: ServiceClient,
  companyId: string,
  scope: "B2B_INQ" | "B2B_QUOTE",
  prefix: string,
  asOfDate: string
): Promise<{ no: string | null; error: string | null }> {
  const fy = await supabase.rpc("fy_label", { p_date: asOfDate });
  if (fy.error) return { no: null, error: `Numbering failed: ${fy.error.message}` };
  const num = await supabase.rpc("reserve_next_number", {
    p_company_id: companyId,
    p_scope: scope,
    p_use_fy: false,
    p_as_of_date: asOfDate,
  });
  if (num.error) return { no: null, error: `Numbering failed: ${num.error.message}` };
  return { no: formatB2BNo(prefix, fy.data, num.data), error: null };
}

// ── shared row fetch with company guard ─────────────────────────────────────
async function loadOwnedInquiry(
  supabase: ServiceClient,
  companyIds: string[],
  inquiryId: string
): Promise<{ inquiry: Database["public"]["Tables"]["b2b_inquiries"]["Row"] } | { error: string }> {
  const { data, error } = await supabase
    .from("b2b_inquiries")
    .select("*")
    .eq("id", inquiryId)
    .in("company_id", companyIds)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Inquiry not found." };
  return { inquiry: data };
}

// ═══════════════════════════════ Inquiries ═══════════════════════════════════

export type InquiryInput = {
  inquiryDate: string;
  buyerName: string;
  buyerCompany: string;
  buyerContactNo: string;
  buyerEmail: string;
  buyerCountry: string;
  source: string;
  priority: string;
  requirementNotes: string;
  remarks: string;
  followUpDate: string;
  items: { description: string; qty: string; unit: string; unitPrice: string; remark: string }[];
};

export type SaveInquiryResult =
  | { ok: true; id: string; inquiryNo: string }
  | { ok: false; error: string };

export async function createInquiry(input: InquiryInput): Promise<SaveInquiryResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const buyerName = input.buyerName.trim();
  if (!buyerName) return { ok: false, error: "Buyer name is required." };
  const inquiryDate = input.inquiryDate || todayIST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inquiryDate)) return { ok: false, error: "Invalid inquiry date." };
  if (input.followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.followUpDate)) {
    return { ok: false, error: "Invalid follow-up date." };
  }

  const priorityValue = ["Hot", "Warm", "Cold"].includes(input.priority) ? input.priority : "Warm";

  const { no, error: numError } = await reserveB2BNo(supabase, me.currentCompanyId, "B2B_INQ", "B2B", inquiryDate);
  if (errorImpossibleGuard(numError)) return { ok: false, error: numError ?? "Numbering failed." };

  const { data: created, error } = await supabase
    .from("b2b_inquiries")
    .insert({
      company_id: me.currentCompanyId,
      inquiry_no: no!,
      inquiry_date: inquiryDate,
      buyer_name: buyerName,
      buyer_company: input.buyerCompany.trim() || null,
      buyer_contact_no: input.buyerContactNo.trim() || null,
      buyer_email: input.buyerEmail.trim() || null,
      buyer_country: input.buyerCountry.trim() || null,
      source: input.source.trim() || null,
      priority: priorityValue as "Hot" | "Warm" | "Cold",
      requirement_notes: input.requirementNotes.trim() || null,
      remarks: input.remarks.trim() || null,
      follow_up_date: input.followUpDate || null,
      entered_by_employee_id: me.id,
    })
    .select("id, inquiry_no")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Insert failed." };

  const items = (input.items ?? [])
    .map((it, idx) => ({
      inquiry_id: created.id,
      description: it.description.trim(),
      qty: it.qty ? Math.max(0.01, parseFloat(it.qty) || 0) : 1,
      unit: it.unit.trim() || "pcs",
      unit_price: it.unitPrice ? Math.max(0, parseFloat(it.unitPrice) || 0) : null,
      remark: it.remark.trim() || null,
      display_order: idx,
    }))
    .filter((it) => it.description);

  if (items.length > 0) {
    const { error: itemError } = await supabase.from("b2b_inquiry_items").insert(items);
    if (itemError) {
      // The header row is the record of truth; a failed line-item batch is
      // logged loudly but never rolls back the inquiry (matches how
      // order_photos/bulk rows degrade elsewhere in this app).
      console.error(`[b2b] inquiry ${created.inquiry_no} line items failed: ${itemError.message}`);
    }
  }

  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_inquiry.created",
    entityType: "b2b_inquiry",
    entityId: created.id,
    entityLabel: created.inquiry_no,
  });

  revalidatePath("/dashboard/b2b");
  return { ok: true, id: created.id, inquiryNo: created.inquiry_no };
}

// Tiny guard so the reserve failure above reads cleanly without nesting.
function errorImpossibleGuard(err: string | null): err is string {
  return Boolean(err);
}

export type UpdateInquiryInput = {
  inquiryId: string;
  buyerName: string;
  buyerCompany: string;
  buyerContactNo: string;
  buyerEmail: string;
  buyerCountry: string;
  source: string;
  priority: string;
  requirementNotes: string;
  remarks: string;
  followUpDate: string;
  status: string;
};

export async function updateInquiry(input: UpdateInquiryInput): Promise<{ ok: boolean; error?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const owned = await loadOwnedInquiry(supabase, me.companyIds, input.inquiryId);
  if ("error" in owned) return { ok: false, error: owned.error };

  const buyerName = input.buyerName.trim();
  if (!buyerName) return { ok: false, error: "Buyer name is required." };
  if (input.followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.followUpDate)) {
    return { ok: false, error: "Invalid follow-up date." };
  }
  const status = B2B_STATUSES.includes(input.status as B2BInquiryStatus) ? (input.status as B2BInquiryStatus) : null;
  if (!status) return { ok: false, error: "Invalid status." };
  const priorityValue = ["Hot", "Warm", "Cold"].includes(input.priority) ? input.priority : "Warm";

  const { error } = await supabase
    .from("b2b_inquiries")
    .update({
      buyer_name: buyerName,
      buyer_company: input.buyerCompany.trim() || null,
      buyer_contact_no: input.buyerContactNo.trim() || null,
      buyer_email: input.buyerEmail.trim() || null,
      buyer_country: input.buyerCountry.trim() || null,
      source: input.source.trim() || null,
      priority: priorityValue as "Hot" | "Warm" | "Cold",
      requirement_notes: input.requirementNotes.trim() || null,
      remarks: input.remarks.trim() || null,
      follow_up_date: input.followUpDate || null,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.inquiryId);
  if (error) return { ok: false, error: error.message };

  // Status transitions are the interesting part of the audit trail.
  if (status !== owned.inquiry.status) {
    await logAudit(supabase, {
      companyId: owned.inquiry.company_id,
      employeeId: me.id,
      employeeName: me.name,
      action: "b2b_inquiry.status_changed",
      entityType: "b2b_inquiry",
      entityId: owned.inquiry.id,
      entityLabel: owned.inquiry.inquiry_no,
      changes: { status: { from: owned.inquiry.status, to: status } },
    });
  }

  revalidatePath("/dashboard/b2b");
  return { ok: true };
}

export async function deleteInquiry(inquiryId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const owned = await loadOwnedInquiry(supabase, me.companyIds, inquiryId);
  if ("error" in owned) return { ok: false, error: owned.error };

  const { error } = await supabase.from("b2b_inquiries").delete().eq("id", inquiryId);
  if (error) return { ok: false, error: error.message };

  await logAudit(supabase, {
    companyId: owned.inquiry.company_id,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_inquiry.deleted",
    entityType: "b2b_inquiry",
    entityId: owned.inquiry.id,
    entityLabel: owned.inquiry.inquiry_no,
    changes: { note: `buyer "${owned.inquiry.buyer_name}" — deleted with all items/quotes/payments` },
  });

  revalidatePath("/dashboard/b2b");
  return { ok: true };
}

// ═══════════════════════════ Quotation / Invoice ═════════════════════════════

export type QuotationInput = {
  inquiryId: string;
  quoteDate: string;
  validUntil: string;
  buyerName: string;
  buyerContactNo: string;
  buyerEmail: string;
  buyerCountry: string;
  subtotal: string;
  taxPercent: string;
  shippingAmount: string;
  currency: string;
  terms: string;
  notes: string;
};

export async function createQuotation(input: QuotationInput): Promise<SaveInquiryResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const owned = await loadOwnedInquiry(supabase, me.companyIds, input.inquiryId);
  if ("error" in owned) return { ok: false, error: owned.error };

  // One quote per inquiry (UNIQUE(inquiry_id)) — point at the existing one
  // instead of erroring, so "Quote" just reopens it.
  const { data: existingQuote } = await supabase
    .from("b2b_quotations")
    .select("id")
    .eq("inquiry_id", input.inquiryId)
    .maybeSingle();
  if (existingQuote) return { ok: false, error: "A quotation already exists for this inquiry." };

  const quoteDate = input.quoteDate || todayIST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quoteDate)) return { ok: false, error: "Invalid quote date." };
  if (input.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) {
    return { ok: false, error: "Invalid validity date." };
  }
  const buyerName = input.buyerName.trim() || owned.inquiry.buyer_name;
  const subtotal = Math.max(0, parseFloat(input.subtotal) || 0);
  const taxPercent = Math.min(100, Math.max(0, parseFloat(input.taxPercent) || 0));
  const shipping = Math.max(0, parseFloat(input.shippingAmount) || 0);
  const currency = (input.currency || "INR").trim().toUpperCase().slice(0, 3);

  const { no, error: numError } = await reserveB2BNo(supabase, me.currentCompanyId, "B2B_QUOTE", "Q", quoteDate);
  if (errorImpossibleGuard(numError)) return { ok: false, error: numError ?? "Numbering failed." };

  const { data: created, error } = await supabase
    .from("b2b_quotations")
    .insert({
      inquiry_id: input.inquiryId,
      company_id: owned.inquiry.company_id,
      quote_no: no!,
      quote_date: quoteDate,
      valid_until: input.validUntil || null,
      buyer_name: buyerName,
      buyer_contact_no: input.buyerContactNo.trim() || owned.inquiry.buyer_contact_no,
      buyer_email: input.buyerEmail.trim() || owned.inquiry.buyer_email,
      buyer_country: input.buyerCountry.trim() || owned.inquiry.buyer_country,
      subtotal,
      tax_percent: taxPercent,
      shipping_amount: shipping,
      currency,
      terms: input.terms.trim() || null,
      notes: input.notes.trim() || null,
      entered_by_employee_id: me.id,
    })
    .select("id, quote_no")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Insert failed." };

  // Quotation Sent — the whole point of creating one.
  await supabase
    .from("b2b_inquiries")
    .update({ status: "Quotation Sent", updated_at: new Date().toISOString() })
    .eq("id", input.inquiryId);

  await logAudit(supabase, {
    companyId: owned.inquiry.company_id,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_quotation.created",
    entityType: "b2b_quotation",
    entityId: created.id,
    entityLabel: created.quote_no,
    changes: { inquiry: owned.inquiry.inquiry_no, total: subtotal * (1 + taxPercent / 100) + shipping },
  });

  revalidatePath("/dashboard/b2b");
  return { ok: true, id: created.id, inquiryNo: created.quote_no };
}

export async function markQuotationSent(quotationId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const { data: quote, error: fetchError } = await supabase
    .from("b2b_quotations")
    .select("id, company_id, inquiry_id, quote_no, sent_at")
    .eq("id", quotationId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!quote) return { ok: false, error: "Quotation not found." };

  if (!quote.sent_at) {
    const { error } = await supabase.from("b2b_quotations").update({ sent_at: new Date().toISOString() }).eq("id", quotationId);
    if (error) return { ok: false, error: error.message };
  }
  // Inquiry status rides along (idempotent).
  await supabase
    .from("b2b_inquiries")
    .update({ status: "Quotation Sent", updated_at: new Date().toISOString() })
    .eq("id", quote.inquiry_id)
    .in("status", ["Open", "In Discussion"]);

  revalidatePath("/dashboard/b2b");
  return { ok: true };
}

export async function updateQuotation(input: QuotationInput & { quotationId: string }): Promise<{ ok: boolean; error?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const { data: quote, error: fetchError } = await supabase
    .from("b2b_quotations")
    .select("id, company_id, inquiry_id")
    .eq("id", input.quotationId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!quote) return { ok: false, error: "Quotation not found." };

  if (input.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) {
    return { ok: false, error: "Invalid validity date." };
  }
  const subtotal = Math.max(0, parseFloat(input.subtotal) || 0);
  const taxPercent = Math.min(100, Math.max(0, parseFloat(input.taxPercent) || 0));
  const shipping = Math.max(0, parseFloat(input.shippingAmount) || 0);

  const { error } = await supabase
    .from("b2b_quotations")
    .update({
      valid_until: input.validUntil || null,
      buyer_name: input.buyerName.trim() || undefined,
      buyer_contact_no: input.buyerContactNo.trim() || undefined,
      buyer_email: input.buyerEmail.trim() || undefined,
      buyer_country: input.buyerCountry.trim() || undefined,
      subtotal,
      tax_percent: taxPercent,
      shipping_amount: shipping,
      currency: (input.currency || "INR").trim().toUpperCase().slice(0, 3),
      terms: input.terms.trim() || null,
      notes: input.notes.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.quotationId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/b2b");
  return { ok: true };
}

// ═══════════════════════════ Payments ════════════════════════════════════════

export type PaymentInput = {
  quotationId: string;
  paymentDate: string;
  amount: string;
  paymentMode: string;
  referenceNo: string;
  referenceDate: string;
  realized: boolean;
  remark: string;
};

export async function addPayment(input: PaymentInput): Promise<{ ok: boolean; error?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const { data: quote, error: fetchError } = await supabase
    .from("b2b_quotations")
    .select("id, company_id, inquiry_id")
    .eq("id", input.quotationId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!quote) return { ok: false, error: "Quotation not found." };

  const paymentDate = input.paymentDate || todayIST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return { ok: false, error: "Invalid payment date." };
  if (input.referenceDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.referenceDate)) {
    return { ok: false, error: "Invalid reference date." };
  }
  const amount = parseFloat(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter a valid amount." };
  const mode = B2B_PAYMENT_MODES.includes(input.paymentMode as B2BPaymentMode) ? (input.paymentMode as B2BPaymentMode) : null;
  if (!mode) return { ok: false, error: "Choose a payment mode." };

  const { error } = await supabase.from("b2b_payments").insert({
    quotation_id: input.quotationId,
    company_id: quote.company_id,
    payment_date: paymentDate,
    amount,
    payment_mode: mode,
    reference_no: input.referenceNo.trim() || null,
    reference_date: input.referenceDate || null,
    realized: input.realized,
    remark: input.remark.trim() || null,
    entered_by_employee_id: me.id,
  });
  if (error) return { ok: false, error: error.message };

  // Money received → the inquiry is won (only moves forward; never
  // overwrites Lost/Converted).
  await supabase
    .from("b2b_inquiries")
    .update({ status: "Won", updated_at: new Date().toISOString() })
    .eq("id", quote.inquiry_id)
    .in("status", ["Open", "In Discussion", "Quotation Sent"]);

  await logAudit(supabase, {
    companyId: quote.company_id,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_payment.added",
    entityType: "b2b_payment",
    entityLabel: mode,
    changes: { quotation: input.quotationId, amount, date: paymentDate },
  });

  revalidatePath("/dashboard/b2b");
  return { ok: true };
}

export async function deletePayment(paymentId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const { data: pay, error: fetchError } = await supabase
    .from("b2b_payments")
    .select("id, company_id, quotation_id, amount, payment_mode")
    .eq("id", paymentId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!pay) return { ok: false, error: "Payment not found." };

  const { error } = await supabase.from("b2b_payments").delete().eq("id", paymentId);
  if (error) return { ok: false, error: error.message };

  await logAudit(supabase, {
    companyId: pay.company_id,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_payment.deleted",
    entityType: "b2b_payment",
    entityId: pay.id,
    entityLabel: pay.payment_mode,
    changes: { amount: pay.amount, quotation: pay.quotation_id },
  });

  revalidatePath("/dashboard/b2b");
  return { ok: true };
}

// ═══════════════════════════ Conversion to a real order ══════════════════════
// Deliberately thin: the converted order is still entered through the
// normal Order Entry flow (PO/RF/RG numbering, store, SKU — all order-table
// rules stay in one place). This action just records the LINK after the
// admin enters the order: paste the new order's ref_no, we find the row and
// stamp the inquiry Converted. No double-entry of buyer data, no parallel
// order-creation logic to keep in sync.

export async function linkConversion(inquiryId: string, orderRefNo: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const owned = await loadOwnedInquiry(supabase, me.companyIds, inquiryId);
  if ("error" in owned) return { ok: false, error: owned.error };
  if (owned.inquiry.status === "Converted") return { ok: true }; // idempotent

  const ref = orderRefNo.trim();
  if (!ref) return { ok: false, error: "Enter the order's ref no." };

  // Orders are multi-company; match on the caller's own scope + exact ref.
  const { data: order } = await supabase
    .from("orders")
    .select("id, ref_no, company_id")
    .eq("ref_no", ref)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!order) return { ok: false, error: `No order found with ref no "${ref}" in your companies.` };

  const { error } = await supabase
    .from("b2b_inquiries")
    .update({ status: "Converted", converted_order_id: order.id, converted_order_ref: order.ref_no, updated_at: new Date().toISOString() })
    .eq("id", inquiryId);
  if (error) return { ok: false, error: error.message };

  await logAudit(supabase, {
    companyId: owned.inquiry.company_id,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_inquiry.converted",
    entityType: "b2b_inquiry",
    entityId: owned.inquiry.id,
    entityLabel: owned.inquiry.inquiry_no,
    changes: { order: order.ref_no },
  });

  revalidatePath("/dashboard/b2b");
  return { ok: true };
}
