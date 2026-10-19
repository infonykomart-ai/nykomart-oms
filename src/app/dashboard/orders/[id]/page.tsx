import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OrderView } from "./order-view";
import { loadOrderDetail } from "./order-detail-loader";

// Order detail / view page (2026-08-22) — until now the Orders hub
// (order-list-table.tsx) had no separate read-only page at all: "Edit"
// swaps the row in place for an inline form, there was never a
// /dashboard/orders/[id] to link someone to or to print/save-as-PDF on its
// own. Mirrors src/app/dashboard/invoices/[id]/page.tsx + invoice-view.tsx
// closely (auth -> fetch -> company-scope check -> hand off to a read-only
// view component with PrintArea/PrintButton), just without the editable
// form panel since this page is view-only — editing still happens back on
// the Orders hub's inline form, unchanged.
//
// Deliberately just getAuthedEmployee() (not requireCapability) — any
// signed-in employee who can already see this order's company (via
// employee.companyIds, same scoping every other page here uses) can view
// its detail/print page; there's no separate capability gate on read-only
// order viewing today (Orders hub itself is gated behind "order_entry" for
// the edit/delete panel, but that's a different concern from "can this
// person see one order's read-only detail").
//
// 2026-09-04 — this USED to deliberately leave out multi-package/AWB
// shipment data (that already lives at its own screen,
// /dashboard/order-packages — "Order Shipments & Packages") on the grounds
// that showing it here too would just be two places to keep in sync. A
// non-technical user then flagged they could no longer easily tell, per
// order, its delivered status/tracking/freight/purchased-from vendor/
// Purchase Bill status from this page — so those 5 fields are now shown
// here too, via the SAME shared read path order-packages and the Orders
// list/Report use (getOrderStatusSummaries, see
// src/lib/orders/order-status-summary.ts), which is what keeps this from
// becoming a second, divergent place: there's one function computing these
// 5 facts, just called from 3 pages instead of 1.
//
// 2026-10-19 — the data loading moved to ./order-detail-loader.ts so the
// same view can also be rendered chrome-less inside the Orders hub's A4
// dialog (?embed=1 — see src/proxy.ts and dashboard/layout.tsx) from one
// source of data (see that file's header).
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadOrderDetail(id);
  if (!detail) notFound();
  // ?embed=1 (set by the Orders hub's View dialog iframe) drops the app
  // shell in dashboard/layout.tsx; the view then also drops its own
  // "Back to Orders" link and opens in-app links in a new tab, so the
  // frame can never navigate itself to a full page.
  const embed = (await headers()).get("x-embed") === "1";
  return <OrderView {...detail} embedded={embed} />;
}
