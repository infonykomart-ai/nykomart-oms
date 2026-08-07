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
};

type Batch = { key: string; companyName: string; storeName: string; orders: OrderRow[] };

export function InvoiceBatchList({ batches }: { batches: Batch[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (batches.length === 0) {
    return <p className="text-sm text-slate-400">All dispatched/delivered orders have already been invoiced.</p>;
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
