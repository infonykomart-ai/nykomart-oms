"use client";

// 2026-11-22 — the register table and its export toolbar live in a CLIENT
// component on purpose. ExportBar is a client component and ExportColumn.value
// is a function, so building these columns inside the server page and handing
// them over the boundary threw "Functions cannot be passed directly to Client
// Components" — which is why /dashboard/purchase-orders failed to open at all
// instead of showing the list. Building the columns here keeps every function
// on the client side; only the plain rows cross the boundary.
import Link from "next/link";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import type { PoListItem } from "@/lib/purchase-orders/data";

function statusClass(status: string): string {
  switch (status) {
    case "Received":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Sent":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "Cancelled":
      return "bg-slate-100 text-slate-500 border-slate-200";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

const columns: ExportColumn<PoListItem>[] = [
  { key: "po_no", label: "PO No.", value: (row) => row.po_no },
  { key: "po_date", label: "PO Date", value: (row) => row.po_date },
  { key: "orderRef", label: "Order Ref", value: (row) => row.orderRef },
  { key: "buyerName", label: "Buyer", value: (row) => row.buyerName },
  { key: "supplierName", label: "Supplier", value: (row) => row.supplierName },
  { key: "lineCount", label: "Lines", value: (row) => row.lineCount },
  { key: "qtyTotal", label: "Qty", value: (row) => row.qtyTotal },
  { key: "currency", label: "Currency", value: (row) => row.currency },
  { key: "total_amount", label: "Total", value: (row) => row.total_amount },
  { key: "status", label: "Status", value: (row) => row.status },
  { key: "closeupCount", label: "Close-up Photos", value: (row) => row.closeupCount },
];

export function PoTable({ rows, hasError }: { rows: PoListItem[]; hasError: boolean }) {
  return (
    <>
      <div className="mb-3">
        <ExportBar title="Purchase Orders" filenameBase="purchase-orders" columns={columns} rows={rows} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">PO No.</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Order Ref</th>
              <th className="px-3 py-2">Buyer</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Photos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-800">
                  <Link href={`/dashboard/purchase-orders/${row.id}`} className="hover:underline">
                    {row.po_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-600">{row.po_date}</td>
                <td className="px-3 py-2 text-slate-600">
                  {row.order_id ? (
                    <Link href={`/dashboard/orders/${row.order_id}`} className="hover:underline">
                      {row.orderRef ?? "(order)"}
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2 text-slate-600">{row.buyerName ?? "—"}</td>
                <td className="max-w-[180px] truncate px-3 py-2 text-slate-600">{row.supplierName ?? "—"}</td>
                <td className="px-3 py-2 text-right text-slate-600">{row.lineCount}</td>
                <td className="px-3 py-2 text-right text-slate-600">{row.qtyTotal}</td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {row.currency ? `${row.currency} ` : ""}
                  {row.total_amount.toFixed(2)}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${statusClass(row.status)}`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-slate-600">{row.closeupCount || "—"}</td>
              </tr>
            ))}
            {!rows.length && !hasError && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-sm text-slate-400">
                  No purchase orders match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
