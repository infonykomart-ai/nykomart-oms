"use client";

import { useActionState, useState } from "react";
import { saveInternalInvoice, type DocFormState } from "./actions";
import { RoundOffField } from "./round-off-field";

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
  // 2026-10-29 — qty × rate (18% GST is added by the stored total) so the
  // round-off control rounds the actual invoice total.
  const [qtyInput, setQtyInput] = useState("");
  const [rateInput, setRateInput] = useState("");
  // 2026-10-31 — split into base + GST so the round-off control can show the
  // full auto calculation (without GST → with GST → round off → net).
  const preRoundBase = Math.round((Number(qtyInput) || 0) * (Number(rateInput) || 0) * 100) / 100;
  const preRoundTotal = Math.round(preRoundBase * 1.18 * 100) / 100;

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
          <input
            id="ii_qty"
            name="qty"
            type="number"
            step="0.01"
            required
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="ii_rate">Rate *</label>
          <input
            id="ii_rate"
            name="rate"
            type="number"
            step="0.01"
            required
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            className={inputClass}
          />
        </div>
        {/* 2026-10-29 — round-off on the invoice TOTAL (qty × rate + 18%
            GST), stored as internal_invoices.round_off_amt and added to the
            generated total_amount, so the list / A4 sheet / report all show
            the rounded figure. */}
        <div className="col-span-2">
          <RoundOffField
            id="ii_round_off"
            payable={preRoundTotal}
            baseAmount={preRoundBase}
            gstAmount={Math.round((preRoundTotal - preRoundBase) * 100) / 100}
            gstLabel="GST 18% (CGST 9% + SGST 9%)"
            label="Round Off (added to the invoice total incl. 18% GST)"
            hint="Rounds the internal invoice total to an even figure."
          />
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
