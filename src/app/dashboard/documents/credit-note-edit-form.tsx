"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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
  // 2026-08-29 — party_id (set only for vendor-side notes, not editable
  // here — see credit-note-form.tsx's create-flow comment) gates whether
  // the Rate Difference Calculator below is shown at all; qty/po_rate/
  // billed_rate are its editable reference fields — see
  // db/2026-08-29-credit-note-rate-difference.sql.
  party_id: string | null;
  qty: number | null;
  po_rate: number | null;
  billed_rate: number | null;
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

  // 2026-08-29 — same Rate Difference Calculator as debit-note-edit-form.tsx,
  // shown only for vendor-side (Party) notes and only as a suggestion —
  // never auto-overwrites an already-saved Refund Amount.
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

      {/* 2026-08-29 — only shown for vendor-side (Party) notes; the
          original sales/buyer-refund flow (no party_id) never sees this. */}
      {note.party_id && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">Rate Difference Calculator (optional)</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass} htmlFor={`cn_qty_${note.id}`}>Qty</label>
              <input
                id={`cn_qty_${note.id}`}
                name="qty"
                type="number"
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`cn_po_rate_${note.id}`}>Agreed / PO Rate (per unit)</label>
              <input
                id={`cn_po_rate_${note.id}`}
                name="po_rate"
                type="number"
                step="0.01"
                value={poRateInput}
                onChange={(e) => setPoRateInput(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`cn_billed_rate_${note.id}`}>Billed/Credited Rate (per unit)</label>
              <input
                id={`cn_billed_rate_${note.id}`}
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
                  {" "}× Qty {qtyInput} = <strong className="text-slate-800">₹{rateDiffAmount.toFixed(2)}</strong> — copy into
                  Refund Amount above if it should change.
                </>
              )}
            </p>
          )}
        </div>
      )}

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
