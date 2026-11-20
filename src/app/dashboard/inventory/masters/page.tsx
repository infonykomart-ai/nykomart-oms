import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { loadMasterCatalog } from "@/lib/inventory/master-queries";
import { masterProductAction, masterVariantAction, mergeMasterVariantsAction } from "../master-actions";
import { EmptyRow, InventoryTabs, MessageBanner, PageHeading, Stat, cardClass, inputClass, labelClass, td, th } from "../ui";

const PATH = "/dashboard/inventory/masters";

export default async function MasterSkuPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("inventory_view");
  const sp = await searchParams;
  const canEdit = employee.capabilities.includes("inventory_master_admin");
  const db = createServiceRoleClientUnchecked();

  const [catalog, categoriesRes] = await Promise.all([
    loadMasterCatalog(db),
    db.from("item_categories").select("id, name").order("name"),
  ]);
  const categories = (categoriesRes.data ?? []) as { id: string; name: string }[];

  const editProductId = typeof sp.edit_product === "string" ? sp.edit_product : "";
  const editVariantId = typeof sp.edit_variant === "string" ? sp.edit_variant : "";
  const editProduct = catalog.products.find((p) => p.id === editProductId);
  const editVariant = catalog.variants.find((v) => v.id === editVariantId);

  const productById = new Map(catalog.products.map((p) => [p.id, p]));
  const activeVariants = catalog.variants.filter((v) => v.active && !v.merged_into_id);
  const mappedVariantIds = new Set(
    catalog.variants.filter((v) => (catalog.mappingCounts.get(v.id) ?? 0) > 0).map((v) => v.id)
  );
  const unmapped = activeVariants.filter((v) => !mappedVariantIds.has(v.id));
  const totalMappings = Array.from(catalog.mappingCounts.values()).reduce((sum, n) => sum + n, 0);

  if (catalog.missingMigration) {
    return (
      <div>
        <PageHeading title="Master SKUs" subtitle="One physical product variant, however many store SKUs point at it." />
        <MessageBanner error="The Master SKU tables are not installed yet. Run db/2026-11-20b-inventory-master-sku-foundation.sql (and db/2026-11-20c-inventory-master-merge.sql) in Supabase." />
      </div>
    );
  }

  return (
    <div>
      <PageHeading
        title="Master SKUs"
        subtitle="Master SKU = the physical variant (design + size + colour + material). Store SKUs only map onto it — they never create a second stock item."
      />
      <MessageBanner ok={typeof sp.ok === "string" ? sp.ok : undefined} error={typeof sp.error === "string" ? sp.error : catalog.error || undefined} />
      <InventoryTabs active={PATH} />

      {!canEdit && (
        <p className="mb-4 text-xs text-slate-500">
          You can review Master SKUs but not change them. Ask an administrator for the Inventory Master Admin capability.
        </p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Master products" value={catalog.products.length} />
        <Stat label="Active Master SKUs" value={activeVariants.length} tone="teal" />
        <Stat label="Store SKU mappings" value={totalMappings} tone="indigo" />
        <Stat label="Unmapped Master SKUs" value={unmapped.length} tone={unmapped.length ? "amber" : "slate"} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className={`${cardClass} p-4`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-700">{editProduct ? `Edit master product ${editProduct.master_code}` : "New master product"}</h2>
            {editProduct && <Link href={PATH} className="text-xs text-slate-500 underline">Cancel edit</Link>}
          </div>
          <form action={masterProductAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="return_to" value={PATH} />
            {editProduct && <input type="hidden" name="id" value={editProduct.id} />}
            <div>
              <label className={labelClass} htmlFor="mp_code">Master code</label>
              <input id="mp_code" name="master_code" required defaultValue={editProduct?.master_code ?? ""} className={inputClass} placeholder="JUTE-001" />
            </div>
            <div>
              <label className={labelClass} htmlFor="mp_name">Name</label>
              <input id="mp_name" name="name" required defaultValue={editProduct?.name ?? ""} className={inputClass} placeholder="Jute kurti" />
            </div>
            <div>
              <label className={labelClass} htmlFor="mp_design">Design code</label>
              <input id="mp_design" name="design_code" defaultValue={editProduct?.design_code ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="mp_category">Item category</label>
              <select id="mp_category" name="item_category_id" defaultValue={editProduct?.item_category_id ?? ""} className={inputClass}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="mp_material">Material</label>
              <input id="mp_material" name="material" defaultValue={editProduct?.material ?? ""} className={inputClass} placeholder="Jute" />
            </div>
            <div>
              <label className={labelClass} htmlFor="mp_construction">Construction</label>
              <input id="mp_construction" name="construction" defaultValue={editProduct?.construction ?? ""} className={inputClass} placeholder="Handloom" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="mp_notes">Notes</label>
              <input id="mp_notes" name="notes" defaultValue={editProduct?.notes ?? ""} className={inputClass} />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" name="active" defaultChecked={editProduct ? editProduct.active : true} /> Active
            </label>
            <div className="text-right">
              <button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">
                {editProduct ? "Save product" : "Create product"}
              </button>
            </div>
          </form>
        </div>

        <div className={`${cardClass} p-4`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-700">{editVariant ? `Edit ${editVariant.master_sku}` : "New Master SKU"}</h2>
            {editVariant && <Link href={PATH} className="text-xs text-slate-500 underline">Cancel edit</Link>}
          </div>
          <form action={masterVariantAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="return_to" value={PATH} />
            {editVariant && <input type="hidden" name="id" value={editVariant.id} />}
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="mv_product">Master product</label>
              <select id="mv_product" name="master_product_id" required defaultValue={editVariant?.master_product_id ?? ""} className={inputClass}>
                <option value="">Select product</option>
                {catalog.products.map((p) => <option key={p.id} value={p.id}>{p.master_code} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="mv_sku">Master SKU</label>
              <input id="mv_sku" name="master_sku" defaultValue={editVariant?.master_sku ?? ""} className={inputClass} placeholder="Auto (e.g. JUTE-001-0001)" />
            </div>
            <div>
              <label className={labelClass} htmlFor="mv_colour">Colour</label>
              <input id="mv_colour" name="colour" defaultValue={editVariant?.colour ?? ""} className={inputClass} placeholder="Natural" />
            </div>
            <div>
              <label className={labelClass} htmlFor="mv_size">Size (exact, no unit conversion)</label>
              <input id="mv_size" name="size_label" defaultValue={editVariant?.size_label ?? ""} className={inputClass} placeholder="M / 40x60" />
            </div>
            <div>
              <label className={labelClass} htmlFor="mv_unit">Size unit (label only)</label>
              <input id="mv_unit" name="size_unit" defaultValue={editVariant?.size_unit ?? ""} className={inputClass} placeholder="IN / CM" />
            </div>
            <div>
              <label className={labelClass} htmlFor="mv_length">Length / height</label>
              <input id="mv_length" name="length_value" type="number" step="0.001" defaultValue={editVariant?.length_value ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="mv_width">Width</label>
              <input id="mv_width" name="width_value" type="number" step="0.001" defaultValue={editVariant?.width_value ?? ""} className={inputClass} />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" name="active" defaultChecked={editVariant ? editVariant.active : true} /> Active
            </label>
            <div className="text-right">
              <button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">
                {editVariant ? "Save Master SKU" : "Create Master SKU"}
              </button>
            </div>
          </form>
          <p className="mt-2 text-[11px] text-slate-400">
            Size text is stored as typed. Order size/unit is never converted or overwritten, whatever the company measurement setting says.
          </p>
        </div>
      </div>

      <div className={`${cardClass} mb-4 overflow-x-auto`}>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Master catalogue</h2>
        </div>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>Master SKU</th>
              <th className={th()}>Product</th>
              <th className={th()}>Size</th>
              <th className={th()}>Colour</th>
              <th className={th()}>Store maps</th>
              <th className={th()}>Status</th>
              <th className={th()}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {catalog.variants.map((variant) => {
              const product = productById.get(variant.master_product_id);
              const maps = catalog.mappingCounts.get(variant.id) ?? 0;
              return (
                <tr key={variant.id}>
                  <td className={td("font-mono text-[11px] font-semibold")}>{variant.master_sku}</td>
                  <td className={td()}>
                    <div>{product?.name ?? "—"}</div>
                    <div className="text-[11px] text-slate-400">{[product?.master_code, product?.material, product?.construction].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className={td()}>{variant.size_label || "—"}{variant.size_unit ? ` ${variant.size_unit}` : ""}</td>
                  <td className={td()}>{variant.colour || "—"}</td>
                  <td className={td(maps === 0 ? "text-amber-600" : "")}>{maps}</td>
                  <td className={td()}>
                    {variant.merged_into_id ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        Merged → {catalog.variants.find((v) => v.id === variant.merged_into_id)?.master_sku ?? "another SKU"}
                      </span>
                    ) : variant.active ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Active</span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Inactive</span>
                    )}
                  </td>
                  <td className={td("text-right")}>
                    {canEdit && (
                      <Link href={`${PATH}?edit_variant=${variant.id}`} className="text-xs font-medium text-slate-600 underline">Edit</Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {catalog.variants.length === 0 && <EmptyRow colSpan={7} message="No Master SKU yet — create a master product, then its first size/colour." />}
          </tbody>
        </table>
      </div>

      {catalog.products.length > 0 && (
        <div className={`${cardClass} mb-4 overflow-x-auto`}>
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Master products</h2>
          </div>
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className={th()}>Code</th>
                <th className={th()}>Name</th>
                <th className={th()}>Material / construction</th>
                <th className={th()}>SKUs</th>
                <th className={th()}>Status</th>
                <th className={th()}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {catalog.products.map((product) => {
                const variants = catalog.variants.filter((v) => v.master_product_id === product.id);
                return (
                  <tr key={product.id}>
                    <td className={td("font-mono text-[11px] font-semibold")}>{product.master_code}</td>
                    <td className={td()}>{product.name}</td>
                    <td className={td("text-slate-500")}>{[product.material, product.construction].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={td()}>{variants.length}</td>
                    <td className={td()}>{product.active ? <span className="text-emerald-700">Active</span> : <span className="text-slate-500">Inactive</span>}</td>
                    <td className={td("text-right")}>
                      {canEdit && <Link href={`${PATH}?edit_product=${product.id}`} className="text-xs font-medium text-slate-600 underline">Edit</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={`${cardClass} mb-4 p-4`}>
        <h2 className="text-sm font-semibold text-slate-700">Merge a duplicate Master SKU</h2>
        <p className="mt-1 text-xs text-slate-500">
          Store mappings, variant links and reservations move to the surviving Master SKU in one transaction. The merged SKU stays visible and inactive — nothing is deleted. Size/colour and material/construction must match exactly.
        </p>
        <form action={mergeMasterVariantsAction} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="return_to" value={PATH} />
          <div>
            <label className={labelClass} htmlFor="merge_source">Duplicate (source)</label>
            <select id="merge_source" name="source_variant_id" required className={inputClass}>
              <option value="">Select Master SKU</option>
              {activeVariants.map((v) => <option key={v.id} value={v.id}>{v.master_sku} · {productById.get(v.master_product_id)?.name ?? ""}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="merge_target">Surviving (target)</label>
            <select id="merge_target" name="target_variant_id" required className={inputClass}>
              <option value="">Select Master SKU</option>
              {activeVariants.map((v) => <option key={v.id} value={v.id}>{v.master_sku} · {productById.get(v.master_product_id)?.name ?? ""}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="merge_reason">Reason / audit note</label>
            <input id="merge_reason" name="reason" className={inputClass} placeholder="Same jute kurti entered twice" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={!canEdit} className="w-full rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40">
              Merge Master SKUs
            </button>
          </div>
        </form>
      </div>

      <div className={`${cardClass} overflow-x-auto`}>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Merge history</h2>
        </div>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>When</th>
              <th className={th()}>Source</th>
              <th className={th()}>Surviving</th>
              <th className={th()}>Moved</th>
              <th className={th()}>Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {catalog.merges.map((merge) => (
              <tr key={merge.id}>
                <td className={td("text-slate-500")}>{new Date(merge.created_at).toLocaleString("en-IN")}</td>
                <td className={td("font-mono text-[11px]")}>{merge.source_master_sku}</td>
                <td className={td("font-mono text-[11px]")}>{merge.target_master_sku}</td>
                <td className={td("text-slate-500")}>{merge.mappings_moved} map · {merge.variants_moved} variant · {merge.reservations_moved} reservation</td>
                <td className={td("text-slate-500")}>{merge.reason || "—"}</td>
              </tr>
            ))}
            {catalog.merges.length === 0 && <EmptyRow colSpan={5} message="No Master SKU has been merged yet." />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
