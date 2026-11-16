import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { getLookups } from "@/lib/inventory/queries";
import { categorySettingsAction, productAction, variantAction, warehouseAction } from "../actions";
import { EmptyRow, InventoryTabs, MessageBanner, PageHeading, cardClass, inputClass, labelClass, td, th } from "../ui";

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

  return (
    <div>
      <PageHeading
        title="Inventory Settings"
        subtitle="Products and variants define what can be stocked; category workflows decide printing, washing, manufacturing and SQ FT tracking."
      />
      <MessageBanner ok={typeof sp.ok === "string" ? sp.ok : undefined} error={typeof sp.error === "string" ? sp.error : undefined} />
      <InventoryTabs active="/dashboard/inventory/settings" />

      {!canEdit && <p className="mb-4 text-xs text-slate-500">You can view these settings but not change them.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${cardClass} p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Category workflow</h2>
          <form action={categorySettingsAction} className="space-y-2">
            <input type="hidden" name="return_to" value="/dashboard/inventory/settings" />
            <div>
              <label className={labelClass} htmlFor="cs_category">Item category</label>
              <select id="cs_category" name="item_category_id" required className={inputClass}>
                <option value="">Select category</option>
                {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
              <label className="flex items-center gap-2"><input type="checkbox" name="is_order_based" /> Order-based purchase</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="requires_printing" /> Printing</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="requires_washing" /> Washing</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="manufacturing_enabled" /> Manufacturing</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="sqft_tracked" defaultChecked /> Track SQ FT</label>
            </div>
            <button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">Save workflow</button>
          </form>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead><tr><th className={th()}>Category</th><th className={th()}>Workflow</th></tr></thead>
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
                  return <tr key={c.id}><td className={td()}>{c.name}</td><td className={td("text-slate-500")}>{tags.join(" · ")}</td></tr>;
                })}
                {lookups.categorySettings.length === 0 && <EmptyRow colSpan={2} message="No category workflow configured yet." />}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${cardClass} p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Warehouse</h2>
          <form action={warehouseAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="return_to" value="/dashboard/inventory/settings" />
            <div><label className={labelClass} htmlFor="w_name">Name</label><input id="w_name" name="name" required className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="w_code">Code</label><input id="w_code" name="code" required className={inputClass} placeholder="MAIN" /></div>
            <div className="sm:col-span-2"><label className={labelClass} htmlFor="w_address">Address</label><input id="w_address" name="address" className={inputClass} /></div>
            <div className="sm:col-span-2"><button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">Save warehouse</button></div>
          </form>
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {lookups.warehouses.map((w) => <li key={w.id}>🏬 <strong>{w.code}</strong> — {w.name}</li>)}
            {lookups.warehouses.length === 0 && <li className="text-slate-400">No warehouse yet — add one before inwarding stock.</li>}
          </ul>
        </div>

        <div className={`${cardClass} p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Product</h2>
          <form action={productAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="return_to" value="/dashboard/inventory/settings" />
            <div><label className={labelClass} htmlFor="p_cat">Category</label>
              <select id="p_cat" name="item_category_id" required className={inputClass}>
                <option value="">Select</option>
                {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className={labelClass} htmlFor="p_name">Product name</label><input id="p_name" name="name" required className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="p_code">Product code</label><input id="p_code" name="product_code" required className={inputClass} placeholder="JUTE-001" /></div>
            <div><label className={labelClass} htmlFor="p_unit">Stock unit</label>
              <select id="p_unit" name="stock_unit" className={inputClass}><option value="PCS">PCS</option><option value="SQFT">SQ FT</option></select>
            </div>
            <div><label className={labelClass} htmlFor="p_type">Purchase type</label>
              <select id="p_type" name="purchase_type" className={inputClass}><option value="DIRECT">Direct purchase</option><option value="ORDER_BASED">Order-based</option></select>
            </div>
            <div><label className={labelClass} htmlFor="p_min">Minimum stock (PCS)</label><input id="p_min" name="min_stock_pcs" type="number" step="0.001" min="0" defaultValue={0} className={inputClass} /></div>
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="processing_required" /> Needs printing/washing</label>
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="manufacturing_enabled" /> Manufactured in-house</label>
            <div className="sm:col-span-2"><button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">Save product</button></div>
          </form>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead><tr><th className={th()}>Code</th><th className={th()}>Name</th><th className={th()}>Type</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => <tr key={p.id}><td className={td("font-medium")}>{p.product_code}</td><td className={td()}>{p.name}</td><td className={td("text-slate-500")}>{p.purchase_type}</td></tr>)}
                {products.length === 0 && <EmptyRow colSpan={3} message="No products yet." />}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${cardClass} p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Variant (size / colour)</h2>
          <form action={variantAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="return_to" value="/dashboard/inventory/settings" />
            <div className="sm:col-span-2"><label className={labelClass} htmlFor="v_product">Product</label>
              <select id="v_product" name="product_id" required className={inputClass}>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.product_code} — {p.name}</option>)}
              </select>
            </div>
            <div><label className={labelClass} htmlFor="v_sku">Variant SKU</label><input id="v_sku" name="sku" required className={inputClass} placeholder="JUTE-001-4X6" /></div>
            <div><label className={labelClass} htmlFor="v_size">Size</label><input id="v_size" name="size_label" className={inputClass} placeholder="4x6" /></div>
            <div><label className={labelClass} htmlFor="v_colour">Colour</label><input id="v_colour" name="colour" className={inputClass} /></div>
            <div className="text-[11px] text-slate-500">Length and width (feet) drive the automatic SQ FT. Leave both blank for PCS-only products.</div>
            <div><label className={labelClass} htmlFor="v_len">Length (ft)</label><input id="v_len" name="length_ft" type="number" step="0.001" min="0" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="v_wid">Width (ft)</label><input id="v_wid" name="width_ft" type="number" step="0.001" min="0" className={inputClass} /></div>
            <div className="sm:col-span-2"><button type="submit" disabled={!canEdit} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">Save variant</button></div>
          </form>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead><tr><th className={th()}>SKU</th><th className={th()}>Size</th><th className={th()}>Colour</th><th className={th("text-right")}>SQ FT/pc</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {lookups.variants.map((v) => (
                  <tr key={v.id}>
                    <td className={td("font-medium")}>{v.sku}</td><td className={td()}>{v.size_label || "—"}</td>
                    <td className={td()}>{v.colour || "—"}</td>
                    <td className={td("text-right")}>{v.sqft_per_piece ?? "—"}</td>
                  </tr>
                ))}
                {lookups.variants.length === 0 && <EmptyRow colSpan={4} message="No variants yet." />}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
