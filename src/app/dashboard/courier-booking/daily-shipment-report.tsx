"use client";

import { useState, useTransition } from "react";
import { COURIERS, type CourierKey } from "@/lib/couriers/credentials";
import type { DailyReportRow, DailyReportFilters } from "./daily-report-data";
import { exportDailyShipmentReportCsv } from "./daily-report-actions";

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

function statusBadgeClass(status: string): string {
  if (status === "created") return "bg-green-100 text-green-700";
  if (status === "failed" || status === "cancelled") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DailyShipmentReport({ rows, filters, rowCapHit }: { rows: DailyReportRow[]; filters: DailyReportFilters; rowCapHit: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [exportError, setExportError] = useState<string | null>(null);

  function handleExport() {
    setExportError(null);
    startTransition(async () => {
      const result = await exportDailyShipmentReportCsv(filters);
      if (result.error || !result.csv) {
        setExportError(result.error ?? "Export failed.");
        return;
      }
      downloadCsv(result.csv, `daily-shipment-report-${new Date().toISOString().slice(0, 10)}.csv`);
    });
  }

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="report" />
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Order Date From</label>
          <input type="date" name="report_date_from" defaultValue={filters.dateFrom ?? ""} className={selectClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Order Date To</label>
          <input type="date" name="report_date_to" defaultValue={filters.dateTo ?? ""} className={selectClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Courier</label>
          <select name="report_courier" defaultValue={filters.courier ?? ""} className={selectClass}>
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
          <select name="report_status" defaultValue={filters.status ?? ""} className={selectClass}>
            <option value="">All</option>
            <option value="created">Created</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Destination Country</label>
          <input name="report_destination_country" defaultValue={filters.destinationCountry ?? ""} className={selectClass} />
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filter
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={isPending}
          className="ml-auto rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {isPending ? "Preparing..." : "⬇ Download All (CSV)"}
        </button>
      </form>
      {exportError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{exportError}</p>}
      {rowCapHit && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing the first 500 rows on screen — narrow the filters to see fewer/more specific rows, or use Download All for the full filtered set
          (up to 5,000 rows).
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">No shipments match — try clearing a filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">AWB</th>
                <th className="px-3 py-2 font-medium">Courier</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Ref No.</th>
                <th className="px-3 py-2 font-medium">Order Date</th>
                <th className="px-3 py-2 font-medium">Booking Date</th>
                <th className="px-3 py-2 font-medium">Buyer</th>
                <th className="px-3 py-2 font-medium">Destination</th>
                <th className="px-3 py-2 font-medium">Order Value</th>
                <th className="px-3 py-2 font-medium">Booked Freight</th>
                <th className="px-3 py-2 font-medium">Weight (kg)</th>
                <th className="px-3 py-2 font-medium">Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={`${r.awbNo}-${i}`}>
                  <td className="px-3 py-2">{r.awbNo ?? "—"}</td>
                  <td className="px-3 py-2">{COURIERS.find((c) => c.key === (r.courier as CourierKey))?.label ?? r.courier}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(r.courierBookingStatus)}`}>{r.courierBookingStatus}</span>
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">{r.refNo}</td>
                  <td className="px-3 py-2">{r.orderDate}</td>
                  <td className="px-3 py-2">{r.bookingDate ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="max-w-[180px] truncate">{r.buyerNameAddress ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">{r.destinationCountry ?? "—"}</td>
                  <td className="px-3 py-2">{r.orderValueInr != null ? `₹${r.orderValueInr.toFixed(2)}` : "—"}</td>
                  <td className="px-3 py-2">{r.bookedFreightAmt != null ? `${r.bookedCurrency ?? ""} ${r.bookedFreightAmt.toFixed(2)}` : "—"}</td>
                  <td className="px-3 py-2">{r.weightKg ?? "—"}</td>
                  <td className="px-3 py-2">{r.deliveredStatus ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
