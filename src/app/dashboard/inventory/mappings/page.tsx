import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { loadMappingData } from "@/lib/inventory/master-queries";
import { deactivateMappingAction, storeSkuMappingAction } from "../master-actions";
import { EmptyRow, InventoryTabs, MessageBanner, PageHeading, Stat, cardClass, inputClass, labelClass, td, th } from "../ui";

const PATH = "/dashboard/inventory/mappings";

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function StoreSkuMappingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("inventory_view");
  const sp = await searchParams;
  const canEdit = employee.capabilities.includes("inventory_master_admin");
  const db = createServiceRoleClientUnchecked();

  const companyFilter = one(sp.company);
  const storeFilter = one(sp.store);
  const query = one(sp.q);

  const data = await loadMappingData(db, employee.companyIds, {
    companyId: companyFilter || undefined,
    storeId: storeFilter || undefined,
    query,
  });

  const activeMappings = data.mappings.filter((m) => m.is_active);
  const inactiveMappings = data.mappings.filter((m) => !m.is_active);
  const storesForForm = companyFilter
    ? data.stores.filter((s) => s.company_id === companyFilter)
    : data.stores;
  const activeVariants = data.variantOptions.filter((v) => v.active && !v.merged);
  const companyById = new Map(data.companies.map((c) => [c.id, c.name]));

  if (data.missingMigration) {
    return (
      <div>
        <PageHeading title="Store SKU Mapping" subtitle="Point each store's selling SKU at the one physical Master SKU." />
        <MessageBanner error="The Master SKU tables are not installed yet. Run db/2026-11-20b-inventory-master-sku-foundation.sql in Supabase." />
      </div>
    );
  }

  return (
    <div>
      <PageHeading
        title="Store SKU Mapping"
        subtitle="Same physical product, different store SKU? Map both here. A store SKU maps to exactly one Master SKU, and every re-point is kept in history."
      />
      <MessageBanner ok={typeof sp.ok === "string" ? sp.ok : undefined} error={typeof sp.error === "string" ? sp.error : data.error || undefined} />
      <InventoryTabs active={PATH} />

      {!canEdit && (
        <p className="mb-4 text-xs text-slate-500">
          You can review mappings but not change them. Ask an administrator for the Inventory Master Admin capability.
        </p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Active mappings" value={activeMappings.length} tone="teal" />
        <Stat label="Inactive mappings" value={inactiveMappings.length} />
        <Stat label="Master SKUs available" value={activeVariants.length} tone="indigo" />
      </div>

      <div className={`${cardClass} mb-4 p-4`}>
        <h2 className="text-sm font-semibold text-slate-700">Map a store SKU</h2>
        <p className="mt-1 text-xs text-slate-500">
          Saving an existing store SKU with a different Master SKU re-points it and writes history — the old mapping is never silently replaced.
        </p>
        <form action={storeSkuMappingAction} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input type="hidden" name="return_to" value={PATH} />
          <div>
            <label className={labelClass} htmlFor="map_company">Company</label>
            <select id="map_company" name="company_id" required defaultValue={employee.currentCompanyId} className={inputClass}>
              {data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="map_store">Store</label>
            <select id="map_store" name="store_id" required className={inputClass}>
              <option value="">Select store</option>
              {storesForForm.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {companyById.get(s.company_id) ?? ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="map_sku">Store SKU</label>
            <input id="map_sku" name="store_sku" required className={inputClass} placeholder="e.g. JK-NAT-M" />
          </div>
          <div>
            <label className={labelClass} htmlFor="map_master">Master SKU</label>
            <select id="map_master" name="master_variant_id" required className={inputClass}>
              <option value="">Select Master SKU</option>
              {activeVariants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.master_sku} · {v.productName} · {v.size_label || "no size"}{v.colour ? ` / ${v.colour}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="map_listing">Marketplace listing ID</label>
            <div className="flex gap-2">
              <input id="map_listing" name="marketplace_listing_id" className={inputClass} placeholder="Optional" />
              <button type="submit" disabled={!canEdit} className="whitespace-nowrap rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">
                Save
              </button>
            </div>
          </div>
        </form>
      </div>

      <form method="get" className={`${cardClass} mb-4 flex flex-wrap items-end gap-2 p-3`}>
        <div>
          <label className={labelClass} htmlFor="f_company">Company</label>
          <select id="f_company" name="company" defaultValue={companyFilter} className={inputClass}>
            <option value="">All my companies</option>
            {data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="f_store">Store</label>
          <select id="f_store" name="store" defaultValue={storeFilter} className={inputClass}>
            <option value="">All stores</option>
            {storesForForm.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="f_q">Search</label>
          <input id="f_q" name="q" defaultValue={query} className={inputClass} placeholder="Store SKU / Master SKU / product" />
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Filter</button>
        <Link href={PATH} className="px-2 py-1.5 text-xs text-slate-500 underline">Reset</Link>
      </form>

      <div className={`${cardClass} mb-4 overflow-x-auto`}>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Mappings</h2>
        </div>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>Company</th>
              <th className={th()}>Store</th>
              <th className={th()}>Store SKU</th>
              <th className={th()}>Master SKU</th>
              <th className={th()}>Product</th>
              <th className={th()}>Listing</th>
              <th className={th()}>Status</th>
              <th className={th()}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.mappings.map((mapping) => (
              <tr key={mapping.id}>
                <td className={td()}>{mapping.companyName}</td>
                <td className={td()}>{mapping.storeName}</td>
                <td className={td("font-mono text-[11px] font-semibold")}>{mapping.store_sku}</td>
                <td className={td("font-mono text-[11px]")}>{mapping.masterSku}</td>
                <td className={td()}>
                  <div>{mapping.productName}</div>
                  <div className="text-[11px] text-slate-400">{[mapping.sizeLabel, mapping.colour].filter(Boolean).join(" / ") || "—"}</div>
                </td>
                <td className={td("text-slate-500")}>{mapping.marketplace_listing_id || "—"}</td>
                <td className={td()}>
                  {mapping.is_active
                    ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Active</span>
                    : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Inactive</span>}
                </td>
                <td className={td("text-right")}>
                  {canEdit && mapping.is_active && (
                    <form action={deactivateMappingAction}>
                      <input type="hidden" name="return_to" value={PATH} />
                      <input type="hidden" name="mapping_id" value={mapping.id} />
                      <input type="hidden" name="company_id" value={mapping.company_id} />
                      <input type="hidden" name="reason" value="Deactivated from the store SKU screen" />
                      <button type="submit" className="text-xs font-medium text-rose-600 underline">Deactivate</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {data.mappings.length === 0 && <EmptyRow colSpan={8} message="No store SKU mapping matches this filter." />}
          </tbody>
        </table>
      </div>

      <div className={`${cardClass} overflow-x-auto`}>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Mapping history (latest 100)</h2>
        </div>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>When</th>
              <th className={th()}>Company / store</th>
              <th className={th()}>Store SKU</th>
              <th className={th()}>Action</th>
              <th className={th()}>Old → new Master SKU</th>
              <th className={th()}>Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.history.map((row) => (
              <tr key={row.id}>
                <td className={td("text-slate-500")}>{new Date(row.changed_at).toLocaleString("en-IN")}</td>
                <td className={td()}>{row.companyName} / {row.storeName}</td>
                <td className={td("font-mono text-[11px]")}>{row.store_sku}</td>
                <td className={td()}>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{row.action}</span>
                </td>
                <td className={td("font-mono text-[11px]")}>
                  {row.old_master_sku ?? "—"} → {row.new_master_sku ?? "—"}
                </td>
                <td className={td("text-slate-500")}>{row.reason || "—"}</td>
              </tr>
            ))}
            {data.history.length === 0 && <EmptyRow colSpan={6} message="No mapping changes recorded yet." />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
