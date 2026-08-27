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

// Persisted in the browser (per-device, not synced) so "which columns are
// hidden" survives a reload — same spirit as an Excel workbook remembering
// which columns you last hid.
const COLUMN_VISIBILITY_KEY = "oms-orders-table-hidden-columns-v1";

// Every <td>/<th> in the grid shares this so the gridlines read as one
// consistent "excel jaisa" sheet instead of a patchwork of borders.
const CELL = "border border-slate-200 px-2 py-1.5 align-top";
const HEAD_CELL =
  "border border-amber-200 bg-amber-100 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-amber-900 whitespace-nowrap";
const FILTER_CELL = "border border-slate-200 bg-white px-1 py-1 align-top";
const FILTER_INPUT =
  "w-full min-w-[64px] rounded border border-slate-300 px-1 py-0.5 text-[10px] font-normal normal-case text-slate-700 outline-none focus:border-amber-500";

type ColumnDef = {
  key: string;
  label: string;
  headClass?: string;
  tdClass?: string;
  filter: "text" | "select" | "none";
  filterOptions?: string[];
  filterValue: (o: OrderRow) => string;
  cell: (o: OrderRow, idx: number) => React.ReactNode;
  cellTitle?: (o: OrderRow) => string;
};

// 2026-08-26 — "isme jo ye order hai jo formate deraha hu us formate me
// dikhe to ache lage na excel jese": redone from a stack of cards into a
// real, dense <table> whose columns mirror the spreadsheet layout the user
// shared (Sn No / Store Name / Remark / Order Date / PO No / PO Date /
// Delivery Date / Order No / Status / Dispatch Date / Photo / SKU / Sizes /
// Qty / Item / Vendor / Buyer Name & Address / Contact No / Email ID /
// VAT-IOSS & Tax ID / Order Value / Address Type / Late Order). Inline edit,
// delete, Hold/Cancel/Refund, WhatsApp notify, tracking, refund history and
// the Etsy/eBay/Amazon fee-match detail all still work — tucked behind a
// per-row expand toggle so the main grid stays one line per order.
//
// 2026-08-26 (same day, round 2) — "ISKO FREEZ KARO OR JO RED MARK KIYA HAI
// SABHI ME FILTER KA OPTION DO OR EK FILTER SECTION BANAO JISME SABHI COLOM
// HO LEKIN AGAR USKO HIDE RAKHNA HO TO VO HIDE RAHE": (1) the header is now
// frozen — the table sits in its own scrollable box (`max-h-[75vh]`) with a
// `sticky top-0` <thead>, so the column headers stay visible while scrolling
// through up to 300 rows, exactly like Excel's "Freeze Panes". (2) every
// column got its own filter box in a second header row (a text box for most
// columns, a dropdown for Status/Item/Late Order) — these filter the rows
// client-side, on top of whatever the page-level search/date/status form
// above already narrowed down. (3) a "Columns" panel (checkboxes, one per
// column) lets any column be hidden — chosen columns stay hidden across
// reloads (saved to this browser's localStorage), matching "agar usko hide
// rakhna ho to vo hide rahe".
//
// Three of the reference columns don't have a matching field anywhere in
// this app's schema — "Vendor Date", "Recv. Date" and "Estimated Dispatch
// Date" were left out rather than invented. If these should actually track
// something real (e.g. the date a Purchase Bill was raised, or a separate
// ETA distinct from Dispatch Date), that needs its own field added to
// `orders` first.
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
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [globalSearch, setGlobalSearch] = useState("");
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(COLUMN_VISIBILITY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? new Set(arr) : new Set();
    } catch {
      return new Set();
    }
  });
  const categoryName = new Map(itemCategories.map((c) => [c.id, c.name]));
  const partyName = new Map(parties.map((p) => [p.id, p.name]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const categoryOptions = Array.from(new Set(itemCategories.map((c) => c.name))).sort();

  function persistHidden(next: Set<string>) {
    setHiddenKeys(next);
    try {
      window.localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // localStorage can throw in private-browsing/blocked-storage contexts —
      // the panel still works for this page view, it just won't persist.
    }
  }
  function toggleColumn(key: string) {
    const next = new Set(hiddenKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persistHidden(next);
  }

  function vendorText(o: OrderRow): string {
    if (purchasesByOrder[o.id]) return purchasesByOrder[o.id].map((p) => p.vendorName).join(", ");
    if (o.vendor_party_id) return `${partyName.get(o.vendor_party_id) ?? "—"} (planned)`;
    return "";
  }

  function vatIossTax(o: OrderRow): string {
    const parts = [
      o.tax_id ? `Tax ${o.tax_id}` : "",
      o.vat_number ? `VAT ${o.vat_number}` : "",
      o.ioss_number ? `IOSS ${o.ioss_number}` : "",
      o.eori_number ? `EORI ${o.eori_number}` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "";
  }

  function isLate(o: OrderRow): boolean {
    return !!o.dispatch_date && o.dispatch_date < todayStr && !NON_LATE_STATUSES.includes(o.status);
  }

  // Column definitions drive the header row, the per-column filter row, the
  // Columns show/hide panel, and every data cell — one source of truth so
  // "add/hide/filter a column" never needs touching 3 different places.
  const ALL_COLUMNS: ColumnDef[] = [
    {
      key: "sn",
      label: "Sn No.",
      filter: "none",
      tdClass: "text-slate-400",
      filterValue: () => "",
      cell: (_o, idx) => idx + 1,
    },
    {
      key: "store",
      label: "Store Name",
      filter: "text",
      tdClass: "whitespace-nowrap font-medium text-slate-700",
      filterValue: (o) => companyName.get(o.company_id) ?? "",
      cell: (o) => companyName.get(o.company_id) ?? "—",
    },
    {
      key: "remark",
      label: "Remark",
      filter: "text",
      tdClass: "max-w-[160px] truncate",
      filterValue: (o) => o.remark ?? "",
      cellTitle: (o) => o.remark ?? "",
      cell: (o) => o.remark || "—",
    },
    {
      key: "orderDate",
      label: "Order Date",
      filter: "text",
      tdClass: "whitespace-nowrap",
      filterValue: (o) => o.order_date ?? "",
      cell: (o) => o.order_date,
    },
    {
      key: "poNo",
      label: "PO No.",
      filter: "text",
      tdClass: "whitespace-nowrap font-semibold text-slate-900",
      filterValue: (o) => o.ref_no ?? "",
      cell: (o) => o.ref_no,
    },
    {
      key: "poDate",
      label: "PO Date",
      filter: "text",
      tdClass: "whitespace-nowrap",
      filterValue: (o) => o.po_date ?? "",
      cell: (o) => o.po_date || "—",
    },
    {
      key: "deliveryDate",
      label: "Delivery Date",
      filter: "text",
      tdClass: "whitespace-nowrap",
      filterValue: (o) => o.delivery_date ?? "",
      cell: (o) => o.delivery_date || "—",
    },
    {
      key: "orderNo",
      label: "Order No.",
      filter: "text",
      tdClass: "whitespace-nowrap",
      filterValue: (o) => o.marketplace_order_no ?? "",
      cell: (o) => o.marketplace_order_no || "—",
    },
    {
      key: "status",
      label: "Status",
      headClass: "bg-sky-100 text-sky-900",
      filter: "select",
      filterOptions: statuses,
      filterValue: (o) => o.status,
      cell: (o) => (
        <div className="flex flex-col items-start gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(o.status)}`}>{o.status}</span>
          {o.whatsapp_sent_at && (
            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">✓ WA sent</span>
          )}
          {o.invoice_id && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Invoiced</span>}
          {o.shipment_status && o.shipment_status !== "Order Placed" && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${shipmentBadgeClass(o.shipment_status)}`}>
              🚚 {o.shipment_status}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "dispatchDate",
      label: "Dispatch Date",
      filter: "text",
      tdClass: "whitespace-nowrap",
      filterValue: (o) => o.dispatch_date ?? "",
      cell: (o) => o.dispatch_date || "—",
    },
    {
      key: "photo",
      label: "Photo",
      filter: "none",
      tdClass: "print:hidden",
      filterValue: () => "",
      cell: (o) => <OrderPhotoThumb photoUrl={o.photo_url} className="h-10 w-10" />,
    },
    {
      key: "sku",
      label: "SKU",
      filter: "text",
      tdClass: "whitespace-nowrap",
      filterValue: (o) => o.sku_label ?? "",
      cell: (o) => o.sku_label || "—",
    },
    {
      key: "sizes",
      label: "Sizes",
      filter: "text",
      tdClass: "whitespace-nowrap",
      filterValue: (o) => o.size_label ?? "",
      cell: (o) => o.size_label || "—",
    },
    {
      key: "qty",
      label: "Qty",
      filter: "text",
      tdClass: "text-right",
      filterValue: (o) => String(o.qty),
      cell: (o) => o.qty,
    },
    {
      key: "item",
      label: "Item",
      filter: "select",
      filterOptions: categoryOptions,
      tdClass: "whitespace-nowrap",
      filterValue: (o) => categoryName.get(o.item_category_id) ?? "",
      cell: (o) => categoryName.get(o.item_category_id) ?? "—",
    },
    {
      key: "vendor",
      label: "Vendor",
      filter: "text",
      tdClass: "max-w-[160px] truncate",
      filterValue: vendorText,
      cell: (o) => vendorText(o) || "—",
    },
    {
      key: "buyer",
      label: "Buyer Name & Address",
      filter: "text",
      tdClass: "max-w-[200px] truncate",
      filterValue: (o) => o.buyer_name_address ?? "",
      cellTitle: (o) => o.buyer_name_address ?? "",
      cell: (o) => o.buyer_name_address || "—",
    },
    {
      key: "contact",
      label: "Contact No.",
      filter: "text",
      tdClass: "whitespace-nowrap",
      filterValue: (o) => o.contact_no ?? "",
      cell: (o) => o.contact_no || "—",
    },
    {
      key: "email",
      label: "Email ID",
      filter: "text",
      tdClass: "max-w-[160px] truncate",
      filterValue: (o) => o.email_id ?? "",
      cell: (o) => o.email_id || "—",
    },
    {
      key: "vatTax",
      label: "VAT/IOSS & Tax ID",
      filter: "text",
      tdClass: "max-w-[160px] truncate",
      filterValue: vatIossTax,
      cellTitle: (o) => vatIossTax(o) || "—",
      cell: (o) => vatIossTax(o) || "—",
    },
    {
      key: "orderValue",
      label: "Order Value",
      filter: "text",
      tdClass: "whitespace-nowrap text-right",
      filterValue: (o) => `${o.order_value_original} ${o.order_currency}`,
      cell: (o) => `${o.order_value_original} ${o.order_currency}`,
    },
    {
      key: "addressType",
      label: "Address Type",
      filter: "text",
      tdClass: "whitespace-nowrap",
      filterValue: (o) => o.address_type ?? "",
      cell: (o) => o.address_type || "—",
    },
    {
      key: "lateOrder",
      label: "Late Order",
      headClass: "bg-red-100 text-red-900",
      filter: "select",
      filterOptions: ["Late", "Not Late"],
      filterValue: (o) => (isLate(o) ? "Late" : "Not Late"),
      cell: (o) =>
        isLate(o) ? (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">⚠️ Late</span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
  ];

  const visibleColumns = ALL_COLUMNS.filter((c) => !hiddenKeys.has(c.key));
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (globalSearch.trim() ? 1 : 0);

  function clearFilters() {
    setFilters({});
    setGlobalSearch("");
  }

  // 2026-08-26 — "SEARCH BAAR BHI JISME ORDER SE RELATED KUCH BHI SUCH KARO
  // US SE RELATED DATA NIKAL KE AAJAYE": one search box that matches ANY
  // column's value (buyer, PO no, SKU, vendor, email, remark, whatever) —
  // reuses every column's own filterValue() so this never drifts out of
  // sync with what the column filters below already know how to read off
  // an order. Column filters still narrow further on top of this.
  const matchesGlobalSearch = (o: OrderRow): boolean => {
    const term = globalSearch.trim().toLowerCase();
    if (!term) return true;
    return ALL_COLUMNS.some((c) => c.filter !== "none" && c.filterValue(o).toLowerCase().includes(term));
  };

  const filteredOrders = orders.filter(
    (o) =>
      matchesGlobalSearch(o) &&
      ALL_COLUMNS.every((c) => {
        if (c.filter === "none") return true;
        const val = filters[c.key];
        if (!val) return true;
        const fv = c.filterValue(o);
        if (c.filter === "select") return fv === val;
        return fv.toLowerCase().includes(val.toLowerCase());
      })
  );

  // 2026-08-26 — "PO SELECT KA OPTION NAHI HAI ... EK SE JYADA SELECT KAR KE
  // DENA HO TO AGAR PRINT DE": a checkbox per row + "select all" in the
  // header, feeding a "Print Selected" link to /dashboard/orders/print —
  // that route stacks every selected order's print sheet with "Page X of Y"
  // footers and page breaks between them (see order-view.tsx's
  // OrderPrintSheet and that route's own comment).
  const allFilteredSelected = filteredOrders.length > 0 && filteredOrders.every((o) => selectedIds.has(o.id));
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filteredOrders.forEach((o) => next.delete(o.id));
        return next;
      }
      const next = new Set(prev);
      filteredOrders.forEach((o) => next.add(o.id));
      return next;
    });
  }
  const printSelectedHref = `/dashboard/orders/print?ids=${Array.from(selectedIds).join(",")}`;

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
  const exportRows: ExportRow[] = filteredOrders.map((o) => ({
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-slate-500">
          {filteredOrders.length === orders.length
            ? `${orders.length} order${orders.length === 1 ? "" : "s"}`
            : `${filteredOrders.length} of ${orders.length} orders (filtered)`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔍</span>
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search anything — buyer, PO no, SKU, vendor, email…"
              className="w-72 rounded-lg border border-slate-300 bg-white py-1.5 pl-7 pr-7 text-xs outline-none focus:border-amber-500"
            />
            {globalSearch && (
              <button
                type="button"
                onClick={() => setGlobalSearch("")}
                title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowColumnPanel((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              showColumnPanel ? "border-amber-300 bg-amber-100 text-amber-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            🧱 Columns{hiddenKeys.size ? ` (${hiddenKeys.size} hidden)` : ""}
          </button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
            >
              ✕ Clear Filters ({activeFilterCount})
            </button>
          )}
          {selectedIds.size > 0 && (
            <>
              <Link
                href={printSelectedHref}
                target="_blank"
                className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
              >
                🖨 Print Selected ({selectedIds.size})
              </Link>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-[11px] text-slate-400 underline"
              >
                clear selection
              </button>
            </>
          )}
          <ExportBar title="Orders" filenameBase="orders" columns={EXPORT_COLUMNS} rows={exportRows} printAreaId="orders-print-area" />
        </div>
      </div>

      {showColumnPanel && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3 print:hidden">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600">Show / hide columns — hidden columns stay hidden next time too</p>
            <button type="button" onClick={() => persistHidden(new Set())} className="text-[11px] font-medium text-amber-700 underline">
              Show all
            </button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ALL_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!hiddenKeys.has(c.key)}
                  onChange={() => toggleColumn(c.key)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {orders.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No orders found.</p>
      ) : (
        <PrintArea id="orders-print-area">
          {/* max-h + overflow-auto turns this into its own scroll box so the
              sticky <thead> below acts as a frozen header row/pane, like
              Excel's Freeze Panes — "ISKO FREEZ KARO". */}
          <div className="oms-scroll max-h-[75vh] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[2200px] border-collapse text-xs">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className={`${HEAD_CELL} print:hidden`} title="Select for Print Selected">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                      className="h-3.5 w-3.5 rounded border-slate-400"
                    />
                  </th>
                  {visibleColumns.map((c) => (
                    <th key={c.key} className={`${HEAD_CELL} ${c.headClass ?? ""}`}>
                      {c.label}
                    </th>
                  ))}
                  <th className={`${HEAD_CELL} print:hidden`}>Actions</th>
                </tr>
                <tr>
                  <th className={`${FILTER_CELL} print:hidden`} />
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
                          {(c.filterOptions ?? []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      )}
                    </th>
                  ))}
                  <th className={`${FILTER_CELL} print:hidden`} />
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 && (
                  <tr>
                    <td className={CELL} colSpan={visibleColumns.length + 2}>
                      <p className="p-2 text-center text-slate-400">No orders match the current search / column filters.</p>
                    </td>
                  </tr>
                )}
                {filteredOrders.map((o, idx) => {
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
                          <td className={CELL} colSpan={visibleColumns.length + 2}>
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
                          <td className={`${CELL} print:hidden`}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(o.id)}
                              onChange={() => toggleSelected(o.id)}
                              className="h-3.5 w-3.5 rounded border-slate-400"
                            />
                          </td>
                          {visibleColumns.map((c) => (
                            <td
                              key={c.key}
                              className={`${CELL} ${c.tdClass ?? ""}`}
                              title={c.cellTitle ? c.cellTitle(o) : undefined}
                            >
                              {c.cell(o, idx)}
                            </td>
                          ))}
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
                          <td className={`${CELL} print:hidden`} colSpan={visibleColumns.length + 2}>
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
