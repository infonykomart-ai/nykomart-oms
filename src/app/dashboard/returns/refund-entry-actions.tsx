"use client";

// 2026-11-05 — "har refund entry ke saath Edit aur Delete" + "delete se pehle
// confirmation popup: Are you sure you want to delete this refund entry?".
//
// One component, used from the Returns/Refunds register AND the order's own
// refund list, so there is exactly one edit form and one delete confirmation
// in the app. It calls the same updateOrderRefund / deleteOrderRefund server
// actions as everything else — the financial recalculation, credit-note sync,
// stock reversal and audit entry all happen on the server.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  deleteOrderRefund,
  updateOrderRefund,
  type OrderRefundEditState,
} from "@/app/dashboard/orders/actions";

export type RefundEditableData = {
  id: string;
  order_id: string;
  order_ref_no: string | null;
  order_currency: string | null;
  refund_amount: number;
  refund_currency: string;
  refund_date: string;
  reason: string | null;
  refund_qty: number | null;
  payment_mode: string | null;
  reference_no: string | null;
  remarks: string | null;
  refund_basis_percent: number | null;
  order_value_refund_amount: number | null;
  shipping_refund_amount: number | null;
  duty_refund_amount: number | null;
};

const initialState: OrderRefundEditState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[10px] font-medium text-slate-500";

export function RefundEntryActions({
  refund,
  currencies,
}: {
  refund: RefundEditableData;
  /** Currency master codes — the refund's own and the order's currency are
   *  always included, even when the master is missing one of them. */
  currencies: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [state, setState] = useState<OrderRefundEditState>(initialState);
  const [savePending, startSave] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();
  const pending = savePending;

  // Submit through a transition instead of useActionState: a successful save
  // closes the dialog and refreshes the server rows from the same event, so
  // there is no "setState inside an effect" cascade (and no stale success
  // state keeping the next edit session closed).
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setState(initialState);
    startSave(async () => {
      const result = await updateOrderRefund(initialState, formData);
      setState(result);
      if (result.success) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  const currencyOptions = Array.from(
    new Set([refund.refund_currency, refund.order_currency, ...currencies].filter(Boolean) as string[])
  );

  function openEdit() {
    setEditing(true);
  }

  function openDelete() {
    setDeleteError(null);
    setConfirmingDelete(true);
  }

  function confirmDelete() {
    startDelete(async () => {
      const result = await deleteOrderRefund(refund.id);
      if (result.error) {
        setDeleteError(result.error);
        return;
      }
      setConfirmingDelete(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap print:hidden">
      <button
        type="button"
        onClick={openEdit}
        title="Edit this refund entry"
        className="rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 hover:bg-teal-100"
      >
        ✏ Edit
      </button>
      <button
        type="button"
        onClick={openDelete}
        title="Delete this refund entry"
        className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-100"
      >
        🗑 Delete
      </button>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit refund for ${refund.order_ref_no ?? "order"}`}
        >
          <form
            onSubmit={handleSubmit}
            className="mt-10 w-full max-w-2xl space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xl"
          >
            <input type="hidden" name="refund_id" value={refund.id} />
            {/* Preserved calculator breakdown: editing the total must not
                silently zero the %/shipping/duty split the row was created
                with. */}
            <input type="hidden" name="refund_basis_percent" value={refund.refund_basis_percent ?? ""} />
            <input type="hidden" name="order_value_refund_amount" value={refund.order_value_refund_amount ?? 0} />
            <input type="hidden" name="shipping_refund_amount" value={refund.shipping_refund_amount ?? 0} />
            <input type="hidden" name="duty_refund_amount" value={refund.duty_refund_amount ?? 0} />

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Edit refund — {refund.order_ref_no ?? refund.order_id}</p>
                <p className="text-[11px] text-slate-500">
                  Updates the existing entry (and its credit note) — never creates a second refund. The order-value cap is
                  re-checked on save, excluding this entry from its own total.
                </p>
              </div>
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-400 underline">
                Close
              </button>
            </div>

            {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <label className={labelClass}>Refund Amount *</label>
                <input
                  name="refund_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={refund.refund_amount}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Currency</label>
                <select name="refund_currency" defaultValue={refund.refund_currency} className={inputClass}>
                  {currencyOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Refund Date *</label>
                <input
                  name="refund_date"
                  type="date"
                  required
                  defaultValue={refund.refund_date}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Quantity</label>
                <input
                  name="refund_qty"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={refund.refund_qty ?? ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Payment Mode</label>
                <input
                  name="payment_mode"
                  list="refund-payment-modes"
                  defaultValue={refund.payment_mode ?? ""}
                  placeholder="NEFT / UPI / Cash…"
                  className={inputClass}
                />
                <datalist id="refund-payment-modes">
                  <option value="NEFT" />
                  <option value="RTGS" />
                  <option value="UPI" />
                  <option value="Cash" />
                  <option value="Cheque" />
                  <option value="Card" />
                  <option value="Marketplace" />
                </datalist>
              </div>
              <div>
                <label className={labelClass}>Reference No.</label>
                <input name="reference_no" defaultValue={refund.reference_no ?? ""} className={inputClass} />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className={labelClass}>Reason</label>
                <input name="reason" defaultValue={refund.reason ?? ""} className={inputClass} />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className={labelClass}>Remarks</label>
                <textarea name="remarks" rows={2} defaultValue={refund.remarks ?? ""} className={inputClass} />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm refund deletion"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Are you sure you want to delete this refund entry?</p>
            <p className="mt-1 text-xs text-slate-500">
              {refund.refund_amount.toFixed(2)} {refund.refund_currency} on {refund.refund_date}
              {refund.reason ? ` — ${refund.reason}` : ""}. Its credit note is removed and the stock it restocked is
              reversed in the same transaction. This cannot be undone (the audit log keeps the record).
            </p>
            {deleteError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{deleteError}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deletePending}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deletePending}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletePending ? "Deleting…" : "Delete Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
