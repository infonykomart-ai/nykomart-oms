"use client";

import { useActionState } from "react";
import { refreshOrderTracking, type TrackingRefreshState } from "./tracking-actions";

// 2026-10-26 — the visible half of tracking-actions.ts: one click asks the
// courier's tracking API for this order's AWBs right now (same code path as
// the nightly cron) and the revalidated page then shows the new status.
const initialState: TrackingRefreshState = { error: null, message: null };

export function TrackingRefreshButton({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState(refreshOrderTracking, initialState);

  return (
    <div className="print:hidden">
      <form action={formAction}>
        <input type="hidden" name="order_id" value={orderId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {pending ? "Checking…" : "🔄 Check tracking now"}
        </button>
      </form>
      {state.error && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{state.error}</p>}
      {state.message && <p className="mt-1 text-[11px] text-slate-500">{state.message}</p>}
    </div>
  );
}
