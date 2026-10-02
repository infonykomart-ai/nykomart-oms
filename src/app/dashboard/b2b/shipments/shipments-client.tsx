"use client";

// 2026-10-02d — Export shipment dashboard client: create form (ports,
// container/seal, BL/AWB, ETD/ETA, freight/insurance — all entered, never
// guessed), status ladder select that runs the ops-actions pipeline
// triggers, and the derived 🔴 delayed badge.

import { useState, useTransition } from "react";
import type { Database } from "@/types/database";
import { fmtMoney, SHIPMENT_STATUSES, statusTone } from "@/lib/b2b/erp";
import { createShipment, updateShipmentStatus } from "../ops-actions";

type ShipmentRow = Database["public"]["Tables"]["b2b_shipments"]["Row"];
export type ShipmentView = ShipmentRow & {
  orderNo: string | null;
  buyerName: string | null;
  orderStatus: string | null;
  destination: string;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";
const btnClass =
  "rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-60";

const num = (v: number | null | undefined) => Number(v ?? 0) || 0;
const today = () => new Date().toISOString().slice(0, 10);

function emptyDraft(orderId?: string) {
  return {
    orderId: orderId ?? "",
    destinationCountry: "",
    portOfLoading: "",
    portOfDischarge: "",
    forwarder: "",
    shippingLine: "",
    containerNo: "",
    sealNo: "",
    blAwb: "",
    etd: "",
    eta: "",
    freightCost: "",
    insuranceCost: "",
    notes: "",
  };
}

export function ShipmentsClient({
  shipments,
  orders,
}: {
  shipments: ShipmentView[];
  orders: { id: string; orderNo: string }[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isDelayed = (s: ShipmentView) => !!s.eta && s.eta < today() && s.status !== "Arrived" && s.status !== "Delivered";
  const delayedCount = shipments.filter(isDelayed).length;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else after?.();
    });
  }

  function submit() {
    run(
      () =>
        createShipment({
          orderId: draft.orderId || undefined,
          destinationCountry: draft.destinationCountry,
          portOfLoading: draft.portOfLoading,
          portOfDischarge: draft.portOfDischarge,
          forwarder: draft.forwarder,
          shippingLine: draft.shippingLine,
          containerNo: draft.containerNo,
          sealNo: draft.sealNo,
          blAwb: draft.blAwb,
          etd: draft.etd,
          eta: draft.eta,
          freightCost: draft.freightCost,
          insuranceCost: draft.insuranceCost,
          notes: draft.notes,
        }),
      () => {
        setDraft(emptyDraft());
        setShowForm(false);
      }
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-500">{shipments.length} shipments</span>
        {delayedCount > 0 && (
          <span className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">🔴 {delayedCount} delayed</span>
        )}
        <button className={`${btnClass} ml-auto`} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close" : "+ New shipment"}
        </button>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {showForm && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className={labelClass}>Sales order</label>
            <select value={draft.orderId} onChange={(e) => setDraft((d) => ({ ...d, orderId: e.target.value }))} className={inputClass}>
              <option value="">— none —</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Destination country</label>
            <input value={draft.destinationCountry} onChange={(e) => setDraft((d) => ({ ...d, destinationCountry: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Port of loading</label>
            <input value={draft.portOfLoading} onChange={(e) => setDraft((d) => ({ ...d, portOfLoading: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Port of discharge</label>
            <input value={draft.portOfDischarge} onChange={(e) => setDraft((d) => ({ ...d, portOfDischarge: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Forwarder</label>
            <input value={draft.forwarder} onChange={(e) => setDraft((d) => ({ ...d, forwarder: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Shipping line</label>
            <input value={draft.shippingLine} onChange={(e) => setDraft((d) => ({ ...d, shippingLine: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Container no</label>
            <input value={draft.containerNo} onChange={(e) => setDraft((d) => ({ ...d, containerNo: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Seal no</label>
            <input value={draft.sealNo} onChange={(e) => setDraft((d) => ({ ...d, sealNo: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>BL / AWB</label>
            <input value={draft.blAwb} onChange={(e) => setDraft((d) => ({ ...d, blAwb: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>ETD</label>
            <input type="date" value={draft.etd} onChange={(e) => setDraft((d) => ({ ...d, etd: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>ETA</label>
            <input type="date" value={draft.eta} onChange={(e) => setDraft((d) => ({ ...d, eta: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Freight cost</label>
            <input type="number" step="0.01" value={draft.freightCost} onChange={(e) => setDraft((d) => ({ ...d, freightCost: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Insurance cost</label>
            <input
              type="number"
              step="0.01"
              value={draft.insuranceCost}
              onChange={(e) => setDraft((d) => ({ ...d, insuranceCost: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div className="md:col-span-3">
            <label className={labelClass}>Notes</label>
            <input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} className={inputClass} />
          </div>
          <div className="flex items-end">
            <button className={`${btnClass} w-full`} disabled={pending} onClick={submit}>
              {pending ? "Creating…" : "Create shipment"}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2.5 pl-4 pr-3">Shipment</th>
              <th className="py-2.5 pr-3">Order / Buyer</th>
              <th className="py-2.5 pr-3">Destination</th>
              <th className="py-2.5 pr-3">Status</th>
              <th className="py-2.5 pr-3">Move to</th>
              <th className="py-2.5 pr-3">ETD / ETA</th>
              <th className="py-2.5 pr-3">BL/AWB · Container</th>
              <th className="py-2.5 pr-3 text-right">Freight</th>
            </tr>
          </thead>
          <tbody>
            {shipments.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500">
                  No shipments yet — create one from a ready order.
                </td>
              </tr>
            )}
            {shipments.map((s) => (
              <tr key={s.id} className={`border-b border-slate-100 last:border-0 ${isDelayed(s) ? "bg-red-50/60" : ""}`}>
                <td className="py-2 pl-4 pr-3 font-mono text-xs font-semibold text-slate-700">
                  {s.shipment_no}
                  {isDelayed(s) && <span className="ml-1 font-sans">🔴</span>}
                </td>
                <td className="py-2 pr-3">
                  <div className="text-slate-800">{s.orderNo ?? "—"}</div>
                  <div className="text-xs text-slate-500">{s.buyerName ?? ""}</div>
                </td>
                <td className="py-2 pr-3 text-slate-600">{s.destination || "—"}</td>
                <td className="py-2 pr-3">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${statusTone(s.status)}`}>{s.status}</span>
                </td>
                <td className="py-2 pr-3">
                  <select
                    value={s.status}
                    disabled={pending}
                    onChange={(e) => run(() => updateShipmentStatus(s.id, e.target.value))}
                    className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  >
                    {SHIPMENT_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {s.etd ?? "—"} → {s.eta ?? "—"}
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {[s.bl_awb, s.container_no].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="py-2 pr-3 text-right">{num(s.freight_cost) > 0 ? fmtMoney(num(s.freight_cost)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
