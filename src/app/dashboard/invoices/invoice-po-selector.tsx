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
//
// 2026-08-11 (round 2): "agar koi buyer ka order 4 din pahle aata hai
// phir 4 din baad ek or order aata hai ... dono ke po rf rg no alag alag
// hai to select karne ka option aana chahiye ... ek se jyada select kare
// to ho jaye" — MULTI-select across batches, so 2+ separate PO/RF/RG
// numbers (e.g. two orders from the same buyer, placed days apart, that
// the buyer wants shipped/invoiced together) can be combined into ONE
// invoice. generateInvoiceCore (actions.ts) already accepted an arbitrary
// orderIds[] and already loops/sums across them — the "one batch only"
// restriction was purely this component's own UI, not a server rule. What
// IS still enforced server-side (and mirrored here client-side, so a
// mismatched pick is caught before submitting instead of after): every
// selected order must share the same company + store, and for CSB-V, the
// same currency (a single value-breakdown sum wouldn't make sense mixing
// currencies). Buyer name is NOT hard-enforced to match (it's a freeform
// text field, minor formatting differences are common) — a mismatch just
// shows a warning banner, doesn't block.
import { useMemo, useState } from "react";
import Link from "next/link";
import { InvoiceGenerateForm } from "./invoice-generate-form";

type OrderRow = {
  id: string;
  ref_no: string;
  ref_no_base: string | null;
  company_id: string;
  store_id: string;
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

function normalizeBuyer(s: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
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
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

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

  const selected = useMemo(() => batches.filter((b) => selectedKeys.includes(b.key)), [batches, selectedKeys]);

  // Once at least one batch is picked, further picks are constrained to
  // the same company + store — matches generateInvoiceCore's own hard
  // check, caught here instead of after submitting.
  const lockCompanyId = selected[0]?.orders[0].company_id ?? null;
  const lockStoreId = selected[0]?.orders[0].store_id ?? null;

  function toggleBatch(batch: Batch) {
    setSelectedKeys((prev) => {
      if (prev.includes(batch.key)) return prev.filter((k) => k !== batch.key);
      return [...prev, batch.key];
    });
  }

  if (batches.length === 0) {
    return <p className="text-sm text-slate-400">No orders yet.</p>;
  }

  // Union of every still-pending order across every selected batch — this
  // is exactly the orderIds[] a combined invoice will cover.
  const pendingOrders = selected.flatMap((b) => b.orders.filter((o) => !o.invoice_id));
  const allBuyerNamesMatch = new Set(pendingOrders.map((o) => normalizeBuyer(o.buyer_name_address))).size <= 1;
  const refNoBases = Array.from(new Set(selected.map((b) => b.orders[0].ref_no_base).filter(Boolean)));
  // Only show "already fully invoiced" state when EVERY selected batch is
  // fully invoiced (there's nothing left to combine into a new invoice).
  const allSelectedInvoiced = selected.length > 0 && selected.every((b) => batchStatus(b.orders) === "invoiced");
  const invoiceIds = Array.from(
    new Set(selected.flatMap((b) => b.orders.map((o) => o.invoice_id)).filter((x): x is string => !!x))
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-500" htmlFor="po_search">
            Select PO / RF / RG Number(s)
          </label>
          {selectedKeys.length > 1 && (
            <span className="text-xs font-medium text-amber-700">{selectedKeys.length} selected — will combine into one invoice</span>
          )}
        </div>
        <input
          id="po_search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search PO/RF/RG, buyer, company, store..."
          className="mb-2 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
        />
        <p className="mb-2 text-xs text-slate-400">
          Tick more than one to combine multiple PO/RF/RG numbers into a single invoice (e.g. two orders from the
          same buyer, placed days apart, shipped together).
        </p>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {filtered.length === 0 && <p className="p-3 text-sm text-slate-400">No matches.</p>}
          {filtered.map((b) => {
            const status = batchStatus(b.orders);
            const isSelected = selectedKeys.includes(b.key);
            const mismatchedScope =
              !isSelected &&
              lockCompanyId != null &&
              (b.orders[0].company_id !== lockCompanyId || b.orders[0].store_id !== lockStoreId);
            // A fully-invoiced batch has nothing pending left to combine —
            // still shown (so its status is visible) but not selectable.
            const disabled = !isSelected && (status === "invoiced" || mismatchedScope);
            return (
              <button
                key={b.key}
                type="button"
                disabled={disabled}
                onClick={() => toggleBatch(b)}
                title={mismatchedScope ? "Different company/store — can't combine with the current selection" : undefined}
                className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white ${
                  isSelected ? "bg-amber-50" : ""
                }`}
              >
                <input type="checkbox" checked={isSelected} disabled={disabled} readOnly className="shrink-0 accent-amber-500" />
                <div className="min-w-0 flex-1">
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

      {selected.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Order Detail — {refNoBases.join(", ")}</h3>
            <p className="mb-2 text-xs text-slate-500">
              {selected[0].companyName} · {selected[0].storeName}
            </p>
            {!allBuyerNamesMatch && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                ⚠ These orders don&apos;t all show the same buyer name/address — double-check before combining into
                one invoice.
              </p>
            )}
            <div className="space-y-3">
              {selected.map((b) => (
                <div key={b.key}>
                  <p className="mb-1 text-xs font-semibold text-slate-500">{b.orders[0].ref_no_base}</p>
                  <div className="space-y-1.5">
                    {b.orders.map((o) => (
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
              ))}
            </div>
          </div>

          <div>
            {allSelectedInvoiced ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                <p className="mb-2 font-medium">Every selected PO/RF/RG is already fully invoiced.</p>
                {invoiceIds.map((id) => (
                  <Link key={id} href={`/dashboard/invoices/${id}`} className="block underline">
                    View / Print Invoice
                  </Link>
                ))}
              </div>
            ) : pendingOrders.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Nothing pending to invoice in this selection.
              </p>
            ) : (
              <>
                {pendingOrders.length < selected.reduce((n, b) => n + b.orders.length, 0) && (
                  <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Some order(s) in this selection are already invoiced (see left, green &ldquo;Invoiced&rdquo; tags
                    link to those invoices) — this form will generate a new invoice for the remaining{" "}
                    {pendingOrders.length} pending order(s) only.
                  </p>
                )}
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  Generate {selected.length > 1 ? "Combined " : ""}Invoice
                </h3>
                <InvoiceGenerateForm
                  orderIds={pendingOrders.map((o) => o.id)}
                  defaultBuyerNameAddress={pendingOrders[0]?.buyer_name_address ?? ""}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
