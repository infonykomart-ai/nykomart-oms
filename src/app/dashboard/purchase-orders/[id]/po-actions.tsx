"use client";

// 2026-11-22c — status change + delete for one Purchase Order.
// Both actions are capability-checked again on the server (order_entry) and
// company-scoped; this component only renders the controls.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePurchaseOrder, setPurchaseOrderStatus } from "../actions";
// Import from the PURE module, not ./data — data.ts pulls in the server
// Supabase client (next/headers), which must never be bundled for a client
// component.
import { PO_STATUSES } from "@/lib/purchase-orders/lines";

export function PoActions({ poId, status }: { poId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function changeStatus(next: string) {
    if (next === status) return;
    setError(null);
    startTransition(async () => {
      const result = await setPurchaseOrderStatus(poId, next);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deletePurchaseOrder(poId);
      if (result.error) setError(result.error);
      else router.push("/dashboard/purchase-orders");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <label className="text-xs font-medium text-slate-600" htmlFor="po-status-change">
        Status
      </label>
      <select
        id="po-status-change"
        value={status}
        disabled={pending}
        onChange={(event) => changeStatus(event.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:opacity-50"
      >
        {PO_STATUSES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      {confirming ? (
        <>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Yes, delete PO"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Keep it
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending}
          className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
