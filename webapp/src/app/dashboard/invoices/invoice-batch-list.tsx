"use client";

import { useState } from "react";
import { InvoiceGenerateForm } from "./invoice-generate-form";

type OrderRow = {
  id: string;
  ref_no: string;
  ref_no_base: string | null;
  buyer_name_address: string | null;
  contact_no: string | null;
  qty: number;
  order_value_original: number;
  order_currency: string;
  status: string;
};

type Batch = { key: string; companyName: string; storeName: string; orders: OrderRow[] };

export function InvoiceBatchList({ batches }: { batches: Batch[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (batches.length === 0) {
    // 2026-08-08: "SABHI ORDER LIST INVOICE VALE SECTION ME DIKHE" — every
    // not-yet-invoiced order (any status) now shows here, so an empty list
    // genuinely means everything already has an invoice (or there are no
    // orders at all yet) — not a status filter hiding anything.
    return <p className="text-sm text-slate-400">No orders left to invoice — every order already has an invoice.</p>;
  }

  return (
    <div className="space-y-2">
      {batches.map((b) => {
        const isOpen = openKey === b.key;
        return (
          <div key={b.key} className="rounded-lg border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : b.key)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm"
            >
              <div>
                <span className="font-medium text-slate-900">{b.orders[0].ref_no_base}</span>
                <span className="ml-2 text-xs text-slate-400">
                  {b.companyName} · {b.storeName} · {b.orders.length} item{b.orders.length > 1 ? "s" : ""}
                </span>
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                    b.orders[0].status === "Dispatched" || b.orders[0].status === "Delivered"
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {b.orders[0].status}
                </span>
                <p className="mt-0.5 truncate text-xs text-slate-500">{b.orders[0].buyer_name_address}</p>
              </div>
              <span className="text-slate-400">{isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen && (
              <div className="border-t border-slate-100 p-3">
                <div className="mb-3 space-y-1">
                  {b.orders.map((o) => (
                    <div key={o.id} className="flex justify-between text-xs text-slate-500">
                      <span>{o.ref_no}</span>
                      <span>Qty {o.qty} · {o.order_value_original} {o.order_currency}</span>
                    </div>
                  ))}
                </div>
                <InvoiceGenerateForm orderIds={b.orders.map((o) => o.id)} defaultBuyerNameAddress={b.orders[0].buyer_name_address ?? ""} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
