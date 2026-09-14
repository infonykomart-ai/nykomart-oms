"use client";

// Per-bill Credit Notes panel (2026-09-13) — "couriour ka bill ho ya
// purchase ka agar inme ek se jyada credit note adjust karne ka option
// nahi bs ek hi entry hoti hai" + "bina credit note ki entry kiye agar
// kisi bill me entry kar di hai to vo auto sambandhit section ke credit
// note me chali jaye". One expander under a bill row with three modes:
//
//   NEW      — create a real credit_notes document AND apply it to this
//              bill (repeatable: one per credit note, adj_amt re-sums).
//   LINK     — apply an already-existing credit note to this bill.
//   REGISTER — wrap this bill's manual credit_note_amt into a proper
//              Credit Note document so it shows in the register.
//
// Existing applied adjustments are listed with a remove button (Admin and
// Finance both hold doc_entry, which the actions require anyway). The
// panel is fed by props from the Server Component (bill-payment-list
// gets them from page.tsx) — no client-side fetching.
import { useActionState, useState } from "react";
import {
  applyBillCreditNote,
  removeBillCreditNote,
  type ApplyCreditNoteState,
  type RegisterCnRow,
} from "./credit-note-actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[11px] text-slate-400";
const initialState: ApplyCreditNoteState = { error: null, success: false };

export type AppliedCn = {
  adjustment_id: string;
  credit_note_id: string | null;
  cn_no: string | null;
  vendor_cn_no: string | null;
  gst_rate_pct: number | null;
  amount: number;
  remark: string | null;
};

export function CreditNotePanel({
  billId,
  billLabel,
  manualCreditNoteAmt,
  applied,
  existingNotes,
}: {
  billId: string;
  billLabel: string;
  manualCreditNoteAmt: number;
  applied: AppliedCn[];
  existingNotes: Pick<RegisterCnRow, "id" | "cn_no" | "credit_note_date" | "refund_amount">[];
}) {
  const [state, formAction, pending] = useActionState(applyBillCreditNote, initialState);
  const [mode, setMode] = useState<"new" | "link" | "register">("new");
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleRemove(adjustmentId: string) {
    setRemoveError(null);
    setRemoving(adjustmentId);
    const res = await removeBillCreditNote(adjustmentId);
    setRemoving(null);
    if (res.error) setRemoveError(res.error);
  }

  return (
    <td colSpan={10} className="bg-teal-50/60 px-3 py-3">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="bill_pass_register_id" value={billId} />
        <input type="hidden" name="mode" value={mode} />
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Credit note applied.</p>}
        {removeError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{removeError}</p>}

        <div className="flex flex-wrap gap-3 text-xs font-medium text-slate-600">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
            New credit note
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === "link"} onChange={() => setMode("link")} />
            Link existing credit note
          </label>
          {manualCreditNoteAmt > 0 && (
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === "register"} onChange={() => setMode("register")} />
              Register this bill&apos;s manual credit note (₹{manualCreditNoteAmt.toFixed(2)})
            </label>
          )}
        </div>

        {mode === "new" && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className={labelClass}>Credit Note Amount *</label>
              <input name="amount" type="number" step="0.01" min="0.01" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Credit Note Date *</label>
              <input name="credit_note_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
            </div>
            {/* 2026-09-13 — "credit note no ka option nahi hai usme gst
                kitni hai": the party's own CN number + GST rate, both
                optional. GST choices match purchase bills' rate enum; blank
                = no GST on this note (common for courier/duty credits). */}
            <div>
              <label className={labelClass}>Party ka CN No. (optional)</label>
              <input name="vendor_cn_no" placeholder="vendor ka apna number" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>GST % (blank = no GST)</label>
              <select name="gst_rate_pct" defaultValue="" className={inputClass}>
                <option value="">— No GST —</option>
                <option value="2.5">2.5%</option>
                <option value="3">3%</option>
                <option value="4">4%</option>
                <option value="9">9%</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Remark</label>
              <input name="remark" placeholder="e.g. shortage / rate diff / damage" className={inputClass} />
            </div>
          </div>
        )}

        {mode === "link" && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Existing Credit Note *</label>
              <select name="credit_note_id" required defaultValue="" className={inputClass}>
                <option value="">— Choose —</option>
                {existingNotes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.cn_no ?? n.id.slice(0, 8)} · {n.credit_note_date} · ₹{n.refund_amount.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Amount (blank = note&apos;s full amount)</label>
              <input name="amount" type="number" step="0.01" min="0.01" className={inputClass} />
            </div>
          </div>
        )}

        {mode === "register" && manualCreditNoteAmt > 0 && (
          <p className="text-[11px] text-slate-500">
            Creates a proper Credit Note document (own CN number, shows under Documents → Credit Notes and in the
            per-party register) for the ₹{manualCreditNoteAmt.toFixed(2)} already entered on{" "}
            <strong>{billLabel}</strong>. The bill&apos;s payable does NOT change again — the amount already reduced it.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {pending ? "Saving..." : mode === "register" ? "Register Credit Note" : "Apply to Bill"}
        </button>
      </form>

      {applied.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Applied credit notes ({applied.length})
          </p>
          <table className="min-w-full text-xs">
            <tbody>
              {applied.map((a) => (
                <tr key={a.adjustment_id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-3 font-medium text-slate-700">
                    {a.cn_no ?? "—"}
                    {a.vendor_cn_no ? <span className="ml-1 text-[10px] text-slate-400">(party: {a.vendor_cn_no})</span> : null}
                    {a.gst_rate_pct != null ? <span className="ml-1 text-[10px] text-slate-400">GST {a.gst_rate_pct}%</span> : null}
                  </td>
                  <td className="py-1 pr-3 text-right text-slate-700">₹{a.amount.toFixed(2)}</td>
                  <td className="py-1 pr-3 text-slate-500">{a.remark ?? ""}</td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemove(a.adjustment_id)}
                      disabled={removing === a.adjustment_id}
                      className="text-red-500 hover:underline disabled:opacity-40"
                    >
                      {removing === a.adjustment_id ? "Removing..." : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </td>
  );
}
