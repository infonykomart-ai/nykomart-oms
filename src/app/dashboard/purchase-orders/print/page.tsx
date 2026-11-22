import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { getPurchaseOrder } from "@/lib/purchase-orders/data";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-11-22c — Phase 3: Purchase Order print sheet (?ids=id1,id2).
//
// One A4 page per PO, page X of Y, and the close-up photo block rendered from
// the linked order's LIVE photo list (getOrderCloseupPhotos via
// getPurchaseOrder) — the same read path the detail page uses, never a copy.
export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const employee = await requireCapability("order_entry");
  const params = await searchParams;
  const requestedIds = (params.ids ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!requestedIds.length) notFound();

  const loaded = await Promise.all(requestedIds.map((id) => getPurchaseOrder(id, employee.companyIds)));
  const details = loaded.filter((detail): detail is NonNullable<typeof detail> => !!detail);
  if (!details.length) notFound();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/purchase-orders" className="text-sm text-slate-500 hover:underline">
          ← Back to Purchase Orders
        </Link>
        <div className="text-right">
          <PrintButton
            label={`🖨 Download PDF (${details.length} purchase order${details.length === 1 ? "" : "s"})`}
          />
          {details.length < requestedIds.length && (
            <p className="mt-1 text-xs text-amber-600">
              {requestedIds.length - details.length} selected purchase order(s) could not be shown.
            </p>
          )}
        </div>
      </div>

      <PrintArea id="purchase-orders-print-area">
        <div className="space-y-6 print:space-y-0">
          {details.map((detail, index) => {
            const { po, items, order, supplierName, companyName, photos } = detail;
            const total = items.reduce((sum, item) => sum + item.qty * item.unit_cost, 0);
            return (
              <article
                key={po.id}
                className="rounded-xl border border-slate-300 bg-white p-6 text-slate-800 print:rounded-none print:border-0 print:p-0"
                style={{ pageBreakAfter: index < details.length - 1 ? "always" : "auto" }}
              >
                <header className="flex items-start justify-between border-b border-slate-300 pb-3">
                  <div>
                    <p className="text-lg font-bold">{companyName || "NYKO MART"}</p>
                    <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Purchase Order</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-bold">{po.po_no}</p>
                    <p>Date: {po.po_date}</p>
                    {po.expected_date && <p>Expected: {po.expected_date}</p>}
                    <p>Status: {po.status}</p>
                  </div>
                </header>

                <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supplier</p>
                    <p>{supplierName ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linked order</p>
                    <p>{order ? order.ref_no : "—"}</p>
                    {order?.buyer_name_address && <p className="text-slate-600">{order.buyer_name_address}</p>}
                  </div>
                </div>

                <table className="mt-4 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-1.5 pr-2">#</th>
                      <th className="py-1.5 pr-2">SKU / item</th>
                      <th className="py-1.5 pr-2 text-right">Qty</th>
                      <th className="py-1.5 pr-2 text-right">Unit cost</th>
                      <th className="py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, lineIndex) => (
                      <tr key={item.id} className="border-b border-slate-200">
                        <td className="py-1.5 pr-2">{lineIndex + 1}</td>
                        <td className="py-1.5 pr-2">{item.sku_label || "—"}</td>
                        <td className="py-1.5 pr-2 text-right">{item.qty}</td>
                        <td className="py-1.5 pr-2 text-right">{item.unit_cost.toFixed(2)}</td>
                        <td className="py-1.5 text-right">{(item.qty * item.unit_cost).toFixed(2)}</td>
                      </tr>
                    ))}
                    {!items.length && (
                      <tr>
                        <td colSpan={5} className="py-3 text-center text-slate-400">
                          No lines.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Total
                      </td>
                      <td className="py-2 text-right font-bold">
                        {po.currency ? `${po.currency} ` : ""}
                        {total.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Close-up photos (from order {order?.ref_no ?? "—"})
                  </p>
                  {photos.length ? (
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {photos.slice(0, 12).map((photo) => (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          key={photo.id}
                          src={photo.url}
                          alt={photo.fileName ?? "Close-up photo"}
                          className="h-28 w-full rounded border border-slate-200 object-cover"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">No close-up photos on this order.</p>
                  )}
                </div>

                <footer className="mt-6 flex items-center justify-between border-t border-slate-200 pt-2 text-xs text-slate-400">
                  <span>{po.po_no}</span>
                  <span>
                    Page {index + 1} of {details.length}
                  </span>
                </footer>
              </article>
            );
          })}
        </div>
      </PrintArea>
    </div>
  );
}
