"use client";

import { useActionState, useState } from "react";
import { saveWashingEntry, type DocFormState, type OrderLookup } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function WashingEntryForm({
  companies,
  parties,
  stores,
}: {
  companies: { id: string; name: string }[];
  parties: { id: string; name: string }[];
  stores: { id: string; name: string; company_id: string }[];
}) {
  const [state, formAction, pending] = useActionState(saveWashingEntry, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");

  function handleFound(r: OrderLookup) {
    if (!r.order) return;
    setCompanyId(r.order.company_id);
    setOrderId(r.order.id);
  }

  if (state.success) {
    return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Washing Entry created — <strong>{state.success.docNo}</strong>.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="order_id" value={orderId} />

      <OrderLookupBox label="Find order by PO/RF/RG No. (optional)" onFound={handleFound} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="we_company">Company *</label>
          <select id="we_company" name="company_id" required value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="we_party">Party *</label>
          <select id="we_party" name="party_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select party</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="we_date">Chalan Date *</label>
          <input id="we_date" name="chalan_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="we_store">Store</label>
          <select id="we_store" name="store_id" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {stores.filter((s) => s.company_id === companyId).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="we_size">Item Size</label>
          <input id="we_size" name="item_size" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="we_pcs">Pcs</label>
          <input id="we_pcs" name="pcs" type="number" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="we_sqmtr">Sq. Mtr / Ft</label>
          <input id="we_sqmtr" name="sq_mtr_ft" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="we_rate">Rate</label>
          <input id="we_rate" name="rate" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="we_debit">Debit Charges</label>
          <input id="we_debit" name="debit_charges" type="number" step="0.01" className={inputClass} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Washing Entry"}
      </button>
    </form>
  );
}
