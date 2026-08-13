"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveEbayFinancialSummary, saveEbayMonthlyFinancialStatement, saveEtsyMonthlyTaxInvoice, type SimpleFormState } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const initialState: SimpleFormState = { error: null, success: false };

export function StatementEntryForms({ companies }: { companies: { id: string; name: string }[] }) {
  const [tab, setTab] = useState<"etsy" | "ebay" | "ebay-monthly">("etsy");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setTab("etsy")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === "etsy" ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"}`}
        >
          Etsy Monthly Tax Invoice
        </button>
        <button
          type="button"
          onClick={() => setTab("ebay")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === "ebay" ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"}`}
        >
          eBay Financial Summary
        </button>
        <button
          type="button"
          onClick={() => setTab("ebay-monthly")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === "ebay-monthly" ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"}`}
        >
          eBay Financial Statement (Monthly)
        </button>
      </div>

      {tab === "etsy" ? <EtsyForm companies={companies} /> : tab === "ebay" ? <EbayForm companies={companies} /> : <EbayMonthlyStatementForm companies={companies} />}
    </div>
  );
}

function CompanySelect({ companies }: { companies: { id: string; name: string }[] }) {
  return (
    <div>
      <label className={labelClass} htmlFor="company_id">Company *</label>
      <select id="company_id" name="company_id" required defaultValue="" className={inputClass}>
        <option value="" disabled>Select company</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

function NumField({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <label className={labelClass} htmlFor={name}>{label}</label>
      <input id={name} name={name} type="number" step="0.01" defaultValue={0} className={inputClass} />
    </div>
  );
}

function EtsyForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(saveEtsyMonthlyTaxInvoice, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs text-slate-400">
        From the PDF-only Etsy Monthly Tax Invoice statement. Subtotal / GST Amount / Total are computed automatically
        from the fields below (matches the invoice&apos;s own arithmetic to within rounding).
      </p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Saved.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CompanySelect companies={companies} />
        <div>
          <label className={labelClass} htmlFor="invoice_no">Invoice No. *</label>
          <input id="invoice_no" name="invoice_no" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="invoice_date">Invoice Date</label>
          <input id="invoice_date" name="invoice_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="period_from">Period From</label>
          <input id="period_from" name="period_from" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="period_to">Period To</label>
          <input id="period_to" name="period_to" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="gst_pct">GST % (e.g. 0.18)</label>
          <input id="gst_pct" name="gst_pct" type="number" step="0.0001" defaultValue={0} className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumField name="subscription_plan_fees" label="Subscription Plan Fees" />
        <NumField name="listing_fees_qty" label="Listing Fees Qty" />
        <NumField name="listing_fees" label="Listing Fees" />
        <NumField name="listing_fees_other" label="Listing Fees (other, flat line)" />
        <NumField name="transaction_fees" label="Transaction Fees" />
        <NumField name="renew_fees_qty" label="Renew Fees Qty (rare — separate from Expired/Sold)" />
        <NumField name="renew_fees" label="Renew Fees (rare — separate from Expired/Sold)" />
        <NumField name="renew_expired_fees_qty" label="Renew Expired Fees Qty" />
        <NumField name="renew_expired_fees" label="Renew Expired Fees" />
        <NumField name="renew_expired_fees_other" label="Renew Expired Fees (other, flat line)" />
        <NumField name="renew_sold_fees_qty" label="Renew Sold Fees Qty" />
        <NumField name="renew_sold_fees" label="Renew Sold Fees" />
        <NumField name="renew_sold_fees_other" label="Renew Sold Fees (other, flat line)" />
        <NumField name="etsy_ads_fees" label="Etsy Ads Fees" />
        <NumField name="processing_fees" label="Processing Fees" />
        <NumField name="offsite_ads_fees" label="Offsite Ads Fees" />
        <NumField name="regulatory_operating_fees" label="Regulatory/Operating Fees" />
        <NumField name="promotional_discount" label="Promotional Discount" />
        <NumField name="total_eur" label="Total (EUR, as printed)" />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save Invoice"}
      </button>
    </form>
  );
}

function EbayForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(saveEbayFinancialSummary, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs text-slate-400">
        From the PDF-only eBay Financial Summary Report. Net roll-ups (Refunds Net, Fees Subtotal Net, Expenses Total
        Net, Net Transfers Net, Adjustments Net) and the sanity-check Net Cash Movement are computed automatically —
        see the report list below.
      </p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Saved.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CompanySelect companies={companies} />
        <div>
          <label className={labelClass} htmlFor="period_from">Period From *</label>
          <input id="period_from" name="period_from" type="date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="period_to">Period To *</label>
          <input id="period_to" name="period_to" type="date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="generated_date">Generated Date</label>
          <input id="generated_date" name="generated_date" type="date" className={inputClass} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Orders</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField name="orders_credits" label="Credits" />
          <NumField name="orders_net" label="Net" />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Refunds (gross)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField name="refunds_gross_refunds" label="Refunds" />
          <NumField name="refunds_gross_claims" label="Claims" />
          <NumField name="refunds_gross_payment_disputes" label="Payment Disputes" />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Fees</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField name="fees_insertion_fees" label="Insertion Fees" />
          <NumField name="fees_promoted_listings_fees" label="Promoted Listings Fees" />
          <NumField name="fees_other_fees" label="Other Fees" />
          <NumField name="fees_transaction_fees_debit" label="Transaction Fees (Debit)" />
          <NumField name="fees_transaction_fees_credit" label="Transaction Fees (Credit)" />
          <NumField name="fees_advanced_listing_upgrade_fees" label="Advanced Listing Upgrade Fees" />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Expenses</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField name="expenses_shipping_labels" label="Shipping Labels" />
          <NumField name="expenses_donations" label="Donations" />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Net Transfers</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField name="net_transfers_charges" label="Charges" />
          <NumField name="net_transfers_payouts" label="Payouts" />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Adjustments</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField name="adjustments_debit" label="Debit" />
          <NumField name="adjustments_credit" label="Credit" />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save Financial Summary"}
      </button>
    </form>
  );
}

// 2026-08-13 — the real eBay "Financial statement" PDF (eBay Commerce
// Inc. letterhead) is a DIFFERENT, simpler monthly report from the
// "Financial Summary Report" the form above is for — a running-balance
// statement (Opening funds -> ... -> Closing funds), verified against 8
// real consecutive months (Dec 2025-Jul 2026): each month's Closing funds
// equals the next month's Opening funds, and Closing = the straight
// signed sum of every field below (verified exact, to the cent, not just
// close) — see db/schema.sql's comment on ebay_monthly_financial_statement.
// Type each field's value exactly as printed on the PDF, including its
// sign (e.g. "Other fees" and "Payouts" are usually shown as negative).
function EbayMonthlyStatementForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(saveEbayMonthlyFinancialStatement, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs text-slate-400">
        From the PDF-only eBay &quot;Financial statement&quot; (the monthly running-balance report, not the Financial
        Summary Report above). Type each field&apos;s value exactly as printed, including its +/- sign — Closing Funds
        (Computed) below is a live check against what you type in Closing Funds (Stated).
      </p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Saved.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CompanySelect companies={companies} />
        <div>
          <label className={labelClass} htmlFor="statement_number">Statement Number</label>
          <input id="statement_number" name="statement_number" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="generated_date">Generated Date</label>
          <input id="generated_date" name="generated_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="period_from">Period From *</label>
          <input id="period_from" name="period_from" type="date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="period_to">Period To *</label>
          <input id="period_to" name="period_to" type="date" required className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumField name="opening_funds" label="Opening Funds" />
        <NumField name="orders_total_minus_fees" label="Orders (Total minus fees)" />
        <NumField name="claims" label="Claims" />
        <NumField name="refunds" label="Refunds" />
        <NumField name="payment_disputes" label="Payment Disputes" />
        <NumField name="shipping_labels" label="Shipping Labels" />
        <NumField name="other_fees" label="Other Fees" />
        <NumField name="adjustment" label="Adjustment" />
        <NumField name="purchases" label="Purchases" />
        <NumField name="charges" label="Charges" />
        <NumField name="payouts" label="Payouts" />
        <NumField name="closing_funds_stated" label="Closing Funds (as printed)" />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save Financial Statement"}
      </button>
    </form>
  );
}
