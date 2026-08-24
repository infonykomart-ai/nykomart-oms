"use client";

// 2026-08-24: shared "add shipment/AWB right here" box used by the Courier
// Bill / Duty & Tax Bill manual-match screens (both the hand-entry
// AssignAwbForm in freight-bill-section.tsx / duty-bill-section.tsx, and the
// PDF-upload FixMatchBox in courier-bill-pdf-section.tsx) — see
// createShipmentForMatch in ./actions.ts and
// claude/tracking-manual-match-no-shipment-gap-2026-08-24.md for why this
// exists: an order with 0 shipments used to be a dead end here.
import { useActionState, useEffect, useRef } from "react";
import { createShipmentForMatch, type CreateShipmentResult } from "./actions";

const initial: CreateShipmentResult = { error: null, orderShipmentId: null };

const inputClass = "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

export function InlineAddShipmentBox({
  orderId,
  refNo,
  onSaved,
}: {
  orderId: string;
  refNo: string;
  onSaved: (orderShipmentId: string) => void;
}) {
  const [state, formAction, pending] = useActionState(createShipmentForMatch, initial);
  // useActionState re-runs with a fresh state object on every dispatch, but
  // orderShipmentId only becomes non-null on a genuine success — track the
  // id we've already reported so this doesn't re-fire if the parent
  // re-renders (rather than keying off state identity, which would fire on
  // every render including the initial one in some React versions).
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (state.orderShipmentId && state.orderShipmentId !== reported.current) {
      reported.current = state.orderShipmentId;
      onSaved(state.orderShipmentId);
    }
  }, [state.orderShipmentId, onSaved]);

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
      <input type="hidden" name="order_id" value={orderId} />
      <p className="text-xs text-amber-800">
        Add a shipment/AWB for <strong>{refNo}</strong> — then it can be matched right away.
      </p>
      {state.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={labelClass}>Shipment No.</label>
          <input name="shipment_no" type="number" min={1} defaultValue={1} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>AWB No.</label>
          <input name="awb_no" className={inputClass} placeholder="optional" />
        </div>
        <div>
          <label className={labelClass}>Courier</label>
          <input name="courier_name" className={inputClass} placeholder="optional" />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save shipment & continue matching"}
      </button>
    </form>
  );
}
