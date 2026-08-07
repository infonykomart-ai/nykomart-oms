"use client";

import { useActionState } from "react";
import { saveInternalInvoice, type DocFormState } from "./actions";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

// Company-to-company billing — deliberately NOT order-linked (see
// internal_invoices' schema comment: "no customs content at all", unlike
// sales_invoices). from_company <> to_company enforced both client- and
// server-side.
export function InternalInvoiceForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(saveInternalInvoice, initialState);

  if (state.success) {
    return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Internal Invoice created — <strong>{state.success.docNo}</strong>.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="ii_from">From Company *</label>
          <select id="ii_from" name="from_company_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="ii_to">To Company *</label>
          <select id="ii_to" name="to_company_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="ii_date">Invoice Date *</label>
          <input id="ii_date" name="invoice_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ii_qty">Qty *</label>
          <input id="ii_qty" name="qty" type="number" step="0.01" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ii_rate">Rate *</label>
          <input id="ii_rate" name="rate" type="number" step="0.01" required className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="ii_desc">Description *</label>
        <input id="ii_desc" name="description" required className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="ii_remark">Remark</label>
        <input id="ii_remark" name="remark" className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Internal Invoice"}
      </button>
    </form>
  );
}
