"use client";

import Link from "next/link";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";
import { PrintArea } from "@/components/print-view";
import { DocStatementDialog } from "@/components/doc-statement-dialog";

// 2026-08-22 — Returns/Refunds ported onto the Reports hub pattern (see
// src/app/dashboard/reports/orders-report-table.tsx's header comment: "the
// pattern... every future report should reuse"). Two tables (live order
// refunds + historical marketplace refunds) keep their own column list and
// their own <ExportBar />/column picker, same as the Reports page's stance
// on Freight vs Duty being two separate exportable sections rather than
// one forced-together table — the two refund sources have genuinely
// different shapes (see returns/page.tsx's header comment) and merging
// their columns would either lose fields or pad both tables with blanks.

// 2026-08-25 — "kis store par return ka % kitna chal raha, cancel ka kitna
// chal raha" — per-store Return-rate/Cancel-rate, computed in page.tsx from
// a plain orders(store_id, status) query (not from order_refunds — a
// Cancelled/Returned order's STATUS is the source of truth here, whether or
// not a refund row was ever added against it).
export type StoreRateRow = {
  id: string;
  store_name: string;
  total_orders: number;
  cancelled_count: number;
  cancelled_pct: number;
  returned_count: number;
  returned_pct: number;
};

const STORE_RATE_COLUMNS: ExportColumn<StoreRateRow>[] = [
  { key: "store_name", label: "Store", value: (r) => r.store_name },
  { key: "total_orders", label: "Total Orders", value: (r) => r.total_orders },
  { key: "cancelled_count", label: "Cancelled", value: (r) => r.cancelled_count },
  { key: "cancelled_pct", label: "Cancelled %", value: (r) => `${r.cancelled_pct.toFixed(1)}%` },
  { key: "returned_count", label: "Returned", value: (r) => r.returned_count },
  { key: "returned_pct", label: "Returned %", value: (r) => `${r.returned_pct.toFixed(1)}%` },
];

export function StoreRateReportTable({ rows }: { rows: StoreRateRow[] }) {
  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(STORE_RATE_COLUMNS);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Return / Cancel Rate by Store</h2>
          <p className="text-xs text-slate-400">
            Cancelled = order status (order date). Returned = refund rows + orders marked/RTO Returned (refund date). Dono me From/To
            apply hota hai.
          </p>
        </div>
        <ExportBar
          title="Return/Cancel Rate by Store"
          filenameBase="store-return-cancel-rate"
          columns={visibleColumns}
          rows={rows}
          printAreaId="store-rate-print-area"
          allColumns={STORE_RATE_COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>
      <PrintArea id="store-rate-print-area"><div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {visibleColumns.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-700">{String(c.value(r) ?? "")}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No orders found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div></PrintArea>
    </div>
  );
}

export type OrderRefundRow = {
  id: string;
  // 2026-11-02 — "order no se order page link nahi hai": the order this
  // refund sits on, rendered as a link on the PO/RF/RG cell. Exports keep
  // the plain text value (see ORDER_REFUND_COLUMNS below).
  order_id: string | null;
  ref_no: string;
  buyer_name: string | null;
  order_status: string | null;
  refund_amount: number;
  refund_currency: string;
  refund_date: string;
  reason: string | null;
  category: string;
  // 2026-08-25 — optional refund-calculator breakdown (see order-hold-
  // cancel-actions.tsx). Null/0 for rows entered before this or via plain
  // manual amount entry.
  refund_basis_percent: number | null;
  order_value_refund_amount: number | null;
  shipping_refund_amount: number | null;
  duty_refund_amount: number | null;
};

// 2026-11-02 — refund-calculator breakdown columns, hidden by default so
// the live refunds table reads at a glance (see OrderRefundsReportTable).
// Module-level on purpose — see use-column-visibility.ts's hydration note.
const ORDER_REFUND_DEFAULT_HIDDEN = [
  "order_value_refund_amount",
  "shipping_refund_amount",
  "duty_refund_amount",
] as const;

const ORDER_REFUND_COLUMNS: ExportColumn<OrderRefundRow>[] = [
  { key: "ref_no", label: "PO/RF/RG", value: (r) => r.ref_no },
  { key: "buyer_name", label: "Buyer", value: (r) => r.buyer_name },
  { key: "order_status", label: "Order Status", value: (r) => r.order_status },
  { key: "refund_amount", label: "Refund Amount", value: (r) => r.refund_amount },
  { key: "refund_currency", label: "Currency", value: (r) => r.refund_currency },
  { key: "refund_basis_percent", label: "Refund %", value: (r) => (r.refund_basis_percent != null ? `${r.refund_basis_percent}%` : "") },
  { key: "order_value_refund_amount", label: "Order Value Refund", value: (r) => (r.order_value_refund_amount || null) },
  { key: "shipping_refund_amount", label: "Shipping Refund", value: (r) => (r.shipping_refund_amount || null) },
  { key: "duty_refund_amount", label: "Duty & Tax Refund", value: (r) => (r.duty_refund_amount || null) },
  { key: "refund_date", label: "Refund Date", value: (r) => r.refund_date },
  { key: "reason", label: "Reason", value: (r) => r.reason },
  { key: "category", label: "Category", value: (r) => r.category },
];

export function OrderRefundsReportTable({ rows }: { rows: OrderRefundRow[] }) {
  // 2026-11-02 — "return refund vala section thoda tough lag raha": the three
  // refund-calculator breakdown columns (order value / shipping / duty split)
  // are niche detail — hidden on screen by default so the table reads at a
  // glance. One click in the picker brings them back, and exports follow the
  // same picker, so nothing is lost.
  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(ORDER_REFUND_COLUMNS, ORDER_REFUND_DEFAULT_HIDDEN);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">          <div>
            <h2 className="text-sm font-semibold text-slate-800">Refunds recorded in OMS (most recent 300)</h2>
            <p className="text-xs text-slate-400">PO/RF/RG par click karo to order khul jayega. Company + From/To upar se.</p>
          </div>
        <ExportBar
          title="Order Refunds Report"
          filenameBase="order-refunds-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="order-refunds-print-area"
          allColumns={ORDER_REFUND_COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>
      <PrintArea id="order-refunds-print-area"><div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
              ))}
              {/* 2026-09-19 — fixed column, outside the ExportColumn/
                  visibleColumns loop (those render plain strings via
                  String(c.value(r) ?? "")) — opens the read-only "A4 dialog
                  box" statement for this order refund, same pattern as
                  DocList's statementBillId/docStatement buttons. Not part of
                  the export/print column set on purpose: print:hidden. */}
              <th className="px-3 py-2 print:hidden"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {visibleColumns.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {/* Link cell: exports/print still read c.value() as plain text. */}
                    {c.key === "ref_no" && r.order_id ? (
                      <Link href={`/dashboard/orders/${r.order_id}`} className="font-medium text-amber-700 hover:underline">
                        {r.ref_no}
                      </Link>
                    ) : (
                      String(c.value(r) ?? "")
                    )}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right print:hidden">
                  <DocStatementDialog type="order_refund" id={r.id} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="px-3 py-8 text-center text-slate-400">No order refunds found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div></PrintArea>
    </div>
  );
}

