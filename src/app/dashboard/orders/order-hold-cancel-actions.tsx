"use client";

import { useActionState, useState, useTransition } from "react";
import { holdOrder, cancelOrder, saveOrderRefund, type OrderRefundState } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const initialRefundState: OrderRefundState = { error: null, success: null };

// Pending item 2 (2026-08-08) — Hold/Cancel + the Refund entry that follows
// Cancel. Design confirmed with the user: Hold blocks the order from
// further action entirely (see invoices module's exclusion of Hold orders);
// refund amount is always case-by-case manual entry (never auto-computed);
// and a refund against an already-invoiced order auto-generates a Credit
// Note (see saveOrderRefund in actions.ts) while a not-yet-dispatched
// order's refund is just its own row — this component doesn't need to know
// which path it took, only report back whether a Credit Note came out of it.
export function OrderHoldCancelActions({
  order,
  hasExistingRefund,
  currencies,
}: {
  order: { id: string; ref_no: string; status: string; order_currency: string };
  hasExistingRefund: boolean;
  currencies: { code: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundState, refundAction, refundPending] = useActionState(saveOrderRefund, initialRefundState);

  function openWhatsApp(text: string) {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function handleHold() {
    setError(null);
    startTransition(async () => {
      const result = await holdOrder(order.id);
      if (result.error) setError(result.error);
      else openWhatsApp(`${order.ref_no} Hold this order`);
    });
  }

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelOrder(order.id);
      if (result.error) setError(result.error);
      else {
        openWhatsApp(`${order.ref_no} Cancel this order`);
        setShowRefundForm(true);
      }
    });
  }

  const canHold = order.status !== "Hold" && order.status !== "Cancelled";
  const canCancel = order.status !== "Cancelled";
  const canAddRefund = order.status === "Cancelled" && !hasExistingRefund;

  if (refundState.success) {
    return (
      <p className="rounded-lg bg-green-50 px-2.5 py-1.5 text-xs text-green-800">
        Refund saved{refundState.success.creditNoteNo ? ` — Credit Note ${refundState.success.creditNoteNo} auto-generated.` : "."}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex shrink-0 gap-2">
        {canHold && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleHold}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            ⏸ Hold
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleCancel}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            ✕ Cancel
          </button>
        )}
        {canAddRefund && !showRefundForm && (
          <button
            type="button"
            onClick={() => setShowRefundForm(true)}
            className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
          >
            💸 Add Refund
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {showRefundForm && (
        <form action={refundAction} className="w-64 space-y-1.5 rounded-lg border border-teal-200 bg-teal-50/50 p-2.5">
          <input type="hidden" name="order_id" value={order.id} />
          {refundState.error && <p className="text-xs text-red-600">{refundState.error}</p>}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Refund Amount *</label>
              <input name="refund_amount" type="number" step="0.01" min="0" required className={inputClass} />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Currency</label>
              <select name="refund_currency" defaultValue={order.order_currency} className={inputClass}>
                {currencies.length > 0
                  ? currencies.map((c) => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))
                  : ["USD", "INR", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Refund Date *</label>
            <input name="refund_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Reason</label>
            <input name="reason" className={inputClass} />
          </div>
          <div className="flex gap-1.5">
            <button
              type="submit"
              disabled={refundPending}
              className="flex-1 rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {refundPending ? "Saving…" : "Save Refund"}
            </button>
            <button
              type="button"
              onClick={() => setShowRefundForm(false)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
