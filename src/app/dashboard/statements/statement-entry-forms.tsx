"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveEbayFinancialSummary, saveEbayMonthlyFinancialStatement, saveEtsyMonthlyTaxInvoice, type SimpleFormState } from "./actions";

// 2026-09-19 — round 12: this file used to be create-only (3 tabs, 3 forms,
// always POSTing a brand-new row). That's why every statement entered so
// far shows under one Company with no way to fix it — see actions.ts's
// header comment for the full story. Added:
//   - `record`/`onDone` props on each of the 3 forms (same shape as
//     src/app/dashboard/parties/party-form.tsx): when `record` is set, the
//     form pre-fills from it, submits a hidden `*_id` field so the action
//     does an UPDATE instead of an INSERT, and shows "Update ..." + Cancel
//     instead of "Save ...".
//   - `defaultCompanyId` prop on `CompanySelect`, used only by the CREATE
//     forms (the Company dropdown here on the Statement Entry page — see
//     page.tsx). It defaults a *new* entry's Company to whichever company is
//     currently selected in the top-nav, instead of a blank "Select
//     company" placeholder — the practical fix for "company auto-select"
//     for a monthly aggregate statement that isn't tied to any single
//     order. It's still just a default: the dropdown stays fully editable
//     for any company this login can access, exactly as before.
//   - 3 new list components (`EtsyInvoiceList`, `EbaySummaryList`,
//     `EbayMonthlyStatementList`) that replace the plain read-only "Recent
//     ..." rows that used to live directly in page.tsx. Each keeps its own
//     `editingId` state and swaps a row for its form inline when "Edit" is
//     clicked — the exact pattern parties/party-list.tsx already uses.
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const initialState: SimpleFormState = { error: null, success: false };

export type EtsyInvoiceRecord = {
  id: string;
  company_id: string;
  invoice_no: string;
  invoice_date: string | null;
  period_from: string | null;
  period_to: string | null;
  subscription_plan_fees: number;
  listing_fees_qty: number;
  listing_fees: number;
  listing_fees_other: number;
  transaction_fees: number;
  renew_fees_qty: number;
  renew_fees: number;
  renew_expired_fees_qty: number;
  renew_expired_fees: number;
  renew_expired_fees_other: number;
  renew_sold_fees_qty: number;
  renew_sold_fees: number;
  renew_sold_fees_other: number;
  etsy_ads_fees: number;
  processing_fees: number;
  offsite_ads_fees: number;
  regulatory_operating_fees: number;
  promotional_discount: number;
  account_opening_fee: number;
  gst_pct: number;
  total_eur: number | null;
  total_inr: number;
};

export type EbaySummaryRecord = {
  id: string;
  company_id: string;
  period_from: string;
  period_to: string;
  generated_date: string | null;
  orders_credits: number;
  orders_net: number;
  refunds_gross_refunds: number;
  refunds_gross_claims: number;
  refunds_gross_payment_disputes: number;
  fees_insertion_fees: number;
  fees_promoted_listings_fees: number;
  fees_other_fees: number;
  fees_transaction_fees_debit: number;
  fees_transaction_fees_credit: number;
  fees_advanced_listing_upgrade_fees: number;
  expenses_shipping_labels: number;
  expenses_donations: number;
  net_transfers_charges: number;
  net_transfers_payouts: number;
  adjustments_debit: number;
  adjustments_credit: number;
  net_cash_movement_check: number;
};

export type EbayMonthlyStatementRecord = {
  id: string;
  company_id: string;
  statement_number: string | null;
  period_from: string;
  period_to: string;
  generated_date: string | null;
  opening_funds: number;
  orders_total_minus_fees: number;
  claims: number;
  refunds: number;
  payment_disputes: number;
  shipping_labels: number;
  other_fees: number;
  adjustment: number;
  purchases: number;
  charges: number;
  payouts: number;
  closing_funds_stated: number;
  closing_funds_computed: number;
};

export function StatementEntryForms({
  companies,
  defaultCompanyId,
}: {
  companies: { id: string; name: string }[];
  defaultCompanyId?: string;
}) {
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

      {tab === "etsy" ? (
        <EtsyForm companies={companies} defaultCompanyId={defaultCompanyId} />
      ) : tab === "ebay" ? (
        <EbayForm companies={companies} defaultCompanyId={defaultCompanyId} />
      ) : (
        <EbayMonthlyStatementForm companies={companies} defaultCompanyId={defaultCompanyId} />
      )}
    </div>
  );
}

