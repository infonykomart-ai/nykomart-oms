"use client";

// 2026-08-17 — "KACHA MAAL BAHR SE BINA PO KE AA SKATA HAI LEKIN JA NAHI
// SAKTA": shared optional/multiple order-link picker for material going
// OUT — used both on the plain Stock Out form (one picker per row) and on
// each Material OUT Chalan line (one picker per line, since a single
// chalan can cover several different orders' material at once). Same
// search-then-add-to-a-list pattern as the Shipment Handover Chalan's
// order picker, just presented compactly (chip list) since it's optional
// and often left empty. Persistence is via stock_out_order_links — see
// db/2026-08-17-stock-out-order-links.sql.
import { useState, useTransition } from "react";
import { lookupOrderForStock } from "./actions";

export type PickedOrderRef = { orderId: string; refNo: string };

export function OrderMultiPicker({
  value,
  onChange,
}: {
  value: PickedOrderRef[];
  onChange: (next: PickedOrderRef[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLooking, startLookup] = useTransition();

  function handleAdd() {
    if (isLooking) return;
    const q = query.trim();
    if (!q) return;
    startLookup(async () => {
      const r = await lookupOrderForStock(q);
      if (r.error || !r.order) {
        setError(r.error ?? "Not found.");
        return;
      }
      if (value.some((o) => o.orderId === r.order!.id)) {
        setError(`${r.order.ref_no} is already linked.`);
        return;
      }
      setError(null);
      onChange([...value, { orderId: r.order.id, refNo: r.order.ref_no }]);
      setQuery("");
    });
  }

  function removeOrder(orderId: string) {
    onChange(value.filter((o) => o.orderId !== orderId));
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  return (
    <div>
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
          placeholder="Link to order — PO/RF/RG no. (optional)"
          className={inputClass}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isLooking}
          className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {isLooking ? "..." : "+ Link"}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      {value.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {value.map((o) => (
            <span
              key={o.orderId}
              className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700"
            >
              {o.refNo}
              <button type="button" onClick={() => removeOrder(o.orderId)} className="text-purple-400 hover:text-purple-700">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
