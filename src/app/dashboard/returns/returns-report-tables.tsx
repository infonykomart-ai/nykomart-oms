"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";
import { PrintArea } from "@/components/print-view";
import { DocStatementDialog } from "@/components/doc-statement-dialog";
import { RefundEntryActions } from "./refund-entry-actions";

// 2026-11-02 — "RETURN REFUND PAGE BHI ISI PARKAR SE BANAO ... SS ORDER PAGE
// KA HAI OR RETURN REFUND VALA PAGE BHI ESA HI BANE, SAB KUCH SAHI SE SAMJH
// ME AAJAYE ... PO LINK NHI HAI, BUYER NAME LINK NHI, ORDER NO LINK NHI HAI,
// JO SHEET TEYAR HORI UNKO FILTER KARNE KA OPTION HI NAHI HAI."
//
// Every table on this page now sits on ONE shared sheet component that copies
// the Orders hub's grid (order-list-table.tsx) exactly, so a refund row is
// found the same way an order row is:
//
//   • amber frozen header + a "Filter…" input (or a dropdown) under EVERY
//     column — per-column filtering, the thing the sheets were missing;
//   • one page-level search box that matches anything on the row;
//   • a Columns picker + the same ExportBar (CSV/Excel/Word/PDF/Email/WA/TG),
//     driven by the same useColumnVisibility() the Orders page uses, so what
//     you hide on screen is also what stays out of the download;
//   • a row count ("N of M rows") and a Clear-filters button when anything
//     is narrowing the sheet;
//   • PO No. / Order No. / Buyer are real links (see ORDER_REFUND_COLUMNS).
//
// Refund RULES are unchanged and still enforced in saveOrderRefundCore
// (src/app/dashboard/orders/actions.ts): a refund can never take the total
// refunded on an order past the order's own value — compared in the order's
// own currency when the refund is in that currency, and after converting the
// order's value into the refund's currency when it isn't (same rate master,
// same dates as every other INR/$ figure in the app, so no discrepancy
// between currencies). The "Value Check" column below shows that rule's
// result for every row.

const CELL = "border border-slate-200 px-2 py-1.5 align-top";
const HEAD_CELL =
  "border border-amber-200 bg-amber-100 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-amber-900 whitespace-nowrap";
const FILTER_CELL = "border border-slate-200 bg-white px-1 py-1 align-top";
const FILTER_INPUT =
  "w-full min-w-[64px] rounded border border-slate-300 px-1 py-0.5 text-[10px] font-normal normal-case text-slate-700 outline-none focus:border-amber-500";

/** ExportColumn + the Orders page's own per-column features (filter kind,
 *  display cell, alignment). `value` is what leaves in a CSV/Excel file;
 *  `cell` (optional) is only what's drawn on screen — that's where links and
 *  badges live, so exports stay plain text. */
type SheetColumn<T> = ExportColumn<T> & {
  filter?: "text" | "select" | "none";
  filterOptions?: string[];
  filterValue?: (row: T) => string;
  cell?: (row: T) => ReactNode;
  headClass?: string;
  tdClass?: string;
};

function columnText<T>(col: SheetColumn<T>, row: T): string {
  const v = col.filterValue ? col.filterValue(row) : col.value(row);
  return v === null || v === undefined ? "" : String(v);
}

