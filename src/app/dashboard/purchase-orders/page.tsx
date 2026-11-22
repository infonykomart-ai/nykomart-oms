import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { listPurchaseOrders, PO_STATUSES, type PoListItem } from "@/lib/purchase-orders/data";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";

// 2026-11-22c — Phase 3: Purchase Orders register.
//
// Scoped to the ONE company selected in the top-nav switcher, like Orders and
// Invoices (not every company the login can reach). The module is gated on the
// existing `order_entry` capability: a PO links an order and shows that
// order's close-up photos, so the people who own orders own this list — no new
// capability had to be granted to anybody.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

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

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const employee = await requireCapability("order_entry");
  const params = await searchParams;
  const page = Math.max(Number(params.page ?? "1") || 1, 1);

  let rows: PoListItem[] = [];
  let total = 0;
  let setupError: string | null = null;

  try {
    const result = await listPurchaseOrders({
      companyIds: [employee.currentCompanyId],
      q: params.q,
      status: params.status,
      page,
      pageSize: PAGE_SIZE,
    });
    rows = result.rows;
    total = result.total;
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const buildHref = (nextPage: number) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.status) query.set("status", params.status);
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return qs ? `/dashboard/purchase-orders?${qs}` : "/dashboard/purchase-orders";
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Purchase Orders</h1>
          <p className="text-sm text-slate-500">
            A PO links one order and shows that order&apos;s close-up photos — photos are uploaded or linked only on the Order page.
          </p>
        </div>
        <Link
          href="/dashboard/purchase-orders/new"
          className="rounded-lg bg-amber-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-600"
        >
          + New Purchase Order
        </Link>
      </div>

      {setupError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Purchase Orders are not available on this database yet.</p>
          <p className="mt-1">
            Run <code className="rounded bg-white px-1 py-0.5 text-xs">db/2026-11-22c-purchase-orders.sql</code> in the
            Supabase SQL editor, then reload this page.
          </p>
          <p className="mt-1 text-xs text-amber-700">{setupError}</p>
        </div>
      )}

      <form method="get" className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="po-search">
            Search
          </label>
          <input
            id="po-search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="PO no., order ref or marketplace order no."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="po-status">
            Status
          </label>
          <select
            id="po-status"
            name="status"
            defaultValue={params.status ?? ""}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">All statuses</option>
            {PO_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Apply
        </button>
        {(params.q || params.status) && (
          <Link href="/dashboard/purchase-orders" className="px-2 py-2 text-sm text-slate-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

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
            {!rows.length && !setupError && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-sm text-slate-400">
                  No purchase orders match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {lastPage} — {total} purchase order{total === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={buildHref(page - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
                ← Previous
              </Link>
            )}
            {page < lastPage && (
              <Link href={buildHref(page + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
