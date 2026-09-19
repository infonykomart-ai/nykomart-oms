// 2026-09-19 — shared READ-ONLY statement loader for the 4 "standalone
// document" tables that came out of the customs/refund/credit-note bulk
// import (see project doc `bulk-import-customs-refund-creditnote-2026-09-18.md`):
// Credit Note, CSB Filing, Refund (historical), Order Refund (live). Same
// pattern as src/lib/bill-statement.ts's loadBillStatement — ONE
// access-checked loader per type, dispatched from ONE API route
// (src/app/api/doc-statement/[type]/[id]/route.ts) and rendered through
// ONE dialog (src/components/doc-statement-dialog.tsx) + ONE actions bar
// (src/components/doc-statement-actions.tsx), so the 4 types share the
// same "view / print / WhatsApp / Telegram / email / PDF" machinery
// instead of 4 separate copies — deliberately mirroring the Bill Statement
// structure rather than duplicating it.
//
// Access scoping is genuinely different per table (this is real, not
// copy-paste laziness):
//  - credit_notes has its own company_id column — scope directly.
//  - refunds (historical, no company_id) scopes via store_id -> stores.company_id.
//  - order_refunds scopes via order_id -> orders.company_id.
//  - csb_filings has NO company/store link at all (see db/2026-08-14-csb-filings.sql —
//    a deliberate standalone-table decision) — any signed-in employee with
//    doc_entry or reports capability can view any filing, same as the
//    Documents page / bulk-upload tab already allow.
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type DocType = "credit_note" | "csb_filing" | "refund" | "order_refund";

export type DocCompany = { id: string; name: string; logo_url: string | null } | null;
export type DocProfile = {
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  gstin: string | null;
  bank_name: string | null;
  account_no: string | null;
  ifsc_code: string | null;
} | null;
export type DocParty = {
  id: string;
  name: string;
  address: string | null;
  contact_no: string | null;
  email: string | null;
  gst: string | null;
} | null;

// Fields every doc-statement shares, regardless of kind — what the shared
// Dialog shell + Actions bar need without caring which table it came from.
type DocStatementBase = {
  id: string;
  docTitle: string;
  invoiceRef: string; // the row's own natural document number, for the PDF filename/title
  companyName: string;
  company: DocCompany;
  profile: DocProfile;
  party: DocParty;
  waPhone: string; // "" when no phone on file — actions bar disables WhatsApp share
};

export type CreditNoteStatement = DocStatementBase & {
  kind: "credit_note";
  cnNo: string | null;
  vendorCnNo: string | null;
  cnKind: string | null;
  creditNoteDate: string | null;
  creditNoteStatus: string | null;
  refundType: string | null;
  invoiceNo: string | null;
  invoiceValueUsd: number | null;
  invoiceValueInr: number | null;
  refundAmount: number;
  refundAmtUsd: number | null;
  refundAmtInr: number | null;
  buyerName: string | null;
  itemName: string | null;
  itemPrice: number | null;
  qty: number | null;
  poRate: number | null;
  billedRate: number | null;
  gstRatePct: number | null;
  awbNo: string | null;
  remark: string | null;
};

export type CsbFilingStatement = DocStatementBase & {
  kind: "csb_filing";
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
};

export type RefundStatement = DocStatementBase & {
  kind: "refund";
  source: string | null;
  marketplaceOrderNo: string | null;
  itemId: string | null;
  buyerName: string | null;
  storeName: string | null;
  invoiceNo: string | null;
  status: string | null;
  orderAmtUsd: number | null;
  refundAmtUsd: number | null;
  refundAmtPct: number | null;
  refundType: string | null;
  refundDate: string | null;
  reason: string | null;
  remark: string | null;
};

export type OrderRefundStatement = DocStatementBase & {
  kind: "order_refund";
  orderRefNo: string | null;
  orderStatus: string | null;
  buyerName: string | null;
  refundAmount: number;
  refundCurrency: string;
  refundAmountUsd: number | null;
  refundAmountInr: number | null;
  refundBasisPercent: number | null;
  orderValueRefundAmount: number | null;
  shippingRefundAmount: number | null;
  dutyRefundAmount: number | null;
  refundDate: string;
  reason: string | null;
  creditNoteNo: string | null;
};

export type DocStatementData = CreditNoteStatement | CsbFilingStatement | RefundStatement | OrderRefundStatement;

export type DocStatementResult = { ok: true; data: DocStatementData } | { ok: false; status: 401 | 403 | 404; error: string };

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

function waPhoneFrom(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `91${digits}` : digits;
}

async function fetchCompanyAndProfile(supabase: ReturnType<typeof createServiceRoleClient>, companyId: string) {
  const [companyRes, profileRes] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", companyId).maybeSingle(),
    supabase
      .from("company_profiles")
      .select("address, phone, whatsapp, email, gstin, bank_name, account_no, ifsc_code")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);
  return { company: companyRes.data ?? null, profile: profileRes.data ?? null };
}