function CompanySelect({
  companies,
  defaultValue,
  idPrefix = "",
}: {
  companies: { id: string; name: string }[];
  defaultValue?: string;
  idPrefix?: string;
}) {
  const id = `${idPrefix}company_id`;
  return (
    <div>
      <label className={labelClass} htmlFor={id}>Company *</label>
      <select id={id} name="company_id" required defaultValue={defaultValue ?? ""} className={inputClass}>
        <option value="" disabled>Select company</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

function NumField({
  name,
  label,
  defaultValue = 0,
  idPrefix = "",
}: {
  name: string;
  label: string;
  defaultValue?: number;
  idPrefix?: string;
}) {
  const id = `${idPrefix}${name}`;
  return (
    <div>
      <label className={labelClass} htmlFor={id}>{label}</label>
      <input id={id} name={name} type="number" step="0.01" defaultValue={defaultValue} className={inputClass} />
    </div>
  );
}

function CancelButton({ onDone }: { onDone: () => void }) {
  return (
    <button
      type="button"
      onClick={onDone}
      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
    >
      Cancel
    </button>
  );
}

function EtsyForm({
  companies,
  defaultCompanyId,
  record,
  onDone,
}: {
  companies: { id: string; name: string }[];
  defaultCompanyId?: string;
  record?: EtsyInvoiceRecord;
  onDone?: () => void;
}) {
  const isEdit = !!record;
  const idPrefix = isEdit ? `etsy-${record.id}-` : "";
  const [state, formAction, pending] = useActionState(saveEtsyMonthlyTaxInvoice, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.success) return;
    if (isEdit) onDone?.();
    else formRef.current?.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      {isEdit && <input type="hidden" name="etsy_invoice_id" value={record.id} />}
      <p className="text-xs text-slate-400">
        From the PDF-only Etsy Monthly Tax Invoice statement. Subtotal / GST Amount / Total are computed automatically
        from the fields below (matches the invoice&apos;s own arithmetic to within rounding).
      </p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && !isEdit && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Saved.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CompanySelect companies={companies} defaultValue={record?.company_id ?? defaultCompanyId} idPrefix={idPrefix} />
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}invoice_no`}>Invoice No. *</label>
          <input id={`${idPrefix}invoice_no`} name="invoice_no" required defaultValue={record?.invoice_no} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}invoice_date`}>Invoice Date</label>
          <input id={`${idPrefix}invoice_date`} name="invoice_date" type="date" defaultValue={record?.invoice_date ?? undefined} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}period_from`}>Period From</label>
          <input id={`${idPrefix}period_from`} name="period_from" type="date" defaultValue={record?.period_from ?? undefined} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}period_to`}>Period To</label>
          <input id={`${idPrefix}period_to`} name="period_to" type="date" defaultValue={record?.period_to ?? undefined} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}gst_pct`}>GST % (e.g. 0.18)</label>
          <input id={`${idPrefix}gst_pct`} name="gst_pct" type="number" step="0.0001" defaultValue={record?.gst_pct ?? 0} className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumField idPrefix={idPrefix} name="subscription_plan_fees" label="Subscription Plan Fees" defaultValue={record?.subscription_plan_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="listing_fees_qty" label="Listing Fees Qty" defaultValue={record?.listing_fees_qty ?? 0} />
        <NumField idPrefix={idPrefix} name="listing_fees" label="Listing Fees" defaultValue={record?.listing_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="listing_fees_other" label="Listing Fees (other, flat line)" defaultValue={record?.listing_fees_other ?? 0} />
        <NumField idPrefix={idPrefix} name="transaction_fees" label="Transaction Fees" defaultValue={record?.transaction_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="renew_fees_qty" label="Renew Fees Qty (rare — separate from Expired/Sold)" defaultValue={record?.renew_fees_qty ?? 0} />
        <NumField idPrefix={idPrefix} name="renew_fees" label="Renew Fees (rare — separate from Expired/Sold)" defaultValue={record?.renew_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="renew_expired_fees_qty" label="Renew Expired Fees Qty" defaultValue={record?.renew_expired_fees_qty ?? 0} />
        <NumField idPrefix={idPrefix} name="renew_expired_fees" label="Renew Expired Fees" defaultValue={record?.renew_expired_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="renew_expired_fees_other" label="Renew Expired Fees (other, flat line)" defaultValue={record?.renew_expired_fees_other ?? 0} />
        <NumField idPrefix={idPrefix} name="renew_sold_fees_qty" label="Renew Sold Fees Qty" defaultValue={record?.renew_sold_fees_qty ?? 0} />
        <NumField idPrefix={idPrefix} name="renew_sold_fees" label="Renew Sold Fees" defaultValue={record?.renew_sold_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="renew_sold_fees_other" label="Renew Sold Fees (other, flat line)" defaultValue={record?.renew_sold_fees_other ?? 0} />
        <NumField idPrefix={idPrefix} name="etsy_ads_fees" label="Etsy Ads Fees" defaultValue={record?.etsy_ads_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="processing_fees" label="Processing Fees" defaultValue={record?.processing_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="offsite_ads_fees" label="Offsite Ads Fees" defaultValue={record?.offsite_ads_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="regulatory_operating_fees" label="Regulatory/Operating Fees" defaultValue={record?.regulatory_operating_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="promotional_discount" label="Promotional Discount" defaultValue={record?.promotional_discount ?? 0} />
        {/* 2026-09-19 — this column existed on the table and factors into the
            subtotal/GST/total formulas but had no input anywhere — added. */}
        <NumField idPrefix={idPrefix} name="account_opening_fee" label="Account Opening Fee" defaultValue={record?.account_opening_fee ?? 0} />
        <NumField idPrefix={idPrefix} name="total_eur" label="Total (EUR, as printed)" defaultValue={record?.total_eur ?? 0} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : isEdit ? "Update Invoice" : "Save Invoice"}
        </button>
        {isEdit && onDone && <CancelButton onDone={onDone} />}
      </div>
    </form>
  );
}

function EbayForm({
  companies,
  defaultCompanyId,
  record,
  onDone,
}: {
  companies: { id: string; name: string }[];
  defaultCompanyId?: string;
  record?: EbaySummaryRecord;
  onDone?: () => void;
}) {
  const isEdit = !!record;
  const idPrefix = isEdit ? `ebay-${record.id}-` : "";
  const [state, formAction, pending] = useActionState(saveEbayFinancialSummary, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.success) return;
    if (isEdit) onDone?.();
    else formRef.current?.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      {isEdit && <input type="hidden" name="ebay_summary_id" value={record.id} />}
      <p className="text-xs text-slate-400">
        From the PDF-only eBay Financial Summary Report. Net roll-ups (Refunds Net, Fees Subtotal Net, Expenses Total
        Net, Net Transfers Net, Adjustments Net) and the sanity-check Net Cash Movement are computed automatically —
        see the report list below.
      </p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && !isEdit && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Saved.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CompanySelect companies={companies} defaultValue={record?.company_id ?? defaultCompanyId} idPrefix={idPrefix} />
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}period_from`}>Period From *</label>
          <input id={`${idPrefix}period_from`} name="period_from" type="date" required defaultValue={record?.period_from} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}period_to`}>Period To *</label>
          <input id={`${idPrefix}period_to`} name="period_to" type="date" required defaultValue={record?.period_to} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}generated_date`}>Generated Date</label>
          <input id={`${idPrefix}generated_date`} name="generated_date" type="date" defaultValue={record?.generated_date ?? undefined} className={inputClass} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Orders</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField idPrefix={idPrefix} name="orders_credits" label="Credits" defaultValue={record?.orders_credits ?? 0} />
          <NumField idPrefix={idPrefix} name="orders_net" label="Net" defaultValue={record?.orders_net ?? 0} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Refunds (gross)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField idPrefix={idPrefix} name="refunds_gross_refunds" label="Refunds" defaultValue={record?.refunds_gross_refunds ?? 0} />
          <NumField idPrefix={idPrefix} name="refunds_gross_claims" label="Claims" defaultValue={record?.refunds_gross_claims ?? 0} />
          <NumField idPrefix={idPrefix} name="refunds_gross_payment_disputes" label="Payment Disputes" defaultValue={record?.refunds_gross_payment_disputes ?? 0} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Fees</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField idPrefix={idPrefix} name="fees_insertion_fees" label="Insertion Fees" defaultValue={record?.fees_insertion_fees ?? 0} />
          <NumField idPrefix={idPrefix} name="fees_promoted_listings_fees" label="Promoted Listings Fees" defaultValue={record?.fees_promoted_listings_fees ?? 0} />
          <NumField idPrefix={idPrefix} name="fees_other_fees" label="Other Fees" defaultValue={record?.fees_other_fees ?? 0} />
          <NumField idPrefix={idPrefix} name="fees_transaction_fees_debit" label="Transaction Fees (Debit)" defaultValue={record?.fees_transaction_fees_debit ?? 0} />
          <NumField idPrefix={idPrefix} name="fees_transaction_fees_credit" label="Transaction Fees (Credit)" defaultValue={record?.fees_transaction_fees_credit ?? 0} />
          <NumField idPrefix={idPrefix} name="fees_advanced_listing_upgrade_fees" label="Advanced Listing Upgrade Fees" defaultValue={record?.fees_advanced_listing_upgrade_fees ?? 0} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Expenses</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField idPrefix={idPrefix} name="expenses_shipping_labels" label="Shipping Labels" defaultValue={record?.expenses_shipping_labels ?? 0} />
          <NumField idPrefix={idPrefix} name="expenses_donations" label="Donations" defaultValue={record?.expenses_donations ?? 0} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Net Transfers</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField idPrefix={idPrefix} name="net_transfers_charges" label="Charges" defaultValue={record?.net_transfers_charges ?? 0} />
          <NumField idPrefix={idPrefix} name="net_transfers_payouts" label="Payouts" defaultValue={record?.net_transfers_payouts ?? 0} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Adjustments</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField idPrefix={idPrefix} name="adjustments_debit" label="Debit" defaultValue={record?.adjustments_debit ?? 0} />
          <NumField idPrefix={idPrefix} name="adjustments_credit" label="Credit" defaultValue={record?.adjustments_credit ?? 0} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : isEdit ? "Update Financial Summary" : "Save Financial Summary"}
        </button>
        {isEdit && onDone && <CancelButton onDone={onDone} />}
      </div>
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
function EbayMonthlyStatementForm({
  companies,
  defaultCompanyId,
  record,
  onDone,
}: {
  companies: { id: string; name: string }[];
  defaultCompanyId?: string;
  record?: EbayMonthlyStatementRecord;
  onDone?: () => void;
}) {
  const isEdit = !!record;
  const idPrefix = isEdit ? `ebaym-${record.id}-` : "";
  const [state, formAction, pending] = useActionState(saveEbayMonthlyFinancialStatement, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.success) return;
    if (isEdit) onDone?.();
    else formRef.current?.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      {isEdit && <input type="hidden" name="ebay_statement_id" value={record.id} />}
      <p className="text-xs text-slate-400">
        From the PDF-only eBay &quot;Financial statement&quot; (the monthly running-balance report, not the Financial
        Summary Report above). Type each field&apos;s value exactly as printed, including its +/- sign — Closing Funds
        (Computed) below is a live check against what you type in Closing Funds (Stated).
      </p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && !isEdit && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Saved.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CompanySelect companies={companies} defaultValue={record?.company_id ?? defaultCompanyId} idPrefix={idPrefix} />
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}statement_number`}>Statement Number</label>
          <input id={`${idPrefix}statement_number`} name="statement_number" defaultValue={record?.statement_number ?? undefined} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}generated_date`}>Generated Date</label>
          <input id={`${idPrefix}generated_date`} name="generated_date" type="date" defaultValue={record?.generated_date ?? undefined} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}period_from`}>Period From *</label>
          <input id={`${idPrefix}period_from`} name="period_from" type="date" required defaultValue={record?.period_from} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}period_to`}>Period To *</label>
          <input id={`${idPrefix}period_to`} name="period_to" type="date" required defaultValue={record?.period_to} className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumField idPrefix={idPrefix} name="opening_funds" label="Opening Funds" defaultValue={record?.opening_funds ?? 0} />
        <NumField idPrefix={idPrefix} name="orders_total_minus_fees" label="Orders (Total minus fees)" defaultValue={record?.orders_total_minus_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="claims" label="Claims" defaultValue={record?.claims ?? 0} />
        <NumField idPrefix={idPrefix} name="refunds" label="Refunds" defaultValue={record?.refunds ?? 0} />
        <NumField idPrefix={idPrefix} name="payment_disputes" label="Payment Disputes" defaultValue={record?.payment_disputes ?? 0} />
        <NumField idPrefix={idPrefix} name="shipping_labels" label="Shipping Labels" defaultValue={record?.shipping_labels ?? 0} />
        <NumField idPrefix={idPrefix} name="other_fees" label="Other Fees" defaultValue={record?.other_fees ?? 0} />
        <NumField idPrefix={idPrefix} name="adjustment" label="Adjustment" defaultValue={record?.adjustment ?? 0} />
        <NumField idPrefix={idPrefix} name="purchases" label="Purchases" defaultValue={record?.purchases ?? 0} />
        <NumField idPrefix={idPrefix} name="charges" label="Charges" defaultValue={record?.charges ?? 0} />
        <NumField idPrefix={idPrefix} name="payouts" label="Payouts" defaultValue={record?.payouts ?? 0} />
        <NumField idPrefix={idPrefix} name="closing_funds_stated" label="Closing Funds (as printed)" defaultValue={record?.closing_funds_stated ?? 0} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : isEdit ? "Update Financial Statement" : "Save Financial Statement"}
        </button>
        {isEdit && onDone && <CancelButton onDone={onDone} />}
      </div>
    </form>
  );
}

