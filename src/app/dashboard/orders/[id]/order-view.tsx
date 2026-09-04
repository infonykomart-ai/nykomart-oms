import Link from "next/link";
import { PrintArea, PrintButton } from "@/components/print-view";
import type { OrderStatusSummary } from "@/lib/orders/order-status-summary";

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
  status: string;
  shipment_status: string | null;
  marketplace_order_no: string | null;
  buyer_name_address: string | null;
  contact_no: string | null;
  email_id: string | null;
  address_type: string;
  destination_country: string | null;
  sku_label: string | null;
  size_label: string | null;
  qty: number;
  colour: string | null;
  photo_type: string | null;
  photo_url: string | null;
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
}) {
  const rate = Number(order.order_value_original || 0) / (order.qty || 1);

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
          </div>

          <div className="mb-3 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3">
            <div>
              <div className="font-semibold">Buyer / Consignee</div>
              <div className="whitespace-pre-wrap">{order.buyer_name_address || "—"}</div>
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
            ) : (
              <div className="text-slate-500">Not invoiced yet.</div>
            )}
          </div>

          {order.remark && (
            <div className="mb-3">
              <div className="font-semibold">Remark</div>
              <div>{order.remark}</div>
            </div>
          )}

          {order.photo_url && (
            <div className="mb-3">
              <div className="font-semibold">Photo{order.photo_type ? ` (${order.photo_type})` : ""}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={order.photo_url} alt="" className="mt-1 h-32 w-32 rounded-lg border border-slate-200 object-cover" />
            </div>
          )}

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
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/orders" className="text-sm text-slate-500 hover:underline">
          ← Back to Orders
        </Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="order-print-area">
        <OrderPrintSheet
          order={order}
          companyName={companyName}
          companyLogoUrl={companyLogoUrl}
          storeName={storeName}
          itemCategoryName={itemCategoryName}
          hsnCode={hsnCode}
          invoice={invoice}
          vendorName={vendorName}
        />
      </PrintArea>

      {invoice && (
        <div className="mt-4 print:hidden">
          <Link href={`/dashboard/invoices/${invoice.id}`} className="text-sm text-amber-600 underline">
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
          </dl>
        </div>
      )}

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
                <Link href="/dashboard/documents" className="text-amber-600 hover:underline">
                  Debit Note {d.debit_note_no ?? "—"}
                </Link>{" "}
                <span className="text-slate-500">
                  · {d.debit_note_date} · ₹{d.debit_amount.toFixed(2)}
                </span>
              </li>
            ))}
            {creditNotes.map((c) => (
              <li key={c.id}>
                <Link href="/dashboard/documents" className="text-amber-600 hover:underline">
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
