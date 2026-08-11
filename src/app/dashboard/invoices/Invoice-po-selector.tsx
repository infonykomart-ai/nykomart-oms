"use client";

// 2026-08-11: replaces the old always-expanded accordion (invoice-batch-
// list.tsx) per "po vagera select karne ka option aana chiahiye jab po
// select kar le to order detail left me show ho jaye or invoice fill ke
// liye details right me". Also shows EVERY PO/RF/RG (not just un-invoiced
// ones) with a status badge — "po number rf number rg number select ka
// option ho kis kis ka bana hai invoice or invoice me dikhe ki kis kis ka
// bana hai invoice" — an invoiced batch links straight to its existing
// invoice instead of re-showing the generate form. A "Partially Invoiced"
// batch (some but not all of its orders already used in an earlier
// invoice — e.g. a deliberate second/split invoice against the same PO)
// scopes the generate form to ONLY the still-pending orders in that batch,
// so it can never accidentally re-invoice an order that already has one
// (actions.ts's generateInvoiceCore also independently rejects that
// server-side — this is just the UI staying consistent with it).
import { useMemo, useState } from "react";
import Link from "next/link";
import { InvoiceGenerateForm } from "./invoice-generate-form";

type OrderRow = {
  id: string;
  ref_no: string;
  ref_no_base: string | null;
  buyer_name_address: string | null;
  contact_no: string | null;
  sku_label: string | null;
  item_category_id: string | null;
  size_label: string | null;
  qty: number;
  order_value_original: number;
  order_currency: string;
  status: string;
  invoice_id: string | null;
};

type Batch = { key: string; companyName: string; storeName: string; orders: OrderRow[] };

type BatchStatus = "invoiced" | "partial" | "pending";

function batchStatus(orders: OrderRow[]): BatchStatus {
  const invoicedCount = orders.filter((o) => o.invoice_id).length;
  if (invoicedCount === 0) return "pending";
  if (invoicedCount === orders.length) return "invoiced";
  return "partial";
}

const STATUS_BADGE: Record<BatchStatus, string> = {
  invoiced: "bg-green-100 text-green-700",
  partial: "bg-amber-100 text-amber-700",
  pending: "bg-slate-100 text-slate-600",
};
const STATUS_LABEL: Record<BatchStatus, string> = {
  invoiced: "Invoiced",
  partial: "Partially Invoiced",
  pending: "Pending",
};

export function InvoicePoSelector({
  batches,
  itemCategoryName,
}: {
  batches: Batch[];
  itemCategoryName: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter((b) => {
      const base = (b.orders[0].ref_no_base ?? "").toLowerCase();
      const buyer = (b.orders[0].buyer_name_address ?? "").toLowerCase();
      return (
        base.includes(q) ||
        buyer.includes(q) ||
        b.companyName.toLowerCase().includes(q) ||
        b.storeName.toLowerCase().includes(q)
      );
    });
  }, [batches, query]);

  const selected = batches.find((b) => b.key === selectedKey) ?? null;

  if (batches.length === 0) {
    return <p className="text-sm text-slate-400">No orders yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="po_search">
          Select PO / RF / RG Number
        </label>
        <input
          id="po_search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search PO/RF/RG, buyer, company, store..."
          className="mb-2 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
        />
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {filtered.length === 0 && <p className="p-3 text-sm text-slate-400">No matches.</p>}
          {filtered.map((b) => {
            const status = batchStatus(b.orders);
            const isSelected = b.key === selectedKey;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => setSelectedKey(isSelected ? null : b.key)}
                className={`flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50 ${
                  isSelected ? "bg-amber-50" : ""
                }`}
              >
                <div className="min-w-0">
                  <span className="font-medium text-slate-900">{b.orders[0].ref_no_base}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {b.companyName} · {b.storeName} · {b.orders.length} item{b.orders.length > 1 ? "s" : ""}
                  </span>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{b.orders[0].buyer_name_address}</p>
                </div>
                <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}>
                  {STATUS_LABEL[status]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selected &&
        (() => {
          const status = batchStatus(selected.orders);
          const pendingOrders = selected.orders.filter((o) => !o.invoice_id);
          // Fully/partially invoiced batch: distinct invoice ids among these orders
          // (normally exactly one, unless a previous split invoice used more than one).
          const invoiceIds = Array.from(
            new Set(selected.orders.map((o) => o.invoice_id).filter((x): x is string => !!x))
          );

          return (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  Order Detail — {selected.orders[0].ref_no_base}
                </h3>
                <p className="mb-2 text-xs text-slate-500">
                  {selected.companyName} · {selected.storeName}
                </p>
                <p className="mb-3 whitespace-pre-line text-xs text-slate-600">{selected.orders[0].buyer_name_address}</p>
                <div className="space-y-1.5">
                  {selected.orders.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between rounded border border-slate-100 px-2 py-1.5 text-xs text-slate-600"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-slate-800">{o.ref_no}</span>
                        <span className="ml-2 text-slate-400">
                          {itemCategoryName[o.item_category_id ?? ""] ?? ""}
                          {o.size_label ? ` · ${o.size_label}` : ""} · Qty {o.qty}
                        </span>
                        <p className="text-slate-400">
                          {o.order_value_original} {o.order_currency}
                        </p>
                      </div>
                      {o.invoice_id ? (
                        <Link
                          href={`/dashboard/invoices/${o.invoice_id}`}
                          className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-200"
                        >
                          Invoiced
                        </Link>
                      ) : (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                          Pending
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                {status === "invoiced" ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                    <p className="mb-2 font-medium">This PO/RF/RG is already fully invoiced.</p>
                    {invoiceIds.map((id) => (
                      <Link key={id} href={`/dashboard/invoices/${id}`} className="block underline">
                        View / Print Invoice
                      </Link>
                    ))}
                  </div>
                ) : (
                  <>
                    {status === "partial" && (
                      <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {selected.orders.length - pendingOrders.length} of {selected.orders.length} order(s) in this PO
                        are already invoiced (see left, green &ldquo;Invoiced&rdquo; tag links to that invoice) — this
                        form will generate a new invoice for the remaining {pendingOrders.length} pending order(s) only.
                      </p>
                    )}
                    <h3 className="mb-2 text-sm font-semibold text-slate-700">Generate Invoice</h3>
                    <InvoiceGenerateForm
                      orderIds={pendingOrders.map((o) => o.id)}
                      defaultBuyerNameAddress={selected.orders[0].buyer_name_address ?? ""}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
