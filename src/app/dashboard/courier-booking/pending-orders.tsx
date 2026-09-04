"use client";

// Pending Orders tab (EGS-integration round, 2026-09-04) — mirrors EGS's
// own Pending Orders / /shipment page: a staging list of orders not yet
// booked with any courier, with a Combine/Split view toggle (grouped by
// ref_no_base — the same buyer-batch unit the Invoice Generation module
// already groups by) and a buyer-info-edit modal. "use client" for the
// combine/split toggle, accordion expand state, and the edit modal —
// filtering itself stays a plain GET <form> (server-rendered, same
// pattern as shipments-tracking.tsx) so filters are shareable/bookmarkable
// URLs like every other filter form in this dashboard.
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { PendingOrderRow, PendingOrderBatch, PendingOrdersFilters } from "./pending-orders-data";
import { updateOrderBuyerInfo, type BuyerInfoEditState } from "./pending-orders-actions";

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const inputClass = selectClass;
const editInitial: BuyerInfoEditState = { error: null, success: false };

function dueBadgeClass(due: PendingOrderRow["dueBucket"]): string {
  if (due === "overdue") return "bg-red-100 text-red-700";
  if (due === "due_soon") return "bg-amber-100 text-amber-700";
  if (due === "later") return "bg-green-100 text-green-700";
  return "bg-slate-100 text-slate-500";
}
function dueLabel(due: PendingOrderRow["dueBucket"]): string {
  if (due === "overdue") return "Overdue";
  if (due === "due_soon") return "Due in 2 days";
  if (due === "later") return "2+ days";
  return "No dispatch date set";
}

