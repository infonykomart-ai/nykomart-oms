"use client";

import { useActionState } from "react";
import { generateLabelAction, type GenerateLabelState } from "./label-actions";
import { openLabelUrl } from "@/lib/couriers/open-label-url";

const initial: GenerateLabelState = { error: null, success: false, labelUrl: null };

// Delhivery/Shiprocket only — see label-actions.ts's header comment for
// why these 2 need a separate on-demand call instead of already having a
// label from the booking response like the other 4 couriers.
export function GenerateLabelButton({ courierShipmentId }: { courierShipmentId: string }) {
  const [state, formAction, pending] = useActionState(generateLabelAction, initial);

  if (state.success && state.labelUrl) {
    // 2026-09-10: routed through openLabelUrl (see its header comment) —
    // a plain <a href target="_blank"> silently shows raw bytes instead of
    // the PDF for a data: URI label. This button is Delhivery/Shiprocket
    // only today (still real http(s) URLs, not affected by that bug), but
    // using the same helper everywhere keeps this safe if that ever changes.
    return (
      <button type="button" onClick={() => openLabelUrl(state.labelUrl!)} className="text-xs font-medium text-amber-700 underline">
        🖨 Label
      </button>
    );
  }

  return (
    <form action={formAction} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="courier_shipment_id" value={courierShipmentId} />
      <button type="submit" disabled={pending} className="text-xs font-medium text-slate-600 underline hover:text-slate-800 disabled:opacity-50">
        {pending ? "Generating..." : "Generate Label"}
      </button>
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
