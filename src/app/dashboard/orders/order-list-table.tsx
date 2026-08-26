"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteOrder } from "./actions";
import { OrderPhotoThumb } from "./order-photo-thumb";
import { OrderEditForm, type EditableOrder } from "./order-edit-form";
import { OrderHoldCancelActions } from "./order-hold-cancel-actions";
import { CustomerWhatsAppButton } from "./customer-whatsapp-button";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { PrintArea } from "@/components/print-view";

// company_id isn't part of EditableOrder (that type is shared with the Edit
// form, which never needs to change an order's company) but it IS selected
// by page.tsx's orders query and needed here for the "Store Name" column.
type OrderRow = EditableOrder & {
  company_id: string;
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

type AmazonFeeLine = {
  date: string | null;
  type: string | null;
  productDetails: string | null;
  amazonFees: number;
  totalAmount: number;
  currency: string;
};
type AmazonFeeMatch = { lines: AmazonFeeLine[]; totalsByCurrency: { currency: string; totalFees: number }[] };

function shipmentBadgeClass(status: string): string {
  if (status === "Delivered" || status === "In Transit" || status === "Shipped") return "bg-green-100 text-green-700";
  if (status === "Returned" || status === "Cancelled") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function statusBadgeClass(status: string): string {
  if (status === "Hold") return "bg-amber-100 text-amber-700";
  if (status === "Cancelled") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

const NON_LATE_STATUSES = ["Dispatched", "Delivered", "Cancelled", "Returned"];

// Every <td>/<th> in the grid shares this so the gridlines read as one
// consistent "excel jaisa" sheet instead of a patchwork of borders.
const CELL = "border border-slate-200 px-2 py-1.5 align-top";
const HEAD_CELL =
  "sticky top-0 z-10 border border-amber-200 bg-amber-100 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-amber-900 whitespace-nowrap";

// 2026-08-26 — "isme jo ye order hai jo formate deraha hu us formate me
// dikhe to ache lage na excel jese": redone from a stack of cards into a
// real, dense <table> whose columns mirror the spreadsheet layout the user
// shared (Sn No / Store Name / Remark / Order Date / PO No / PO Date /
// Delivery Date / Order No / Status / Dispatch Date / Photo / SKU / Sizes /
// Qty / Item / Vendor / Vendor Date / Recv. Date / Estimated Dispatch Date /
// Late Order / Buyer Name & Address / Contact No / Email ID / VAT-IOSS & Tax
// ID / Order Value / Address Type). Everything the old card view could do
// (inline edit, delete, Hold/Cancel/Refund, WhatsApp notify, per-order
// Etsy/eBay/Amazon fee-match detail, tracking, refund history, purchased-
// from) still exists — it's just moved into a collapsible detail row
// (toggled per-order via the ▾ button in the Actions column) so the main
// grid itself stays one line per order, exactly like the reference sheet.
//
// Three of the reference columns don't have a matching field anywhere in
// this app's schema — "Vendor Date", "Recv. Date" and "Estimated Dispatch
// Date" are shown as "—" rather than invented. If these should actually
// track something real (e.g. the date a Purchase Bill was raised, or a
// separate ETA distinct from Dispatch Date), that needs its own field
// added to `orders` first.
export function OrderListTable({
  orders,
  itemCategories,
  sizes,
  currencies,
  parties,
  companies,
  statuses,
  todayStr,
  purchasesByOrder,
  trackingByOrder,
  refundsByOrder,
  etsyFeesByOrder,
  ebayFeesByOrder,
  amazonFeesByOrder,
}: {
  orders: OrderRow[];
  itemCategories: { id: string; name: string }[];
  sizes: { id: string; label: string }[];
  currencies: { code: string; name: string }[];
  parties: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  statuses: string[];
  todayStr: string;
  purchasesByOrder: Record<string, { vendorName: string; vendorInvoiceNo: string }[]>;
  trackingByOrder: Record<string, TrackingInfo>;
  refundsByOrder: Record<string, { amount: number; currency: string; date: string; hasCreditNote: boolean }[]>;
  etsyFeesByOrder: Record<string, EtsyFeeMatch>;
  ebayFeesByOrder: Record<string, EbayFeeMatch>;
  amazonFeesByOrder: Record<string, AmazonFeeMatch>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedFeesId, setExpandedFeesId] = useState<string | null>(null);
  const [expandedEbayFeesId, setExpandedEbayFeesId] = useState<string | null>(null);
  const [expandedAmazonFeesId, setExpandedAmazonFeesId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const categoryName = new Map(itemCategories.map((c) => [c.id, c.name]));
  const partyName = new Map(parties.map((p) => [p.id, p.name]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  const COLUMN_COUNT = 23; // data columns in the main row (excludes the trailing Actions column) — keep in sync with the <th> list below

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

  function vatIossTax(o: OrderRow): string {
    const parts = [
      o.tax_id ? `Tax ${o.tax_id}` : "",
      o.vat_number ? `VAT ${o.vat_number}` : "",
      o.ioss_number ? `IOSS ${o.ioss_number}` : "",
      o.eori_number ? `EORI ${o.eori_number}` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "—";
  }

  function isLate(o: OrderRow): boolean {
    return !!o.dispatch_date && o.dispatch_date < todayStr && !NON_LATE_STATUSES.includes(o.status);
  }

  const hasExtraDetail = (o: OrderRow) =>
    !!(
      purchasesByOrder[o.id] ||
      o.vendor_party_id ||
      trackingByOrder[o.id] ||
      (refundsByOrder[o.id] ?? []).length ||
      etsyFeesByOrder[o.id] ||
      ebayFeesByOrder[o.id] ||
      amazonFeesByOrder[o.id]
    );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">{orders.length} order{orders.length === 1 ? "" : "s"}</p>
        <ExportBar title="Orders" filenameBase="orders" columns={EXPORT_COLUMNS} rows={exportRows} printAreaId="orders-print-area" />
      </div>
      {orders.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No orders found.</p>
      ) : (
        <PrintArea id="orders-print-area">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[2200px] border-collapse text-xs">
              <thead>
                <tr>
                  <th className={HEAD_CELL}>Sn No.</th>
                  <th className={HEAD_CELL}>Store Name</th>
                  <th className={HEAD_CELL}>Remark</th>
                  <th className={HEAD_CELL}>Order Date</th>
                  <th className={HEAD_CELL}>PO No.</th>
                  <th className={HEAD_CELL}>PO Date</th>
                  <th className={HEAD_CELL}>Delivery Date</th>
                  <th className={HEAD_CELL}>Order No.</th>
                  <th className={`${HEAD_CELL} bg-sky-100 text-sky-900`}>Status</th>
                  <th className={HEAD_CELL}>Dispatch Date</th>
                  <th className={HEAD_CELL}>Photo</th>
                  <th className={HEAD_CELL}>SKU</th>
                  <th className={HEAD_CELL}>Sizes</th>
                  <th className={HEAD_CELL}>Qty</th>
                  <th className={HEAD_CELL}>Item</th>
                  <th className={HEAD_CELL}>Vendor</th>
                  <th className={HEAD_CELL}>Buyer Name &amp; Address</th>
                  <th className={HEAD_CELL}>Contact No.</th>
                  <th className={HEAD_CELL}>Email ID</th>
                  <th className={HEAD_CELL}>VAT/IOSS &amp; Tax ID</th>
                  <th className={HEAD_CELL}>Order Value</th>
                  <th className={HEAD_CELL}>Address Type</th>
                  <th className={`${HEAD_CELL} bg-red-100 text-red-900`}>Late Order</th>
                  <th className={`${HEAD_CELL} print:hidden`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, idx) => {
                  const late = isLate(o);
                  const rowBg = o.whatsapp_sent_at
                    ? "bg-green-50"
                    : late
                      ? "bg-red-50/40"
                      : idx % 2 === 1
                        ? "bg-slate-50/70"
                        : "bg-white";
                  return (
                    <FragmentRow key={o.id}>
                      {editingId === o.id ? (
                        <tr>
                          <td className={CELL} colSpan={COLUMN_COUNT + 1}>
                            <OrderEditForm
                              order={o}
                              itemCategories={itemCategories}
                              sizes={sizes}
                              currencies={currencies}
                              parties={parties}
                              statuses={statuses}
                              onDone={() => setEditingId(null)}
                            />
                          </td>
                        </tr>
                      ) : (
                        <tr className={`${rowBg} hover:bg-amber-50/60`}>
                          <td className={`${CELL} text-slate-400`}>{idx + 1}</td>
                          <td className={`${CELL} whitespace-nowrap font-medium text-slate-700`}>
                            {companyName.get(o.company_id) ?? "—"}
                          </td>
                          <td className={`${CELL} max-w-[160px] truncate`} title={o.remark ?? ""}>
                            {o.remark || "—"}
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>{o.order_date}</td>
                          <td className={`${CELL} whitespace-nowrap font-semibold text-slate-900`}>{o.ref_no}</td>
                          <td className={`${CELL} whitespace-nowrap`}>{o.po_date || "—"}</td>
                          <td className={`${CELL} whitespace-nowrap`}>{o.delivery_date || "—"}</td>
                          <td className={`${CELL} whitespace-nowrap`}>{o.marketplace_order_no || "—"}</td>
                          <td className={CELL}>
                            <div className="flex flex-col items-start gap-1">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(o.status)}`}>{o.status}</span>
                              {o.whatsapp_sent_at && (
                                <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">✓ WA sent</span>
                              )}
                              {o.invoice_id && (
                                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Invoiced</span>
                              )}
                              {o.shipment_status && o.shipment_status !== "Order Placed" && (
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${shipmentBadgeClass(o.shipment_status)}`}>
                                  🚚 {o.shipment_status}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>{o.dispatch_date || "—"}</td>
                          <td className={`${CELL} print:hidden`}>
                            <OrderPhotoThumb photoUrl={o.photo_url} className="h-10 w-10" />
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>{o.sku_label || "—"}</td>
                          <td className={`${CELL} whitespace-nowrap`}>{o.size_label || "—"}</td>
                          <td className={`${CELL} text-right`}>{o.qty}</td>
                          <td className={`${CELL} whitespace-nowrap`}>{categoryName.get(o.item_category_id) ?? "—"}</td>
                          <td className={`${CELL} max-w-[160px] truncate`}>
                            {purchasesByOrder[o.id]
                              ? purchasesByOrder[o.id].map((p) => p.vendorName).join(", ")
                              : o.vendor_party_id
                                ? `${partyName.get(o.vendor_party_id) ?? "—"} (planned)`
                                : "—"}
                          </td>
                          <td className={`${CELL} max-w-[200px] truncate`} title={o.buyer_name_address ?? ""}>
                            {o.buyer_name_address || "—"}
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>{o.contact_no || "—"}</td>
                          <td className={`${CELL} max-w-[160px] truncate`}>{o.email_id || "—"}</td>
                          <td className={`${CELL} max-w-[160px] truncate`} title={vatIossTax(o)}>
                            {vatIossTax(o)}
                          </td>
                          <td className={`${CELL} whitespace-nowrap text-right`}>
                            {o.order_value_original} {o.order_currency}
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>{o.address_type || "—"}</td>
                          <td className={CELL}>
                            {late ? (
                              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">⚠️ Late</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className={`${CELL} print:hidden`}>
                            <div className="flex items-center gap-1 whitespace-nowrap">
                              <Link
                                href={`/dashboard/orders/${o.id}`}
                                title="View"
                                className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                              >
                                👁️
                              </Link>
                              <button
                                type="button"
                                title="Edit"
                                onClick={() => setEditingId(o.id)}
                                className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                title="Delete"
                                disabled={isPending}
                                onClick={() => handleDelete(o.id, o.ref_no)}
                                className="rounded border border-red-200 bg-red-50 px-1.5 py-1 text-[11px] text-red-600 hover:bg-red-100 disabled:opacity-50"
                              >
                                🗑️
                              </button>
                              <button
                                type="button"
                                title="More details / actions"
                                onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                                className={`rounded border px-1.5 py-1 text-[11px] ${
                                  expandedId === o.id
                                    ? "border-amber-300 bg-amber-100 text-amber-700"
                                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                                }`}
                              >
                                {expandedId === o.id ? "▲" : hasExtraDetail(o) ? "▾•" : "▾"}
                              </button>
                            </div>
                            {deleteError[o.id] && <p className="mt-1 text-[10px] font-medium text-red-600">{deleteError[o.id]}</p>}
                          </td>
                        </tr>
                      )}

                      {expandedId === o.id && editingId !== o.id && (
                        <tr className={rowBg}>
                          <td className={`${CELL} print:hidden`} colSpan={COLUMN_COUNT + 1}>
                            <div className="flex flex-wrap items-start justify-between gap-4 p-2">
                              <div className="min-w-0 flex-1 space-y-1.5">
                                {purchasesByOrder[o.id] ? (
                                  <p className="text-xs text-purple-700">
                                    🛒 Purchased from: {purchasesByOrder[o.id].map((p) => `${p.vendorName} (${p.vendorInvoiceNo})`).join(", ")}
                                  </p>
                                ) : o.vendor_party_id ? (
                                  <p className="text-xs text-amber-700">
                                    🏷️ Planned vendor: {partyName.get(o.vendor_party_id) ?? "—"} (no Purchase Bill yet)
                                  </p>
                                ) : (
                                  <p className="text-xs text-slate-400">No Purchase Bill linked yet.</p>
                                )}
                                {trackingByOrder[o.id] && (trackingByOrder[o.id].awbNo || trackingByOrder[o.id].courierName) && (
                                  <p className="text-xs text-teal-700">
                                    🚚 {trackingByOrder[o.id].courierName || "Courier"}
                                    {trackingByOrder[o.id].awbNo ? ` · AWB ${trackingByOrder[o.id].awbNo}` : ""}
                                    {trackingByOrder[o.id].deliveredDate ? ` · Delivered ${trackingByOrder[o.id].deliveredDate}` : ""}
                                  </p>
                                )}
                                {(refundsByOrder[o.id] ?? []).map((r, i) => (
                                  <p key={i} className="text-xs text-teal-700">
                                    💸 Refund: {r.amount} {r.currency} on {r.date}
                                    {r.hasCreditNote ? " · Credit Note generated" : ""}
                                  </p>
                                ))}

                                {etsyFeesByOrder[o.id] && (
                                  <div>
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

                                {ebayFeesByOrder[o.id] && (
                                  <div>
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

                                {amazonFeesByOrder[o.id] && (
                                  <div>
                                    <button
                                      type="button"
                                      onClick={() => setExpandedAmazonFeesId(expandedAmazonFeesId === o.id ? null : o.id)}
                                      className="text-xs font-medium text-orange-700 underline decoration-dotted hover:text-orange-900"
                                    >
                                      🧾 Amazon fees matched: {amazonFeesByOrder[o.id].lines.length} line
                                      {amazonFeesByOrder[o.id].lines.length === 1 ? "" : "s"} · net fee impact{" "}
                                      {amazonFeesByOrder[o.id].totalsByCurrency
                                        .map((t) => `${t.totalFees.toLocaleString("en-US")} ${t.currency}`)
                                        .join(", ")}
                                      {expandedAmazonFeesId === o.id ? " ▲" : " ▼"}
                                    </button>
                                    {expandedAmazonFeesId === o.id && (
                                      <div className="mt-1.5 overflow-x-auto rounded-lg border border-orange-100 bg-orange-50/50">
                                        <table className="min-w-full text-xs">
                                          <thead>
                                            <tr className="border-b border-orange-100 text-left text-orange-700">
                                              <th className="px-2 py-1 font-medium">Date</th>
                                              <th className="px-2 py-1 font-medium">Type</th>
                                              <th className="px-2 py-1 font-medium">Product Details</th>
                                              <th className="px-2 py-1 font-medium">Currency</th>
                                              <th className="px-2 py-1 text-right font-medium">Amazon Fees</th>
                                              <th className="px-2 py-1 text-right font-medium">Total</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {amazonFeesByOrder[o.id].lines.map((l, i) => (
                                              <tr key={i} className="border-b border-orange-100/60 last:border-0">
                                                <td className="px-2 py-1 text-slate-600">{l.date ?? "—"}</td>
                                                <td className="px-2 py-1 text-slate-600">{l.type ?? "—"}</td>
                                                <td className="px-2 py-1 text-slate-600">{l.productDetails ?? "—"}</td>
                                                <td className="px-2 py-1 text-slate-600">{l.currency}</td>
                                                <td className="px-2 py-1 text-right text-slate-600">{l.amazonFees ? l.amazonFees.toLocaleString("en-US") : "—"}</td>
                                                <td className="px-2 py-1 text-right text-slate-600">{l.totalAmount ? l.totalAmount.toLocaleString("en-US") : "—"}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-2">
                                <OrderHoldCancelActions
                                  order={{
                                    id: o.id,
                                    ref_no: o.ref_no,
                                    status: o.status,
                                    order_currency: o.order_currency,
                                    order_value_original: Number(o.order_value_original || 0),
                                  }}
                                  hasExistingRefund={(refundsByOrder[o.id] ?? []).length > 0}
                                  currencies={currencies}
                                />
                                <CustomerWhatsAppButton
                                  order={{
                                    ref_no: o.ref_no,
                                    status: o.status,
                                    buyer_name_address: o.buyer_name_address,
                                    contact_no: o.contact_no,
                                    item_category_name: categoryName.get(o.item_category_id) ?? "",
                                    size_label: o.size_label,
                                    qty: o.qty,
                                  }}
                                  tracking={trackingByOrder[o.id]}
                                />
                                <Link
                                  href={`/dashboard/orders/${o.id}`}
                                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                                >
                                  Download
                                </Link>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PrintArea>
      )}
    </div>
  );
}

// A plain array return from .map() would work too, but wrapping each
// order's 1-3 <tr> rows in a component keeps the JSX above readable —
// React.Fragment can't take a key via the shorthand <>...</> syntax, so a
// tiny named wrapper is used instead of importing Fragment everywhere.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
