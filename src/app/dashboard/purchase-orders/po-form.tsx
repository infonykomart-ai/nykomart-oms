"use client";

// 2026-11-22c — Phase 3: Purchase Order create/edit form.
//
// One component for both: a `po_id` hidden field turns it into an update.
// The linked order is required — that is what makes the close-up photos
// readable by this PO. The photo count is shown for the picked order, and the
// photos themselves are displayed on the PO detail/print page from the
// order's live list (no copy is taken here).
import { useActionState, useState } from "react";
import Link from "next/link";
import { savePurchaseOrder, type PoFormState } from "./actions";
import type { PoLinkedOrder } from "@/lib/purchase-orders/data";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

type LineState = { key: number; sku: string; qty: string; cost: string };

let nextLineKey = 1;

export type PoFormInitial = {
  id: string;
  order_id: string | null;
  supplier_party_id: string | null;
  po_date: string;
  expected_date: string | null;
  currency: string | null;
  total_amount: number;
  items: { sku_label: string | null; qty: number; unit_cost: number }[];
};

export function PoForm({
  orders,
  suppliers,
  initial,
  today,
  cancelHref,
}: {
  orders: PoLinkedOrder[];
  suppliers: { id: string; name: string }[];
  initial?: PoFormInitial;
  today: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<PoFormState, FormData>(savePurchaseOrder, {
    error: null,
    success: false,
  });

  const [orderId, setOrderId] = useState(initial?.order_id ?? "");
  const [lines, setLines] = useState<LineState[]>(() =>
    initial && initial.items.length
      ? initial.items.map((item) => ({
          key: nextLineKey++,
          sku: item.sku_label ?? "",
          qty: String(item.qty),
          cost: String(item.unit_cost),
        }))
      : [{ key: nextLineKey++, sku: "", qty: "1", cost: "0" }]
  );

  const pickedOrder = orders.find((order) => order.id === orderId) ?? null;

  function updateLine(key: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, { key: nextLineKey++, sku: "", qty: "1", cost: "0" }]);
  }

  function removeLine(key: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.key !== key)));
  }

  function fillFromOrder() {
    if (!pickedOrder) return;
    setLines((prev) => {
      const [first, ...rest] = prev;
      return [
        {
          ...first,
          sku: pickedOrder.sku_label ?? "",
          qty: pickedOrder.qty > 0 ? String(pickedOrder.qty) : first.qty,
        },
        ...rest,
      ];
    });
  }

  const total = lines.reduce((sum, line) => {
    const qty = Number(line.qty);
    const cost = Number(line.cost);
    return sum + (Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : 0);
  }, 0);

  return (
    <form action={formAction} className="space-y-5">
      {initial && <input type="hidden" name="po_id" value={initial.id} />}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className={labelClass} htmlFor="po-order">
              Linked order <span className="text-red-500">*</span>
            </label>
            <select
              id="po-order"
              name="order_id"
              required
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              className={inputClass}
            >
              <option value="">Select an order…</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.ref_no} — {order.buyer_name_address ?? "(no buyer)"} — {order.status}
                  {order.closeupCount > 0 ? ` — ${order.closeupCount} close-up photo${order.closeupCount === 1 ? "" : "s"}` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              This PO reads that order&apos;s close-up photos. Photos are only uploaded or linked on the Order page.
            </p>
            {pickedOrder && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span>Order date: {pickedOrder.order_date}</span>
                <span>SKU: {pickedOrder.sku_label || "—"}</span>
                <span>Size: {pickedOrder.size_label || "—"}</span>
                <span>Qty: {pickedOrder.qty}</span>
                <span>Currency: {pickedOrder.order_currency || "—"}</span>
                <span className={pickedOrder.closeupCount ? "font-medium text-amber-700" : "text-slate-400"}>
                  {pickedOrder.closeupCount} close-up photo{pickedOrder.closeupCount === 1 ? "" : "s"}
                </span>
                <button type="button" onClick={fillFromOrder} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-white">
                  Use order details in line 1
                </button>
              </div>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="po-supplier">
              Supplier
            </label>
            <select
              id="po-supplier"
              name="supplier_party_id"
              defaultValue={initial?.supplier_party_id ?? ""}
              className={inputClass}
            >
              <option value="">Not selected</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="po-date">
              PO date <span className="text-red-500">*</span>
            </label>
            <input
              id="po-date"
              name="po_date"
              type="date"
              required
              defaultValue={initial?.po_date ?? today}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="po-expected">
              Expected date
            </label>
            <input
              id="po-expected"
              name="expected_date"
              type="date"
              defaultValue={initial?.expected_date ?? ""}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="po-currency">
              Currency
            </label>
            <input
              id="po-currency"
              name="currency"
              type="text"
              maxLength={8}
              defaultValue={initial?.currency ?? ""}
              placeholder={pickedOrder?.order_currency ?? "USD"}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Line items</h2>
          <button
            type="button"
            onClick={addLine}
            className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-amber-400 hover:text-amber-600"
          >
            + Add line
          </button>
        </div>

        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_110px_130px_120px_36px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid">
            <span>SKU / item</span>
            <span>Qty</span>
            <span>Unit cost</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {lines.map((line, index) => {
            const qty = Number(line.qty);
            const cost = Number(line.cost);
            const amount = Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : 0;
            return (
              <div key={line.key} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_110px_130px_120px_36px] md:items-center">
                <input
                  name="item_sku_label"
                  value={line.sku}
                  onChange={(event) => updateLine(line.key, { sku: event.target.value })}
                  placeholder={`Item / SKU for line ${index + 1}`}
                  className={inputClass}
                />
                <input
                  name="item_qty"
                  value={line.qty}
                  onChange={(event) => updateLine(line.key, { qty: event.target.value })}
                  inputMode="numeric"
                  className={inputClass}
                />
                <input
                  name="item_unit_cost"
                  value={line.cost}
                  onChange={(event) => updateLine(line.key, { cost: event.target.value })}
                  inputMode="decimal"
                  className={inputClass}
                />
                <span className="px-1 text-right text-sm text-slate-600">{amount.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  disabled={lines.length === 1}
                  aria-label="Remove line"
                  className="justify-self-start rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:border-red-300 hover:text-red-600 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-end gap-4 border-t border-slate-200 pt-3 text-sm">
          <span className="text-slate-500">Total</span>
          <span className="font-semibold text-slate-800">{total.toFixed(2)}</span>
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "Saving…" : initial ? "Save changes" : "Create purchase order"}
        </button>
        <Link href={cancelHref} className="text-sm text-slate-500 hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
