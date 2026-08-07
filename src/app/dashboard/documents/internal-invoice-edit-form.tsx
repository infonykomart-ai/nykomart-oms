"use client";

import { useActionState, useEffect } from "react";
import { updateInternalInvoice, type DocEditState } from "./actions";

const initialState: DocEditState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditableInternalInvoice = {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  description: string;
  qty: number;
  rate: number;
  remark: string | null;
};

// from_company/to_company aren't editable — internal_invoices.company_id
// (the numbering-sequence owner) is derived from from_company_id at
// insert time; re-pointing either side after the fact would silently
// disconnect the invoice number from its actual owner.
export function InternalInvoiceEditForm({
  invoice,
  onDone,
}: {
  invoice: EditableInternalInvoice;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateInternalInvoice, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <input type="hidden" name="id" value={invoice.id} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Editing {invoice.invoice_no}</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline">Cancel</button>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`ii_date_${invoice.id}`}>Invoice Date *</label>
          <input id={`ii_date_${invoice.id}`} name="invoice_date" type="date" required defaultValue={invoice.invoice_date} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`ii_qty_${invoice.id}`}>Qty *</label>
          <input id={`ii_qty_${invoice.id}`} name="qty" type="number" step="0.01" required defaultValue={invoice.qty} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`ii_rate_${invoice.id}`}>Rate *</label>
          <input id={`ii_rate_${invoice.id}`} name="rate" type="number" step="0.01" required defaultValue={invoice.rate} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor={`ii_desc_${invoice.id}`}>Description *</label>
        <input id={`ii_desc_${invoice.id}`} name="description" required defaultValue={invoice.description} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`ii_remark_${invoice.id}`}>Remark</label>
        <input id={`ii_remark_${invoice.id}`} name="remark" defaultValue={invoice.remark ?? ""} className={inputClass} />
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
