"use client";

import { useState, useTransition } from "react";
import { holdOrder, cancelOrder, returnOrder } from "./actions";
import { RefundSheetDialog } from "./refund-sheet-dialog";

// Hold/Cancel + the Refund entry that follows Cancel. Design confirmed with
// the user: Hold blocks the order from further action entirely; refund
// amount is always case-by-case manual entry (never auto-computed); and a
// refund against an already-invoiced order auto-generates a Credit Note
// (see saveOrderRefund in actions.ts) while a not-yet-dispatched order's
// refund is just its own row.
//
// "↩️ Return & Refund" is the post-delivery counterpart: an order that WAS
// invoiced/dispatched/delivered and comes back after delivery is NOT a
// cancellation — it sets status to 'Returned' via returnOrder, then opens
// the same refund form (still auto-generates a Credit Note the same way).
//
// A refund doesn't always mean the order was returned at all — a
// duty-only goodwill refund keeps the order where it is. So "💸 Add Refund"
// opens directly on a shipped order with no status change, and a second
// refund later on the same order is allowed.
//
// 2026-11-03 — the refund form + printable A4 sheet moved to the shared
// RefundSheetDialog (refund-sheet-dialog.tsx) so /dashboard/returns opens
// the same sheet from its own section; this component only owns the
// Hold/Cancel/Return buttons and the "Refund saved" confirmation.
export function OrderHoldCancelActions({
  order,
  hasExistingRefund,
  currencies,
}: {
  order: { id: string; ref_no: string; status: string; order_currency: string; order_value_original: number };
  hasExistingRefund: boolean;
  currencies: { code: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showRefundForm, setShowRefundForm] = useState(false);

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

  function handleReturn() {
    setError(null);
    startTransition(async () => {
      const result = await returnOrder(order.id);
      if (result.error) setError(result.error);
      else {
        openWhatsApp(`${order.ref_no} Returned by buyer after delivery — refund being processed`);
        setShowRefundForm(true);
      }
    });
  }

  const canHold = order.status !== "Hold" && order.status !== "Cancelled" && order.status !== "Returned";
  // Cancel stays for pre-dispatch orders — nothing shipped yet.
  const canCancel = !["Dispatched", "Delivered", "Cancelled", "Returned"].includes(order.status);
  // Return & Refund is the post-delivery counterpart.
  const canReturn = ["Dispatched", "Delivered"].includes(order.status);
  // 2026-11-02 — "kabhi kabhi refund add nahi ho pa raha": this used to be
  // gated to Cancelled / Returned / Dispatched / Delivered only, so an order
  // still Pending / Confirmed / In Production / Hold — e.g. buyer paid through
  // a marketplace and then cancelled before we ever shipped — had no way to
  // record the money going back at all. A refund record is just money paid
  // back; the order's own status still only changes through Cancel / Return
  // above, so the button is available for every status now.
  const canAddRefund = true;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {savedNote && !showRefundForm && (
        <p className="rounded-lg bg-green-50 px-2.5 py-1.5 text-xs text-green-800">{savedNote}</p>
      )}
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
        {canReturn && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleReturn}
            title="Order already shipped — buyer is returning it after delivery"
            className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
          >
            ↩️ Return &amp; Refund
          </button>
        )}
        {canAddRefund && !showRefundForm && (
          <button
            type="button"
            onClick={() => setShowRefundForm(true)}
            title={
              order.status === "Dispatched" || order.status === "Delivered"
                ? "Goodwill/partial refund (e.g. duty & taxes) — order status stays unchanged"
                : undefined
            }
            className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
          >
            💸 {hasExistingRefund ? "Add Another Refund" : "Add Refund"}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {showRefundForm && (
        <RefundSheetDialog
          order={order}
          currencies={currencies}
          onClose={() => setShowRefundForm(false)}
          onSaved={(creditNoteNo) =>
            setSavedNote(creditNoteNo ? `Refund saved — Credit Note ${creditNoteNo} auto-generated.` : "Refund saved.")
          }
        />
      )}
    </div>
  );
}
