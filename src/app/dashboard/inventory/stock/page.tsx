import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { getLookups, listReservations, listStock } from "@/lib/inventory/queries";
import { INWARD_STAGES, STOCK_SOURCES, stageLabel } from "@/lib/inventory/stages";
import { adjustmentAction, inwardAction, qcAction } from "../actions";
import { EmptyRow, InventoryTabs, MessageBanner, PageHeading, cardClass, inputClass, labelClass, td, th } from "../ui";

// Current stock — one row per SKU × warehouse × stage. The "available" column
// is READY minus live reservations, which is the number an order may promise.
export default async function InventoryStockPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("inventory_view");
  const sp = await searchParams;
  const categoryId = typeof sp.category === "string" ? sp.category : "";
  const warehouseId = typeof sp.warehouse === "string" ? sp.warehouse : "";
  const stage = typeof sp.stage === "string" ? sp.stage : "";
  const search = typeof sp.q === "string" ? sp.q : "";
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, employee.currentCompanyId);
  const [lines, reservations] = await Promise.all([
    listStock(db, employee.currentCompanyId, lookups, { categoryId, warehouseId, stage, search }),
    listReservations(db, employee.currentCompanyId, lookups, "ACTIVE"),
  ]);
  const canManage = employee.capabilities.includes("inventory_manage");
  const reservedByVariant = new Map<string, number>();
  for (const r of reservations) {
    reservedByVariant.set(r.meta.sku, (reservedByVariant.get(r.meta.sku) ?? 0) + r.pcs - r.fulfilledPcs);
  }
  const warehouseName = new Map(lookups.warehouses.map((w) => [w.id, w.name]));
  const variantOptions = lookups.variants.filter((v) => v.active);

  return (
    <div>
      <PageHeading title="Current Stock" subtitle="Physical balances by stage, with PCS and SQ FT side by side." />
      <MessageBanner ok={typeof sp.ok === "string" ? sp.ok : undefined} error={typeof sp.error === "string" ? sp.error : undefined} />
      <InventoryTabs active="/dashboard/inventory/stock" />

      <form method="get" className={`${cardClass} mb-4 flex flex-wrap items-end gap-3 p-3`}>
        <div className="min-w-[150px]">
          <label className={labelClass} htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={categoryId} className={inputClass}>
            <option value="">All</option>
            {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="min-w-[150px]">
          <label className={labelClass} htmlFor="warehouse">Warehouse</label>
          <select id="warehouse" name="warehouse" defaultValue={warehouseId} className={inputClass}>
            <option value="">All</option>
            {lookups.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="min-w-[150px]">
          <label className={labelClass} htmlFor="stage">Stage</label>
          <select id="stage" name="stage" defaultValue={stage} className={inputClass}>
            <option value="">All stages</option>
            {["RAW", "PRINTING", "WASHING", "MANUFACTURING", "QC", "READY", "REJECTED"].map((s) => (
              <option key={s} value={s}>{stageLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[160px]">
          <label className={labelClass} htmlFor="q">SKU / product</label>
          <input id="q" name="q" defaultValue={search} className={inputClass} placeholder="Search SKU, product, size" />
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">Filter</button>
        <Link href="/dashboard/inventory/stock" className="text-xs text-slate-400 underline">Clear</Link>
      </form>

      <div className={`${cardClass} overflow-x-auto`}>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>SKU</th><th className={th()}>Product</th><th className={th()}>Size</th>
              <th className={th()}>Warehouse</th><th className={th()}>Stage</th><th className={th("text-right")}>PCS</th>
              <th className={th("text-right")}>SQ FT</th><th className={th("text-right")}>Reserved</th><th className={th("text-right")}>Available</th>
              <th className={th()}>Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => {
              const reserved = l.stage === "READY" ? reservedByVariant.get(l.meta.sku) ?? 0 : 0;
              return (
                <tr key={`${l.variantId}-${l.warehouseId}-${l.stage}`} className="hover:bg-slate-50">
                  <td className={td("font-medium")}>{l.meta.sku}</td>
                  <td className={td()}>{l.meta.productName}</td>
                  <td className={td()}>{l.meta.sizeLabel || l.meta.colour || "—"}</td>
                  <td className={td()}>{warehouseName.get(l.warehouseId) ?? "—"}</td>
                  <td className={td()}>{stageLabel(l.stage)}</td>
                  <td className={td("text-right font-semibold")}>{l.pcs}</td>
                  <td className={td("text-right")}>{l.sqft}</td>
                  <td className={td("text-right text-indigo-700")}>{reserved || "—"}</td>
                  <td className={td("text-right font-semibold text-teal-700")}>{l.stage === "READY" ? Math.max(l.pcs - reserved, 0) : "—"}</td>
                  <td className={td("text-slate-400")}>{new Date(l.updatedAt).toLocaleDateString("en-IN")}</td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <EmptyRow colSpan={10} message="No stock rows match. Create a product and variant in Settings, then add stock below." />
            )}
          </tbody>
        </table>
      </div>

      {canManage && variantOptions.length > 0 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className={`${cardClass} p-4 lg:col-span-2`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Add stock / Stock inward</h2>
            <form action={inwardAction} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="return_to" value="/dashboard/inventory/stock" />
              <div className="sm:col-span-3">
                <label className={labelClass} htmlFor="variant_id">SKU</label>
                <select id="variant_id" name="variant_id" required className={inputClass}>
                  <option value="">Select SKU</option>
                  {variantOptions.map((v) => {
                    const product = lookups.products.find((p) => p.id === v.product_id);
                    return <option key={v.id} value={v.id}>{v.sku} — {product?.name ?? ""} {v.size_label ? `· ${v.size_label}` : ""}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="warehouse_id">Warehouse</label>
                <select id="warehouse_id" name="warehouse_id" required className={inputClass}>
                  {lookups.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="stage">Stock stage</label>
                <select id="stage" name="stage" className={inputClass} defaultValue="READY">
                  {INWARD_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="source">Stock source</label>
                <select id="source" name="source" className={inputClass} defaultValue="MANUAL">
                  {STOCK_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="pcs">PCS</label>
                <input id="pcs" name="pcs" type="number" step="0.001" min="0.001" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="sqft">SQ FT (blank = auto)</label>
                <input id="sqft" name="sqft" type="number" step="0.001" min="0" className={inputClass} placeholder="Auto from size" />
              </div>
              <div>
                <label className={labelClass} htmlFor="reference">Reference</label>
                <input id="reference" name="reference" className={inputClass} placeholder="Bill / receipt / opening ref" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="remarks">Remarks</label>
                <input id="remarks" name="remarks" className={inputClass} />
              </div>
              <div className="sm:col-span-3">
                <button type="submit" className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-500">Add stock</button>
                <span className="ml-2 text-[11px] text-slate-400">
                  Purchase orders do not increase stock — this is the physical receipt step, and it always writes a ledger entry.
                </span>
              </div>
            </form>
          </div>

          <div className={`${cardClass} p-4`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">QC decision</h2>
            <form action={qcAction} className="space-y-3">
              <input type="hidden" name="return_to" value="/dashboard/inventory/stock" />
              <div>
                <label className={labelClass} htmlFor="qc_variant">SKU in QC</label>
                <select id="qc_variant" name="variant_id" required className={inputClass}>
                  <option value="">Select SKU</option>
                  {variantOptions.map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="qc_warehouse">Warehouse</label>
                <select id="qc_warehouse" name="warehouse_id" required className={inputClass}>
                  {lookups.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="qc_pcs">PCS</label>
                <input id="qc_pcs" name="pcs" type="number" step="0.001" min="0.001" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="decision">Decision</label>
                <select id="decision" name="decision" className={inputClass}>
                  <option value="ACCEPT">Accept → READY</option>
                  <option value="REJECT">Reject → rejected stock</option>
                </select>
              </div>
              <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">Record QC</button>
            </form>
          </div>
        </div>
      )}

      {canManage && (
        <details className={`${cardClass} mt-4 p-4`}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Stock correction (audited)</summary>
          <p className="mt-1 text-[11px] text-slate-500">
            Use only for irregular pieces or a counted difference. A correction can never overwrite a balance silently — it posts a new ledger transaction with your reason.
          </p>
          <form action={adjustmentAction} className="mt-3 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="return_to" value="/dashboard/inventory/stock" />
            <div className="sm:col-span-3">
              <label className={labelClass} htmlFor="adj_variant">SKU</label>
              <select id="adj_variant" name="variant_id" required className={inputClass}>
                <option value="">Select SKU</option>
                {variantOptions.map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="adj_warehouse">Warehouse</label>
              <select id="adj_warehouse" name="warehouse_id" required className={inputClass}>
                {lookups.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="adj_stage">Stage</label>
              <select id="adj_stage" name="stage" className={inputClass} defaultValue="READY">
                {["RAW", "PRINTING", "WASHING", "QC", "READY", "REJECTED"].map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pcs_delta">PCS correction (+/−)</label>
              <input id="pcs_delta" name="pcs_delta" type="number" step="0.001" className={inputClass} placeholder="e.g. -1" />
            </div>
            <div>
              <label className={labelClass} htmlFor="sqft_delta">SQ FT correction (+/−)</label>
              <input id="sqft_delta" name="sqft_delta" type="number" step="0.001" className={inputClass} placeholder="e.g. -6" />
            </div>
            <div>
              <label className={labelClass} htmlFor="reason">Reason</label>
              <input id="reason" name="reason" required className={inputClass} placeholder="Physical count, damage, sample…" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="adj_remarks">Remarks (mandatory)</label>
              <input id="adj_remarks" name="remarks" required className={inputClass} />
            </div>
            <div className="sm:col-span-3">
              <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">Post correction</button>
            </div>
          </form>
        </details>
      )}
    </div>
  );
}
