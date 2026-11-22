import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { listPurchaseOrders, PO_STATUSES, type PoListItem } from "@/lib/purchase-orders/data";
import { PoTable } from "./po-table";

// 2026-11-22c — Phase 3: Purchase Orders register.
//
// Scoped to the ONE company selected in the top-nav switcher, like Orders and
// Invoices (not every company the login can reach). The module is gated on the
// existing `order_entry` capability: a PO links an order and shows that
// order's close-up photos, so the people who own orders own this list — no new
// capability had to be granted to anybody.
//
// 2026-11-22 — the table + export toolbar moved into po-table.tsx (client).
// ExportBar is a client component and its column definitions are functions,
// so passing them from this server component crashed the page on open; the
// columns now live on the client side with the rows as plain data.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const employee = await requireCapability("order_entry");
  const params = await searchParams;
  const page = Math.max(Number(params.page ?? "1") || 1, 1);

  let rows: PoListItem[] = [];
  let total = 0;
  let setupError: string | null = null;

  try {
    const result = await listPurchaseOrders({
      companyIds: [employee.currentCompanyId],
      q: params.q,
      status: params.status,
      page,
      pageSize: PAGE_SIZE,
    });
    rows = result.rows;
    total = result.total;
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const buildHref = (nextPage: number) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.status) query.set("status", params.status);
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return qs ? `/dashboard/purchase-orders?${qs}` : "/dashboard/purchase-orders";
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Purchase Orders</h1>
          <p className="text-sm text-slate-500">
            The document you send a supplier for one order&apos;s items — one PO per order. Its close-up photos are the
            ones uploaded on that Order page (read live, never copied), so removing a photo there removes it here too.
          </p>
        </div>
        <Link
          href="/dashboard/purchase-orders/new"
          className="rounded-lg bg-amber-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-600"
        >
          + New Purchase Order
        </Link>
      </div>

      {setupError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Purchase Orders are not available on this database yet.</p>
          <p className="mt-1">
            Run <code className="rounded bg-white px-1 py-0.5 text-xs">db/2026-11-22c-purchase-orders.sql</code> in the
            Supabase SQL editor, then reload this page.
          </p>
          <p className="mt-1 text-xs text-amber-700">{setupError}</p>
        </div>
      )}

      <form method="get" className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="po-search">
            Search
          </label>
          <input
            id="po-search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="PO no., order ref or marketplace order no."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="po-status">
            Status
          </label>
          <select
            id="po-status"
            name="status"
            defaultValue={params.status ?? ""}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">All statuses</option>
            {PO_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Apply
        </button>
        {(params.q || params.status) && (
          <Link href="/dashboard/purchase-orders" className="px-2 py-2 text-sm text-slate-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <PoTable rows={rows} hasError={Boolean(setupError)} />

      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {lastPage} — {total} purchase order{total === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={buildHref(page - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
                ← Previous
              </Link>
            )}
            {page < lastPage && (
              <Link href={buildHref(page + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
