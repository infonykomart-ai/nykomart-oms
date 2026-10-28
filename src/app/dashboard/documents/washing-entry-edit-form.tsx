"use client";

import { useActionState, useEffect, useState } from "react";
import { updateWashingEntry, type DocEditState } from "./actions";
import { RoundOffField } from "./round-off-field";

const initialState: DocEditState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditableWashingEntry = {
  id: string;
  chalan_no: string | null;
  chalan_date: string;
  company_id: string;
  party_id: string;
  store_id: string | null;
  item_size: string | null;
  pcs: number | null;
  sq_mtr_ft: number | null;
  rate: number | null;
  debit_charges: number | null;
  /** 2026-10-24b — round-figure adjustment; payable = amount + debit + this. */
  round_off_amt?: number | null;
};

export function WashingEntryEditForm({
  entry,
  parties,
  stores,
  onDone,
}: {
  entry: EditableWashingEntry;
  parties: { id: string; name: string }[];
  stores: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateWashingEntry, initialState);
  // 2026-10-28 — same live round-off preview as the create form.
  const [sqMtr, setSqMtr] = useState(entry.sq_mtr_ft != null ? String(entry.sq_mtr_ft) : "");
  const [rate, setRate] = useState(entry.rate != null ? String(entry.rate) : "");
  const [debit, setDebit] = useState(entry.debit_charges != null ? String(entry.debit_charges) : "");
  const amountOr0 = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const preRoundPayable = Math.round((amountOr0(sqMtr) * amountOr0(rate) + amountOr0(debit)) * 100) / 100;

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <input type="hidden" name="id" value={entry.id} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Editing {entry.chalan_no}</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline">Cancel</button>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`we_party_${entry.id}`}>Party *</label>
          <select id={`we_party_${entry.id}`} name="party_id" required defaultValue={entry.party_id} className={inputClass}>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_date_${entry.id}`}>Chalan Date *</label>
          <input id={`we_date_${entry.id}`} name="chalan_date" type="date" required defaultValue={entry.chalan_date} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_store_${entry.id}`}>Store</label>
          <select id={`we_store_${entry.id}`} name="store_id" defaultValue={entry.store_id ?? ""} className={inputClass}>
            <option value="">—</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_size_${entry.id}`}>Item Size</label>
          <input id={`we_size_${entry.id}`} name="item_size" defaultValue={entry.item_size ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_pcs_${entry.id}`}>Pcs</label>
          <input id={`we_pcs_${entry.id}`} name="pcs" type="number" defaultValue={entry.pcs ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_sqmtr_${entry.id}`}>Sq. Mtr / Ft</label>
          <input id={`we_sqmtr_${entry.id}`} name="sq_mtr_ft" type="number" step="0.01" value={sqMtr} onChange={(e) => setSqMtr(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_rate_${entry.id}`}>Rate</label>
          <input id={`we_rate_${entry.id}`} name="rate" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_debit_${entry.id}`}>Debit Charges</label>
          <input id={`we_debit_${entry.id}`} name="debit_charges" type="number" step="0.01" value={debit} onChange={(e) => setDebit(e.target.value)} className={inputClass} />
        </div>
        {/* 2026-10-24b — see washing-entry-form.tsx; 2026-10-28 +/− control. */}
        <RoundOffField id={`we_round_${entry.id}`} payable={preRoundPayable} defaultValue={entry.round_off_amt ?? 0} />
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
