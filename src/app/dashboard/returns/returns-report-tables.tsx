"use client";

import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

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
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #store-rate-print-area, #store-rate-print-area * { visibility: visible; }
          #store-rate-print-area { position: fixed; inset: 0; width: 100%; }
        }
      `}</style>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Return / Cancel Rate by Store</h2>
          <p className="text-xs text-slate-400">Based on order status (order_date filter above) — not the refund tables below, which filter by refund date.</p>
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
      <div id="store-rate-print-area" className="overflow-x-auto">
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
      </div>
    </div>
  );
}

export type OrderRefundRow = {
  id: string;
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
  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(ORDER_REFUND_COLUMNS);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #order-refunds-print-area, #order-refunds-print-area * { visibility: visible; }
          #order-refunds-print-area { position: fixed; inset: 0; width: 100%; }
        }
      `}</style>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Order Refunds (live — company-scoped, most recent 300)</h2>
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
      <div id="order-refunds-print-area" className="overflow-x-auto">
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
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No order refunds found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type HistoricalRefundRow = {
  id: string;
  source: string;
  store_name: string;
  marketplace_order_no: string | null;
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
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #historical-refunds-print-area, #historical-refunds-print-area * { visibility: visible; }
          #historical-refunds-print-area { position: fixed; inset: 0; width: 100%; }
        }
      `}</style>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Historical Marketplace Refunds (company-scoped, most recent 300)</h2>
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
      <div id="historical-refunds-print-area" className="overflow-x-auto">
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
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">
                  No historical refund rows for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
