import Link from "next/link";
import { COURIERS, type CourierKey } from "@/lib/couriers/credentials";
import type { TrackedShipment, TrackingFilters } from "./tracking-data";
import { GenerateLabelButton } from "./generate-label-button";

// Cross-order shipment tracking list — see tracking-data.ts's header
// comment: there was no dedicated cross-order "Shipments"/"Tracking" list
// page anywhere in this app before this round, only a small badge on the
// Orders list/detail pages. Same shipment-status color convention as
// order-list-table.tsx's own shipmentBadgeClass, duplicated here rather
// than imported since that file is a large client component this doesn't
// otherwise need to pull in.
function shipmentBadgeClass(status: string): string {
  if (status === "Delivered" || status === "In Transit" || status === "Shipped") return "bg-green-100 text-green-700";
  if (status === "Returned" || status === "Cancelled") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function attemptBadgeClass(status: TrackedShipment["status"]): string {
  if (status === "created") return "bg-green-100 text-green-700";
  if (status === "failed") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function ShipmentsTracking({ shipments, filters }: { shipments: TrackedShipment[]; filters: TrackingFilters }) {
  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-2">
        {/* keeps the page on the Track tab across a filter submit */}
        <input type="hidden" name="tab" value="track" />
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Courier</label>
          <select name="courier" defaultValue={filters.courier ?? ""} className={selectClass}>
            <option value="">All</option>
            {COURIERS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Booking Status</label>
          <select name="status" defaultValue={filters.status ?? ""} className={selectClass}>
            <option value="">All</option>
            <option value="created">Created</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Search (AWB or Ref No.)</label>
          <input name="q" defaultValue={filters.q ?? ""} placeholder="e.g. PO-0123 or AWB" className={selectClass} />
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filter
        </button>
      </form>

      {shipments.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">No shipments match — try clearing a filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Ref No.</th>
                <th className="px-3 py-2 font-medium">Courier</th>
                <th className="px-3 py-2 font-medium">AWB</th>
                <th className="px-3 py-2 font-medium">Booking</th>
                <th className="px-3 py-2 font-medium">Order Status</th>
                <th className="px-3 py-2 font-medium">Booked</th>
                <th className="px-3 py-2 font-medium">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/orders/${s.orderId}`} className="font-medium text-amber-700 hover:underline">
                      {s.refNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{COURIERS.find((c) => c.key === s.courier)?.label ?? s.courier}</td>
                  <td className="px-3 py-2">{s.awbNo ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${attemptBadgeClass(s.status)}`}>{s.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${shipmentBadgeClass(s.shipmentStatus)}`}>
                      {s.shipmentStatus}
                      {s.shipmentStatus !== "Delivered" && s.shipmentStatus !== "Cancelled" && s.shipmentStatus !== "Returned" && " ⚠"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{s.bookedAmt != null ? `${s.bookedCurrency ?? ""} ${s.bookedAmt.toFixed(2)}` : "—"}</td>
                  <td className="px-3 py-2">
                    {s.status !== "created" ? (
                      "—"
                    ) : s.labelUrl ? (
                      <a href={s.labelUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-amber-700 underline">
                        🖨 Label
                      </a>
                    ) : s.courier === "delhivery" || s.courier === "shiprocket" ? (
                      <GenerateLabelButton courierShipmentId={s.id} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export type { CourierKey };
