"use client";

import { useActionState, useEffect } from "react";
import { updateCreditNote, type DocEditState } from "./actions";

const initialState: DocEditState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const REFUND_TYPES = ["PARTIAL REFUND", "FULL REFUND", "A TO Z CLAIM", "NO REFUND", "CUSTOM TAX"];

export type EditableCreditNote = {
  id: string;
  cn_no: string | null;
  company_id: string;
  store_id: string | null;
  credit_note_date: string;
  item_id: string | null;
  buyer_name: string | null;
  refund_date: string | null;
  item_name: string | null;
  item_price: number | null;
  invoice_no: string | null;
  invoice_value_usd: number | null;
  invoice_value_inr: number | null;
  refund_amount: number;
  refund_amt_usd: number | null;
  refund_amt_inr: number | null;
  credit_note_status: string | null;
  refund_type: string | null;
  remark: string | null;
};

// cn_no and the order_id link are deliberately not editable — same reasoning
// as ref_no on Orders (assigned once, other rows key off it).
export function CreditNoteEditForm({
  note,
  stores,
  onDone,
}: {
  note: EditableCreditNote;
  stores: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateCreditNote, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <input type="hidden" name="id" value={note.id} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Editing {note.cn_no}</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline">Cancel</button>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`cn_store_${note.id}`}>Store / Portal</label>
          <select id={`cn_store_${note.id}`} name="store_id" defaultValue={note.store_id ?? ""} className={inputClass}>
            <option value="">—</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_date_${note.id}`}>Credit Note Date *</label>
          <input id={`cn_date_${note.id}`} name="credit_note_date" type="date" required defaultValue={note.credit_note_date} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_refund_date_${note.id}`}>Refund Date</label>
          <input id={`cn_refund_date_${note.id}`} name="refund_date" type="date" defaultValue={note.refund_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_buyer_${note.id}`}>Buyer Name</label>
          <input id={`cn_buyer_${note.id}`} name="buyer_name" defaultValue={note.buyer_name ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_item_id_${note.id}`}>Item ID</label>
          <input id={`cn_item_id_${note.id}`} name="item_id" defaultValue={note.item_id ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_item_name_${note.id}`}>Item Name</label>
          <input id={`cn_item_name_${note.id}`} name="item_name" defaultValue={note.item_name ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_item_price_${note.id}`}>Item Price</label>
          <input id={`cn_item_price_${note.id}`} name="item_price" type="number" step="0.01" defaultValue={note.item_price ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_invoice_no_${note.id}`}>Invoice No.</label>
          <input id={`cn_invoice_no_${note.id}`} name="invoice_no" defaultValue={note.invoice_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_refund_type_${note.id}`}>Refund Type</label>
          <select id={`cn_refund_type_${note.id}`} name="refund_type" defaultValue={note.refund_type ?? ""} className={inputClass}>
            <option value="">—</option>
            {REFUND_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_invoice_usd_${note.id}`}>Invoice Value (USD)</label>
          <input id={`cn_invoice_usd_${note.id}`} name="invoice_value_usd" type="number" step="0.01" defaultValue={note.invoice_value_usd ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_invoice_inr_${note.id}`}>Invoice Value (INR)</label>
          <input id={`cn_invoice_inr_${note.id}`} name="invoice_value_inr" type="number" step="0.01" defaultValue={note.invoice_value_inr ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_refund_amount_${note.id}`}>Refund Amount *</label>
          <input id={`cn_refund_amount_${note.id}`} name="refund_amount" type="number" step="0.01" required defaultValue={note.refund_amount} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_refund_usd_${note.id}`}>Refund Amt (USD)</label>
          <input id={`cn_refund_usd_${note.id}`} name="refund_amt_usd" type="number" step="0.01" defaultValue={note.refund_amt_usd ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_refund_inr_${note.id}`}>Refund Amt (INR)</label>
          <input id={`cn_refund_inr_${note.id}`} name="refund_amt_inr" type="number" step="0.01" defaultValue={note.refund_amt_inr ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cn_status_${note.id}`}>Credit Note Status</label>
          <input id={`cn_status_${note.id}`} name="credit_note_status" defaultValue={note.credit_note_status ?? ""} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor={`cn_remark_${note.id}`}>Remark</label>
        <input id={`cn_remark_${note.id}`} name="remark" defaultValue={note.remark ?? ""} className={inputClass} />
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
