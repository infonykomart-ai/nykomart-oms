"use client";

// Shipment Handover Chalan — 2026-08-17: "SHIPMENT BHI AGAR JAYEGI KI AAJ
// FEDEX 5 SHIPMENT DI TO USKA BHI CHALAN KATE KI IS CHALAN NO SE 5 SHIPMENT
// FDEX KO GAYA" — pick the courier once, search-and-add however many
// existing orders (by PO/RF/RG or AWB) were physically handed over
// together, save once and get one auto-numbered chalan (see actions.ts's
// createShipmentHandoverChalan) grouping all of them. Same
// search-then-add-to-a-list pattern as Purchase Bill Multi.
import { useState, useTransition } from "react";
import { useActionState } from "react";
import {
  lookupOrderForShipmentChalan,
  createShipmentHandoverChalan,
  type ShipmentHandoverChalanState,
} from "./actions";
import { groupPartyOptions, type PartyOption } from "./party-options";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const initialState: ShipmentHandoverChalanState = { error: null, success: null };

type PickedOrder = {
  orderId: string;
  refNo: string;
  awbNo: string | null;
  courierName: string | null;
  alreadyHandedOver: boolean;
};

export function ShipmentHandoverChalanForm({ parties }: { parties: PartyOption[] }) {
  const partyGroups = groupPartyOptions(parties);
  const [state, formAction, pending] = useActionState(createShipmentHandoverChalan, initialState);
  const [query, setQuery] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLooking, startLookup] = useTransition();
  const [orders, setOrders] = useState<PickedOrder[]>([]);

  function handleAdd() {
    if (isLooking) return;
    const q = query.trim();
    if (!q) return;
    startLookup(async () => {
      const r = await lookupOrderForShipmentChalan(q);
      if (r.error || !r.order) {
        setLookupError(r.error ?? "Not found.");
        return;
      }
      if (orders.some((o) => o.orderId === r.order!.id)) {
        setLookupError(`${r.order.ref_no} is already added below.`);
        return;
      }
      setLookupError(null);
      setOrders((prev) => [
        ...prev,
        {
          orderId: r.order!.id,
          refNo: r.order!.ref_no,
          awbNo: r.dispatch?.awb_no ?? null,
          courierName: r.dispatch?.courier_name ?? null,
          alreadyHandedOver: r.alreadyHandedOver,
        },
      ]);
      setQuery("");
    });
  }

  function removeOrder(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
  }

  const orderIdsJson = JSON.stringify(orders.map((o) => o.orderId));

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && (
        <div className="space-y-1 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
          <p className="font-semibold">Chalan {state.success.chalanNo} created.</p>
          {state.success.results.map((r, i) => (
            <p key={i} className={r.ok ? "text-green-700" : "text-red-700"}>
              {r.ok ? "✓" : "✗"} {r.refNo} {r.error ? `— ${r.error}` : ""}
            </p>
          ))}
        </div>
      )}

      <input type="hidden" name="order_ids_json" value={orderIdsJson} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="shc_courier">Courier *</label>
          <select id="shc_courier" name="courier_party_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select courier</option>
            {partyGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="shc_date">Chalan Date</label>
          <input id="shc_date" name="chalan_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="mb-1 block text-xs font-medium text-slate-500">Add shipments/orders handed over on this chalan (search by PO/RF/RG or AWB)</label>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
            placeholder="e.g. PO-0001 or AWB number"
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={isLooking}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isLooking ? "..." : "Add"}
          </button>
        </div>
        {lookupError && <p className="mt-1 text-xs text-red-600">{lookupError}</p>}
      </div>

      {orders.length > 0 && (
        <div className="space-y-1.5">
          {orders.map((o) => (
            <div key={o.orderId} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 text-xs">
              <div>
                <p className="font-semibold text-slate-900">
                  {o.refNo} <span className="font-normal text-slate-400">— AWB {o.awbNo ?? "—"} · {o.courierName ?? "—"}</span>
                </p>
                {o.alreadyHandedOver && (
                  <p className="mt-0.5 text-amber-700">⚠ Already on another handover chalan — this add will be rejected on save.</p>
                )}
              </div>
              <button type="button" onClick={() => removeOrder(o.orderId)} className="shrink-0 text-red-500 hover:underline">Remove</button>
            </div>
          ))}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="shc_remark">Remark</label>
        <textarea id="shc_remark" name="remark" rows={2} className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending || orders.length === 0}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : `Save Chalan for ${orders.length || 0} shipment(s)`}
      </button>
    </form>
  );
}