function BuyerInfoEditModal({ order, onClose }: { order: PendingOrderRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateOrderBuyerInfo, editInitial);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Edit Buyer Info — {order.refNo}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        {state.success ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Saved.</p>
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm">
              Close
            </button>
          </div>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="order_id" value={order.id} />
            {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Buyer Name & Address</label>
              <textarea name="buyer_name_address" defaultValue={order.buyerNameAddress ?? ""} rows={3} className={`${inputClass} w-full`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Contact No.</label>
                <input name="contact_no" defaultValue={order.contactNo ?? ""} className={`${inputClass} w-full`} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Email</label>
                <input name="email_id" defaultValue={order.emailId ?? ""} className={`${inputClass} w-full`} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Destination Country</label>
              <input name="destination_country" defaultValue={order.destinationCountry ?? ""} className={`${inputClass} w-full`} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm">
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {pending ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function OrderRow({
  order,
  onEdit,
  onBook,
}: {
  order: PendingOrderRow;
  onEdit: () => void;
  onBook: () => void;
}) {
  return (
    <tr>
      <td className="px-3 py-2 font-medium text-slate-800">{order.refNo}</td>
      <td className="px-3 py-2">{order.orderDate}</td>
      <td className="px-3 py-2">{order.marketplaceOrderNo ?? "—"}</td>
      <td className="px-3 py-2">
        <div className="max-w-[220px] truncate" title={order.buyerNameAddress ?? ""}>
          {order.buyerNameAddress ?? "—"}
        </div>
        <div className="text-slate-400">{order.contactNo ?? "—"}</div>
      </td>
      <td className="px-3 py-2">{order.destinationCountry ?? "—"}</td>
      <td className="px-3 py-2">
        {order.skuLabel ?? "—"} × {order.qty}
      </td>
      <td className="px-3 py-2">{order.orderValueInr != null ? `₹${order.orderValueInr.toFixed(2)}` : "—"}</td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${dueBadgeClass(order.dueBucket)}`}>{dueLabel(order.dueBucket)}</span>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-2">
          <button type="button" onClick={onEdit} className="text-xs font-medium text-slate-500 hover:text-slate-800">
            ✏️ Edit
          </button>
          <button type="button" onClick={onBook} className="text-xs font-semibold text-amber-700 hover:underline">
            📦 Book
          </button>
        </div>
      </td>
    </tr>
  );
}

const TABLE_HEAD = (
  <thead className="bg-slate-50 text-slate-500">
    <tr>
      <th className="px-3 py-2 font-medium">Ref No.</th>
      <th className="px-3 py-2 font-medium">Order Date</th>
      <th className="px-3 py-2 font-medium">Marketplace Order No.</th>
      <th className="px-3 py-2 font-medium">Buyer</th>
      <th className="px-3 py-2 font-medium">Destination</th>
      <th className="px-3 py-2 font-medium">SKU × Qty</th>
      <th className="px-3 py-2 font-medium">Value</th>
      <th className="px-3 py-2 font-medium">Due</th>
      <th className="px-3 py-2 font-medium">Actions</th>
    </tr>
  </thead>
);

export function PendingOrders({ rows, batches, filters }: { rows: PendingOrderRow[]; batches: PendingOrderBatch[]; filters: PendingOrdersFilters }) {
  const router = useRouter();
  const [view, setView] = useState<"combine" | "split">("split");
  const [editingOrder, setEditingOrder] = useState<PendingOrderRow | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function goBook(refNo: string, combinedOrderIds: string[]) {
    const params = new URLSearchParams({ tab: "book", book_ref_no: refNo });
    if (combinedOrderIds.length > 0) params.set("book_combined_ids", combinedOrderIds.join(","));
    router.push(`/dashboard/courier-booking?${params.toString()}`);
  }

  function toggleExpand(refNoBase: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(refNoBase)) next.delete(refNoBase);
      else next.add(refNoBase);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="pending" />
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Order Date From</label>
          <input type="date" name="date_from" defaultValue={filters.dateFrom ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Order Date To</label>
          <input type="date" name="date_to" defaultValue={filters.dateTo ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Due</label>
          <select name="due" defaultValue={filters.due ?? ""} className={selectClass}>
            <option value="">All</option>
            <option value="overdue">Overdue</option>
            <option value="due_soon">In 2 days</option>
            <option value="later">2+ days</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Destination Country</label>
          <input name="destination_country" defaultValue={filters.destinationCountry ?? ""} placeholder="e.g. USA" className={inputClass} />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">Search (Ref No. / Order No. / Buyer / Contact)</label>
          <input name="q" defaultValue={filters.q ?? ""} className={`${inputClass} w-full`} />
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filter
        </button>
      </form>

      <div className="flex items-center gap-4 text-sm">
        <span className="font-medium text-slate-600">Show Orders:</span>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={view === "split"} onChange={() => setView("split")} /> Split (one row per order)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={view === "combine"} onChange={() => setView("combine")} /> Combine (group by buyer-batch)
        </label>
        <span className="ml-auto text-xs text-slate-400">{rows.length} pending order{rows.length === 1 ? "" : "s"}</span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">No pending orders match — try clearing a filter.</p>
      ) : view === "split" ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            {TABLE_HEAD}
            <tbody className="divide-y divide-slate-100">
              {rows.map((o) => (
                <OrderRow key={o.id} order={o} onEdit={() => setEditingOrder(o)} onBook={() => goBook(o.refNo, [])} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2">
          {batches.map((batch) => {
            const isOpen = expanded.has(batch.refNoBase);
            const totalValue = batch.orders.reduce((sum, o) => sum + (o.orderValueInr ?? 0), 0);
            return (
              <div key={batch.refNoBase} className="rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between px-3 py-2">
                  <button type="button" onClick={() => toggleExpand(batch.refNoBase)} className="flex-1 text-left text-sm font-medium text-slate-800">
                    {isOpen ? "▾" : "▸"} {batch.refNoBase} — {batch.orders.length} order{batch.orders.length === 1 ? "" : "s"} — ₹{totalValue.toFixed(2)}
                  </button>
                  {batch.orders.length > 1 && (
                    <button
                      type="button"
                      onClick={() => goBook(batch.orders[0].refNo, batch.orders.slice(1).map((o) => o.id))}
                      className="ml-3 whitespace-nowrap text-xs font-semibold text-amber-700 hover:underline"
                    >
                      📦 Combine & Book all {batch.orders.length}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="overflow-x-auto border-t border-slate-100">
                    <table className="w-full text-left text-xs">
                      {TABLE_HEAD}
                      <tbody className="divide-y divide-slate-100">
                        {batch.orders.map((o) => (
                          <OrderRow key={o.id} order={o} onEdit={() => setEditingOrder(o)} onBook={() => goBook(o.refNo, [])} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editingOrder && <BuyerInfoEditModal order={editingOrder} onClose={() => setEditingOrder(null)} />}
    </div>
  );
}
