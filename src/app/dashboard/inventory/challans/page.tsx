import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { getLookups, listChallans } from "@/lib/inventory/queries";
import { challanCancelAction, challanCreateAction, challanDispatchAction, challanIssueAction } from "../actions";
import { EmptyRow, InventoryTabs, MessageBanner, PageHeading, cardClass, inputClass, labelClass, th } from "../ui";

// Challan & Dispatch. The whole point of this screen is the Issue button:
// DRAFT does not touch stock, ISSUED deducts READY and writes the ledger in
// one transaction. Issuing an already-issued challan is a no-op (idempotent).
export default async function ChallansPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("inventory_view");
  const sp = await searchParams;
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, employee.currentCompanyId);
  const challans = await listChallans(db, employee.currentCompanyId, lookups);
  const canDispatch = employee.capabilities.includes("inventory_dispatch");
  const variants = lookups.variants.filter((v) => v.active);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeading
        title="Challan & Dispatch"
        subtitle="Stock leaves only when a challan is ISSUED — printing or viewing a challan never deducts again."
      />
      <MessageBanner ok={typeof sp.ok === "string" ? sp.ok : undefined} error={typeof sp.error === "string" ? sp.error : undefined} />
      <InventoryTabs active="/dashboard/inventory/challans" />

      {canDispatch && (
        <div className={`${cardClass} mb-4 p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">New challan (draft)</h2>
          <form action={challanCreateAction} className="space-y-3">
            <input type="hidden" name="return_to" value="/dashboard/inventory/challans" />
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className={labelClass} htmlFor="chalan_date">Challan date</label>
                <input id="chalan_date" name="chalan_date" type="date" defaultValue={today} className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="party_id">Party (optional)</label>
                <select id="party_id" name="party_id" className={inputClass}>
                  <option value="">—</option>
                  {lookups.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="remarks">Remarks</label>
                <input id="remarks" name="remarks" className={inputClass} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th className={th()}>SKU</th><th className={th()}>Warehouse</th><th className={th()}>Order (optional)</th>
                    <th className={th()}>PCS</th><th className={th()}>SQ FT (blank = auto)</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td className="px-1 py-1">
                        <select name="line_variant_id" className={inputClass} defaultValue="">
                          <option value="">—</option>
                          {variants.map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <select name="line_warehouse_id" className={inputClass} defaultValue={lookups.warehouses[0]?.id ?? ""}>
                          {lookups.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1"><input name="line_order_ref" className={inputClass} placeholder="PO/RF/RG" /></td>
                      <td className="px-1 py-1"><input name="line_pcs" type="number" step="0.001" min="0" className={inputClass} /></td>
                      <td className="px-1 py-1"><input name="line_sqft" type="number" step="0.001" min="0" className={inputClass} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="submit" className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-500">Create draft</button>
            <span className="ml-2 text-[11px] text-slate-400">A draft never changes stock. Issuing checks READY availability for every line, then deducts atomically.</span>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {challans.map((c) => (
          <div key={c.id} className={`${cardClass} p-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {c.chalanNo}
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    c.status === "ISSUED" ? "bg-emerald-50 text-emerald-700" : c.status === "CANCELLED" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"
                  }`}>{c.status}</span>
                  {c.dispatchedAt ? <span className="ml-2 text-[11px] text-slate-400">dispatched</span> : null}
                </div>
                <div className="text-[11px] text-slate-500">
                  {c.chalanDate} · {c.partyName ?? "No party"} · issued {c.issueDate ?? "—"}
                  {c.remarks ? ` · ${c.remarks}` : ""}
                </div>
              </div>
              {canDispatch && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {c.status === "DRAFT" && (
                    <form action={challanIssueAction}>
                      <input type="hidden" name="return_to" value="/dashboard/inventory/challans" />
                      <input type="hidden" name="challan_id" value={c.id} />
                      <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">Issue &amp; deduct stock</button>
                    </form>
                  )}
                  {c.status === "ISSUED" && !c.dispatchedAt && (
                    <form action={challanDispatchAction}>
                      <input type="hidden" name="return_to" value="/dashboard/inventory/challans" />
                      <input type="hidden" name="challan_id" value={c.id} />
                      <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">Mark dispatched</button>
                    </form>
                  )}
                  {c.status !== "CANCELLED" && !c.dispatchedAt && (
                    <form action={challanCancelAction} className="flex items-center gap-1">
                      <input type="hidden" name="return_to" value="/dashboard/inventory/challans" />
                      <input type="hidden" name="challan_id" value={c.id} />
                      <input name="reason" placeholder="Cancel reason" className="w-28 rounded border border-slate-300 px-1.5 py-1 text-[11px]" />
                      <button type="submit" className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100">Cancel</button>
                    </form>
                  )}
                </div>
              )}
            </div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-4 font-medium">SKU</th><th className="py-1 pr-4 font-medium">Product</th>
                  <th className="py-1 pr-4 font-medium">Order</th><th className="py-1 pr-4 font-medium">PCS</th><th className="py-1 font-medium">SQ FT</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="py-1 pr-4 font-medium text-slate-800">{l.sku}</td>
                    <td className="py-1 pr-4 text-slate-600">{l.productName}</td>
                    <td className="py-1 pr-4 text-slate-600">{l.orderRef ?? "—"}</td>
                    <td className="py-1 pr-4 font-semibold text-slate-900">{l.pcs}</td>
                    <td className="py-1 text-slate-600">{l.sqft}</td>
                  </tr>
                ))}
                {c.lines.length === 0 && (
                  <tr><td colSpan={5} className="py-2 text-slate-400">No lines on this challan.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
        {challans.length === 0 && (
          <div className={cardClass}>
            <table><tbody><EmptyRow colSpan={1} message="No challans yet." /></tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}
