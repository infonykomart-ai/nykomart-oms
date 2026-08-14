"use client";

import { useActionState, useEffect } from "react";
import { updateCsbFiling, type DocEditState } from "./actions";

const initialState: DocEditState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditableCsbFiling = {
  id: string;
  csb_number: string;
  exchange_rate: number | null;
  total_taxable_value: number | null;
  taxable_value_currency: string | null;
  fob_value_inr: number | null;
  filing_date: string | null;
  egm_number: string | null;
  egm_date: string | null;
  hawb_number: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
};

export function CsbFilingEditForm({
  filing,
  currencies,
  onDone,
}: {
  filing: EditableCsbFiling;
  currencies: { code: string; name: string }[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateCsbFiling, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <input type="hidden" name="id" value={filing.id} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Editing {filing.csb_number}</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline">Cancel</button>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelClass} htmlFor={`csb_number_${filing.id}`}>CSB Number *</label>
          <input id={`csb_number_${filing.id}`} name="csb_number" required defaultValue={filing.csb_number} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_exchange_rate_${filing.id}`}>Exchange Rate</label>
          <input id={`csb_exchange_rate_${filing.id}`} name="exchange_rate" type="number" step="0.0001" defaultValue={filing.exchange_rate ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_total_taxable_value_${filing.id}`}>Total Taxable Value</label>
          <input id={`csb_total_taxable_value_${filing.id}`} name="total_taxable_value" type="number" step="0.01" defaultValue={filing.total_taxable_value ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_taxable_value_currency_${filing.id}`}>Taxable Value Currency</label>
          <select id={`csb_taxable_value_currency_${filing.id}`} name="taxable_value_currency" defaultValue={filing.taxable_value_currency ?? "USD"} className={inputClass}>
            {currencies.length > 0
              ? currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))
              : ["USD", "INR", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_fob_value_inr_${filing.id}`}>FOB Value (In INR)</label>
          <input id={`csb_fob_value_inr_${filing.id}`} name="fob_value_inr" type="number" step="0.01" defaultValue={filing.fob_value_inr ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_filing_date_${filing.id}`}>Filing Date</label>
          <input id={`csb_filing_date_${filing.id}`} name="filing_date" type="date" defaultValue={filing.filing_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_egm_number_${filing.id}`}>EGM Number</label>
          <input id={`csb_egm_number_${filing.id}`} name="egm_number" defaultValue={filing.egm_number ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_egm_date_${filing.id}`}>EGM Date</label>
          <input id={`csb_egm_date_${filing.id}`} name="egm_date" type="date" defaultValue={filing.egm_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_hawb_number_${filing.id}`}>HAWB Number</label>
          <input id={`csb_hawb_number_${filing.id}`} name="hawb_number" defaultValue={filing.hawb_number ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_invoice_no_${filing.id}`}>Invoice Number</label>
          <input id={`csb_invoice_no_${filing.id}`} name="invoice_no" defaultValue={filing.invoice_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`csb_invoice_date_${filing.id}`}>Invoice Date</label>
          <input id={`csb_invoice_date_${filing.id}`} name="invoice_date" type="date" defaultValue={filing.invoice_date ?? ""} className={inputClass} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Changes"}
      </button>
    </form>
  );
}