export type HistoricalRefundRow = {
  id: string;
  source: string;
  store_name: string;
  marketplace_order_no: string | null;
  // 2026-11-02 — matched OMS order id (page.tsx normalises the number the
  // same way schema.sql's match helpers do); null when no order matches,
  // in which case the cell falls back to plain text.
  order_id: string | null;
  buyer_name: string | null;
  order_amt_usd: number | null;
  refund_amt_usd: number | null;
  refund_amt_pct: number | null;
  refund_type: string | null;
  refund_date: string | null;
};

const HISTORICAL_REFUND_COLUMNS: ExportColumn<HistoricalRefundRow>[] = [
  { key: "source", label: "Source", value: (r) => r.source },
  { key: "store_name", label: "Store", value: (r) => r.store_name },
  { key: "marketplace_order_no", label: "Marketplace Order No.", value: (r) => r.marketplace_order_no },
  { key: "buyer_name", label: "Buyer", value: (r) => r.buyer_name },
  { key: "order_amt_usd", label: "Order $", value: (r) => r.order_amt_usd },
  { key: "refund_amt_usd", label: "Refund $", value: (r) => r.refund_amt_usd },
  { key: "refund_amt_pct", label: "Refund %", value: (r) => (r.refund_amt_pct != null ? (r.refund_amt_pct * 100).toFixed(1) : "") },
  { key: "refund_type", label: "Type", value: (r) => r.refund_type },
  { key: "refund_date", label: "Date", value: (r) => r.refund_date },
];

export function HistoricalRefundsReportTable({ rows }: { rows: HistoricalRefundRow[] }) {
  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(HISTORICAL_REFUND_COLUMNS);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">          <div>
            <h2 className="text-sm font-semibold text-slate-800">Marketplace refunds — old sheets (most recent 300)</h2>
            <p className="text-xs text-slate-400">Ek baar import hue, USD only. Order no par click karo to order khul jayega.</p>
          </div>
        <ExportBar
          title="Historical Marketplace Refunds Report"
          filenameBase="historical-refunds-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="historical-refunds-print-area"
          allColumns={HISTORICAL_REFUND_COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>
      <PrintArea id="historical-refunds-print-area"><div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
              ))}
              {/* 2026-09-19 — same fixed statement-dialog column as
                  OrderRefundsReportTable above, this time opening the
                  "refund" kind (historical marketplace refunds). */}
              <th className="px-3 py-2 print:hidden"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {visibleColumns.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {c.key === "marketplace_order_no" && r.order_id ? (
                      <Link href={`/dashboard/orders/${r.order_id}`} className="font-medium text-amber-700 hover:underline">
                        {r.marketplace_order_no}
                      </Link>
                    ) : (
                      String(c.value(r) ?? "")
                    )}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right print:hidden">
                  <DocStatementDialog type="refund" id={r.id} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="px-3 py-8 text-center text-slate-400">
                  No historical refund rows for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div></PrintArea>
    </div>
  );
}
