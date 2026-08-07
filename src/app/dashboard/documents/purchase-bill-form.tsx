"use client";

import { useState } from "react";
import { useActionState } from "react";
import { savePurchaseBill, type DocFormState, type OrderLookup } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

// Purchase Bill (vendor's own bill for job-work/purchases) — same flat-form
// + optional-order-lookup pattern as Washing Entry. The order link is
// optional since not every purchase bill traces back to a specific
// PO/RF/RG (e.g. general material purchases).
export function PurchaseBillForm({ parties }: { parties: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(savePurchaseBill, initialState);
  const [orderId, setOrderId] = useState("");

  function handleFound(r: OrderLookup) {
    setOrderId(r.order?.id ?? "");
  }

  if (state.success) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
        Purchase Bill saved — <strong>{state.success.docNo}</strong>.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="order_id" value={orderId} />

      <OrderLookupBox label="Link to an order by PO/RF/RG No. (optional)" onFound={handleFound} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="pb_party">Vendor Party *</label>
          <select id="pb_party" name="vendor_party_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select vendor</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="pb_inv_no">Vendor Invoice No. *</label>
          <input id="pb_inv_no" name="vendor_invoice_no" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb_inv_date">Vendor Invoice Date</label>
          <input id="pb_inv_date" name="vendor_invoice_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb_qty">Qty</label>
          <input id="pb_qty" name="qty" type="number" defaultValue={1} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb_sqfeet">Sq. Feet</label>
          <input id="pb_sqfeet" name="sq_feet" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb_rate">Unit Rate</label>
          <input id="pb_rate" name="unit_rate" type="number" step="0.01" className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className={labelClass} htmlFor="pb_desc">Work Description</label>
          <input id="pb_desc" name="work_description" className={inputClass} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Purchase Bill"}
      </button>
    </form>
  );
}
