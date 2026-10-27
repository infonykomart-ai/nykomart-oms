import Link from "next/link";
import { PrintArea, PrintButton } from "@/components/print-view";
import type { OrderStatusSummary } from "@/lib/orders/order-status-summary";
import type { VendorAssignmentCycle } from "../vendor-assignment-actions";
import { VendorAssignmentSection } from "./vendor-assignment-section";
import { composeBuyerNameAndAddress } from "@/lib/compose-buyer-address";
import { FlagErrorButton } from "./flag-error-button";
import { ShippingDetailsForm } from "./shipping-details-form";
import { OrderHoldCancelActions } from "../order-hold-cancel-actions";
import { TrackingRefreshButton } from "./tracking-refresh-button";

// Read-only order detail/print view — mirrors invoice-view.tsx's structure
// (header block -> info grids -> item table -> value breakdown -> footer)
// but drops the editable form panel entirely, since this page never edits
// anything (editing an order stays on the Orders hub's inline form). Uses
// the shared PrintArea/PrintButton pair (src/components/print-view.tsx)
// rather than invoice-view.tsx's own hand-rolled print CSS — that
// hand-rolled version predates PrintArea/PrintButton being pulled out into
// a shared component; every printable view built since reuses the shared
// pair instead of re-copying the CSS block again.
export type Order = {
  id: string;
  ref_no: string;
  order_date: string;
  po_date: string | null;
  delivery_date: string | null;
  dispatch_date: string | null;
  estimated_dispatch_date: string | null;
  status: string;
  shipment_status: string | null;
  marketplace_order_no: string | null;
  buyer_name_address: string | null;
  contact_no: string | null;
  email_id: string | null;
  address_type: string;
  destination_country: string | null;
  // 2026-09-08 additions — see
  // db/2026-09-08-order-address-fields-and-vendor-assignments.sql. Country
  // is NOT duplicated here — destination_country above is reused.
  buyer_address1: string | null;
  buyer_address2: string | null;
  buyer_address3: string | null;
  buyer_city: string | null;
  buyer_state: string | null;
  buyer_postal_code: string | null;
  sku_label: string | null;
  size_label: string | null;
  qty: number;
  colour: string | null;
  photo_type: string | null;
  photo_url: string | null;
  // 2026-09-18 — multi-photo links; photo_url stays photo #1. Optional in
  // the type so callers that haven't re-selected their rows yet keep
  // compiling.
  photo_urls?: string[] | null;
  order_currency: string;
  order_value_original: number;
  order_value_usd: number | null;
  order_value_inr: number | null;
  exchange_rate_source: string | null;
  remark: string | null;
  entry_timestamp: string;
};

export type Invoice = {
  id: string;
  invoice_no: string;
  master_invoice_no: string;
  invoice_date: string;
  csb_type: string;
  courier_company: string;
} | null;

export type OrderDebitNote = { id: string; debit_note_no: string | null; debit_note_date: string; debit_amount: number };
export type OrderCreditNote = { id: string; cn_no: string | null; credit_note_date: string; refund_amount: number };
export type OrderRefund = {
  refund_amount: number;
  refund_currency: string;
  refund_date: string;
  reason: string | null;
};

// 2026-10-26 — one row per real AWB/package set (order_shipments +
// order_packages), plus the courier-API tracking state that the nightly
// poller/webhooks write. See order-detail-loader.ts.
export type OrderShipmentView = {
  id: string;
  shipmentNo: number;
  awbNo: string | null;
  /** 2026-10-26 — the forwarder/aggregator's own number for this parcel
   * (Shiprocket shipment id, Shipglobal order number, …), stored beside the
   * carrier's AWB. See db/2026-10-26-order-shipment-forwarding-no.sql. */
  forwardingNo: string | null;
  courierName: string | null;
  deliveredStatus: string | null;
  deliveredDate: string | null;
  lastUpdateDate: string | null;
  weightKg: number | null;
  volumetricWeightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  labelUrl: string | null;
  bookingStatus: string | null;
  bookingCourier: string | null;
};

