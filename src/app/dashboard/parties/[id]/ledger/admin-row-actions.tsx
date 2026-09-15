"use client";

import { useActionState, useState } from "react";
import { adminEditBill, adminEditPayment, adminEditPaymentBatch, type LedgerAdminState } from "./admin-actions";

// 2026-09-13 — the Admin edit/delete buttons rendered inline on the Party
// Ledger's rows (employee_admin capability only, see admin-actions.ts).
// Lives in its own client file so the ledger page itself stays a pure
// Server Component (same split as ledger-export-bar.tsx).
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const initialState: LedgerAdminState = { error: null, success: false };

const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "PhonePe", "Google Pay", "Paytm", "Cash", "Cheque", "Adjustment", "Other"];

export function LedgerBillAdminActions({
  billId,
  partyId,
  defaults,
}: {
  billId: string;
  partyId: string;
  defaults: { invoice_no: string | null; vendor_invoice_no: string | null; invoice_date: string | null; invoice_recv_date: string | null; total_amt: number; credit_note_amt: number; remark: string | null };
}) {
  const [state, formAction, pending] = useActionState(adminEditBill, initialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-2 hidden group-hover:block print:hidden">
      <details>
        <summary className="cursor-pointer text-[11px] font-semibold text-amber-700 hover:underline">✏️ Edit this bill (Admin)</summary>
        <form action={formAction} className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 md:grid-cols-3">
          <input type="hidden" name="bill_id" value={billId} />
          <input type="hidden" name="party_id" value={partyId} />
          {state.error && <p className="col-span-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 md:col-span-3">{state.error}</p>}
          {state.success && <p className="col-span-2 rounded bg-green-50 px-2 py-1 text-[11px] text-green-700 md:col-span-3">✓ Bill updated.</p>}
          <div>
            <label className={labelClass} htmlFor={`b_inv_${billId}`}>Vendor Invoice No.</label>
            <input id={`b_inv_${billId}`} name="vendor_invoice_no" defaultValue={defaults.vendor_invoice_no ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`b_sys_${billId}`}>System Ref (internal)</label>
            <input id={`b_sys_${billId}`} name="invoice_no" defaultValue={defaults.invoice_no ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`b_date_${billId}`}>Bill Date</label>
            <input id={`b_date_${billId}`} name="invoice_date" type="date" defaultValue={defaults.invoice_date ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`b_recv_${billId}`}>Received Date (due = +7d)</label>
            <input id={`b_recv_${billId}`} name="invoice_recv_date" type="date" defaultValue={defaults.invoice_recv_date ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`b_amt_${billId}`}>Bill Amount (₹)</label>
            <input id={`b_amt_${billId}`} name="total_amt" type="number" step="0.01" min={0} defaultValue={defaults.total_amt} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`b_cn_${billId}`}>Credit Note (₹)</label>
            <input id={`b_cn_${billId}`} name="credit_note_amt" type="number" step="0.01" min={0} defaultValue={defaults.credit_note_amt} className={inputClass} />
          </div>
          <div className="col-span-2 md:col-span-3">
            <label className={labelClass} htmlFor={`b_rem_${billId}`}>Remark</label>
            <input id={`b_rem_${billId}`} name="remark" defaultValue={defaults.remark ?? ""} className={inputClass} />
          </div>
          <div className="col-span-2 md:col-span-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              {pending ? "Saving..." : "Save Bill"}
            </button>
          </div>
        </form>
      </details>
      {confirming ? (
        <p className="mt-1.5 text-[11px] text-red-700">
          Delete this bill and its payments permanently?{" "}
          <LedgerDeleteButton what="bill" id={billId} partyId={partyId} onDone={() => setConfirming(false)} />{" "}
          <button type="button" className="underline" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </p>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-1.5 text-[11px] font-semibold text-red-600 hover:underline print:hidden">
          🗑 Delete this bill (Admin)
        </button>
      )}
    </div>
  );
}