// ---------------------------------------------------------------------------
// CREDIT NOTE
// ---------------------------------------------------------------------------
async function loadCreditNoteStatement(id: string): Promise<DocStatementResult> {
  const employee = await requireEmployee();
  if (!employee.ok) return employee;
  const supabase = createServiceRoleClient();

  const { data: note } = await supabase
    .from("credit_notes")
    .select(
      "id, company_id, store_id, cn_no, vendor_cn_no, cn_kind, credit_note_date, order_id, item_id, buyer_name, refund_date, item_name, item_price, invoice_no, invoice_value_usd, invoice_value_inr, refund_amount, refund_amt_usd, refund_amt_inr, credit_note_status, refund_type, debit_note_id, party_id, qty, po_rate, billed_rate, gst_rate_pct, awb_no, remark"
    )
    .eq("id", id)
    .maybeSingle();
  if (!note) return { ok: false, status: 404, error: "Credit Note not found." };
  if (!employee.employee.companyIds.includes(note.company_id)) {
    return { ok: false, status: 403, error: "You don't have access to this Credit Note's company." };
  }

  const [{ company, profile }, partyRes] = await Promise.all([
    fetchCompanyAndProfile(supabase, note.company_id),
    note.party_id
      ? supabase.from("parties").select("id, name, address, contact_no, email, gst").eq("id", note.party_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const party = partyRes.data ?? null;
  const companyName = company?.name ?? "—";

  return {
    ok: true,
    data: {
      kind: "credit_note",
      id: note.id,
      docTitle: "CREDIT NOTE",
      invoiceRef: note.cn_no ?? note.id,
      companyName,
      company,
      profile,
      party,
      waPhone: waPhoneFrom(party?.contact_no),
      cnNo: note.cn_no,
      vendorCnNo: note.vendor_cn_no,
      cnKind: note.cn_kind,
      creditNoteDate: note.credit_note_date,
      creditNoteStatus: note.credit_note_status,
      refundType: note.refund_type,
      invoiceNo: note.invoice_no,
      invoiceValueUsd: numOrNull(note.invoice_value_usd),
      invoiceValueInr: numOrNull(note.invoice_value_inr),
      refundAmount: num(note.refund_amount),
      refundAmtUsd: numOrNull(note.refund_amt_usd),
      refundAmtInr: numOrNull(note.refund_amt_inr),
      buyerName: note.buyer_name,
      itemName: note.item_name,
      itemPrice: numOrNull(note.item_price),
      qty: numOrNull(note.qty),
      poRate: numOrNull(note.po_rate),
      billedRate: numOrNull(note.billed_rate),
      gstRatePct: numOrNull(note.gst_rate_pct),
      awbNo: note.awb_no,
      remark: note.remark,
    },
  };
}

// ---------------------------------------------------------------------------
// CSB FILING — no company/store link at all; access is capability-only.
// ---------------------------------------------------------------------------
async function loadCsbFilingStatement(id: string): Promise<DocStatementResult> {
  const employee = await requireEmployee();
  if (!employee.ok) return employee;
  if (!employee.employee.capabilities.some((c) => c === "doc_entry" || c === "reports")) {
    return { ok: false, status: 403, error: "You don't have access to CSB Filings." };
  }
  const supabase = createServiceRoleClient();

  const { data: filing } = await supabase
    .from("csb_filings")
    .select(
      "id, csb_number, exchange_rate, total_taxable_value, taxable_value_currency, fob_value_inr, filing_date, egm_number, egm_date, hawb_number, invoice_no, invoice_date"
    )
    .eq("id", id)
    .maybeSingle();
  if (!filing) return { ok: false, status: 404, error: "CSB Filing not found." };

  return {
    ok: true,
    data: {
      kind: "csb_filing",
      id: filing.id,
      docTitle: "CSB-V CUSTOMS FILING",
      invoiceRef: filing.csb_number,
      companyName: "—",
      company: null,
      profile: null,
      party: null,
      waPhone: "",
      csbNumber: filing.csb_number,
      exchangeRate: numOrNull(filing.exchange_rate),
      totalTaxableValue: numOrNull(filing.total_taxable_value),
      taxableValueCurrency: filing.taxable_value_currency,
      fobValueInr: numOrNull(filing.fob_value_inr),
      filingDate: filing.filing_date,
      egmNumber: filing.egm_number,
      egmDate: filing.egm_date,
      hawbNumber: filing.hawb_number,
      invoiceNo: filing.invoice_no,
      invoiceDate: filing.invoice_date,
    },
  };
}

// ---------------------------------------------------------------------------
// REFUND (historical `refunds` table) — scoped via store_id -> company_id.
// ---------------------------------------------------------------------------
async function loadRefundStatement(id: string): Promise<DocStatementResult> {
  const employee = await requireEmployee();
  if (!employee.ok) return employee;
  const supabase = createServiceRoleClient();

  const { data: refund } = await supabase
    .from("refunds")
    .select(
      "id, source, marketplace_order_no, item_id, buyer_name, store_id, invoice_no, status, order_amt_usd, refund_amt_usd, refund_amt_pct, refund_type, refund_date, reason, remark"
    )
    .eq("id", id)
    .maybeSingle();
  if (!refund) return { ok: false, status: 404, error: "Refund not found." };
  if (!refund.store_id) return { ok: false, status: 404, error: "This historical refund has no store linked." };

  const { data: store } = await supabase.from("stores").select("id, name, company_id").eq("id", refund.store_id).maybeSingle();
  if (!store) return { ok: false, status: 404, error: "Store not found." };
  if (!employee.employee.companyIds.includes(store.company_id)) {
    return { ok: false, status: 403, error: "You don't have access to this refund's company." };
  }

  const { company, profile } = await fetchCompanyAndProfile(supabase, store.company_id);
  const companyName = company?.name ?? "—";

  return {
    ok: true,
    data: {
      kind: "refund",
      id: refund.id,
      docTitle: "HISTORICAL MARKETPLACE REFUND",
      invoiceRef: refund.marketplace_order_no ?? refund.invoice_no ?? refund.id,
      companyName,
      company,
      profile,
      party: null,
      waPhone: "",
      source: refund.source,
      marketplaceOrderNo: refund.marketplace_order_no,
      itemId: refund.item_id,
      buyerName: refund.buyer_name,
      storeName: store.name,
      invoiceNo: refund.invoice_no,
      status: refund.status,
      orderAmtUsd: numOrNull(refund.order_amt_usd),
      refundAmtUsd: numOrNull(refund.refund_amt_usd),
      refundAmtPct: numOrNull(refund.refund_amt_pct),
      refundType: refund.refund_type,
      refundDate: refund.refund_date,
      reason: refund.reason,
      remark: refund.remark,
    },
  };
}

// ---------------------------------------------------------------------------
// ORDER REFUND (live) — scoped via order_id -> orders.company_id.
// ---------------------------------------------------------------------------
async function loadOrderRefundStatement(id: string): Promise<DocStatementResult> {
  const employee = await requireEmployee();
  if (!employee.ok) return employee;
  const supabase = createServiceRoleClient();

  const { data: refund } = await supabase
    .from("order_refunds")
    .select(
      "id, order_id, refund_amount, refund_currency, refund_date, reason, credit_note_id, refund_amount_usd, refund_amount_inr, refund_basis_percent, order_value_refund_amount, shipping_refund_amount, duty_refund_amount"
    )
    .eq("id", id)
    .maybeSingle();
  if (!refund) return { ok: false, status: 404, error: "Order Refund not found." };

  const { data: order } = await supabase
    .from("orders")
    .select("id, ref_no, company_id, buyer_name_address, status")
    .eq("id", refund.order_id)
    .maybeSingle();
  if (!order) return { ok: false, status: 404, error: "Linked order not found." };
  if (!employee.employee.companyIds.includes(order.company_id)) {
    return { ok: false, status: 403, error: "You don't have access to this refund's company." };
  }

  const [{ company, profile }, cnRes] = await Promise.all([
    fetchCompanyAndProfile(supabase, order.company_id),
    refund.credit_note_id ? supabase.from("credit_notes").select("id, cn_no").eq("id", refund.credit_note_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const companyName = company?.name ?? "—";

  return {
    ok: true,
    data: {
      kind: "order_refund",
      id: refund.id,
      docTitle: "ORDER REFUND",
      invoiceRef: order.ref_no ?? refund.id,
      companyName,
      company,
      profile,
      party: null,
      waPhone: "",
      orderRefNo: order.ref_no,
      orderStatus: order.status,
      buyerName: order.buyer_name_address,
      refundAmount: num(refund.refund_amount),
      refundCurrency: refund.refund_currency,
      refundAmountUsd: numOrNull(refund.refund_amount_usd),
      refundAmountInr: numOrNull(refund.refund_amount_inr),
      refundBasisPercent: numOrNull(refund.refund_basis_percent),
      orderValueRefundAmount: numOrNull(refund.order_value_refund_amount),
      shippingRefundAmount: numOrNull(refund.shipping_refund_amount),
      dutyRefundAmount: numOrNull(refund.duty_refund_amount),
      refundDate: refund.refund_date,
      reason: refund.reason,
      creditNoteNo: cnRes.data?.cn_no ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Auth helper + dispatcher
// ---------------------------------------------------------------------------
type EmployeeGate = { ok: true; employee: Awaited<ReturnType<typeof getAuthedEmployee>> } | { ok: false; status: 401; error: string };

async function requireEmployee(): Promise<EmployeeGate> {
  try {
    const employee = await getAuthedEmployee();
    return { ok: true, employee };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, status: 401, error: "Sign in to view this document." };
    return { ok: false, status: 401, error: "Not authorized." };
  }
}

export async function loadDocStatement(type: DocType, id: string): Promise<DocStatementResult> {
  switch (type) {
    case "credit_note":
      return loadCreditNoteStatement(id);
    case "csb_filing":
      return loadCsbFilingStatement(id);
    case "refund":
      return loadRefundStatement(id);
    case "order_refund":
      return loadOrderRefundStatement(id);
    default:
      return { ok: false, status: 404, error: "Unknown document type." };
  }
}
