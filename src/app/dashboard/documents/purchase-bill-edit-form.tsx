"use client";

import { useActionState, useEffect, useState } from "react";
import { updatePurchaseBill, type DocEditState } from "./actions";
import { groupPartyOptions, type PartyOption } from "./party-options";
import { UnitSelect } from "@/components/unit-select";
import { toFeet, type LengthUnit } from "@/lib/length-units";
import { GstSelect, type GstType } from "@/components/gst-select";

const initialState: DocEditState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditablePurchaseBill = {
  id: string;
  vendor_party_id: string;
  vendor_invoice_no: string;
  vendor_invoice_date: string | null;
  qty: number;
  sq_feet: number;
  qty_unit: string | null;
  work_description: string | null;
  unit_rate: number;
  gst_rate_pct: number | null;
  gst_type: string | null;
};

export function PurchaseBillEditForm({
  bill,
  parties,
  onDone,
}: {
  bill: EditablePurchaseBill;
  parties: PartyOption[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updatePurchaseBill, initialState);
  const partyGroups = groupPartyOptions(parties);

  // 2026-08-17 — same FT/MTR/INCH/YARD/CM unit picker as the New Purchase
  // Bill form (see src/lib/length-units.ts). bill.sq_feet is stored AS
  // ENTERED, in bill.qty_unit (not converted to feet — see
  // db/2026-08-17-purchase-bills-qty-unit.sql for why: Unit Rate is
  // per-that-unit), so this starts at the bill's own saved unit showing
  // its own saved value as-is, not re-interpreted as feet.
  const [sqFeetInput, setSqFeetInput] = useState(String(bill.sq_feet));
  const [sqFeetUnit, setSqFeetUnit] = useState<LengthUnit>((bill.qty_unit as LengthUnit) || "FT");
  const sqFeetConverted = sqFeetInput ? toFeet(Number(sqFeetInput) || 0, sqFeetUnit) : 0;

  const [gstRatePct, setGstRatePct] = useState<number | null>(bill.gst_rate_pct);
  const [gstType, setGstType] = useState<GstType>((bill.gst_type as GstType) || "CGST_SGST");

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <input type="hidden" name="id" value={bill.id} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Editing {bill.vendor_invoice_no}</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline">Cancel</button>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`pb_party_${bill.id}`}>Vendor Party *</label>
          <select id={`pb_party_${bill.id}`} name="vendor_party_id" required defaultValue={bill.vendor_party_id} className={inputClass}>
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
          <label className={labelClass} htmlFor={`pb_inv_no_${bill.id}`}>Vendor Invoice No. *</label>
          <input id={`pb_inv_no_${bill.id}`} name="vendor_invoice_no" required defaultValue={bill.vendor_invoice_no} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`pb_inv_date_${bill.id}`}>Vendor Invoice Date</label>
          <input id={`pb_inv_date_${bill.id}`} name="vendor_invoice_date" type="date" defaultValue={bill.vendor_invoice_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`pb_qty_${bill.id}`}>Qty</label>
          <input id={`pb_qty_${bill.id}`} name="qty" type="number" defaultValue={bill.qty} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`pb_sqfeet_${bill.id}`}>Sq. Feet</label>
          <div className="flex gap-1.5">
            <input
              id={`pb_sqfeet_${bill.id}`}
              type="number"
              step="0.01"
              value={sqFeetInput}
              onChange={(e) => setSqFeetInput(e.target.value)}
              className={inputClass}
            />
            <UnitSelect value={sqFeetUnit} onChange={setSqFeetUnit} />
          </div>
          {sqFeetUnit !== "FT" && sqFeetInput && (
            <p className="mt-0.5 text-[11px] text-slate-400">≈ {sqFeetConverted.toFixed(2)} Sq. Feet equivalent (reference only)</p>
          )}
          <input type="hidden" name="sq_feet" value={sqFeetInput} />
          <input type="hidden" name="qty_unit" value={sqFeetUnit} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`pb_rate_${bill.id}`}>Unit Rate {sqFeetUnit !== "FT" && <span className="text-slate-400">(per {sqFeetUnit})</span>}</label>
          <input id={`pb_rate_${bill.id}`} name="unit_rate" type="number" step="0.01" defaultValue={bill.unit_rate} className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className={labelClass} htmlFor={`pb_desc_${bill.id}`}>Work Description</label>
          <input id={`pb_desc_${bill.id}`} name="work_description" defaultValue={bill.work_description ?? ""} className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className={labelClass} htmlFor={`pb_gst_rate_${bill.id}`}>GST</label>
          <GstSelect ratePct={gstRatePct} onRateChange={setGstRatePct} gstType={gstType} onTypeChange={setGstType} idPrefix={`pb_${bill.id}`} />
          <input type="hidden" name="gst_rate_pct" value={gstRatePct ?? ""} />
          <input type="hidden" name="gst_type" value={gstRatePct != null ? gstType : ""} />
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
