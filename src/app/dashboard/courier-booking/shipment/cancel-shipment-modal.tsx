"use client";

import { useActionState, useState } from "react";
import { cancelShipment, type CancelShipmentState } from "./cancel-shipment-actions";

const initial: CancelShipmentState = { error: null, success: false };

const REASONS = [
  "Buyer requested cancellation",
  "Duplicate booking",
  "Wrong courier/service selected",
  "Address/customs issue",
  "Order cancelled/returned",
  "Other",
];

export function CancelShipmentModal({ courierShipmentId }: { courierShipmentId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(cancelShipment, initial);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
        ✕ Cancel Shipment
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !state.success && setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Cancel Shipment</h3>
            {state.success ? (
              <div className="space-y-3">
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  Cancelled on our side. If this AWB was already manifested with the courier, cancel/void it with them directly too.
                </p>
                <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm">
                  Close
                </button>
              </div>
            ) : (
              <form action={action} className="space-y-3">
                <input type="hidden" name="courier_shipment_id" value={courierShipmentId} />
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  This records a cancellation in this app only — it does not call the courier&apos;s own API. If a refund is owed, handle it via
                  the Order Refunds flow separately.
                </p>
                {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Reason *</label>
                  <select name="cancel_reason" required defaultValue="" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
                    <option value="" disabled>
                      Select a reason
                    </option>
                    {REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Remark</label>
                  <textarea name="cancel_remark" rows={2} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm">
                    Back
                  </button>
                  <button type="submit" disabled={pending} className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                    {pending ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