export function LedgerPaymentAdminActions({
  paymentId,
  partyId,
  defaults,
}: {
  paymentId: string;
  partyId: string;
  defaults: { amount: number; payment_date: string; payment_mode: string | null; reference_no: string | null; remark: string | null };
}) {
  const [state, formAction, pending] = useActionState(adminEditPayment, initialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-2 hidden group-hover:block print:hidden">
      <details>
        <summary className="cursor-pointer text-[11px] font-semibold text-amber-700 hover:underline">✏️ Edit this payment (Admin)</summary>
        <form action={formAction} className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 md:grid-cols-3">
          <input type="hidden" name="payment_id" value={paymentId} />
          <input type="hidden" name="party_id" value={partyId} />
          {state.error && <p className="col-span-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 md:col-span-3">{state.error}</p>}
          {state.success && <p className="col-span-2 rounded bg-green-50 px-2 py-1 text-[11px] text-green-700 md:col-span-3">✓ Payment updated.</p>}
          <div>
            <label className={labelClass} htmlFor={`p_amt_${paymentId}`}>Amount (₹)</label>
            <input id={`p_amt_${paymentId}`} name="amount" type="number" step="0.01" min={0.01} defaultValue={defaults.amount} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`p_date_${paymentId}`}>Payment Date</label>
            <input id={`p_date_${paymentId}`} name="payment_date" type="date" defaultValue={defaults.payment_date} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`p_mode_${paymentId}`}>Payment Mode</label>
            <select id={`p_mode_${paymentId}`} name="payment_mode" defaultValue={defaults.payment_mode ?? ""} className={inputClass}>
              <option value="">—</option>
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor={`p_ref_${paymentId}`}>UTR / Ref No.</label>
            <input id={`p_ref_${paymentId}`} name="reference_no" defaultValue={defaults.reference_no ?? ""} className={inputClass} />
          </div>
          <div className="col-span-2 md:col-span-3">
            <label className={labelClass} htmlFor={`p_rem_${paymentId}`}>Remark</label>
            <input id={`p_rem_${paymentId}`} name="remark" defaultValue={defaults.remark ?? ""} className={inputClass} />
          </div>
          <div className="col-span-2 md:col-span-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              {pending ? "Saving..." : "Save Payment"}
            </button>
          </div>
        </form>
      </details>
      {confirming ? (
        <p className="mt-1.5 text-[11px] text-red-700">
          Delete this payment permanently (bill&apos;s paid total is recomputed automatically)?{" "}
          <LedgerDeleteButton what="payment" id={paymentId} partyId={partyId} onDone={() => setConfirming(false)} />{" "}
          <button type="button" className="underline" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </p>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-1.5 text-[11px] font-semibold text-red-600 hover:underline print:hidden">
          🗑 Delete this payment (Admin)
        </button>
      )}
    </div>
  );
}