// ---- Recent-entries lists (edit-in-place) --------------------------------
// 2026-09-19 — moved out of page.tsx (a Server Component, which can't hold
// `editingId` state) so clicking "Edit" on a row can swap it for a
// pre-filled form right there, same UX as parties/party-list.tsx.

export function EtsyInvoiceList({
  companies,
  companyNamePairs,
  invoices,
  total,
}: {
  companies: { id: string; name: string }[];
  companyNamePairs: [string, string][];
  invoices: EtsyInvoiceRecord[];
  total: { count: number; amount: number };
}) {
  const companyName = new Map(companyNamePairs);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">Recent Etsy Monthly Tax Invoices</h2>
      <p className="mb-3 text-xs font-medium text-slate-500">
        Total: {total.count} invoice{total.count === 1 ? "" : "s"} · ₹{total.amount.toFixed(2)} (all-time)
      </p>
      <div className="space-y-1 text-xs">
        {invoices.length === 0 && <p className="text-slate-400">None entered yet.</p>}
        {invoices.map((r) =>
          editingId === r.id ? (
            <div key={r.id} className="py-2">
              <EtsyForm companies={companies} record={r} onDone={() => setEditingId(null)} />
            </div>
          ) : (
            <div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
              <span className="text-slate-600">
                {companyName.get(r.company_id)} — {r.invoice_no} ({r.invoice_date ?? "—"})
              </span>
              <span className="flex items-center gap-2">
                <span className="font-medium text-slate-800">₹{Number(r.total_inr ?? 0).toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => setEditingId(r.id)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                >
                  Edit
                </button>
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function EbaySummaryList({
  companies,
  companyNamePairs,
  summaries,
  total,
}: {
  companies: { id: string; name: string }[];
  companyNamePairs: [string, string][];
  summaries: EbaySummaryRecord[];
  total: { count: number; amount: number };
}) {
  const companyName = new Map(companyNamePairs);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">Recent eBay Financial Summaries</h2>
      <p className="mb-3 text-xs font-medium text-slate-500">
        Total: {total.count} summar{total.count === 1 ? "y" : "ies"} · ₹{total.amount.toFixed(2)} (all-time)
      </p>
      <div className="space-y-1 text-xs">
        {summaries.length === 0 && <p className="text-slate-400">None entered yet.</p>}
        {summaries.map((r) =>
          editingId === r.id ? (
            <div key={r.id} className="py-2">
              <EbayForm companies={companies} record={r} onDone={() => setEditingId(null)} />
            </div>
          ) : (
            <div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
              <span className="text-slate-600">
                {companyName.get(r.company_id)} — {r.period_from} to {r.period_to}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-medium text-slate-800">₹{Number(r.net_cash_movement_check ?? 0).toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => setEditingId(r.id)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                >
                  Edit
                </button>
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function EbayMonthlyStatementList({
  companies,
  companyNamePairs,
  statements,
  total,
}: {
  companies: { id: string; name: string }[];
  companyNamePairs: [string, string][];
  statements: EbayMonthlyStatementRecord[];
  total: { count: number; amount: number };
}) {
  const companyName = new Map(companyNamePairs);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">Recent eBay Financial Statements (Monthly)</h2>
      <p className="mb-3 text-xs font-medium text-slate-500">
        Total: {total.count} statement{total.count === 1 ? "" : "s"} · ${total.amount.toFixed(2)} closing funds stated (all-time)
      </p>
      <div className="space-y-1 text-xs">
        {statements.length === 0 && <p className="text-slate-400">None entered yet.</p>}
        {statements.map((r) => {
          if (editingId === r.id) {
            return (
              <div key={r.id} className="py-2">
                <EbayMonthlyStatementForm companies={companies} record={r} onDone={() => setEditingId(null)} />
              </div>
            );
          }
          const mismatch = Math.abs(Number(r.closing_funds_stated ?? 0) - Number(r.closing_funds_computed ?? 0)) > 0.01;
          return (
            <div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
              <span className="text-slate-600">
                {companyName.get(r.company_id)} — {r.period_from} to {r.period_to}
              </span>
              <span className="flex items-center gap-2">
                <span className={`font-medium ${mismatch ? "text-red-600" : "text-slate-800"}`}>
                  ${Number(r.closing_funds_stated ?? 0).toFixed(2)}
                  {mismatch ? " ⚠️ mismatch" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingId(r.id)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                >
                  Edit
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
