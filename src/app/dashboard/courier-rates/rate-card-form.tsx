"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveCourierRate, type RateCardFormState } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const initialState: RateCardFormState = { error: null, success: false };

export function RateCardForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(saveCourierRate, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-800">Add Rate Slab</h2>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Rate slab saved.</p>}

      <div>
        <label className={labelClass} htmlFor="cr_company">Company *</label>
        <select id="cr_company" name="company_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>Select company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="cr_courier">Courier Name *</label>
        <input id="cr_courier" name="courier_name" required placeholder="e.g. Aramex, On Point Express" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="cr_zone">Zone *</label>
        <input id="cr_zone" name="zone_label" required placeholder="e.g. USA, Zone 1, Europe — as the courier's own sheet names it" className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="cr_min_wt">Min Weight (kg) *</label>
          <input id="cr_min_wt" name="min_weight_kg" type="number" step="0.001" min="0" defaultValue="0" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cr_max_wt">Max Weight (kg) *</label>
          <input id="cr_max_wt" name="max_weight_kg" type="number" step="0.001" min="0" required className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="cr_base">Base Rate</label>
          <input id="cr_base" name="base_rate" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cr_perkg">Rate / kg</label>
          <input id="cr_perkg" name="rate_per_kg" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cr_fuel">Fuel Surcharge %</label>
          <input id="cr_fuel" name="fuel_surcharge_pct" type="number" step="0.001" min="0" defaultValue="0" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cr_other">Other Charges</label>
          <input id="cr_other" name="other_charges" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="cr_currency">Currency</label>
        <input id="cr_currency" name="currency" defaultValue="INR" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="cr_remark">Remark</label>
        <input id="cr_remark" name="remark" placeholder="e.g. source/date of this rate sheet" className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save Rate Slab"}
      </button>
    </form>
  );
}