function FilterableSheet<T extends { id: string }>({
  areaId,
  title,
  subtitle,
  filenameBase,
  columns,
  rows,
  emptyText,
  searchPlaceholder,
  minWidthClass = "min-w-[1400px]",
  rowAction,
  actionLabel = "Statement",
}: {
  areaId: string;
  title: string;
  subtitle: string;
  filenameBase: string;
  columns: SheetColumn<T>[];
  rows: T[];
  emptyText: string;
  searchPlaceholder: string;
  minWidthClass?: string;
  /** Fixed right-hand column (the 📄 statement button) — outside the
   *  column/export set on purpose, print:hidden, same as the Orders page's
   *  "Actions" column. */
  rowAction?: (row: T) => ReactNode;
  /** Header of the fixed right-hand column ("Statement" by default). */
  actionLabel?: string;
}) {
  // useColumnVisibility() types its result as ExportColumn<T>[] (it is shared
  // with every report in the app), which would erase the extra SheetColumn
  // fields the render below needs — so the hook is used for hidden/toggle and
  // the visible slice is derived here at the richer type instead.
  const { hiddenKeys, toggleColumn } = useColumnVisibility(columns);
  const visibleColumns = useMemo(() => columns.filter((c) => !hiddenKeys.has(c.key)), [columns, hiddenKeys]);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});

  // Dropdown options for `filter: "select"` columns that didn't declare their
  // own list — derived from the rows actually on screen, so a status/store
  // option can never offer a value this sheet doesn't contain.
  const selectOptions = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of columns) {
      if (c.filter !== "select") continue;
      if (c.filterOptions) {
        map.set(c.key, c.filterOptions);
        continue;
      }
      const seen = new Set<string>();
      for (const r of rows) {
        const v = columnText(c, r);
        if (v) seen.add(v);
      }
      map.set(c.key, Array.from(seen).sort((a, b) => a.localeCompare(b)));
    }
    return map;
  }, [columns, rows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (term && !columns.some((c) => columnText(c, r).toLowerCase().includes(term))) return false;
      return columns.every((c) => {
        if (!c.filter || c.filter === "none") return true;
        const val = filters[c.key];
        if (!val) return true;
        const fv = columnText(c, r);
        if (c.filter === "select") return fv === val;
        return fv.toLowerCase().includes(val.toLowerCase());
      });
    });
  }, [rows, columns, search, filters]);

  const activeFilterCount = (search.trim() ? 1 : 0) + Object.values(filters).filter(Boolean).length;
  const clearAll = () => {
    setSearch("");
    setFilters({});
  };
  const actionColCount = rowAction ? 1 : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 print:hidden">
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-72 rounded-lg border border-slate-300 bg-white py-1.5 pl-7 pr-7 text-xs outline-none focus:border-amber-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          )}
        </div>
        <span className="text-xs text-slate-500">
          <strong>{filteredRows.length}</strong> of {rows.length} rows
        </span>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
          >
            ✕ Clear Filters ({activeFilterCount})
          </button>
        )}
        <div className="ml-auto">
          <ExportBar
            title={title}
            filenameBase={filenameBase}
            columns={visibleColumns}
            rows={filteredRows}
            printAreaId={areaId}
            allColumns={columns}
            hiddenKeys={hiddenKeys}
            onToggleColumn={toggleColumn}
          />
        </div>
      </div>

      <PrintArea id={areaId}>
        {/* Same scroll box + frozen <thead> as the Orders page — the column
            headers and, underneath them, every column's own Filter… box stay
            put while you scroll a long sheet. */}
        <div className="oms-scroll max-h-[75vh] overflow-auto rounded-xl border border-slate-200">
          <table className={`w-full ${minWidthClass} border-collapse text-xs`}>
            <thead className="sticky top-0 z-20">
              <tr>
                {visibleColumns.map((c) => (
                  <th key={c.key} className={`${HEAD_CELL} ${c.headClass ?? ""}`}>
                    {c.label}
                  </th>
                ))}
                {rowAction && <th className={HEAD_CELL}>{actionLabel}</th>}
              </tr>
              <tr>
                {visibleColumns.map((c) => (
                  <th key={c.key} className={FILTER_CELL}>
                    {c.filter === "text" && (
                      <input
                        type="text"
                        value={filters[c.key] ?? ""}
                        onChange={(e) => setFilters((prev) => ({ ...prev, [c.key]: e.target.value }))}
                        placeholder="Filter…"
                        className={FILTER_INPUT}
                      />
                    )}
                    {c.filter === "select" && (
                      <select
                        value={filters[c.key] ?? ""}
                        onChange={(e) => setFilters((prev) => ({ ...prev, [c.key]: e.target.value }))}
                        className={FILTER_INPUT}
                      >
                        <option value="">All</option>
                        {(selectOptions.get(c.key) ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    )}
                  </th>
                ))}
                {rowAction && <th className={`${FILTER_CELL} print:hidden`} />}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td className={CELL} colSpan={visibleColumns.length + actionColCount}>
                    <p className="p-3 text-center text-slate-400">
                      {emptyText}
                      {activeFilterCount > 0 && (
                        <>
                          {" "}
                          <button type="button" onClick={clearAll} className="font-medium text-amber-600 underline">
                            Clear the filters →
                          </button>
                        </>
                      )}
                    </p>
                  </td>
                </tr>
              )}
              {filteredRows.map((r) => (
                <tr key={r.id} className="hover:bg-amber-50/50">
                  {visibleColumns.map((c) => {
                    const txt = columnText(c, r);
                    return (
                      <td key={c.key} className={`${CELL} ${c.tdClass ?? ""}`}>
                        {c.cell ? c.cell(r) : txt === "" ? "—" : txt}
                      </td>
                    );
                  })}
                  {rowAction && <td className={`${CELL} text-right print:hidden`}>{rowAction(r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PrintArea>
    </div>
  );
}

// ---------------------------------------------------------------- store rate

export type StoreRateRow = {
  id: string;
  store_name: string;
  total_orders: number;
  cancelled_count: number;
  cancelled_pct: number;
  returned_count: number;
  returned_pct: number;
};

const STORE_RATE_COLUMNS: SheetColumn<StoreRateRow>[] = [
  { key: "store_name", label: "Store Name", filter: "text", value: (r) => r.store_name },
  { key: "total_orders", label: "Total Orders", filter: "text", value: (r) => r.total_orders, tdClass: "text-right" },
  { key: "cancelled_count", label: "Cancelled", filter: "text", value: (r) => r.cancelled_count, tdClass: "text-right" },
  {
    key: "cancelled_pct",
    label: "Cancelled %",
    filter: "text",
    value: (r) => `${r.cancelled_pct.toFixed(1)}%`,
    tdClass: "text-right",
  },
  { key: "returned_count", label: "Returned", filter: "text", value: (r) => r.returned_count, tdClass: "text-right" },
  {
    key: "returned_pct",
    label: "Returned %",
    filter: "text",
    value: (r) => `${r.returned_pct.toFixed(1)}%`,
    tdClass: "text-right",
  },
];

export function StoreRateReportTable({ rows }: { rows: StoreRateRow[] }) {
  return (
    <FilterableSheet
      areaId="store-rate-print-area"
      title="Return / Cancel rate by store"
      subtitle="Counted from each order's own STATUS in the order-date range — not from the refund tables below, which use refund dates. Filter a store in the box under its name."
      filenameBase="store-return-cancel-rate"
      columns={STORE_RATE_COLUMNS}
      rows={rows}
      emptyText="No orders found for this filter."
      searchPlaceholder="Search store…"
      minWidthClass="min-w-[720px]"
    />
  );
}

// ---------------------------------------------------------- OMS refund sheet

export type OrderRefundRow = {
  id: string;
  /** Display sequence, assigned in page.tsx — stays stable while the sheet's
   *  own filters narrow it (so SN in a download matches the row). */
  sn: number;
  order_id: string;
  po_no: string;
  order_no: string | null;
  buyer_name: string | null;
  store_name: string;
  order_status: string | null;
  order_value: number | null;
  order_currency: string | null;
  refund_amount: number;
  refund_currency: string;
  refund_amount_inr: number | null;
  refund_amount_usd: number | null;
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
  // 2026-11-05 — editable refund detail + history (refund edit/delete round).
  order_ref_no: string;
  refund_qty: number | null;
  payment_mode: string | null;
  reference_no: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
  /** "OK" / "OVER" / "N/A" — every refund on this order (in ₹) vs the
   *  order's own value in ₹. Computed in page.tsx from ALL of the order's
   *  refunds, not just the rows visible under the current date filter. */
  value_check: string;
};

function ValueCheckCell({ value }: { value: string }) {
  if (value === "OK") {
    return (
      <span
        className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
        title="Total refunded on this order (₹) is within the order's own value (₹)"
      >
        ✓ OK
      </span>
    );
  }
  if (value === "OVER") {
    return (
      <span
        className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
        title="Total refunded on this order (₹) is MORE than the order's own value (₹) — should not happen; the refund screen blocks this"
      >
        ⚠ OVER
      </span>
    );
  }
  return (
    <span className="text-slate-400" title="Order value not recorded in ₹ — nothing to compare against">
      —
    </span>
  );
}

const ORDER_REFUND_COLUMNS: SheetColumn<OrderRefundRow>[] = [
  { key: "sn", label: "SN No.", filter: "none", value: (r) => r.sn, tdClass: "text-right" },
  { key: "store_name", label: "Store Name", filter: "text", value: (r) => r.store_name },
  {
    key: "po_no",
    label: "PO No.",
    filter: "text",
    value: (r) => r.po_no,
    cell: (r) => (
      <Link
        href={`/dashboard/orders/${r.order_id}`}
        className="font-medium text-amber-700 underline decoration-dotted hover:text-amber-900"
        title="Open this order"
      >
        {r.po_no}
      </Link>
    ),
  },
  {
    key: "order_no",
    label: "Order No.",
    filter: "text",
    value: (r) => r.order_no,
    cell: (r) =>
      r.order_no ? (
        <Link
          href={`/dashboard/orders?q=${encodeURIComponent(r.order_no)}`}
          className="text-blue-700 underline decoration-dotted hover:text-blue-900"
          title="Find this marketplace order on the Orders page"
        >
          {r.order_no}
        </Link>
      ) : (
        "—"
      ),
  },
  {
    key: "buyer_name",
    label: "Buyer",
    filter: "text",
    value: (r) => r.buyer_name,
    cell: (r) =>
      r.buyer_name ? (
        <Link
          href={`/dashboard/orders?q=${encodeURIComponent(r.buyer_name)}`}
          className="block max-w-[200px] truncate text-blue-700 underline decoration-dotted hover:text-blue-900"
          title={`See every order for ${r.buyer_name}`}
        >
          {r.buyer_name}
        </Link>
      ) : (
        "—"
      ),
  },
  { key: "order_status", label: "Order Status", filter: "select", value: (r) => r.order_status },
  { key: "refund_date", label: "Refund Date", filter: "text", value: (r) => r.refund_date },
  {
    key: "refund_amount",
    label: "Refund Amount",
    filter: "text",
    value: (r) => r.refund_amount,
    tdClass: "text-right whitespace-nowrap",
    cell: (r) => r.refund_amount.toFixed(2),
  },
  { key: "refund_currency", label: "Currency", filter: "select", value: (r) => r.refund_currency },
  {
    key: "refund_amount_inr",
    label: "Refund in ₹",
    filter: "none",
    value: (r) => r.refund_amount_inr,
    tdClass: "text-right whitespace-nowrap",
    cell: (r) => (r.refund_amount_inr != null ? r.refund_amount_inr.toFixed(2) : "—"),
  },
  {
    key: "refund_amount_usd",
    label: "Refund in $",
    filter: "none",
    value: (r) => r.refund_amount_usd,
    tdClass: "text-right whitespace-nowrap",
    cell: (r) => (r.refund_amount_usd != null ? r.refund_amount_usd.toFixed(2) : "—"),
  },
  {
    key: "refund_basis_percent",
    label: "Refund %",
    filter: "text",
    value: (r) => (r.refund_basis_percent != null ? `${r.refund_basis_percent}%` : ""),
    tdClass: "text-right",
  },
  {
    key: "order_value",
    label: "Order Value",
    filter: "text",
    value: (r) => (r.order_value != null ? `${r.order_value.toFixed(2)} ${r.order_currency ?? ""}`.trim() : ""),
    tdClass: "text-right whitespace-nowrap",
  },
  {
    key: "value_check",
    label: "Value Check",
    filter: "select",
    value: (r) => r.value_check,
    cell: (r) => <ValueCheckCell value={r.value_check} />,
  },
  {
    key: "order_value_refund_amount",
    label: "Order Value Refund",
    filter: "text",
    value: (r) => r.order_value_refund_amount,
    tdClass: "text-right whitespace-nowrap",
    cell: (r) => (r.order_value_refund_amount ? r.order_value_refund_amount.toFixed(2) : "—"),
  },
  {
    key: "shipping_refund_amount",
    label: "Shipping Refund",
    filter: "text",
    value: (r) => r.shipping_refund_amount,
    tdClass: "text-right whitespace-nowrap",
    cell: (r) => (r.shipping_refund_amount ? r.shipping_refund_amount.toFixed(2) : "—"),
  },
  {
    key: "duty_refund_amount",
    label: "Duty & Tax Refund",
    filter: "text",
    value: (r) => r.duty_refund_amount,
    tdClass: "text-right whitespace-nowrap",
    cell: (r) => (r.duty_refund_amount ? r.duty_refund_amount.toFixed(2) : "—"),
  },
  { key: "category", label: "Category", filter: "select", value: (r) => r.category },
  { key: "reason", label: "Reason", filter: "text", value: (r) => r.reason },
  // 2026-11-05 — the "all previously entered refund details" the owner asked
  // to see and edit: quantity, how it was paid, its transaction reference and
  // free remarks. NULL on rows that predate this round (shown as —).
  {
    key: "refund_qty",
    label: "Qty",
    filter: "text",
    value: (r) => r.refund_qty,
    tdClass: "text-right",
    cell: (r) => (r.refund_qty != null ? r.refund_qty.toFixed(2) : "—"),
  },
  { key: "payment_mode", label: "Payment Mode", filter: "text", value: (r) => r.payment_mode },
  { key: "reference_no", label: "Reference No.", filter: "text", value: (r) => r.reference_no },
  { key: "remarks", label: "Remarks", filter: "text", value: (r) => r.remarks },
  {
    key: "created_at",
    label: "Created",
    filter: "text",
    value: (r) => r.created_at,
    cell: (r) => (r.created_at ? r.created_at.slice(0, 16).replace("T", " ") : "—"),
  },
  {
    key: "updated_at",
    label: "Last Updated",
    filter: "text",
    value: (r) => r.updated_at,
    cell: (r) => (r.updated_at ? r.updated_at.slice(0, 16).replace("T", " ") : "—"),
  },
];

export function OrderRefundsReportTable({ rows, currencies }: { rows: OrderRefundRow[]; currencies: string[] }) {
  return (
    <FilterableSheet
      areaId="order-refunds-print-area"
      title="Refunds recorded in OMS"
      subtitle="One row per refund entered against an order. PO No. opens that order, Order No. / Buyer jump to it on the Orders page. Value Check compares EVERY refund on that order with the order's value in the same currency (₹ only when refunds are in mixed currencies): ✓ OK = within the order's value, ⚠ OVER = more refunded than the order was worth (the refund screen blocks this), — = the order has no recorded value to compare against. Edit updates the same entry (and its credit note) after re-checking the cap; Delete asks for confirmation, then removes the entry, its credit note and the restock it caused, all in one transaction."
      filenameBase="order-refunds-report"
      columns={ORDER_REFUND_COLUMNS}
      rows={rows}
      emptyText="No order refunds match the current search / column filters."
      searchPlaceholder="Search anything — PO, order no, buyer, store, amount…"
      minWidthClass="min-w-[2600px]"
      actionLabel="Statement / Actions"
      rowAction={(r) => (
        <div className="flex items-center justify-end gap-1">
          <DocStatementDialog type="order_refund" id={r.id} />
          <RefundEntryActions
            currencies={currencies}
            refund={{
              id: r.id,
              order_id: r.order_id,
              order_ref_no: r.order_ref_no,
              order_currency: r.order_currency,
              refund_amount: r.refund_amount,
              refund_currency: r.refund_currency,
              refund_date: r.refund_date,
              reason: r.reason,
              refund_qty: r.refund_qty,
              payment_mode: r.payment_mode,
              reference_no: r.reference_no,
              remarks: r.remarks,
              refund_basis_percent: r.refund_basis_percent,
              order_value_refund_amount: r.order_value_refund_amount,
              shipping_refund_amount: r.shipping_refund_amount,
              duty_refund_amount: r.duty_refund_amount,
            }}
          />
        </div>
      )}
    />
  );
}

// ---------------------------------------------------- historical sheet

export type HistoricalRefundRow = {
  id: string;
  sn: number;
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

const HISTORICAL_REFUND_COLUMNS: SheetColumn<HistoricalRefundRow>[] = [
  { key: "sn", label: "SN No.", filter: "none", value: (r) => r.sn, tdClass: "text-right" },
  { key: "source", label: "Source", filter: "select", value: (r) => r.source },
  { key: "store_name", label: "Store Name", filter: "text", value: (r) => r.store_name },
  {
    key: "marketplace_order_no",
    label: "Order No.",
    filter: "text",
    value: (r) => r.marketplace_order_no,
    cell: (r) =>
      r.marketplace_order_no ? (
        <Link
          href={`/dashboard/orders?q=${encodeURIComponent(r.marketplace_order_no)}`}
          className="text-blue-700 underline decoration-dotted hover:text-blue-900"
          title="Find this marketplace order on the Orders page"
        >
          {r.marketplace_order_no}
        </Link>
      ) : (
        "—"
      ),
  },
  {
    key: "buyer_name",
    label: "Buyer",
    filter: "text",
    value: (r) => r.buyer_name,
    cell: (r) =>
      r.buyer_name ? (
        <Link
          href={`/dashboard/orders?q=${encodeURIComponent(r.buyer_name)}`}
          className="block max-w-[200px] truncate text-blue-700 underline decoration-dotted hover:text-blue-900"
          title={`See every order for ${r.buyer_name}`}
        >
          {r.buyer_name}
        </Link>
      ) : (
        "—"
      ),
  },
  {
    key: "order_amt_usd",
    label: "Order $",
    filter: "text",
    value: (r) => r.order_amt_usd,
    tdClass: "text-right whitespace-nowrap",
    cell: (r) => (r.order_amt_usd != null ? r.order_amt_usd.toFixed(2) : "—"),
  },
  {
    key: "refund_amt_usd",
    label: "Refund $",
    filter: "text",
    value: (r) => r.refund_amt_usd,
    tdClass: "text-right whitespace-nowrap",
    cell: (r) => (r.refund_amt_usd != null ? r.refund_amt_usd.toFixed(2) : "—"),
  },
  {
    key: "refund_amt_pct",
    label: "Refund %",
    filter: "text",
    value: (r) => (r.refund_amt_pct != null ? (r.refund_amt_pct * 100).toFixed(1) : ""),
    tdClass: "text-right",
  },
  { key: "refund_type", label: "Type", filter: "select", value: (r) => r.refund_type },
  { key: "refund_date", label: "Refund Date", filter: "text", value: (r) => r.refund_date },
];

export function HistoricalRefundsReportTable({ rows }: { rows: HistoricalRefundRow[] }) {
  return (
    <FilterableSheet
      areaId="historical-refunds-print-area"
      title="Marketplace refund sheets (historical)"
      subtitle="Old Amazon / Etsy refund sheets imported into the system — USD only, exactly as the marketplace reported them. Order No. and Buyer link through to the Orders page."
      filenameBase="historical-refunds-report"
      columns={HISTORICAL_REFUND_COLUMNS}
      rows={rows}
      emptyText="No historical refund rows match the current search / column filters."
      searchPlaceholder="Search anything — order no, buyer, store, type…"
      minWidthClass="min-w-[1400px]"
      rowAction={(r) => <DocStatementDialog type="refund" id={r.id} />}
    />
  );
}
