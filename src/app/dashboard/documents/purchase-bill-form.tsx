"use client";

import { useState } from "react";
import { useActionState } from "react";
import { savePurchaseBill, type DocFormState, type OrderLookup } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";
import { groupPartyOptions, type PartyOption } from "./party-options";
import { UnitSelect } from "@/components/unit-select";
import { toFeet, type LengthUnit } from "@/lib/length-units";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

// Purchase Bill (vendor's own bill for job-work/purchases) — same flat-form
// + order-lookup pattern as Washing Entry. 2026-08-08: "YE LINK HONA
// CHAHIYE... SABHI CHEJE LINK RAHEGI" made the order link REQUIRED: every
// purchase tied to the PO/RF/RG it was bought for, so "which party did
// this order's item come from" is answerable — see the reverse lookup on
// the Orders hub. 2026-08-17: "KACHA MAAL... GENERAL STOCK KE LIYE — KOI
// FIXED PO NAHI" — raw-material vendor purchases aren't for one specific
// order, so the link is optional again (see actions.ts's
// savePurchaseBillCore comment for how company scoping still works
// without one).
export function PurchaseBillForm({ parties }: { parties: PartyOption[] }) {
  const [state, formAction, pending] = useActionState(savePurchaseBill, initialState);
  const [orderId, setOrderId] = useState("");
  const partyGroups = groupPartyOptions(parties);

  // 2026-08-17 — "FT/MTR/INCH/YARD/CM SABHI KA FOURMULA KAAM KARNA CHAHIYE"
  // — vendor can bill raw material in whichever unit; typed value + unit
  // convert to feet (this app's own convention, matching the field's own
  // "Sq. Feet" label) before it's actually submitted. See
  // src/lib/length-units.ts.
  const [sqFeetInput, setSqFeetInput] = useState("");
  const [sqFeetUnit, setSqFeetUnit] = useState<LengthUnit>("FT");
  const sqFeetConverted = sqFeetInput ? toFeet(Number(sqFeetInput) || 0, sqFeetUnit) : 0;

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
      {!orderId && (
        <p className="-mt-1 text-xs text-slate-400">
          Optional — leave blank for a general-stock raw-material purchase not tied to one specific order.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="pb_party">Vendor Party *</label>
          <select id="pb_party" name="vendor_party_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select vendor</option>
            {partyGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
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
          <div className="flex gap-1.5">
            <input
              id="pb_sqfeet"
              type="number"
              step="0.01"
              value={sqFeetInput}
              onChange={(e) => setSqFeetInput(e.target.value)}
              className={inputClass}
            />
            <UnitSelect value={sqFeetUnit} onChange={setSqFeetUnit} />
          </div>
          {sqFeetUnit !== "FT" && sqFeetInput && (
            <p className="mt-0.5 text-[11px] text-purple-600">= {sqFeetConverted.toFixed(2)} Sq. Feet (saved)</p>
          )}
          <input type="hidden" name="sq_feet" value={sqFeetInput ? sqFeetConverted : ""} />
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