// 2026-09-15 — ONE Edit/Delete control for a merged payment line ("13
// payments merged"): previously every underlying row stacked its own
// edit/delete form on the line, 13 deep. Editing the batch posts the new
// TOTAL to adminEditPaymentBatch, which re-splits it across the rows
// proportionally; deleting removes every row at once.
export function LedgerPaymentBatchAdminActions({
  paymentIds,
  partyId,
  defaults,
}: {
  paymentIds: string[];
  partyId: string;
  defaults: { amount: number; payment_date: string; payment_mode: string | null; reference_no: string | null };
}) {
  const [state, formAction, pending] = useActionState(adminEditPaymentBatch, initialState);
  const [confirming, setConfirming] = useState(false);
  const joinedIds = paymentIds.join(",");

  return (
    <div className="mt-2 hidden group-hover:block print:hidden">
      <details>
        <summary className="cursor-pointer text-[11px] font-semibold text-amber-700 hover:underline">
          ✏️ Edit this payment (Admin) — {paymentIds.length} merged rows
        </summary>
        <form action={formAction} className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 md:grid-cols-3">
          <input type="hidden" name="payment_ids" value={joinedIds} />
          <input type="hidden" name="party_id" value={partyId} />
          {state.error && <p className="col-span-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 md:col-span-3">{state.error}</p>}
          {state.success && <p className="col-span-2 rounded bg-green-50 px-2 py-1 text-[11px] text-green-700 md:col-span-3">✓ Payment updated across {paymentIds.length} rows.</p>}
          <div>
            <label className={labelClass} htmlFor={`pb_amt_${joinedIds.slice(-8)}`}>Total Amount (₹) — re-split across rows</label>
            <input id={`pb_amt_${joinedIds.slice(-8)}`} name="amount" type="number" step="0.01" min={0.01} defaultValue={defaults.amount} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`pb_date_${joinedIds.slice(-8)}`}>Payment Date</label>
            <input id={`pb_date_${joinedIds.slice(-8)}`} name="payment_date" type="date" defaultValue={defaults.payment_date} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`pb_mode_${joinedIds.slice(-8)}`}>Payment Mode</label>
            <select id={`pb_mode_${joinedIds.slice(-8)}`} name="payment_mode" defaultValue={defaults.payment_mode ?? ""} className={inputClass}>
              <option value="">—</option>
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor={`pb_ref_${joinedIds.slice(-8)}`}>UTR / Ref No.</label>
            <input id={`pb_ref_${joinedIds.slice(-8)}`} name="reference_no" defaultValue={defaults.reference_no ?? ""} className={inputClass} />
          </div>
          <div className="col-span-2 md:col-span-3">
            <label className={labelClass} htmlFor={`pb_rem_${joinedIds.slice(-8)}`}>Remark</label>
            <input id={`pb_rem_${joinedIds.slice(-8)}`} name="remark" defaultValue="" className={inputClass} />
          </div>
          <div className="col-span-2 md:col-span-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              {pending ? "Saving..." : `Save Payment (${paymentIds.length} rows)`}
            </button>
          </div>
        </form>
      </details>
      {confirming ? (
        <p className="mt-1.5 text-[11px] text-red-700">
          Delete all {paymentIds.length} merged payment rows permanently (each bill&apos;s paid total is recomputed automatically)?{" "}
          <LedgerBatchDeleteButton ids={joinedIds} partyId={partyId} onDone={() => setConfirming(false)} />{" "}
          <button type="button" className="underline" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </p>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-1.5 text-[11px] font-semibold text-red-600 hover:underline print:hidden">
          🗑 Delete this payment (Admin)
        </button>
      )}
    </div>
  );
}

function LedgerBatchDeleteButton({ ids, partyId, onDone }: { ids: string; partyId: string; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    const mod = await import("./admin-actions");
    const res = await mod.adminDeletePaymentBatch(ids, partyId);
    setPending(false);
    if (res.error) {
      setError(res.error);
    } else {
      onDone();
      window.location.reload();
    }
  }

  return (
    <>
      <button type="button" onClick={run} disabled={pending} className="font-semibold text-red-700 underline disabled:opacity-60">
        {pending ? "Deleting..." : "Yes, delete all"}
      </button>
      {error && <span className="ml-1 text-red-600">({error})</span>}
    </>
  );
}

function LedgerDeleteButton({ what, id, partyId, onDone }: { what: "bill" | "payment"; id: string; partyId: string; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    // Imported lazily so the page's first paint doesn't pull the delete
    // action's server reference until it's actually needed — both actions
    // live in the same module as the edit forms above.
    const mod = await import("./admin-actions");
    const res =
      what === "bill" ? await mod.adminDeleteBill(id, partyId) : await mod.adminDeletePayment(id, partyId);
    setPending(false);
    if (res.error) {
      setError(res.error);
    } else {
      onDone();
      window.location.reload();
    }
  }

  return (
    <>
      <button type="button" onClick={run} disabled={pending} className="font-semibold text-red-700 underline disabled:opacity-60">
        {pending ? "Deleting..." : "Yes, delete"}
      </button>
      {error && <span className="ml-1 text-red-600">({error})</span>}
    </>
  );
}
