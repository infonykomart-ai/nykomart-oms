"use client";

import { useState, useTransition } from "react";
import { deleteOrder } from "./actions";
import { OrderEditForm, type EditableOrder } from "./order-edit-form";

type OrderRow = EditableOrder & {
  whatsapp_sent_at: string | null;
  invoice_id: string | null;
  entry_timestamp: string;
};

// The actual "edit modify delete" panel — one row per order, expandable
// into OrderEditForm. WhatsApp-already-sent rows get a green tint (matches
// the same convention added to the "Aaj ki recent entries" list on the
// /new page). Delete is guarded server-side (see actions.ts) — this just
// surfaces whatever message comes back if it's blocked.
export function OrderListTable({
  orders,
  itemCategories,
  sizes,
  currencies,
  statuses,
}: {
  orders: OrderRow[];
  itemCategories: { id: string; name: string }[];
  sizes: { id: string; label: string }[];
  currencies: { code: string; name: string }[];
  statuses: string[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const categoryName = new Map(itemCategories.map((c) => [c.id, c.name]));

  function handleDelete(orderId: string, refNo: string) {
    if (!window.confirm(`Delete "${refNo}"? This cannot be undone.`)) return;
    setDeleteError((prev) => ({ ...prev, [orderId]: "" }));
    startTransition(async () => {
      const result = await deleteOrder(orderId);
      if (result.error) {
        setDeleteError((prev) => ({ ...prev, [orderId]: result.error! }));
      }
    });
  }

  if (orders.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No orders found.</p>;
  }

  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <div
          key={o.id}
          className={`rounded-xl border p-4 ${o.whatsapp_sent_at ? "border-green-200 bg-green-50" : "border-slate-200 bg-white"}`}
        >
          {editingId === o.id ? (
            <OrderEditForm
              order={o}
              itemCategories={itemCategories}
              sizes={sizes}
              currencies={currencies}
              statuses={statuses}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{o.ref_no}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{o.status}</span>
                  {o.whatsapp_sent_at && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      ✓ Sent on WhatsApp
                    </span>
                  )}
                  {o.invoice_id && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Invoiced</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">{o.buyer_name_address || "—"}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {o.order_date} · {categoryName.get(o.item_category_id) ?? "—"} {o.size_label ? `· ${o.size_label}` : ""} · Qty {o.qty} ·{" "}
                  {o.order_value_original} {o.order_currency}
                </p>
                {deleteError[o.id] && <p className="mt-2 text-xs font-medium text-red-600">{deleteError[o.id]}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setEditingId(o.id)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(o.id, o.ref_no)}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
