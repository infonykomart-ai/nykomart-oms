"use client";

// 2026-11-03 — the click-through half of "returns page se hi refund": the
// server page searches orders by PO / marketplace order no / buyer and hands
// the matches here. Picking one opens the SAME RefundSheetDialog the Orders
// page uses (read-only order details on the A4 sheet, only reason / amount /
// date / currency editable), so there is exactly one refund form in the app.

import { useState } from "react";
import { RefundSheetDialog } from "../orders/refund-sheet-dialog";

export type RefundPickerOrder = {
  id: string;
  ref_no: string;
  status: string;
  order_currency: string;
  order_value_original: number;
  buyer_name_address: string | null;
  marketplace_order_no: string | null;
  order_date: string;
  store_name: string | null;
};

export function RefundOrderPicker({
  orders,
  currencies,
  search,
}: {
  orders: RefundPickerOrder[];
  currencies: { code: string; name: string }[];
  search: string;
}) {
  const [selected, setSelected] = useState<RefundPickerOrder | null>(null);

  if (orders.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        &quot;{search}&quot; se koi order match nahi hua (ya us company/date range me nahi hai). PO no ya marketplace order
        no poora likh ke try karo.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-teal-700">
        {orders.length} order{orders.length === 1 ? "" : "s"} mile — jis order ka refund karna hai us par{" "}
        <b>Open refund sheet</b> dabao.
      </p>
      <div className="overflow-x-auto rounded-lg border border-teal-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-teal-50/60">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">PO / Order No</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Order Date</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Buyer</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Store</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Status</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Order Value</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="font-medium text-slate-900">{o.ref_no}</div>
                  {o.marketplace_order_no && (
                    <div className="text-[11px] text-slate-400">{o.marketplace_order_no}</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{o.order_date}</td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-slate-600" title={o.buyer_name_address ?? ""}>
                  {o.buyer_name_address || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{o.store_name ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{o.status}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">
                  {o.order_value_original.toFixed(2)} {o.order_currency}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setSelected(o)}
                    className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
                  >
                    💸 Open refund sheet
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <RefundSheetDialog
          order={{
            id: selected.id,
            ref_no: selected.ref_no,
            status: selected.status,
            order_currency: selected.order_currency,
            order_value_original: selected.order_value_original,
            buyer_name_address: selected.buyer_name_address,
            marketplace_order_no: selected.marketplace_order_no,
          }}
          currencies={currencies}
          onClose={() => setSelected(null)}
          onSaved={() => setSelected(null)}
        />
      )}
    </div>
  );
}
