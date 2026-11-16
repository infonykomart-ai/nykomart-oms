import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { getLookups, listManufacturingJobs, listProcessingJobs } from "@/lib/inventory/queries";
import {
  manufacturingCompleteAction,
  manufacturingStartAction,
  processingCompleteAction,
  processingSendAction,
} from "../actions";
import { EmptyRow, InventoryTabs, MessageBanner, PageHeading, cardClass, inputClass, labelClass, td, th } from "../ui";

export default async function ProcessingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("inventory_view");
  const sp = await searchParams;
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, employee.currentCompanyId);
  const [processing, manufacturing] = await Promise.all([
    listProcessingJobs(db, employee.currentCompanyId, lookups),
    listManufacturingJobs(db, employee.currentCompanyId, lookups),
  ]);
  const canManage = employee.capabilities.includes("inventory_manage");
  const activeVariants = lookups.variants.filter((v) => v.active);
  const warehouses = lookups.warehouses;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeading
        title="Printing, Washing & Manufacturing"
        subtitle="Each send/complete moves stock between stages in one database transaction — never in two places at once."
      />
      <MessageBanner ok={typeof sp.ok === "string" ? sp.ok : undefined} error={typeof sp.error === "string" ? sp.error : undefined} />
      <InventoryTabs active="/dashboard/inventory/processing" />

      {canManage && (
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <div className={`${cardClass} p-4`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Send to printing / washing</h2>
            <form action={processingSendAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="return_to" value="/dashboard/inventory/processing" />
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="p_variant">SKU</label>
                <select id="p_variant" name="variant_id" required className={inputClass}>
                  <option value="">Select SKU</option>
                  {activeVariants.map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="p_warehouse">Warehouse</label>
                <select id="p_warehouse" name="warehouse_id" required className={inputClass}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="process">Process</label>
                <select id="process" name="process" className={inputClass}>
                  <option value="PRINTING">Printing (from RAW)</option>
                  <option value="WASHING">Washing (from PRINTING)</option>
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="p_pcs">PCS</label>
                <input id="p_pcs" name="pcs" type="number" step="0.001" min="0.001" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="p_sqft">SQ FT (blank = auto)</label>
                <input id="p_sqft" name="sqft" type="number" step="0.001" min="0" className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="p_order">Order (optional)</label>
                <input id="p_order" name="order_ref" className={inputClass} placeholder="PO/RF/RG" />
              </div>
              <div>
                <label className={labelClass} htmlFor="p_vendor">Processing vendor</label>
                <select id="p_vendor" name="vendor_party_id" className={inputClass}>
                  <option value="">—</option>
                  {lookups.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="p_expected">Expected completion</label>
                <input id="p_expected" name="expected_date" type="date" className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="p_remarks">Remarks</label>
                <input id="p_remarks" name="remarks" className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-500">Create job &amp; move stock</button>
              </div>
            </form>
          </div>

          <div className={`${cardClass} p-4`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">New manufacturing order</h2>
            <p className="mb-2 text-[11px] text-slate-500">
              For kurtis, table cloth and table runner. Accepted output enters at QC and only the accepted pieces reach READY; raw material stays in the separate Stock module.
            </p>
            <form action={manufacturingStartAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="return_to" value="/dashboard/inventory/processing" />
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="m_variant">SKU</label>
                <select id="m_variant" name="variant_id" required className={inputClass}>
                  <option value="">Select SKU</option>
                  {activeVariants.map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="m_warehouse">Warehouse</label>
                <select id="m_warehouse" name="warehouse_id" required className={inputClass}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="m_planned">Planned PCS</label>
                <input id="m_planned" name="planned_pcs" type="number" step="0.001" min="0.001" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="m_start">Start date</label>
                <input id="m_start" name="start_date" type="date" defaultValue={today} className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="m_remarks">Remarks</label>
                <input id="m_remarks" name="remarks" className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">Create production order</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-700">Processing jobs</h2>
      <div className={`${cardClass} mb-6 overflow-x-auto`}>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>Job</th><th className={th()}>Process</th><th className={th()}>SKU</th>
              <th className={th("text-right")}>Sent</th><th className={th("text-right")}>Accepted</th><th className={th("text-right")}>Rejected</th>
              <th className={th("text-right")}>Pending</th><th className={th()}>Expected</th><th className={th()}>Status</th>
              {canManage && <th className={th()}>Record completion</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {processing.map((j) => (
              <tr key={j.id}>
                <td className={td("font-medium")}>{j.jobNo}</td>
                <td className={td()}>{j.process}</td>
                <td className={td()}>{j.sku}</td>
                <td className={td("text-right")}>{j.pcsSent}</td>
                <td className={td("text-right text-emerald-700")}>{j.pcsAccepted}</td>
                <td className={td("text-right text-rose-600")}>{j.pcsRejected}</td>
                <td className={td("text-right font-semibold")}>{j.pendingPcs}</td>
                <td className={td(j.expectedDate && j.expectedDate < today && j.status !== "COMPLETED" ? "text-rose-600" : "")}>{j.expectedDate ?? "—"}</td>
                <td className={td()}>{j.status}</td>
                {canManage && (
                  <td className={td()}>
                    {(j.status === "OPEN" || j.status === "PARTIAL") && (
                      <form action={processingCompleteAction} className="flex items-center gap-1">
                        <input type="hidden" name="return_to" value="/dashboard/inventory/processing" />
                        <input type="hidden" name="job_id" value={j.id} />
                        <input name="accepted_pcs" type="number" step="0.001" min="0" placeholder="Accepted" className="w-20 rounded border border-slate-300 px-1.5 py-1 text-[11px]" />
                        <input name="rejected_pcs" type="number" step="0.001" min="0" placeholder="Rejected" className="w-20 rounded border border-slate-300 px-1.5 py-1 text-[11px]" />
                        <button type="submit" className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100">Save</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {processing.length === 0 && <EmptyRow colSpan={canManage ? 10 : 9} message="No processing jobs yet." />}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-slate-700">Manufacturing jobs</h2>
      <div className={`${cardClass} overflow-x-auto`}>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>Job</th><th className={th()}>SKU</th><th className={th("text-right")}>Planned</th>
              <th className={th("text-right")}>Accepted</th><th className={th("text-right")}>Rejected</th>
              <th className={th("text-right")}>Pending</th><th className={th()}>Status</th><th className={th()}>Completed</th>
              {canManage && <th className={th()}>Record production</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {manufacturing.map((j) => (
              <tr key={j.id}>
                <td className={td("font-medium")}>{j.jobNo}</td>
                <td className={td()}>{j.sku}</td>
                <td className={td("text-right")}>{j.plannedPcs}</td>
                <td className={td("text-right text-emerald-700")}>{j.acceptedPcs}</td>
                <td className={td("text-right text-rose-600")}>{j.rejectedPcs}</td>
                <td className={td("text-right font-semibold")}>{j.pendingPcs}</td>
                <td className={td()}>{j.status}</td>
                <td className={td("text-slate-400")}>{j.completedAt ? new Date(j.completedAt).toLocaleDateString("en-IN") : "—"}</td>
                {canManage && (
                  <td className={td()}>
                    {(j.status === "OPEN" || j.status === "PARTIAL") && (
                      <form action={manufacturingCompleteAction} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="return_to" value="/dashboard/inventory/processing" />
                        <input type="hidden" name="job_id" value={j.id} />
                        <input name="accepted_pcs" type="number" step="0.001" min="0" placeholder="Accepted" className="w-20 rounded border border-slate-300 px-1.5 py-1 text-[11px]" />
                        <input name="rejected_pcs" type="number" step="0.001" min="0" placeholder="Rejected" className="w-20 rounded border border-slate-300 px-1.5 py-1 text-[11px]" />
                        <input name="material_consumption" placeholder="Material used" className="w-28 rounded border border-slate-300 px-1.5 py-1 text-[11px]" />
                        <button type="submit" className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100">Save</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {manufacturing.length === 0 && <EmptyRow colSpan={canManage ? 9 : 8} message="No manufacturing jobs yet." />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
