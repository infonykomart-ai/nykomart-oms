"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveExchangeRate, type ExchangeRateFormState } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const initialState: ExchangeRateFormState = { error: null, success: false };

export function ExchangeRateForm({ currencies }: { currencies: { code: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(saveExchangeRate, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-800">Add Official Rate</h2>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Rate saved.</p>}

      <div>
        <label className={labelClass} htmlFor="currency_code">Currency *</label>
        <select id="currency_code" name="currency_code" required defaultValue="" className={inputClass}>
          <option value="" disabled>Select currency</option>
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="effective_from">Effective From *</label>
        <input id="effective_from" name="effective_from" type="date" required className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="rate_to_inr">Rate to INR *</label>
        <input id="rate_to_inr" name="rate_to_inr" type="number" step="0.000001" required className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="notification_no">Notification No.</label>
        <input id="notification_no" name="notification_no" placeholder="CBIC / ICEGATE notification ref" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="remark">Remark</label>
        <input id="remark" name="remark" className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save Rate"}
      </button>
    </form>
  );
}
