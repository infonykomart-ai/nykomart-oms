import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { loadMasterCatalog, loadMappingData } from "@/lib/inventory/master-queries";
import {
  deactivateMappingAction,
  masterPhotoRemoveAction,
  masterProductAction,
  masterProductDeleteAction,
  masterVariantAction,
  masterVariantDeleteAction,
  masterVariantPhotoAction,
  mergeMasterVariantsAction,
  storeSkuMappingAction,
} from "../master-actions";
import { ConfirmSubmitButton } from "../confirm-submit";
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

  const [catalog, categoriesRes, mappingData] = await Promise.all([
    loadMasterCatalog(db),
    db.from("item_categories").select("id, name").order("name"),
    loadMappingData(db, employee.companyIds),
  ]);
  const categories = (categoriesRes.data ?? []) as { id: string; name: string }[];

  const editProductId = typeof sp.edit_product === "string" ? sp.edit_product : "";
  const editVariantId = typeof sp.edit_variant === "string" ? sp.edit_variant : "";
  const editProduct = catalog.products.find((p) => p.id === editProductId);
  const editVariant = catalog.variants.find((v) => v.id === editVariantId);

  const productById = new Map(catalog.products.map((p) => [p.id, p]));
  const activeVariants = catalog.variants.filter((v) => v.active && !v.merged_into_id);
  // 2026-11-20d — each Master SKU's photo album, newest first.
  const activePhotosByVariant = new Map<string, typeof catalog.photos>();
  for (const photo of catalog.photos) {
    if (!photo.is_active) continue;
    const list = activePhotosByVariant.get(photo.master_variant_id) ?? [];
    list.push(photo);
    activePhotosByVariant.set(photo.master_variant_id, list);
  }
  const withPhoto = activeVariants.filter((v) => (activePhotosByVariant.get(v.id)?.length ?? 0) > 0).length;
  const mappedVariantIds = new Set(
    catalog.variants.filter((v) => (catalog.mappingCounts.get(v.id) ?? 0) > 0).map((v) => v.id)
  );
  const unmapped = activeVariants.filter((v) => !mappedVariantIds.has(v.id));
  const totalMappings = Array.from(catalog.mappingCounts.values()).reduce((sum, n) => sum + n, 0);
  // 2026-11-20e — each store's own SKU/listing is updated from this same screen.
  const mappingCompanyById = new Map(mappingData.companies.map((c) => [c.id, c.name]));
  const storeOptions = mappingData.stores.filter((s) => s.active);
  const activePhotoRows = catalog.photos.filter((p) => p.is_active);
  const masterSkuById = new Map(catalog.variants.map((v) => [v.id, v.master_sku]));

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
        <Stat label="Master SKUs with photo" value={`${withPhoto}/${activeVariants.length}`} tone={withPhoto < activeVariants.length ? "amber" : "teal"} />
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

      <div className={`${cardClass} mb-4 p-4`} id="master-photos">
        <h2 className="text-sm font-semibold text-slate-700">Master SKU photo</h2>
        {canEdit ? (
          <form action={masterVariantPhotoAction} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="return_to" value={PATH} />
            <div className="lg:col-span-2">
              <label className={labelClass} htmlFor="photo_variant">Master SKU</label>
              <select id="photo_variant" name="variant_id" required className={inputClass}>
                <option value="">Select Master SKU</option>
                {activeVariants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.master_sku} · {productById.get(v.master_product_id)?.name ?? ""}{v.size_label ? ` · ${v.size_label}` : ""}{v.colour ? ` · ${v.colour}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="photo_type">Photo type</label>
              <select id="photo_type" name="image_type" className={inputClass} defaultValue="PRODUCT_MAIN">
                <option value="PRODUCT_MAIN">Product main</option>
                <option value="DESIGN_DETAIL">Design detail</option>
                <option value="COLOUR_REFERENCE">Colour reference</option>
                <option value="SIZE_MEASUREMENT">Size measurement</option>
                <option value="QUALITY_CHECK">Quality check</option>
                <option value="PACKAGING">Packaging</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="photo_file">Photo (JPEG / PNG / WebP, max 10MB)</label>
              <input id="photo_file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required className={inputClass} />
            </div>
            <div className="flex items-end">
              <button type="submit" className="w-full rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
                Upload photo
              </button>
            </div>
            <div className="sm:col-span-2 lg:col-span-5">
              <label className={labelClass} htmlFor="photo_reason">Note (optional)</label>
              <input id="photo_reason" name="reason" className={inputClass} placeholder="e.g. New colour lot, actual shade reference" />
            </div>
          </form>
        ) : (
          <p className="mt-2 text-xs text-slate-500">You can see the photos but not upload them. Ask an administrator for the Inventory Master Admin capability.</p>
        )}
      </div>

      <div className={`${cardClass} mb-4 overflow-x-auto`} id="master-photo-album">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Master SKU photo album</h2>
        </div>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>Photo</th>
              <th className={th()}>Master SKU</th>
              <th className={th()}>Type</th>
              <th className={th()}>Uploaded</th>
              <th className={th()}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {activePhotoRows.map((photo) => (
              <tr key={photo.id}>
                <td className={td()}>
                  <a href={`/api/inventory/master-photo/${photo.id}`} target="_blank" rel="noreferrer">
                    <img src={`/api/inventory/master-photo/${photo.id}`} alt={photo.file_name ?? "Master SKU photo"} className="h-12 w-12 rounded-md border border-slate-200 object-cover" />
                  </a>
                </td>
                <td className={td("font-mono text-[11px]")}>{masterSkuById.get(photo.master_variant_id) ?? "—"}</td>
                <td className={td()}>{photo.image_type}</td>
                <td className={td("text-slate-500")}>{new Date(photo.uploaded_at).toLocaleString("en-IN")}</td>
                <td className={td("text-right whitespace-nowrap")}>
                  {canEdit && (
                    <form action={masterPhotoRemoveAction}>
                      <input type="hidden" name="return_to" value={PATH} />
                      <input type="hidden" name="photo_id" value={photo.id} />
                      <input type="hidden" name="variant_id" value={photo.master_variant_id} />
                      <ConfirmSubmitButton
                        message={`Remove this ${photo.image_type} photo from ${masterSkuById.get(photo.master_variant_id) ?? "the SKU"}? The file stays in private storage and in history.`}
                        className="text-xs font-medium text-rose-600 underline"
                      >
                        Remove
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {activePhotoRows.length === 0 && <EmptyRow colSpan={5} message="No Master SKU photo yet — upload one in the card above." />}
          </tbody>
        </table>
      </div>

      <div className={`${cardClass} mb-4 p-4`} id="store-updates">
        <h2 className="text-sm font-semibold text-slate-700">Store update — store-specific SKU</h2>
        {canEdit ? (
          <form action={storeSkuMappingAction} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="return_to" value={PATH} />
            <div>
              <label className={labelClass} htmlFor="store_company">Company</label>
              <select id="store_company" name="company_id" required defaultValue={employee.currentCompanyId} className={inputClass}>
                {mappingData.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="store_store">Store</label>
              <select id="store_store" name="store_id" required className={inputClass}>
                <option value="">Select store</option>
                {storeOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} — {mappingCompanyById.get(s.company_id) ?? ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="store_sku">Store SKU</label>
              <input id="store_sku" name="store_sku" required className={inputClass} placeholder="e.g. JK-NAT-M" />
            </div>
            <div>
              <label className={labelClass} htmlFor="store_master">Master SKU</label>
              <select id="store_master" name="master_variant_id" required className={inputClass}>
                <option value="">Select Master SKU</option>
                {activeVariants.map((v) => <option key={v.id} value={v.id}>{v.master_sku} · {productById.get(v.master_product_id)?.name ?? ""}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="store_listing">Marketplace listing ID</label>
              <div className="flex gap-2">
                <input id="store_listing" name="marketplace_listing_id" className={inputClass} placeholder="Optional" />
                <button type="submit" className="whitespace-nowrap rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">Save</button>
              </div>
            </div>
          </form>
        ) : (
          <p className="mt-2 text-xs text-slate-500">You can see store mappings but not change them. Ask an administrator for the Inventory Master Admin capability.</p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className={th()}>Company / store</th>
                <th className={th()}>Store SKU</th>
                <th className={th()}>Master SKU</th>
                <th className={th()}>Listing</th>
                <th className={th()}>Status</th>
                <th className={th()}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mappingData.mappings.map((mapping) => {
                // 2026-11-20e — the row's select must never pre-select a Master
                // SKU it does not list. When the current one is inactive, merged
                // or missing from the catalogue, the browser falls back to the
                // first option and a save would silently re-point the mapping.
                // Those rows are read-only and the fixed form above re-maps them.
                const currentSelectable = activeVariants.some((v) => v.id === mapping.master_variant_id);
                const rowEditable = canEdit && mapping.is_active && currentSelectable;
                return (
                <tr key={mapping.id}>
                  <td className={td()}>{mapping.companyName} / {mapping.storeName}</td>
                  <td className={td("font-mono text-[11px] font-semibold")}>{mapping.store_sku}</td>
                  <td className={td("whitespace-normal")}>
                    {rowEditable ? (
                      <details className="min-w-[250px]">
                        <summary className="cursor-pointer text-[11px] font-semibold text-slate-700 underline">
                          Update — current {mapping.masterSku}
                        </summary>
                        <form action={storeSkuMappingAction} className="mt-2 grid gap-1.5">
                          <input type="hidden" name="return_to" value={PATH} />
                          <input type="hidden" name="mapping_id" value={mapping.id} />
                          <input type="hidden" name="company_id" value={mapping.company_id} />
                          <input type="hidden" name="store_id" value={mapping.store_id} />
                          <input type="hidden" name="store_sku" value={mapping.store_sku} />
                          <label className="text-[10px] font-medium text-slate-500" htmlFor={`map_master_${mapping.id}`}>
                            Master SKU — choose explicitly
                          </label>
                          <select
                            id={`map_master_${mapping.id}`}
                            name="master_variant_id"
                            required
                            defaultValue=""
                            className={inputClass}
                          >
                            <option value="" disabled>Choose Master SKU</option>
                            {activeVariants.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.master_sku}{v.id === mapping.master_variant_id ? " (current)" : ""}
                              </option>
                            ))}
                          </select>
                          <input name="marketplace_listing_id" defaultValue={mapping.marketplace_listing_id ?? ""} placeholder="Listing" className={inputClass} />
                          <button type="submit" className="w-fit whitespace-nowrap rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                            Save mapping
                          </button>
                        </form>
                      </details>
                    ) : (
                      <div>
                        <span className="font-mono text-[11px]">{mapping.masterSku}</span>
                        {canEdit && mapping.is_active && (
                          <div className="mt-1 max-w-[260px] whitespace-normal text-[10px] text-amber-600">
                            Current Master SKU is inactive or merged — this row is read-only on purpose. Map the store SKU again from the form above.
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className={td("text-slate-500")}>{mapping.marketplace_listing_id || "—"}</td>
                  <td className={td()}>
                    {mapping.is_active
                      ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Active</span>
                      : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Inactive — save again to reactivate</span>}
                  </td>
                  <td className={td("text-right whitespace-nowrap")}>
                    {canEdit && mapping.is_active && (
                      <form action={deactivateMappingAction}>
                        <input type="hidden" name="return_to" value={PATH} />
                        <input type="hidden" name="mapping_id" value={mapping.id} />
                        <input type="hidden" name="company_id" value={mapping.company_id} />
                        <input type="hidden" name="reason" value="Deactivated from the Master SKU screen" />
                        <button type="submit" className="text-xs font-medium text-rose-600 underline">Deactivate</button>
                      </form>
                    )}
                  </td>
                </tr>
                );
              })}
              {mappingData.mappings.length === 0 && <EmptyRow colSpan={6} message="No store SKU mapped yet — map the first one above." />}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${cardClass} mb-4 overflow-x-auto`}>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Master catalogue</h2>
        </div>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>Photo</th>
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
              const photos = activePhotosByVariant.get(variant.id) ?? [];
              return (
                <tr key={variant.id}>
                  <td className={td()}>
                    {photos.length === 0 ? (
                      <span className="text-[11px] text-amber-600">No photo</span>
                    ) : (
                      <a href={`/api/inventory/master-photo/${photos[0].id}`} target="_blank" rel="noreferrer" title={`${photos[0].image_type} · ${photos.length} active photo(s)`}>
                        <img src={`/api/inventory/master-photo/${photos[0].id}`} alt={`${variant.master_sku} photo`} className="h-10 w-10 rounded-md border border-slate-200 object-cover" />
                      </a>
                    )}
                  </td>
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
                  <td className={td("text-right whitespace-nowrap")}>
                    {canEdit && (
                      <span className="flex items-center justify-end gap-3">
                        <Link href={`${PATH}?edit_variant=${variant.id}`} className="text-xs font-medium text-slate-600 underline">Edit</Link>
                        <form action={masterVariantDeleteAction}>
                          <input type="hidden" name="return_to" value={PATH} />
                          <input type="hidden" name="variant_id" value={variant.id} />
                          <ConfirmSubmitButton
                            message={`Delete Master SKU ${variant.master_sku}? If any store mapping or stock history points at it, it is only deactivated and stays in history.`}
                            className="text-xs font-medium text-rose-600 underline"
                          >
                            Delete
                          </ConfirmSubmitButton>
                        </form>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {catalog.variants.length === 0 && <EmptyRow colSpan={8} message="No Master SKU yet — create a master product, then its first size/colour, then add its photo." />}
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
                    <td className={td("text-right whitespace-nowrap")}>
                      {canEdit && (
                        <span className="flex items-center justify-end gap-3">
                          <Link href={`${PATH}?edit_product=${product.id}`} className="text-xs font-medium text-slate-600 underline">Edit</Link>
                          <form action={masterProductDeleteAction}>
                            <input type="hidden" name="return_to" value={PATH} />
                            <input type="hidden" name="product_id" value={product.id} />
                            <ConfirmSubmitButton
                              message={`Delete master product ${product.master_code}? Its unused Master SKUs are deleted too; any SKU that stores or stock point at is only deactivated.`}
                              className="text-xs font-medium text-rose-600 underline"
                            >
                              Delete
                            </ConfirmSubmitButton>
                          </form>
                        </span>
                      )}
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
