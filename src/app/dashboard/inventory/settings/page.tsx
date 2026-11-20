import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { getLookups } from "@/lib/inventory/queries";
import {
  categorySettingsAction,
  categoryWorkflowDeleteAction,
  productAction,
  productDeleteAction,
  variantAction,
  variantDeleteAction,
  warehouseAction,
  warehouseDeleteAction,
} from "../actions";
import { EmptyRow, InventoryTabs, MessageBanner, PageHeading, cardClass, inputClass, labelClass, td, th } from "../ui";

const PATH = "/dashboard/inventory/settings";

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function InventorySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("inventory_view");
  const sp = await searchParams;
  const canEdit = employee.capabilities.includes("inventory_settings");
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, employee.currentCompanyId);
  const products = lookups.products;
  const settingsByCategory = new Map(lookups.categorySettings.map((s) => [s.item_category_id, s]));

  const editProduct = products.find((p) => p.id === one(sp.edit_product));
  const editVariant = lookups.variants.find((v) => v.id === one(sp.edit_variant));
  const editWarehouse = lookups.warehouses.find((w) => w.id === one(sp.edit_warehouse));
  const editCategoryId = one(sp.edit_category);
  const editCategorySettings = settingsByCategory.get(editCategoryId);

  const status = (active: boolean) =>
    active ? (
      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Active</span>
    ) : (
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Inactive</span>
    );

  return (
    <div>
      <PageHeading
        title="Inventory Settings"
        subtitle="Products, categories, warehouses and variants — sab yahin se edit, deactivate ya delete hote hain. Used rows are deactivated instead of deleted so stock history stays intact."
      />
      <MessageBanner ok={typeof sp.ok === "string" ? sp.ok : undefined} error={typeof sp.error === "string" ? sp.error : undefined} />
      <InventoryTabs active={PATH} />

      {!canEdit && <p className="mb-4 text-xs text-slate-500">You can view these settings but not change them.</p>}
      {canEdit && (
        <p className="mb-4 text-xs text-slate-500">
          Delete = permanent only when nothing points at the row. If stock, ledger, an order or a store mapping already uses it, the row is
          deactivated (reversible) and the message says so.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${cardClass} p-4`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              {editCategoryId ? `Edit workflow — ${lookups.categories.find((c) => c.id === editCategoryId)?.name ?? ""}` : "Category workflow"}
            </h2>
            {editCategoryId && <Link href={PATH} className="text-xs text-slate-500 underline">Cancel edit</Link>}
          </div>
          <form action={categorySettingsAction} className="space-y-2">
            <input type="hidden" name="return_to" value={PATH} />
            <div>
              <label className={labelClass} htmlFor="cs_category">Item category</label>
              <select
                id="cs_category"
                name="item_category_id"
                required
                defaultValue={editCategoryId}
                className={inputClass}
              >
                <option value="">Select category</option>
                {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
              <label className="flex items-center gap-2"><input type="checkbox" name="is_order_based" defaultChecked={editCategorySettings?.is_order_based} /> Order-based purchase</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="requires_printing" defaultChecked={editCategorySettings?.requires_printing} /> Printing</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="requires_washing" defaultChecked={editCategorySettings?.requires_washing} /> Washing</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="manufacturing_enabled" defaultChecked={editCategorySettings?.manufacturing_enabled} /> Manufacturing</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="sqft_tracked" defaultChecked={editCategorySettings ? editCategorySettings.sqft_tracked : true} /> Track SQ FT</label>
            </div>
            <button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">
              {editCategoryId ? "Save workflow changes" : "Save workflow"}
            </button>
          </form>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead><tr><th className={th()}>Category</th><th className={th()}>Workflow</th><th className={th()}></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {lookups.categories.filter((c) => settingsByCategory.has(c.id)).map((c) => {
                  const s = settingsByCategory.get(c.id)!;
                  const tags = [
                    s.is_order_based ? "Order-based" : "Direct",
                    s.requires_printing ? "Printing" : null,
                    s.requires_washing ? "Washing" : null,
                    s.manufacturing_enabled ? "Manufacturing" : null,
                    s.sqft_tracked ? "SQ FT" : "PCS only",
                  ].filter(Boolean);
                  return (
                    <tr key={c.id}>
                      <td className={td()}>{c.name}</td>
                      <td className={td("text-slate-500")}>{tags.join(" · ")}</td>
                      <td className={td("text-right whitespace-nowrap")}>
                        {canEdit && (
                          <span className="flex items-center justify-end gap-3">
                            <Link href={`${PATH}?edit_category=${c.id}`} className="font-medium text-slate-600 underline">Edit</Link>
                            <form action={categoryWorkflowDeleteAction}>
                              <input type="hidden" name="return_to" value={PATH} />
                              <input type="hidden" name="item_category_id" value={c.id} />
                              <button type="submit" className="font-medium text-rose-600 underline">Delete</button>
                            </form>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {lookups.categorySettings.length === 0 && <EmptyRow colSpan={3} message="No category workflow configured yet." />}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${cardClass} p-4`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-700">{editWarehouse ? `Edit warehouse ${editWarehouse.code}` : "Warehouse"}</h2>
            {editWarehouse && <Link href={PATH} className="text-xs text-slate-500 underline">Cancel edit</Link>}
          </div>
          <form action={warehouseAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="return_to" value={PATH} />
            {editWarehouse && <input type="hidden" name="warehouse_id" value={editWarehouse.id} />}
            <div><label className={labelClass} htmlFor="w_name">Name</label><input id="w_name" name="name" required defaultValue={editWarehouse?.name ?? ""} className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="w_code">Code</label><input id="w_code" name="code" required defaultValue={editWarehouse?.code ?? ""} className={inputClass} placeholder="MAIN" /></div>
            <div className="sm:col-span-2"><label className={labelClass} htmlFor="w_address">Address</label><input id="w_address" name="address" defaultValue={editWarehouse?.address ?? ""} className={inputClass} /></div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" name="active" defaultChecked={editWarehouse ? editWarehouse.active : true} /> Active
            </label>
            <div className="text-right">
              <button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">
                {editWarehouse ? "Save warehouse changes" : "Save warehouse"}
              </button>
            </div>
          </form>
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {lookups.warehouses.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2">
                <span>🏬 <strong>{w.code}</strong> — {w.name}{w.address ? ` · ${w.address}` : ""} {status(w.active)}</span>
                {canEdit && (
                  <span className="flex items-center gap-3 whitespace-nowrap">
                    <Link href={`${PATH}?edit_warehouse=${w.id}`} className="font-medium text-slate-600 underline">Edit</Link>
                    <form action={warehouseDeleteAction}>
                      <input type="hidden" name="return_to" value={PATH} />
                      <input type="hidden" name="warehouse_id" value={w.id} />
                      <button type="submit" className="font-medium text-rose-600 underline">Delete</button>
                    </form>
                  </span>
                )}
              </li>
            ))}
            {lookups.warehouses.length === 0 && <li className="text-slate-400">No warehouse yet — add one before inwarding stock.</li>}
          </ul>
        </div>

        <div className={`${cardClass} p-4`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-700">{editProduct ? `Edit product ${editProduct.product_code}` : "Product"}</h2>
            {editProduct && <Link href={PATH} className="text-xs text-slate-500 underline">Cancel edit</Link>}
          </div>
          <form action={productAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="return_to" value={PATH} />
            {editProduct && <input type="hidden" name="product_id" value={editProduct.id} />}
            <div><label className={labelClass} htmlFor="p_cat">Category</label>
              <select id="p_cat" name="item_category_id" required defaultValue={editProduct?.item_category_id ?? ""} className={inputClass}>
                <option value="">Select</option>
                {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className={labelClass} htmlFor="p_name">Product name</label><input id="p_name" name="name" required defaultValue={editProduct?.name ?? ""} className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="p_code">Product code</label><input id="p_code" name="product_code" required defaultValue={editProduct?.product_code ?? ""} className={inputClass} placeholder="JUTE-001" /></div>
            <div><label className={labelClass} htmlFor="p_unit">Stock unit</label>
              <select id="p_unit" name="stock_unit" defaultValue={editProduct?.stock_unit ?? "PCS"} className={inputClass}><option value="PCS">PCS</option><option value="SQFT">SQ FT</option></select>
            </div>
            <div><label className={labelClass} htmlFor="p_type">Purchase type</label>
              <select id="p_type" name="purchase_type" defaultValue={editProduct?.purchase_type ?? "DIRECT"} className={inputClass}><option value="DIRECT">Direct purchase</option><option value="ORDER_BASED">Order-based</option></select>
            </div>
            <div><label className={labelClass} htmlFor="p_min">Minimum stock (PCS)</label><input id="p_min" name="min_stock_pcs" type="number" step="0.001" min="0" defaultValue={editProduct?.min_stock_pcs ?? 0} className={inputClass} /></div>
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="processing_required" defaultChecked={editProduct?.processing_required} /> Needs printing/washing</label>
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="manufacturing_enabled" defaultChecked={editProduct?.manufacturing_enabled} /> Manufactured in-house</label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" name="active" defaultChecked={editProduct ? editProduct.active : true} /> Active
            </label>
            <div className="text-right">
              <button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">
                {editProduct ? "Save product changes" : "Save product"}
              </button>
            </div>
          </form>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead><tr><th className={th()}>Code</th><th className={th()}>Name</th><th className={th()}>Type</th><th className={th()}>Status</th><th className={th()}></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id}>
                    <td className={td("font-medium")}>{p.product_code}</td>
                    <td className={td()}>{p.name}</td>
                    <td className={td("text-slate-500")}>{p.purchase_type}</td>
                    <td className={td()}>{status(p.active)}</td>
                    <td className={td("text-right whitespace-nowrap")}>
                      {canEdit && (
                        <span className="flex items-center justify-end gap-3">
                          <Link href={`${PATH}?edit_product=${p.id}`} className="font-medium text-slate-600 underline">Edit</Link>
                          <form action={productDeleteAction}>
                            <input type="hidden" name="return_to" value={PATH} />
                            <input type="hidden" name="product_id" value={p.id} />
                            <button type="submit" className="font-medium text-rose-600 underline">Delete</button>
                          </form>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {products.length === 0 && <EmptyRow colSpan={5} message="No products yet." />}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${cardClass} p-4`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-700">{editVariant ? `Edit ${editVariant.sku}` : "Variant (size / colour)"}</h2>
            {editVariant && <Link href={PATH} className="text-xs text-slate-500 underline">Cancel edit</Link>}
          </div>
          <form action={variantAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="return_to" value={PATH} />
            {editVariant && <input type="hidden" name="variant_id" value={editVariant.id} />}
            <div className="sm:col-span-2"><label className={labelClass} htmlFor="v_product">Product</label>
              <select id="v_product" name="product_id" required defaultValue={editVariant?.product_id ?? ""} className={inputClass}>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.product_code} — {p.name}</option>)}
              </select>
            </div>
            <div><label className={labelClass} htmlFor="v_sku">Variant SKU</label><input id="v_sku" name="sku" required defaultValue={editVariant?.sku ?? ""} className={inputClass} placeholder="JUTE-001-4X6" /></div>
            <div><label className={labelClass} htmlFor="v_size">Size</label><input id="v_size" name="size_label" defaultValue={editVariant?.size_label ?? ""} className={inputClass} placeholder="4x6" /></div>
            <div><label className={labelClass} htmlFor="v_colour">Colour</label><input id="v_colour" name="colour" defaultValue={editVariant?.colour ?? ""} className={inputClass} /></div>
            <div className="text-[11px] text-slate-500">Length and width (feet) drive the automatic SQ FT. Leave both blank for PCS-only products.</div>
            <div><label className={labelClass} htmlFor="v_len">Length (ft)</label><input id="v_len" name="length_ft" type="number" step="0.001" min="0" defaultValue={editVariant?.length_ft ?? ""} className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="v_wid">Width (ft)</label><input id="v_wid" name="width_ft" type="number" step="0.001" min="0" defaultValue={editVariant?.width_ft ?? ""} className={inputClass} /></div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" name="active" defaultChecked={editVariant ? editVariant.active : true} /> Active
            </label>
            <div className="text-right">
              <button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">
                {editVariant ? "Save variant changes" : "Save variant"}
              </button>
            </div>
          </form>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead><tr><th className={th()}>SKU</th><th className={th()}>Size</th><th className={th()}>Colour</th><th className={th("text-right")}>SQ FT/pc</th><th className={th()}>Status</th><th className={th()}></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {lookups.variants.map((v) => (
                  <tr key={v.id}>
                    <td className={td("font-medium")}>{v.sku}</td><td className={td()}>{v.size_label || "—"}</td>
                    <td className={td()}>{v.colour || "—"}</td>
                    <td className={td("text-right")}>{v.sqft_per_piece ?? "—"}</td>
                    <td className={td()}>{status(v.active)}</td>
                    <td className={td("text-right whitespace-nowrap")}>
                      {canEdit && (
                        <span className="flex items-center justify-end gap-3">
                          <Link href={`${PATH}?edit_variant=${v.id}`} className="font-medium text-slate-600 underline">Edit</Link>
                          <form action={variantDeleteAction}>
                            <input type="hidden" name="return_to" value={PATH} />
                            <input type="hidden" name="variant_id" value={v.id} />
                            <button type="submit" className="font-medium text-rose-600 underline">Delete</button>
                          </form>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {lookups.variants.length === 0 && <EmptyRow colSpan={6} message="No variants yet." />}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
