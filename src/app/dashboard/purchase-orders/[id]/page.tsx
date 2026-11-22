import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { todayIST } from "@/lib/attendance/ist-date";
import { getPurchaseOrder, listSupplierOptions, type PoLinkedOrder } from "@/lib/purchase-orders/data";
import { PoForm } from "../po-form";
import { PoActions } from "./po-actions";

// 2026-11-22c — Phase 3: one Purchase Order.
//
// The close-up photo gallery at the bottom is READ-THROUGH: it comes from
// getOrderCloseupPhotos() over the linked order, so a photo deleted on the
// Order page disappears here too (single source of truth, no snapshot).
export const dynamic = "force-dynamic";

function statusClass(status: string): string {
  switch (status) {
    case "Received":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Sent":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "Cancelled":
      return "bg-slate-100 text-slate-500 border-slate-200";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireCapability("order_entry");
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof getPurchaseOrder>> = null;
  let setupError: string | null = null;
  try {
    detail = await getPurchaseOrder(id, employee.companyIds);
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }

  if (!detail && !setupError) notFound();

  if (!detail) {
    return (
      <div>
        <Link href="/dashboard/purchase-orders" className="text-sm text-slate-500 hover:underline">
          ← Back to Purchase Orders
        </Link>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Purchase Orders are not available on this database yet.</p>
          <p className="mt-1">
            Run <code className="rounded bg-white px-1 py-0.5 text-xs">db/2026-11-22c-purchase-orders.sql</code> in the
            Supabase SQL editor, then reload this page.
          </p>
          <p className="mt-1 text-xs text-amber-700">{setupError}</p>
        </div>
      </div>
    );
  }

  const { po, items, order, supplierName, photos } = detail;
  const linesTotal = items.reduce((sum, item) => sum + item.qty * item.unit_cost, 0);

  // The edit form must not be able to re-point the PO at a different order,
  // so the picker carries only the order it is already linked to.
  const editOrders: PoLinkedOrder[] = order
    ? [
        {
          id: order.id,
          ref_no: order.ref_no,
          order_date: order.order_date,
          buyer_name_address: order.buyer_name_address,
          sku_label: order.sku_label,
          size_label: order.size_label,
          qty: order.qty,
          order_currency: po.currency,
          status: order.status,
          closeupCount: photos.length,
        },
      ]
    : [];
  const suppliers = await listSupplierOptions([employee.currentCompanyId]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/purchase-orders" className="text-sm text-slate-500 hover:underline">
            ← Back to Purchase Orders
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-800">{po.po_no}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(po.status)}`}>{po.status}</span>
            <span>PO date {po.po_date}</span>
            {po.expected_date && <span>Expected {po.expected_date}</span>}
            {supplierName && <span>Supplier: {supplierName}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <a
            href={`/api/purchase-orders/${po.id}/pdf`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ⬇ Download PDF
          </a>
          <Link
            href={`/dashboard/purchase-orders/print?ids=${po.id}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            🖨 Print
          </Link>
          <PoActions poId={po.id} status={po.status} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Linked order</h2>
          {order ? (
            <dl className="space-y-1 text-sm text-slate-600">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Reference</dt>
                <dd>
                  <Link href={`/dashboard/orders/${order.id}`} className="font-medium text-slate-800 hover:underline">
                    {order.ref_no}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Order status</dt>
                <dd>{order.status}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Buyer</dt>
                <dd className="max-w-[60%] truncate text-right">{order.buyer_name_address ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">SKU / Size</dt>
                <dd className="text-right">
                  {order.sku_label || "—"} / {order.size_label || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Order qty</dt>
                <dd>{order.qty}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-400">
              The linked order no longer exists, so this PO has no close-up photos to show.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Line items</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 pr-2">SKU / item</th>
                  <th className="py-1 pr-2 text-right">Qty</th>
                  <th className="py-1 pr-2 text-right">Unit cost</th>
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-2 text-slate-700">{item.sku_label || "—"}</td>
                    <td className="py-2 pr-2 text-right text-slate-600">{item.qty}</td>
                    <td className="py-2 pr-2 text-right text-slate-600">{item.unit_cost.toFixed(2)}</td>
                    <td className="py-2 text-right text-slate-700">{(item.qty * item.unit_cost).toFixed(2)}</td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      No lines on this purchase order.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td colSpan={3} className="py-2 text-right text-xs uppercase tracking-wide text-slate-400">
                    Total
                  </td>
                  <td className="py-2 text-right font-semibold text-slate-800">
                    {po.currency ? `${po.currency} ` : ""}
                    {linesTotal.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Close-up photos from the order</h2>
          <span className="text-xs text-slate-400">
            {photos.length} photo{photos.length === 1 ? "" : "s"} — managed on the Order page only
          </span>
        </div>
        {photos.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {photos.map((photo) => (
              <a
                key={photo.id}
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                className="group block overflow-hidden rounded-lg border border-slate-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.fileName ?? "Close-up photo"}
                  loading="lazy"
                  className="h-32 w-full object-cover transition group-hover:opacity-90"
                />
              </a>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">
            This order has no close-up photos. Add them on the Order page (Upload Photo or Link Photo) and they will
            appear here automatically.
          </p>
        )}
      </div>

      {editOrders.length > 0 && (
        <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Edit header &amp; lines</summary>
          <div className="mt-4">
            <PoForm
              orders={editOrders}
              suppliers={suppliers}
              today={todayIST()}
              cancelHref={`/dashboard/purchase-orders/${po.id}`}
              initial={{
                id: po.id,
                order_id: po.order_id,
                supplier_party_id: po.supplier_party_id,
                po_date: po.po_date,
                expected_date: po.expected_date,
                currency: po.currency,
                total_amount: po.total_amount,
                items: items.map((item) => ({
                  sku_label: item.sku_label,
                  qty: item.qty,
                  unit_cost: item.unit_cost,
                })),
              }}
            />
          </div>
        </details>
      )}
    </div>
  );
}
