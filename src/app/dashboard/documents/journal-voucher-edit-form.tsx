"use client";

import { useActionState, useEffect } from "react";
import { updateJournalVoucherDetails, type EditJournalVoucherState } from "./actions";
import { groupPartyOptions, type PartyOption } from "./party-options";

const initialState: EditJournalVoucherState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditableJournalVoucher = {
  id: string;
  jv_no: string | null;
  jv_date: string;
  bill_pass_register_id: string | null;
  party_id: string | null;
  vendor_invoice_no: string | null;
  invoice_date: string | null;
  debit_amount: number;
  passed_amount: number | null;
  item_details: string | null;
  qty: number | null;
  qty_unit: string | null;
  qlty: string | null;
  particulars: string | null;
  remark: string | null;
};

// 2026-08-29 (evening) — works for both auto-generated JVs (bill_pass_
// register_id set, most fields prefilled from the bill) and manual ones.
// Company/bill link stay fixed after creation — only the party (in case it
// was wrong) and the JV-specific fields the auto-create path leaves blank
// (Item Details/Qty/Qlty/Particulars/Remarks, plus Passed Amount for a
// manual JV) are editable here.
export function JournalVoucherEditForm({
  jv,
  parties,
  onDone,
}: {
  jv: EditableJournalVoucher;
  parties: PartyOption[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateJournalVoucherDetails, initialState);
  const partyGroups = groupPartyOptions(parties);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <input type="hidden" name="id" value={jv.id} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Editing {jv.jv_no}</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline">Cancel</button>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`jv_party_${jv.id}`}>Vendor *</label>
          <select id={`jv_party_${jv.id}`} name="party_id" required defaultValue={jv.party_id ?? ""} className={inputClass}>
            <option value="" disabled>Select party</option>
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
          <label className={labelClass} htmlFor={`jv_invoice_no_${jv.id}`}>Invoice No.</label>
          <input id={`jv_invoice_no_${jv.id}`} name="vendor_invoice_no" defaultValue={jv.vendor_invoice_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`jv_invoice_date_${jv.id}`}>Invoice Date</label>
          <input id={`jv_invoice_date_${jv.id}`} name="invoice_date" type="date" defaultValue={jv.invoice_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`jv_debit_amount_${jv.id}`}>Debit Amount *</label>
          <input id={`jv_debit_amount_${jv.id}`} name="debit_amount" type="number" step="0.01" required defaultValue={jv.debit_amount} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`jv_passed_amount_${jv.id}`}>
            Passed Amount {jv.bill_pass_register_id && <span className="font-normal text-slate-400">(the printed report shows the live bill balance instead when linked to a bill)</span>}
          </label>
          <input id={`jv_passed_amount_${jv.id}`} name="passed_amount" type="number" step="0.01" defaultValue={jv.passed_amount ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`jv_item_details_${jv.id}`}>Item Details</label>
          <input id={`jv_item_details_${jv.id}`} name="item_details" defaultValue={jv.item_details ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`jv_qty_${jv.id}`}>Qty</label>
          <input id={`jv_qty_${jv.id}`} name="qty" type="number" step="0.01" defaultValue={jv.qty ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`jv_qty_unit_${jv.id}`}>Qty Unit</label>
          <input id={`jv_qty_unit_${jv.id}`} name="qty_unit" defaultValue={jv.qty_unit ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`jv_qlty_${jv.id}`}>Qlty</label>
          <input id={`jv_qlty_${jv.id}`} name="qlty" defaultValue={jv.qlty ?? ""} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor={`jv_particulars_${jv.id}`}>Particulars</label>
        <input id={`jv_particulars_${jv.id}`} name="particulars" defaultValue={jv.particulars ?? ""} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`jv_remark_${jv.id}`}>Remarks</label>
        <input id={`jv_remark_${jv.id}`} name="remark" defaultValue={jv.remark ?? ""} className={inputClass} />
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
