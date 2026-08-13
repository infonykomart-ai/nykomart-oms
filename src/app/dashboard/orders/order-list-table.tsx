"use client";

import { useState, useTransition } from "react";
import { deleteOrder } from "./actions";
import { OrderEditForm, type EditableOrder } from "./order-edit-form";
import { OrderHoldCancelActions } from "./order-hold-cancel-actions";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";

type OrderRow = EditableOrder & {
  whatsapp_sent_at: string | null;
  invoice_id: string | null;
  entry_timestamp: string;
  shipment_status: string | null;
};

type TrackingInfo = { awbNo: string | null; courierName: string | null; deliveredStatus: string | null; deliveredDate: string | null };

type EtsyFeeLine = {
  date: string | null;
  type: string | null;
  title: string | null;
  info: string | null;
  amount: number;
  fees: number;
  net: number;
  currency: string | null;
};
type EtsyFeeMatch = { lines: EtsyFeeLine[]; totalFeesInr: number };

type EbayFeeLine = {
  date: string | null;
  type: string | null;
  description: string | null;
  memo: string | null;
  amount: number;
  currency: string | null;
};
type EbayFeeMatch = { lines: EbayFeeLine[]; totalFeesUsd: number };

// 2026-08-08 (pending item 7's UI half) — colour-code the shipment status
// badge so "In Transit / Delivered / red alert on issues" is a glance, not
// a read: green once it's actually moving/done, red for Returned/Cancelled
// (the "issue" states), slate for everything still pre-shipment.
function shipmentBadgeClass(status: string): string {
  if (status === "Delivered" || status === "In Transit" || status === "Shipped") return "bg-green-100 text-green-700";
  if (status === "Returned" || status === "Cancelled") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

// Pending item 2 — Hold/Cancelled get their own colours so a blocked/dead
// order reads at a glance, same idea as shipmentBadgeClass above.
function statusBadgeClass(status: string): string {
  if (status === "Hold") return "bg-amber-100 text-amber-700";
  if (status === "Cancelled") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

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
  purchasesByOrder,
  trackingByOrder,
  refundsByOrder,
  etsyFeesByOrder,
  ebayFeesByOrder,
}: {
  orders: OrderRow[];
  itemCategories: { id: string; name: string }[];
  sizes: { id: string; label: string }[];
  currencies: { code: string; name: string }[];
  statuses: string[];
  purchasesByOrder: Record<string, { vendorName: string; vendorInvoiceNo: string }[]>;
  trackingByOrder: Record<string, TrackingInfo>;
  refundsByOrder: Record<string, { amount: number; currency: string; date: string; hasCreditNote: boolean }[]>;
  etsyFeesByOrder: Record<string, EtsyFeeMatch>;
  ebayFeesByOrder: Record<string, EbayFeeMatch>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedFeesId, setExpandedFeesId] = useState<string | null>(null);
  const [expandedEbayFeesId, setExpandedEbayFeesId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const categoryName = new Map(itemCategories.map((c) => [c.id, c.name]));

  // 2026-08-08 (pending item 5) — "Pending/Late/Dispatched order lists
  // ko print/PDF me export kar sake". Reuses the same universal
  // ExportBar/export-table.ts system built 2026-08-06 for Reports — this
  // is its first hookup into the Orders hub itself. Whatever's currently
  // filtered on this page (via the status/date/company filters above) is
  // what gets exported/printed — no separate export-only query.
  type ExportRow = {
    ref_no: string;
    order_date: string;
    status: string;
    buyer_name_address: string | null;
    contact_no: string | null;
    item_category_name: string;
    size_label: string | null;
    qty: number;
    order_value_original: number;
    order_currency: string;
    dispatch_date: string | null;
    purchased_from: string;
  };
  const exportRows: ExportRow[] = orders.map((o) => ({
    ref_no: o.ref_no,
    order_date: o.order_date,
    status: o.status,
    buyer_name_address: o.buyer_name_address,
    contact_no: o.contact_no,
    item_category_name: categoryName.get(o.item_category_id) ?? "",
    size_label: o.size_label,
    qty: o.qty,
    order_value_original: o.order_value_original,
    order_currency: o.order_currency,
    dispatch_date: o.dispatch_date,
    purchased_from: purchasesByOrder[o.id]?.map((p) => p.vendorName).join(", ") ?? "",
  }));
  const EXPORT_COLUMNS: ExportColumn<ExportRow>[] = [
    { key: "ref_no", label: "PO/RF/RG No.", value: (r) => r.ref_no },
    { key: "order_date", label: "Order Date", value: (r) => r.order_date },
    { key: "status", label: "Status", value: (r) => r.status },
    { key: "buyer_name_address", label: "Buyer", value: (r) => r.buyer_name_address },
    { key: "contact_no", label: "Contact No.", value: (r) => r.contact_no },
    { key: "item_category_name", label: "Item", value: (r) => r.item_category_name },
    { key: "size_label", label: "Size", value: (r) => r.size_label },
    { key: "qty", label: "Qty", value: (r) => r.qty },
    { key: "order_value_original", label: "Value", value: (r) => r.order_value_original },
    { key: "order_currency", label: "Currency", value: (r) => r.order_currency },
    { key: "dispatch_date", label: "Dispatch Date", value: (r) => r.dispatch_date },
    { key: "purchased_from", label: "Purchased From", value: (r) => r.purchased_from },
  ];

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

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #orders-print-area, #orders-print-area * { visibility: visible; }
          #orders-print-area { position: fixed; inset: 0; width: 100%; }
        }
      `}</style>
      <div className="mb-3 flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">{orders.length} order{orders.length === 1 ? "" : "s"}</p>
        <ExportBar title="Orders" filenameBase="orders" columns={EXPORT_COLUMNS} rows={exportRows} printAreaId="orders-print-area" />
      </div>
      {orders.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No orders found.</p>
      ) : (
      <div id="orders-print-area" className="space-y-3">
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
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(o.status)}`}>{o.status}</span>
                  {o.whatsapp_sent_at && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      ✓ Sent on WhatsApp
                    </span>
                  )}
                  {o.invoice_id && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Invoiced</span>
                  )}
                  {/* 2026-08-08 (pending item 7's UI half) — "In Transit /
                      Delivered / red alert on issues" at a glance. Filled
                      in via Bulk Courier Tracking Update (item 8); only
                      shown once something other than the default has been
                      set, so brand-new orders don't clutter with a
                      redundant "Order Placed" badge next to Status. */}
                  {o.shipment_status && o.shipment_status !== "Order Placed" && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${shipmentBadgeClass(o.shipment_status)}`}>
                      🚚 {o.shipment_status}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">{o.buyer_name_address || "—"}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {o.order_date} · {categoryName.get(o.item_category_id) ?? "—"} {o.size_label ? `· ${o.size_label}` : ""} · Qty {o.qty} ·{" "}
                  {o.order_value_original} {o.order_currency}
                </p>
                {/* 2026-08-08: "YE LINK HONA CHAHIYE" — which vendor Party
                    this order's item was purchased from, via Purchase
                    Bill's required order_id link. */}
                {purchasesByOrder[o.id] ? (
                  <p className="mt-1 text-xs text-purple-700">
                    🛒 Purchased from: {purchasesByOrder[o.id].map((p) => `${p.vendorName} (${p.vendorInvoiceNo})`).join(", ")}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">No Purchase Bill linked yet.</p>
                )}
                {trackingByOrder[o.id] && (trackingByOrder[o.id].awbNo || trackingByOrder[o.id].courierName) && (
                  <p className="mt-1 text-xs text-teal-700">
                    🚚 {trackingByOrder[o.id].courierName || "Courier"}
                    {trackingByOrder[o.id].awbNo ? ` · AWB ${trackingByOrder[o.id].awbNo}` : ""}
                    {trackingByOrder[o.id].deliveredDate ? ` · Delivered ${trackingByOrder[o.id].deliveredDate}` : ""}
                  </p>
                )}
                {/* Pending item 2 — any refund(s) already entered against
                    this order, and whether one auto-generated a Credit
                    Note (see saveOrderRefund's dispatched+invoiced path). */}
                {(refundsByOrder[o.id] ?? []).map((r, i) => (
                  <p key={i} className="mt-1 text-xs text-teal-700">
                    💸 Refund: {r.amount} {r.currency} on {r.date}{r.hasCreditNote ? " · Credit Note generated" : ""}
                  </p>
                ))}
                {/* 2026-08-13 — "store par jab order aaya to kon kon si fee
                    lagi vo uske store ke statement se milani padegi" — per-
                    order fee reconciliation against the Etsy Ledger CSV
                    (matched via etsy_ledger_lines.order_number, see
                    page.tsx). Only shown when a real match exists, so
                    orders from other marketplaces or with no ledger data
                    yet don't clutter the list with an empty section. */}
                {etsyFeesByOrder[o.id] && (
                  <div className="mt-1.5 print:hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedFeesId(expandedFeesId === o.id ? null : o.id)}
                      className="text-xs font-medium text-indigo-700 underline decoration-dotted hover:text-indigo-900"
                    >
                      🧾 Etsy fees matched: {etsyFeesByOrder[o.id].lines.length} line
                      {etsyFeesByOrder[o.id].lines.length === 1 ? "" : "s"} · net fee impact ₹
                      {etsyFeesByOrder[o.id].totalFeesInr.toLocaleString("en-IN")}
                      {expandedFeesId === o.id ? " ▲" : " ▼"}
                    </button>
                    {expandedFeesId === o.id && (
                      <div className="mt-1.5 overflow-x-auto rounded-lg border border-indigo-100 bg-indigo-50/50">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-indigo-100 text-left text-indigo-700">
                              <th className="px-2 py-1 font-medium">Date</th>
                              <th className="px-2 py-1 font-medium">Type</th>
                              <th className="px-2 py-1 font-medium">Title / Info</th>
                              <th className="px-2 py-1 text-right font-medium">Amount</th>
                              <th className="px-2 py-1 text-right font-medium">Fees &amp; Taxes</th>
                              <th className="px-2 py-1 text-right font-medium">Net</th>
                            </tr>
                          </thead>
                          <tbody>
                            {etsyFeesByOrder[o.id].lines.map((l, i) => (
                              <tr key={i} className="border-b border-indigo-100/60 last:border-0">
                                <td className="px-2 py-1 text-slate-600">{l.date ?? "—"}</td>
                                <td className="px-2 py-1 text-slate-600">{l.type ?? "—"}</td>
                                <td className="px-2 py-1 text-slate-600">{l.title || l.info || "—"}</td>
                                <td className="px-2 py-1 text-right text-slate-600">{l.amount ? l.amount.toLocaleString("en-IN") : "—"}</td>
                                <td className="px-2 py-1 text-right text-slate-600">{l.fees ? l.fees.toLocaleString("en-IN") : "—"}</td>
                                <td className="px-2 py-1 text-right text-slate-600">{l.net ? l.net.toLocaleString("en-IN") : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                {/* 2026-08-13 — same idea, for eBay's real "Tax invoice
                    detail" export. ebay_tax_invoice_lines.order_number is
                    a NATIVE column there (no extraction needed) — see
                    page.tsx. total_amount is negated so a fee charge
                    reads as a negative "fee impact", matching Etsy's
                    convention above; kept as a separate USD total since
                    Etsy's is INR — never summed together. */}
                {ebayFeesByOrder[o.id] && (
                  <div className="mt-1.5 print:hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedEbayFeesId(expandedEbayFeesId === o.id ? null : o.id)}
                      className="text-xs font-medium text-purple-700 underline decoration-dotted hover:text-purple-900"
                    >
                      🧾 eBay fees matched: {ebayFeesByOrder[o.id].lines.length} line
                      {ebayFeesByOrder[o.id].lines.length === 1 ? "" : "s"} · net fee impact $
                      {ebayFeesByOrder[o.id].totalFeesUsd.toLocaleString("en-US")}
                      {expandedEbayFeesId === o.id ? " ▲" : " ▼"}
                    </button>
                    {expandedEbayFeesId === o.id && (
                      <div className="mt-1.5 overflow-x-auto rounded-lg border border-purple-100 bg-purple-50/50">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-purple-100 text-left text-purple-700">
                              <th className="px-2 py-1 font-medium">Date</th>
                              <th className="px-2 py-1 font-medium">Fee Type</th>
                              <th className="px-2 py-1 font-medium">Description / Memo</th>
                              <th className="px-2 py-1 text-right font-medium">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ebayFeesByOrder[o.id].lines.map((l, i) => (
                              <tr key={i} className="border-b border-purple-100/60 last:border-0">
                                <td className="px-2 py-1 text-slate-600">{l.date ?? "—"}</td>
                                <td className="px-2 py-1 text-slate-600">{l.type ?? "—"}</td>
                                <td className="px-2 py-1 text-slate-600">{l.description || l.memo || "—"}</td>
                                <td className="px-2 py-1 text-right text-slate-600">{l.amount ? l.amount.toLocaleString("en-US") : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                {deleteError[o.id] && <p className="mt-2 text-xs font-medium text-red-600">{deleteError[o.id]}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 print:hidden">
                <div className="flex gap-2">
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
                <OrderHoldCancelActions
                  order={{ id: o.id, ref_no: o.ref_no, status: o.status, order_currency: o.order_currency }}
                  hasExistingRefund={(refundsByOrder[o.id] ?? []).length > 0}
                  currencies={currencies}
                />
              </div>
            </div>
          )}
        </div>
      ))}
      </div>
      )}
    </div>
  );
}
