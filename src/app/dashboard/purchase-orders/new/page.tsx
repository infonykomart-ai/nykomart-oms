import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { todayIST } from "@/lib/attendance/ist-date";
import { listOrdersForPoPicker, listSupplierOptions } from "@/lib/purchase-orders/data";
import { PoForm } from "../po-form";

// 2026-11-22c — Phase 3: create a Purchase Order.
//
// The order picker is server-loaded (latest 100 orders in the current
// company, optionally searched) — no client fetch, and no way to link an order
// from a company this employee is not currently working in.
export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const employee = await requireCapability("order_entry");
  const params = await searchParams;

  let orders: Awaited<ReturnType<typeof listOrdersForPoPicker>> = [];
  let suppliers: Awaited<ReturnType<typeof listSupplierOptions>> = [];
  let setupError: string | null = null;

  try {
    [orders, suppliers] = await Promise.all([
      listOrdersForPoPicker([employee.currentCompanyId], params.q),
      listSupplierOptions([employee.currentCompanyId]),
    ]);
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }

  return (
    <div>
      <div className="mb-4">
        <Link href="/dashboard/purchase-orders" className="text-sm text-slate-500 hover:underline">
          ← Back to Purchase Orders
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-800">New Purchase Order</h1>
        <p className="text-sm text-slate-500">Pick the order, add the lines, and the PO number is reserved automatically.</p>
      </div>

      {setupError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Purchase Orders are not available on this database yet.</p>
          <p className="mt-1">
            Run <code className="rounded bg-white px-1 py-0.5 text-xs">db/2026-11-22c-purchase-orders.sql</code> in the
            Supabase SQL editor, then reload this page.
          </p>
          <p className="mt-1 text-xs text-amber-700">{setupError}</p>
        </div>
      ) : (
        <>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2 print:hidden">
            <div className="min-w-[240px] flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="order-search">
                Find an order
              </label>
              <input
                id="order-search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Order ref, marketplace order no. or buyer"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Search
            </button>
            {params.q && (
              <Link href="/dashboard/purchase-orders/new" className="px-2 py-2 text-sm text-slate-500 hover:underline">
                Clear
              </Link>
            )}
          </form>

          {orders.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
              {params.q ? "No order matches that search." : "There are no orders in this company yet."}
            </p>
          ) : (
            <PoForm
              orders={orders}
              suppliers={suppliers}
              today={todayIST()}
              cancelHref="/dashboard/purchase-orders"
            />
          )}
        </>
      )}
    </div>
  );
}
