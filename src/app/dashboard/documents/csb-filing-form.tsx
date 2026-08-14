"use client";

import { useActionState } from "react";
import { saveCsbFiling, type DocFormState } from "./actions";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

// CSB Filing (2026-08-14) — manual entry for the customs CSB-V filing
// confirmation register (see actions.ts / db/2026-08-14-csb-filings.sql
// for the full "why"). Flat form, same shape as Purchase Bill/Washing
// Entry, but with NO order lookup — this is a standalone header row,
// invoice_no is just free text here (not FK-linked). Field order/labels
// match columns B-L of the source xlsx (A "File Name" and M "Goods
// Description" are intentionally not fields on this form).
export function CsbFilingForm({ currencies }: { currencies: { code: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(saveCsbFiling, initialState);

  if (state.success) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
        CSB Filing saved — <strong>{state.success.docNo}</strong>.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelClass} htmlFor="csb_number">CSB Number *</label>
          <input id="csb_number" name="csb_number" required className={inputClass} placeholder="CSBV_DEL_2026-2027_30_07_18608" />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_exchange_rate">Exchange Rate</label>
          <input id="csb_exchange_rate" name="exchange_rate" type="number" step="0.0001" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_total_taxable_value">Total Taxable Value</label>
          <input id="csb_total_taxable_value" name="total_taxable_value" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_taxable_value_currency">Taxable Value Currency</label>
          <select id="csb_taxable_value_currency" name="taxable_value_currency" defaultValue="USD" className={inputClass}>
            {currencies.length > 0
              ? currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))
              : ["USD", "INR", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_fob_value_inr">FOB Value (In INR)</label>
          <input id="csb_fob_value_inr" name="fob_value_inr" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_filing_date">Filing Date</label>
          <input id="csb_filing_date" name="filing_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_egm_number">EGM Number</label>
          <input id="csb_egm_number" name="egm_number" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_egm_date">EGM Date</label>
          <input id="csb_egm_date" name="egm_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_hawb_number">HAWB Number</label>
          <input id="csb_hawb_number" name="hawb_number" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_invoice_no">Invoice Number</label>
          <input id="csb_invoice_no" name="invoice_no" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_invoice_date">Invoice Date</label>
          <input id="csb_invoice_date" name="invoice_date" type="date" className={inputClass} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save CSB Filing"}
      </button>
    </form>
  );
}