// Order-level shipment summary (dispatch_invoices mirror + summed package
// figures) — used by both the on-screen Dispatch & Tracking card and the
// printed dispatch sheet.
export type OrderDispatchSummary = {
  awbNo: string | null;
  forwardingNo: string | null;
  courierName: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  weightKg: number | null;
  volumetricWeightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  deliveredStatus: string | null;
  deliveredDate: string | null;
  lastUpdateDate: string | null;
};

// 2026-08-26 — "PO SELECT KA OPTION NAHI HAI KISI PO KA JO EK SE JYADA
// SELECT KAR KE DENA HO TO AGAR PRINT DE TO KESE DENGE 1/2 2/2 TYPE KE":
// pulled the actual printable sheet out of OrderView into its own
// component so /dashboard/orders/print (multi-order print, see that
// route) can stack several of these — one per selected order — inside a
// single PrintArea/window.print() call, each with its own "Page X of Y"
// footer and a page break before the next one. OrderView below still uses
// this for the single-order case, just without pageLabel/pageBreakAfter.
export function OrderPrintSheet({
  order,
  companyName,
  companyLogoUrl,
  storeName,
  itemCategoryName,
  hsnCode,
  invoice,
  vendorName,
  pageLabel,
  pageBreakAfter = false,
  shipment = null,
}: {
  order: Order;
  companyName: string;
  companyLogoUrl: string | null;
  storeName: string;
  itemCategoryName: string;
  hsnCode: string;
  invoice: Invoice;
  vendorName: string | null;
  pageLabel?: string;
  pageBreakAfter?: boolean;
  /** 2026-10-26 — AWB/courier/weight/dims + the dispatch invoice, so the
   * printed sheet and its PDF carry the same shipping facts as the page. */
  shipment?: OrderDispatchSummary | null;
}) {
  const rate = Number(order.order_value_original || 0) / (order.qty || 1);
  const dimsText =
    shipment && shipment.lengthCm != null && shipment.widthCm != null && shipment.heightCm != null
      ? `${shipment.lengthCm} × ${shipment.widthCm} × ${shipment.heightCm} cm`
      : null;
  const hasShipmentBlock = !!shipment && (shipment.awbNo || shipment.courierName || shipment.weightKg != null || dimsText);

  return (
    <div
      className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-xs text-slate-900 print:border-0 print:p-0"
      style={{ fontFamily: "Arial, sans-serif", pageBreakAfter: pageBreakAfter ? "always" : "auto" }}
    >
          <div className="mb-4 flex items-start justify-between border-b-2 border-slate-800 pb-3">
            <div className="flex items-start gap-3">
              {companyLogoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={companyLogoUrl} alt={companyName} className="h-12 w-12 object-contain" />
              )}
              <div>
                <div className="text-lg font-bold">{companyName}</div>
                <div className="text-[11px] text-slate-600">Store: {storeName}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold tracking-wide">ORDER DETAIL</div>
              <div className="mt-1 text-[11px] text-slate-600">{order.ref_no}</div>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3">
            <div>
              <div className="font-semibold">PO/RF/RG No.</div>
              <div>{order.ref_no}</div>
              {order.marketplace_order_no && (
                <div className="mt-1 text-[10px] text-slate-500">Marketplace Order No.: {order.marketplace_order_no}</div>
              )}
            </div>
            <div>
              <div className="font-semibold">Status</div>
              <div>
                {order.status}
                {order.shipment_status && order.shipment_status !== "Order Placed" ? ` · ${order.shipment_status}` : ""}
              </div>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-4 gap-3 border-b border-slate-300 pb-3">
            <div>
              <div className="font-semibold">Order Date</div>
              <div>{order.order_date}</div>
            </div>
            <div>
              <div className="font-semibold">PO Date</div>
              <div>{order.po_date ?? "—"}</div>
            </div>
            <div>
              <div className="font-semibold">Delivery Date</div>
              <div>{order.delivery_date ?? "—"}</div>
            </div>
            <div>
              <div className="font-semibold">Dispatch Date</div>
              <div>{order.dispatch_date ?? "—"}</div>
            </div>
            <div>
              <div className="font-semibold">Estimated Dispatch Date</div>
              <div>{order.estimated_dispatch_date ?? "—"}</div>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3">
            <div>
              <div className="font-semibold">Buyer / Consignee</div>
              {/* 2026-09-08 (follow-up): composed from Buyer Name +
                  Structured Address instead of printing buyer_name_address
                  alone — that field is now name-only for orders entered
                  after this change (see order-form.tsx), so printing it by
                  itself would drop the address off the packing slip.
                  composeBuyerNameAndAddress() falls back to the raw field
                  unchanged for older orders that still hold the full
                  name+address blob there. */}
              <div className="whitespace-pre-wrap">{composeBuyerNameAndAddress(order) || "—"}</div>
              {order.contact_no && <div className="mt-1">Phone: {order.contact_no}</div>}
              {order.email_id && <div>Email: {order.email_id}</div>}
              <div className="mt-1 text-[10px] text-slate-500">{order.address_type}</div>
            </div>
            <div>
              <div className="font-semibold">Destination</div>
              <div>{order.destination_country || "—"}</div>
              {vendorName && (
                <>
                  <div className="mt-2 font-semibold">Purchased From</div>
                  <div>{vendorName}</div>
                </>
              )}
            </div>
          </div>

          <table className="mb-3 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-t border-slate-400 bg-slate-50">
                <th className="border border-slate-300 px-2 py-1 text-left">Item</th>
                <th className="border border-slate-300 px-2 py-1 text-left">HSN</th>
                <th className="border border-slate-300 px-2 py-1 text-left">SKU</th>
                <th className="border border-slate-300 px-2 py-1 text-left">Size</th>
                <th className="border border-slate-300 px-2 py-1 text-left">Colour</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Qty</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Rate ({order.order_currency})</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Amount ({order.order_currency})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-300 px-2 py-1">{itemCategoryName || "—"}</td>
                <td className="border border-slate-300 px-2 py-1">{hsnCode || "—"}</td>
                <td className="border border-slate-300 px-2 py-1">{order.sku_label || "—"}</td>
                <td className="border border-slate-300 px-2 py-1">{order.size_label || "—"}</td>
                <td className="border border-slate-300 px-2 py-1">{order.colour || "—"}</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{order.qty}</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{rate.toFixed(2)}</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{Number(order.order_value_original || 0).toFixed(2)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="border border-slate-300 px-2 py-1 text-right" colSpan={7}>
                  TOTAL
                </td>
                <td className="border border-slate-300 px-2 py-1 text-right">
                  {Number(order.order_value_original || 0).toFixed(2)} {order.order_currency}
                </td>
              </tr>
            </tfoot>
          </table>

          {(order.order_value_usd != null || order.order_value_inr != null) && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[10px] text-slate-600">
              <p className="mb-1 font-semibold text-slate-700">Value Conversion (reference only)</p>
              <p>
                ≈ USD {order.order_value_usd != null ? Number(order.order_value_usd).toFixed(2) : "—"} · ≈ INR{" "}
                {order.order_value_inr != null ? Number(order.order_value_inr).toFixed(2) : "—"}
              </p>
              {order.exchange_rate_source && <p className="mt-1">Rate source: {order.exchange_rate_source}</p>}
            </div>
          )}

          <div className="mb-3 border-b border-slate-300 pb-3">
            <div className="font-semibold">Invoice</div>
            {invoice ? (
              <div>
                {invoice.invoice_no} ({invoice.csb_type}) · {invoice.invoice_date} · Master No.: {invoice.master_invoice_no}
                {invoice.courier_company && ` · ${invoice.courier_company}`}
              </div>
            ) : shipment?.invoiceNo ? (
              // 2026-10-26 — the dispatch/commercial invoice no. + date entered
              // on this page (or by a courier bill) is a real invoice on file
              // even before a sales invoice exists; the sheet used to print
              // "Not invoiced yet" and hide it.
              <div>
                Invoice No.: {shipment.invoiceNo}
                {shipment.invoiceDate ? ` · Invoice Date: ${shipment.invoiceDate}` : ""}
              </div>
            ) : (
              <div className="text-slate-500">Not invoiced yet.</div>
            )}
          </div>

          {hasShipmentBlock && shipment && (
            <div className="mb-3 border-b border-slate-300 pb-3">
              <div className="font-semibold">Shipment &amp; Dispatch</div>
              <div className="mt-1 grid grid-cols-4 gap-2 text-[10px] text-slate-700">
                <div>
                  <div className="font-semibold text-slate-500">AWB No.</div>
                  <div>{shipment.awbNo ?? "—"}</div>
                  {/* 2026-10-26 — aggregator couriers hand out a second,
                      forwarder-side number; printed only when there is one so
                      sheets for single-number couriers stay as they were. */}
                  {shipment.forwardingNo && (
                    <>
                      <div className="font-semibold text-slate-500">Forwarding No.</div>
                      <div>{shipment.forwardingNo}</div>
                    </>
                  )}
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Courier</div>
                  <div>{shipment.courierName ?? "—"}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Weight</div>
                  <div>{shipment.weightKg != null ? `${shipment.weightKg} kg` : "—"}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Dimensions</div>
                  <div>{dimsText ?? "—"}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Volumetric Wt.</div>
                  <div>{shipment.volumetricWeightKg != null ? `${shipment.volumetricWeightKg} kg` : "—"}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Dispatch Date</div>
                  <div>{order.dispatch_date ?? "—"}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Tracking Status</div>
                  <div>
                    {order.shipment_status ?? "—"}
                    {shipment.deliveredStatus ? ` · ${shipment.deliveredStatus}` : ""}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Last Update</div>
                  <div>{shipment.lastUpdateDate ?? "—"}</div>
                </div>
              </div>
            </div>
          )}

          {order.remark && (
            <div className="mb-3">
              <div className="font-semibold">Remark</div>
              <div>{order.remark}</div>
            </div>
          )}

          {/* 2026-09-18 — multi-photo links: render EVERY photo in
              photo_urls (photo #1 = photo_url first, then the extras). Each
              thumbnail links to the full image so a click opens the
              original. Falls back to photo_url alone when the caller
              hasn't re-selected photo_urls yet. */}
          {(() => {
            const allPhotos = Array.from(
              new Set([order.photo_url, ...(order.photo_urls ?? [])].filter((u): u is string => !!u))
            );
            if (allPhotos.length === 0) return null;
            return (
              <div className="mb-3">
                <div className="font-semibold">
                  Photo{order.photo_type ? ` (${order.photo_type})` : ""}
                  {allPhotos.length > 1 ? ` — ${allPhotos.length} photos` : ""}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {allPhotos.map((url, idx) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className="h-32 w-32 rounded-lg border border-slate-200 object-cover"
                      />
                      {/* 2026-09-19 — Main vs Closeup caption, matching the
                          form's Main Photo + 2 Closeup slots layout. */}
                      <span className="mt-0.5 block text-center text-[10px] font-medium text-slate-400">
                        {idx === 0 ? "Main" : `Closeup ${idx}`}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="mt-6 flex items-center justify-between text-[10px] text-slate-500">
            <span>Entered {new Date(order.entry_timestamp).toLocaleString()}</span>
            {pageLabel && <span className="font-medium">{pageLabel}</span>}
          </div>
    </div>
  );
}

// Single-order read-only view — the "View"/"Download" destination linked
// from the Orders hub's Actions column. Wraps one OrderPrintSheet in its
// own PrintArea/PrintButton pair for the ordinary one-order-at-a-time case;
// /dashboard/orders/print (see that route) is the multi-order counterpart
// for "PO select karke ek sath print/download karna hai".
export function OrderView({
  order,
  companyName,
  companyLogoUrl,
  storeName,
  itemCategoryName,
  hsnCode,
  invoice,
  vendorName,
  statusSummary = null,
  debitNotes = [],
  creditNotes = [],
  vendorAssignmentParties = [],
  vendorAssignmentCycles = [],
  shippingDefaults = null,
  shipments = [],
  dispatchSummary = null,
  canManageOrders = false,
  refunds = [],
  currencies = [],
  embedded = false,
}: {
  order: Order;
  companyName: string;
  companyLogoUrl: string | null;
  storeName: string;
  itemCategoryName: string;
  hsnCode: string;
  invoice: Invoice;
  vendorName: string | null;
  // 2026-09-04 — the 5-fields-per-order summary (purchased-from vendor,
  // Purchase Bill entry, delivered status, tracking no., freight/store
  // expense), shared with the Orders list and Orders Report — see
  // src/lib/orders/order-status-summary.ts.
  statusSummary?: OrderStatusSummary | null;
  debitNotes?: OrderDebitNote[];
  creditNotes?: OrderCreditNote[];
  // 2026-09-08 — Vendor Assignment History section (separate from the
  // "Purchasing From (if known)" vendor_party_id select above and from the
  // statusSummary.purchasedFromName shown in the status grid) — see
  // ../vendor-assignment-actions.ts.
  vendorAssignmentParties?: { id: string; name: string }[];
  vendorAssignmentCycles?: VendorAssignmentCycle[];
  // 2026-09-13 (#5+#6) — pre-filled values for the manual shipping-details
  // form (AWB/courier/invoice no+date/weight/dims), resolved server-side
  // from dispatch_invoices' summary (which resyncDispatchSummary keeps
  // true against order_shipments/order_packages). Optional so every other
  // consumer of this view (orders/print) stays unchanged.
  shippingDefaults?: {
    awb_no: string | null;
    forwarding_no: string | null;
    courier_name: string | null;
    invoice_no: string | null;
    invoice_date: string | null;
    weight_kg: number | null;
    length_cm: number | null;
    width_cm: number | null;
    height_cm: number | null;
  } | null;
  /** Every AWB/package on the order with its courier-API tracking state. */
  shipments?: OrderShipmentView[];
  /** Order-level shipping summary (AWB/courier/weight/dims/invoice/dispatch). */
  dispatchSummary?: OrderDispatchSummary | null;
  /** "order_entry" capability — gates the Hold/Cancel/Return/Refund actions
   * (the same gate the Orders hub itself has). */
  canManageOrders?: boolean;
  /** Already-recorded refunds for this order, newest first. */
  refunds?: OrderRefund[];
  currencies?: { code: string; name: string }[];
  /**
   * 2026-10-19 — rendered inside the Orders hub's A4 dialog iframe
   * (/dashboard/orders/[id]?embed=1 — the same page, chrome-less; see
   * src/proxy.ts and dashboard/layout.tsx). Hides the "← Back to Orders" link
   * (which would navigate the frame to the full dashboard) and opens every
   * other in-app link in a new tab instead.
   */
  embedded?: boolean;
}) {
  // In embedded (dialog) mode every in-app link must leave the frame — the
  // frame is only meant to hold THIS order, never a whole page with the
  // app shell around it.
  const inAppLink = embedded ? { target: "_blank", rel: "noreferrer" } : {};
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        {embedded ? (
          <span className="text-xs text-slate-400">Order {order.ref_no}</span>
        ) : (
          <Link href="/dashboard/orders" className="text-sm text-slate-500 hover:underline">
            ← Back to Orders
          </Link>
        )}
        <div className="flex items-center gap-2">
          <FlagErrorButton orderId={order.id} orderRefNo={order.ref_no} />
          <PrintButton label="🖨 Download PDF" />
        </div>
      </div>

      {/* 2026-10-17 — "agar dispatch hone ke baad refund karte hai to kya
          order page se hi refund kiya jayega": the exact same Hold / Cancel /
          Return / Add-Refund controls the Orders hub row already exposes,
          now also on the order's own page — so a post-dispatch goodwill
          refund (status stays Dispatched/Delivered), or a Return & Refund,
          doesn't require going back to the list and finding the row.
          Same component, same server actions, same refund cap / Credit Note
          / restock behavior — nothing is duplicated here. Screen-only
          (print:hidden); gated on order_entry like the hub. */}
      {canManageOrders && (
        <div className="mb-4 flex justify-end print:hidden">
          <OrderHoldCancelActions
            order={{
              id: order.id,
              ref_no: order.ref_no,
              status: order.status,
              order_currency: order.order_currency,
              order_value_original: Number(order.order_value_original || 0),
            }}
            hasExistingRefund={refunds.length > 0}
            currencies={currencies}
          />
        </div>
      )}

      {refunds.length > 0 && (
        <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50/40 p-3 text-xs print:hidden">
          <p className="mb-1.5 font-semibold text-teal-800">Refunds on this order</p>
          <ul className="space-y-1">
            {refunds.map((r, i) => (
              <li key={i} className="text-slate-700">
                💸 {r.refund_amount.toFixed(2)} {r.refund_currency} on {r.refund_date}
                {r.reason ? <span className="text-slate-500"> · {r.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <PrintArea id="order-print-area" companyName={companyName} companyLogoUrl={companyLogoUrl}>
        <OrderPrintSheet
          order={order}
          companyName={companyName}
          companyLogoUrl={companyLogoUrl}
          storeName={storeName}
          itemCategoryName={itemCategoryName}
          hsnCode={hsnCode}
          invoice={invoice}
          vendorName={vendorName}
          shipment={dispatchSummary}
        />
      </PrintArea>

      {invoice && (
        <div className="mt-4 print:hidden">
          <Link href={`/dashboard/invoices/${invoice.id}`} {...inAppLink} className="text-sm text-amber-600 underline">
            View full Invoice →
          </Link>
        </div>
      )}

      {/* 2026-09-04 — "store expense/freight, purchased-from vendor, whether
          a Purchase Bill entry was made, delivered status, tracking no." —
          the 5 fields a non-technical user flagged as missing from this
          page. Screen-only (print:hidden) rather than folded into the
          formal print sheet above — same treatment as the debit/credit
          notes block below, since this is operational status, not part of
          the order document itself. Sourced from the shared statusSummary
          (see src/lib/orders/order-status-summary.ts) — same function the
          Orders list and Orders Report use, so this can never disagree with
          them. */}
      {statusSummary && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs print:hidden">
          <p className="mb-2 font-semibold text-slate-700">Purchase &amp; Shipping Status</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <div>
              <dt className="text-slate-400">Purchased From</dt>
              <dd className="text-slate-700">
                {statusSummary.purchasedFromName
                  ? `${statusSummary.purchasedFromName}${statusSummary.purchasedFromIsPlanned ? " (planned)" : ""}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Purchase Bill Entry</dt>
              <dd className={statusSummary.purchaseBillCount > 0 ? "text-emerald-700" : "text-slate-400"}>
                {statusSummary.purchaseBillCount > 0 ? `✓ ${statusSummary.purchaseBillLabel}` : "No Purchase Bill yet"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Delivered</dt>
              <dd className="text-slate-700">
                {statusSummary.deliveredStatus
                  ? `${statusSummary.deliveredStatus}${statusSummary.deliveredDate ? ` · ${statusSummary.deliveredDate}` : ""}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Tracking</dt>
              <dd className="text-slate-700">
                {statusSummary.trackingNo
                  ? `${statusSummary.trackingNo}${statusSummary.courierName ? ` (${statusSummary.courierName})` : ""}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Freight / Store Expense</dt>
              <dd className="text-slate-700">
                {statusSummary.freightAmt != null
                  ? `${statusSummary.freightAmt.toFixed(2)}${statusSummary.freightCurrency ? ` ${statusSummary.freightCurrency}` : ""}`
                  : "—"}
              </dd>
            </div>
            {/* 2026-10-26 — dispatch + the invoice no./date entered on this
                page now show here too, not only on the entry form. */}
            <div>
              <dt className="text-slate-400">Dispatch</dt>
              <dd className="text-slate-700">
                {order.status === "Dispatched" || order.status === "Delivered"
                  ? `✓ ${order.status}${order.dispatch_date ? ` · ${order.dispatch_date}` : ""}`
                  : "Not dispatched yet"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Shipment / Tracking Status</dt>
              <dd className="text-slate-700">{order.shipment_status || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Invoice No. / Date</dt>
              <dd className="text-slate-700">
                {dispatchSummary?.invoiceNo
                  ? `${dispatchSummary.invoiceNo}${dispatchSummary.invoiceDate ? ` · ${dispatchSummary.invoiceDate}` : ""}`
                  : invoice
                    ? `${invoice.invoice_no} · ${invoice.invoice_date}`
                    : "—"}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* 2026-10-26 — "AWB NO JAB SHIPMENT ME ADD HO GAYA TO DISPATCH DIKHAYE
          OR TRACKING CHECK HOKAR STATUS SHOW HO JAYE": one card with every
          AWB on the order, its package weight/dims, the dispatch state and
          the status the courier tracking API last reported. "Check tracking
          now" runs the same poll as the nightly cron for this order's AWBs
          (see tracking-actions.ts). */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-slate-700">Dispatch &amp; Tracking</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {order.status === "Dispatched" || order.status === "Delivered"
                ? `Dispatched${order.dispatch_date ? ` on ${order.dispatch_date}` : ""}`
                : "No dispatch yet — an AWB saved below marks this order Dispatched automatically."}
              {order.shipment_status ? ` · Shipment status: ${order.shipment_status}` : ""}
            </p>
          </div>
          {canManageOrders && <TrackingRefreshButton orderId={order.id} />}
        </div>

        {dispatchSummary && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-[11px] sm:grid-cols-4">
            <span className="text-slate-400">AWB</span>
            <span className="text-slate-700">{dispatchSummary.awbNo ?? "—"}</span>
            {dispatchSummary.forwardingNo && (
              <>
                <span className="text-slate-400">Forwarding No.</span>
                <span className="text-slate-700">{dispatchSummary.forwardingNo}</span>
              </>
            )}
            <span className="text-slate-400">Courier</span>
            <span className="text-slate-700">{dispatchSummary.courierName ?? "—"}</span>
            <span className="text-slate-400">Weight</span>
            <span className="text-slate-700">{dispatchSummary.weightKg != null ? `${dispatchSummary.weightKg} kg` : "—"}</span>
            <span className="text-slate-400">Volumetric</span>
            <span className="text-slate-700">
              {dispatchSummary.volumetricWeightKg != null ? `${dispatchSummary.volumetricWeightKg} kg` : "—"}
            </span>
            <span className="text-slate-400">Dimensions</span>
            <span className="text-slate-700">
              {dispatchSummary.lengthCm != null && dispatchSummary.widthCm != null && dispatchSummary.heightCm != null
                ? `${dispatchSummary.lengthCm} × ${dispatchSummary.widthCm} × ${dispatchSummary.heightCm} cm`
                : "—"}
            </span>
            <span className="text-slate-400">Invoice No. / Date</span>
            <span className="text-slate-700">
              {dispatchSummary.invoiceNo
                ? `${dispatchSummary.invoiceNo}${dispatchSummary.invoiceDate ? ` · ${dispatchSummary.invoiceDate}` : ""}`
                : "—"}
            </span>
          </div>
        )}

        {shipments.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1 pr-2 font-medium">AWB</th>
                  <th className="py-1 pr-2 font-medium">Forwarding No.</th>
                  <th className="py-1 pr-2 font-medium">Courier</th>
                  <th className="py-1 pr-2 font-medium">Weight</th>
                  <th className="py-1 pr-2 font-medium">Dims (cm)</th>
                  <th className="py-1 pr-2 font-medium">Delivered</th>
                  <th className="py-1 pr-2 font-medium">Last Update</th>
                  <th className="py-1 font-medium">Label</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {shipments.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="py-1 pr-2 font-medium">{s.awbNo ?? "—"}</td>
                    <td className="py-1 pr-2">{s.forwardingNo ?? "—"}</td>
                    <td className="py-1 pr-2">{s.courierName ?? s.bookingCourier ?? "—"}</td>
                    <td className="py-1 pr-2">{s.weightKg != null ? `${s.weightKg} kg` : "—"}</td>
                    <td className="py-1 pr-2">
                      {s.lengthCm != null && s.widthCm != null && s.heightCm != null
                        ? `${s.lengthCm} × ${s.widthCm} × ${s.heightCm}`
                        : "—"}
                    </td>
                    <td className="py-1 pr-2">
                      {s.deliveredStatus
                        ? `${s.deliveredStatus}${s.deliveredDate ? ` · ${s.deliveredDate}` : ""}`
                        : "Not tracked yet"}
                    </td>
                    <td className="py-1 pr-2">{s.lastUpdateDate ?? "—"}</td>
                    <td className="py-1">
                      {s.labelUrl ? (
                        <a
                          href={s.labelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-600 underline"
                        >
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-slate-400">No AWB on this order yet.</p>
        )}
      </div>

      {/* 2026-09-13 (#5+#6) — manual AWB / courier / invoice no+date /
          weight / dims entry, with auto-Dispatch when AWB + invoice no. are
          both present (the user's own rule). Sits directly under the
          status grid so the result is immediately visible there. */}
      {shippingDefaults && (
        <ShippingDetailsForm orderId={order.id} orderStatus={order.status} defaults={shippingDefaults} />
      )}

      {/* 2026-09-08 — Vendor Assignment History: a separate section (per
          explicit user request "ek alag section") from both the plain
          "Purchasing From (if known)" select on the order-edit form and
          the single purchasedFromName fact in the status grid above — this
          is the full multi-cycle assign -> receive -> reassign history. */}
      <VendorAssignmentSection orderId={order.id} parties={vendorAssignmentParties} cycles={vendorAssignmentCycles} />

      {/* 2026-08-27 — "kisi order ke against me bhi agar credit debit note
          bana na pade to vo bhi link ho" — see page.tsx's own comment on
          why this wasn't shown here before. No per-note detail page exists
          yet (Document Entry is entry-only), so this links back to the
          Document Entry hub rather than a dead link — still visible +
          linked, per the request, just not a dedicated note page. */}
      {(debitNotes.length > 0 || creditNotes.length > 0) && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs print:hidden">
          <p className="mb-1.5 font-semibold text-slate-700">Related Debit/Credit Notes</p>
          <ul className="space-y-1">
            {debitNotes.map((d) => (
              <li key={d.id}>
                <Link href="/dashboard/documents" {...inAppLink} className="text-amber-600 hover:underline">
                  Debit Note {d.debit_note_no ?? "—"}
                </Link>{" "}
                <span className="text-slate-500">
                  · {d.debit_note_date} · ₹{d.debit_amount.toFixed(2)}
                </span>
              </li>
            ))}
            {creditNotes.map((c) => (
              <li key={c.id}>
                <Link href="/dashboard/documents" {...inAppLink} className="text-amber-600 hover:underline">
                  Credit Note {c.cn_no ?? "—"}
                </Link>{" "}
                <span className="text-slate-500">
                  · {c.credit_note_date} · ₹{c.refund_amount.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
