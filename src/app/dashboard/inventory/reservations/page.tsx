import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { getLookups, listReservations } from "@/lib/inventory/queries";
import { releaseAction, reserveAction } from "../actions";
import { EmptyRow, InventoryTabs, MessageBanner, PageHeading, cardClass, inputClass, labelClass, td, th } from "../ui";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("inventory_view");
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "ACTIVE";
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, employee.currentCompanyId);
  const reservations = await listReservations(db, employee.currentCompanyId, lookups, status);
  const canManage = employee.capabilities.includes("inventory_manage");

  return (
    <div>
      <PageHeading
        title="Stock Reservations"
        subtitle="A reservation promises READY stock to one order. The same pieces can never be reserved twice."
      />
      <MessageBanner ok={typeof sp.ok === "string" ? sp.ok : undefined} error={typeof sp.error === "string" ? sp.error : undefined} />
      <InventoryTabs active="/dashboard/inventory/reservations" />

      <div className="mb-4 flex gap-1.5 text-xs">
        {["ACTIVE", "FULFILLED", "RELEASED", "ALL"].map((s) => (
          <Link
            key={s}
            href={`/dashboard/inventory/reservations?status=${s}`}
            className={`rounded-md px-2.5 py-1 ${status === s ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {s}
          </Link>
        ))}
      </div>

      {canManage && (
        <div className={`${cardClass} mb-4 p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Reserve stock for an order</h2>
          <form action={reserveAction} className="grid gap-3 sm:grid-cols-5">
            <input type="hidden" name="return_to" value="/dashboard/inventory/reservations" />
            <div>
              <label className={labelClass} htmlFor="order_ref">Order (PO/RF/RG)</label>
              <input id="order_ref" name="order_ref" required className={inputClass} placeholder="e.g. PO-1234" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="variant_id">SKU</label>
              <select id="variant_id" name="variant_id" required className={inputClass}>
                <option value="">Select SKU</option>
                {lookups.variants.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="warehouse_id">Warehouse</label>
              <select id="warehouse_id" name="warehouse_id" required className={inputClass}>
                {lookups.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pcs">PCS</label>
              <input id="pcs" name="pcs" type="number" step="0.001" min="0.001" required className={inputClass} />
            </div>
            <div className="sm:col-span-5">
              <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">Reserve</button>
              <span className="ml-2 text-[11px] text-slate-400">The database locks the balance row, so two people reserving at once cannot both take the last piece.</span>
            </div>
          </form>
        </div>
      )}

      <div className={`${cardClass} overflow-x-auto`}>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>Order</th><th className={th()}>SKU</th><th className={th()}>Warehouse</th>
              <th className={th("text-right")}>Reserved</th><th className={th("text-right")}>Fulfilled</th>
              <th className={th("text-right")}>Open</th><th className={th("text-right")}>SQ FT</th>
              <th className={th()}>Status</th><th className={th()}>Created</th><th className={th()}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {reservations.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className={td("font-medium")}>{r.orderRef}</td>
                <td className={td()}>{r.meta.sku}</td>
                <td className={td()}>{r.warehouseName}</td>
                <td className={td("text-right")}>{r.pcs}</td>
                <td className={td("text-right")}>{r.fulfilledPcs}</td>
                <td className={td("text-right font-semibold")}>{r.pcs - r.fulfilledPcs}</td>
                <td className={td("text-right")}>{r.sqft}</td>
                <td className={td()}>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${r.status === "ACTIVE" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>{r.status}</span>
                </td>
                <td className={td("text-slate-400")}>{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                <td className={td()}>
                  {canManage && r.status === "ACTIVE" && (
                    <form action={releaseAction} className="flex items-center gap-1">
                      <input type="hidden" name="return_to" value="/dashboard/inventory/reservations" />
                      <input type="hidden" name="reservation_id" value={r.id} />
                      <input name="reason" placeholder="Reason" className="w-24 rounded border border-slate-300 px-1.5 py-1 text-[11px]" />
                      <button type="submit" className="rounded bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">Release</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {reservations.length === 0 && <EmptyRow colSpan={10} message="No reservations in this view." />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
