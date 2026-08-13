"use server";

// Statement Entry (round 11) — manual hand-entry for the 2 PDF-only
// statements db/schema.sql's own comments name this screen for:
// "Old sheet: Etsy Monthly Tax Invoice — PDF-only statement, entered by
// hand via the 'Statement Entry' screen (not CSV-uploadable)" and the
// matching comment on ebay_financial_summary. Both tables + their derived
// totals (subtotal/GST/total for Etsy; the *_net roll-ups + sanity-check
// net_cash_movement_check for eBay, via ebay_financial_summary_computed_view)
// already existed in the schema — this just adds the entry forms.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type SimpleFormState = { error: string | null; success: boolean };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}
function num(formData: FormData, key: string): number {
  const v = Number(str(formData, key));
  return Number.isFinite(v) ? v : 0;
}
function intOrZero(formData: FormData, key: string): number {
  const v = Math.trunc(Number(str(formData, key)));
  return Number.isFinite(v) ? v : 0;
}

export async function saveEtsyMonthlyTaxInvoice(_prev: SimpleFormState, formData: FormData): Promise<SimpleFormState> {
  await requireCapability("statement_entry");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const invoiceNo = str(formData, "invoice_no");
  if (!companyId || !invoiceNo) return { error: "Company and Invoice No. are required.", success: false };

  const { error } = await supabase.from("etsy_monthly_tax_invoices").insert({
    company_id: companyId,
    invoice_no: invoiceNo,
    invoice_date: strOrNull(formData, "invoice_date"),
    period_from: strOrNull(formData, "period_from"),
    period_to: strOrNull(formData, "period_to"),
    subscription_plan_fees: num(formData, "subscription_plan_fees"),
    listing_fees_qty: intOrZero(formData, "listing_fees_qty"),
    listing_fees: num(formData, "listing_fees"),
    listing_fees_other: num(formData, "listing_fees_other"),
    transaction_fees: num(formData, "transaction_fees"),
    renew_fees_qty: intOrZero(formData, "renew_fees_qty"),
    renew_fees: num(formData, "renew_fees"),
    renew_expired_fees_qty: intOrZero(formData, "renew_expired_fees_qty"),
    renew_expired_fees: num(formData, "renew_expired_fees"),
    renew_expired_fees_other: num(formData, "renew_expired_fees_other"),
    renew_sold_fees_qty: intOrZero(formData, "renew_sold_fees_qty"),
    renew_sold_fees: num(formData, "renew_sold_fees"),
    renew_sold_fees_other: num(formData, "renew_sold_fees_other"),
    etsy_ads_fees: num(formData, "etsy_ads_fees"),
    processing_fees: num(formData, "processing_fees"),
    offsite_ads_fees: num(formData, "offsite_ads_fees"),
    regulatory_operating_fees: num(formData, "regulatory_operating_fees"),
    promotional_discount: num(formData, "promotional_discount"),
    gst_pct: num(formData, "gst_pct"),
    total_eur: strOrNull(formData, "total_eur") ? num(formData, "total_eur") : null,
  });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate key")) {
      return { error: "This Invoice No. is already entered for this company.", success: false };
    }
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/statements");
  return { error: null, success: true };
}

// 2026-08-13 — real eBay "Financial statement" PDF (eBay Commerce Inc.
// letterhead), a different/simpler monthly running-balance report from
// eBay Financial Summary Report above. See db/schema.sql's comment on
// ebay_monthly_financial_statement for the verification detail.
export async function saveEbayMonthlyFinancialStatement(_prev: SimpleFormState, formData: FormData): Promise<SimpleFormState> {
  await requireCapability("statement_entry");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const periodFrom = str(formData, "period_from");
  const periodTo = str(formData, "period_to");
  if (!companyId || !periodFrom || !periodTo) {
    return { error: "Company, Period From, and Period To are required.", success: false };
  }

  const { error } = await supabase.from("ebay_monthly_financial_statement").insert({
    company_id: companyId,
    statement_number: strOrNull(formData, "statement_number"),
    period_from: periodFrom,
    period_to: periodTo,
    generated_date: strOrNull(formData, "generated_date"),
    opening_funds: num(formData, "opening_funds"),
    orders_total_minus_fees: num(formData, "orders_total_minus_fees"),
    claims: num(formData, "claims"),
    refunds: num(formData, "refunds"),
    payment_disputes: num(formData, "payment_disputes"),
    shipping_labels: num(formData, "shipping_labels"),
    other_fees: num(formData, "other_fees"),
    adjustment: num(formData, "adjustment"),
    purchases: num(formData, "purchases"),
    charges: num(formData, "charges"),
    payouts: num(formData, "payouts"),
    closing_funds_stated: num(formData, "closing_funds_stated"),
  });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate key")) {
      return { error: "A Financial Statement for this company and period already exists.", success: false };
    }
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/statements");
  return { error: null, success: true };
}

export async function saveEbayFinancialSummary(_prev: SimpleFormState, formData: FormData): Promise<SimpleFormState> {
  await requireCapability("statement_entry");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const periodFrom = str(formData, "period_from");
  const periodTo = str(formData, "period_to");
  if (!companyId || !periodFrom || !periodTo) {
    return { error: "Company, Period From, and Period To are required.", success: false };
  }

  const { error } = await supabase.from("ebay_financial_summary").insert({
    company_id: companyId,
    period_from: periodFrom,
    period_to: periodTo,
    generated_date: strOrNull(formData, "generated_date"),
    orders_credits: num(formData, "orders_credits"),
    orders_net: num(formData, "orders_net"),
    refunds_gross_refunds: num(formData, "refunds_gross_refunds"),
    refunds_gross_claims: num(formData, "refunds_gross_claims"),
    refunds_gross_payment_disputes: num(formData, "refunds_gross_payment_disputes"),
    fees_insertion_fees: num(formData, "fees_insertion_fees"),
    fees_promoted_listings_fees: num(formData, "fees_promoted_listings_fees"),
    fees_other_fees: num(formData, "fees_other_fees"),
    fees_transaction_fees_debit: num(formData, "fees_transaction_fees_debit"),
    fees_transaction_fees_credit: num(formData, "fees_transaction_fees_credit"),
    fees_advanced_listing_upgrade_fees: num(formData, "fees_advanced_listing_upgrade_fees"),
    expenses_shipping_labels: num(formData, "expenses_shipping_labels"),
    expenses_donations: num(formData, "expenses_donations"),
    net_transfers_charges: num(formData, "net_transfers_charges"),
    net_transfers_payouts: num(formData, "net_transfers_payouts"),
    adjustments_debit: num(formData, "adjustments_debit"),
    adjustments_credit: num(formData, "adjustments_credit"),
  });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate key")) {
      return { error: "A Financial Summary for this company and period already exists.", success: false };
    }
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/statements");
  return { error: null, success: true };
}
