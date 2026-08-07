"use client";

import { useActionState, useState } from "react";
import { saveDebitNote, type DocFormState, type OrderLookup } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function DebitNoteForm({ companies, parties }: { companies: { id: string; name: string }[]; parties: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(saveDebitNote, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");

  function handleFound(r: OrderLookup) {
    if (!r.order) return;
    setCompanyId(r.order.company_id);
    setOrderId(r.order.id);
  }

  if (state.success) {
    return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Debit Note created — <strong>{state.success.docNo}</strong>.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="order_id" value={orderId} />

      <OrderLookupBox label="Find order by PO/RF/RG No. (optional)" onFound={handleFound} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="dn_company">Company *</label>
          <select id="dn_company" name="company_id" required value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_party">Party (Vendor) *</label>
          <select id="dn_party" name="party_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select party</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_date">Debit Note Date *</label>
          <input id="dn_date" name="debit_note_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_against">Against Invoice/Bill No.</label>
          <input id="dn_against" name="against_invoice_bill_no" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_bill_no">Bill No.</label>
          <input id="dn_bill_no" name="bill_no" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_bill_date">Bill Date</label>
          <input id="dn_bill_date" name="bill_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_sqft">Sq. Ft</label>
          <input id="dn_sqft" name="sq_ft" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_qty">Qty</label>
          <input id="dn_qty" name="qty" type="number" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_rate">Rate</label>
          <input id="dn_rate" name="rate" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_amount">Debit Amount *</label>
          <input id="dn_amount" name="debit_amount" type="number" step="0.01" required className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="dn_particulars">Particulars</label>
        <input id="dn_particulars" name="particulars" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="dn_remark">Remark</label>
        <input id="dn_remark" name="remark" className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Debit Note"}
      </button>
    </form>
  );
}
