"use client";

import { useActionState, useEffect } from "react";
import { updateDebitNote, type DocEditState } from "./actions";
import { groupPartyOptions, type PartyOption } from "./party-options";

const initialState: DocEditState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditableDebitNote = {
  id: string;
  debit_note_no: string | null;
  debit_note_date: string;
  party_id: string;
  against_invoice_bill_no: string | null;
  particulars: string | null;
  bill_no: string | null;
  bill_date: string | null;
  sq_ft: number | null;
  qty: number | null;
  rate: number | null;
  debit_amount: number;
  remark: string | null;
};

export function DebitNoteEditForm({
  note,
  parties,
  onDone,
}: {
  note: EditableDebitNote;
  parties: PartyOption[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateDebitNote, initialState);
  const partyGroups = groupPartyOptions(parties);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <input type="hidden" name="id" value={note.id} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Editing {note.debit_note_no}</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline">Cancel</button>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`dn_party_${note.id}`}>Party (Vendor) *</label>
          <select id={`dn_party_${note.id}`} name="party_id" required defaultValue={note.party_id} className={inputClass}>
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
          <label className={labelClass} htmlFor={`dn_date_${note.id}`}>Debit Note Date *</label>
          <input id={`dn_date_${note.id}`} name="debit_note_date" type="date" required defaultValue={note.debit_note_date} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`dn_against_${note.id}`}>Against Invoice/Bill No.</label>
          <input id={`dn_against_${note.id}`} name="against_invoice_bill_no" defaultValue={note.against_invoice_bill_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`dn_bill_no_${note.id}`}>Bill No.</label>
          <input id={`dn_bill_no_${note.id}`} name="bill_no" defaultValue={note.bill_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`dn_bill_date_${note.id}`}>Bill Date</label>
          <input id={`dn_bill_date_${note.id}`} name="bill_date" type="date" defaultValue={note.bill_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`dn_sqft_${note.id}`}>Sq. Ft</label>
          <input id={`dn_sqft_${note.id}`} name="sq_ft" type="number" step="0.01" defaultValue={note.sq_ft ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`dn_qty_${note.id}`}>Qty</label>
          <input id={`dn_qty_${note.id}`} name="qty" type="number" defaultValue={note.qty ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`dn_rate_${note.id}`}>Rate</label>
          <input id={`dn_rate_${note.id}`} name="rate" type="number" step="0.01" defaultValue={note.rate ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`dn_amount_${note.id}`}>Debit Amount *</label>
          <input id={`dn_amount_${note.id}`} name="debit_amount" type="number" step="0.01" required defaultValue={note.debit_amount} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor={`dn_particulars_${note.id}`}>Particulars</label>
        <input id={`dn_particulars_${note.id}`} name="particulars" defaultValue={note.particulars ?? ""} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`dn_remark_${note.id}`}>Remark</label>
        <input id={`dn_remark_${note.id}`} name="remark" defaultValue={note.remark ?? ""} className={inputClass} />
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
