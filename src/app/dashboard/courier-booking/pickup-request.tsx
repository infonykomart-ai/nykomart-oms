"use client";

// Pickup Request tab UI (EGS-integration round, 2026-09-04). Candidate
// AWBs for all 6 couriers are pre-fetched server-side (page.tsx) and
// filtered client-side by the selected courier — row counts here are
// small (only booked-not-yet-delivered AWBs with no pickup request yet),
// so this avoids needing a client-fetch API route.
import { useActionState, useMemo, useState } from "react";
import { COURIERS, type CourierKey } from "@/lib/couriers/credentials";
import type { PickupCandidateAwb, PickupRequestRow } from "./pickup-request-data";
import { createPickupRequest, type CreatePickupRequestState } from "./pickup-request-actions";

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const initial: CreatePickupRequestState = { error: null, success: false };

function statusBadgeClass(status: PickupRequestRow["status"]): string {
  if (status === "confirmed") return "bg-green-100 text-green-700";
  if (status === "cancelled") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

export function PickupRequest({
  candidatesByCourier,
  defaultPickupAddress,
  existingRequests,
}: {
  candidatesByCourier: Record<CourierKey, PickupCandidateAwb[]>;
  defaultPickupAddress: string;
  existingRequests: PickupRequestRow[];
}) {
  const [courier, setCourier] = useState<CourierKey>("fedex");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState(createPickupRequest, initial);

  const candidates = useMemo(() => candidatesByCourier[courier] ?? [], [candidatesByCourier, courier]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedTotal = useMemo(() => candidates.filter((c) => selected.has(c.orderShipmentId)).reduce((sum, c) => sum + (c.totalPriceInr ?? 0), 0), [candidates, selected]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">New Pickup Request</h2>
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This creates an internal request record only — it does NOT call the courier&apos;s own API to schedule a reverse pickup (no courier&apos;s
          pickup-scheduling endpoint has been verified yet). Still arrange the actual pickup with the courier directly; use this to track what
          was requested and when.
        </p>
        {state.success ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Pickup request created. Refresh the page to see it below.</p>
        ) : (
          <form action={action} className="space-y-3">
            {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <label className={labelClass}>Logistic Partner</label>
                <select
                  name="courier"
                  value={courier}
                  onChange={(e) => {
                    setCourier(e.target.value as CourierKey);
                    setSelected(new Set());
                  }}
                  className={inputClass}
                >
                  {COURIERS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Pickup Address</label>
                <input name="pickup_address" required defaultValue={defaultPickupAddress} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Booking Date</label>
                <input type="date" name="booking_date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Scheduled Pickup Date</label>
                <input type="date" name="scheduled_pickup_date" required className={inputClass} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Remark</label>
                <input name="remark" className={inputClass} />
              </div>
            </div>

            {candidates.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                No {COURIERS.find((c) => c.key === courier)?.label} AWBs currently need a pickup request (either none booked, or already requested).
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2"></th>
                      <th className="px-3 py-2 font-medium">Ref No.</th>
                      <th className="px-3 py-2 font-medium">AWB</th>
                      <th className="px-3 py-2 font-medium">Service</th>
                      <th className="px-3 py-2 font-medium">Buyer</th>
                      <th className="px-3 py-2 font-medium">Total Price (₹)</th>
                      <th className="px-3 py-2 font-medium">Weight (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidates.map((c) => (
                      <tr key={c.orderShipmentId}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            name="order_shipment_ids"
                            value={c.orderShipmentId}
                            checked={selected.has(c.orderShipmentId)}
                            onChange={() => toggle(c.orderShipmentId)}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">{c.refNo}</td>
                        <td className="px-3 py-2">{c.awbNo}</td>
                        <td className="px-3 py-2">{c.serviceCode ?? "—"}</td>
                        <td className="px-3 py-2">
                          <div className="max-w-[200px] truncate">{c.buyerNameAddress ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2">{c.totalPriceInr != null ? c.totalPriceInr.toFixed(2) : "—"}</td>
                        <td className="px-3 py-2">{c.weightKg ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                {selected.size} AWB{selected.size === 1 ? "" : "s"} selected — ₹{selectedTotal.toFixed(2)}
              </p>
              <button
                type="submit"
                disabled={pending || selected.size === 0}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {pending ? "Submitting..." : "Submit Pickup Request"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Recent Pickup Requests</h2>
        {existingRequests.length === 0 ? (
          <p className="text-xs text-slate-400">No pickup requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Courier</th>
                  <th className="px-3 py-2 font-medium">AWBs</th>
                  <th className="px-3 py-2 font-medium">Booking Date</th>
                  <th className="px-3 py-2 font-medium">Scheduled Pickup</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {existingRequests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{COURIERS.find((c) => c.key === r.courier)?.label ?? r.courier}</td>
                    <td className="px-3 py-2">{r.awbCount}</td>
                    <td className="px-3 py-2">{r.bookingDate}</td>
                    <td className="px-3 py-2">{r.scheduledPickupDate}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(r.status)}`}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2">{r.remark ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
