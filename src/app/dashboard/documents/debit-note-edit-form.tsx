"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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
  // 2026-08-29 — rate-difference calculator reference fields, see
  // debit-note-form.tsx's fuller comment on the same fields.
  po_rate: number | null;
  billed_rate: number | null;
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

  // 2026-08-29 — same Rate Difference Calculator as debit-note-form.tsx's
  // create flow, so an existing note's PO Rate/Billed Rate can be added or
  // corrected on edit too, with the same live (Billed − PO) × Qty helper.
  const [qtyInput, setQtyInput] = useState(note.qty != null ? String(note.qty) : "");
  const [poRateInput, setPoRateInput] = useState(note.po_rate != null ? String(note.po_rate) : "");
  const [billedRateInput, setBilledRateInput] = useState(note.billed_rate != null ? String(note.billed_rate) : "");
  const rateDiff = useMemo(() => {
    const po = Number(poRateInput);
    const billed = Number(billedRateInput);
    return poRateInput !== "" && billedRateInput !== "" ? billed - po : null;
  }, [poRateInput, billedRateInput]);
  const rateDiffAmount = useMemo(() => {
    const qty = Number(qtyInput);
    return rateDiff != null && qty > 0 ? rateDiff * qty : null;
  }, [rateDiff, qtyInput]);

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
          <input
            id={`dn_qty_${note.id}`}
            name="qty"
            type="number"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            className={inputClass}
          />
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

      {/* 2026-08-29 — see debit-note-form.tsx's create-flow comment. Shown
          as a suggestion only here (never auto-overwrites Debit Amount on
          an existing, already-saved note) — copy the figure in manually if
          it matches. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">Rate Difference Calculator (optional)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor={`dn_po_rate_${note.id}`}>Agreed / PO Rate (per unit)</label>
            <input
              id={`dn_po_rate_${note.id}`}
              name="po_rate"
              type="number"
              step="0.01"
              value={poRateInput}
              onChange={(e) => setPoRateInput(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`dn_billed_rate_${note.id}`}>Billed Rate (vendor charged, per unit)</label>
            <input
              id={`dn_billed_rate_${note.id}`}
              name="billed_rate"
              type="number"
              step="0.01"
              value={billedRateInput}
              onChange={(e) => setBilledRateInput(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        {rateDiff != null && (
          <p className="mt-2 text-xs text-slate-600">
            Difference: <strong>₹{rateDiff.toFixed(2)}</strong> / unit
            {rateDiffAmount != null && (
              <>
                {" "}× Qty {qtyInput} = <strong className="text-slate-800">₹{rateDiffAmount.toFixed(2)}</strong> — copy into Debit
                Amount above if it should change.
              </>
            )}
          </p>
        )}
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
