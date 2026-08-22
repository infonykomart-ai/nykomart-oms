import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";

// Inventory / Stock for finished goods (pending item 4, 2026-08-08) — see
// db/2026-08-08-inventory-finished-stock.sql for the full design. Scope
// confirmed with the user: read-only view of auto-restocked stock, no
// manual Stock In/Out for finished goods (out of scope for now — see
// saveOrderRefund in ../orders/actions.ts for the only writer: a cancelled
// order that already had a Purchase Bill flows its purchased qty in here).
// The "stock-check popup at order entry" half of this feature lives in
// ../orders/new/order-form.tsx (checkFinishedStockAction).
// 2026-08-22 — filter UI added (GET-form + searchParams, same pattern as
// Orders). Before this, Inventory had no filter UI at all. SKU/Size options
// for the dropdowns are built from the DISTINCT values actually present in
// finished_stock (no fixed master list to join against here — sku_label/
// size_label are free-text snapshots copied in at restock time, same as
// orders.sku_label/size_label they originate from).
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireCapability("finished_stock_view");
  const supabase = await createClient();
  const sp = await searchParams;

  const skuFilter = typeof sp.sku === "string" ? sp.sku : "";
  const sizeFilter = typeof sp.size === "string" ? sp.size : "";

  let stockQuery = supabase
    .from("finished_stock")
    .select("id, item_category_id, sku_label, size_label, qty, updated_at")
    // 2026-08-18 perf fix — no limit here before; naturally bounded today
    // by (item_category_id, sku_label, size_label) cardinality (the unique
    // key), not by order volume, so this isn't urgent, but flagged in the
    // 2026-08-17 perf audit as worth capping defensively rather than
    // relying on that staying true forever.
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (skuFilter) stockQuery = stockQuery.eq("sku_label", skuFilter);
  if (sizeFilter) stockQuery = stockQuery.eq("size_label", sizeFilter);

  const [{ data: stock }, { data: movements }, { data: itemCategories }, { data: allSkuSize }] = await Promise.all([
    stockQuery,
    supabase
      .from("finished_stock_movements")
      .select("id, item_category_id, sku_label, size_label, qty_change, reason, order_id, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("item_categories").select("id, name"),
    supabase.from("finished_stock").select("sku_label, size_label"),
  ]);

  const skuOptions = Array.from(new Set((allSkuSize ?? []).map((s) => s.sku_label).filter((s): s is string => !!s))).sort();
  const sizeOptions = Array.from(new Set((allSkuSize ?? []).map((s) => s.size_label).filter((s): s is string => !!s))).sort();

  const categoryName = new Map((itemCategories ?? []).map((c) => [c.id, c.name]));

  const orderIds = [...new Set((movements ?? []).map((m) => m.order_id).filter((id): id is string => !!id))];
  const { data: orders } = orderIds.length ? await supabase.from("orders").select("id, ref_no").in("id", orderIds) : { data: [] };
  const orderRefNo = new Map((orders ?? []).map((o) => [o.id, o.ref_no]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">📦 Inventory — Finished Goods</h1>
        <p className="mt-1 text-sm text-slate-500">
          Auto-restocked only — when a cancelled order that already had a Purchase Bill gets refunded, its purchased
          quantity flows in here automatically. No manual Stock In/Out for finished goods.
        </p>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="sku">SKU</label>
          <select id="sku" name="sku" defaultValue={skuFilter} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All</option>
            {skuOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="size">Size</label>
          <select id="size" name="size" defaultValue={sizeFilter} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All</option>
            {sizeOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
        <a href="/dashboard/inventory" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Current Stock ({(stock ?? []).length})</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Item Category</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">SKU</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Size</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(stock ?? []).map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{categoryName.get(s.item_category_id) ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{s.sku_label || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{s.size_label || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-900">{s.qty}</td>
                  </tr>
                ))}
                {(stock ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                      No stock yet — this fills in automatically as cancelled+refunded+already-purchased orders come in.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent Restock Activity</h2>
          <div className="space-y-1.5">
            {(movements ?? []).map((m) => (
              <div key={m.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900">
                      {categoryName.get(m.item_category_id) ?? "—"} {m.sku_label ? `· ${m.sku_label}` : ""} {m.size_label ? `· ${m.size_label}` : ""}
                    </div>
                    <div className="text-slate-400">
                      {m.order_id ? `Order ${orderRefNo.get(m.order_id) ?? "—"}` : "—"} · {m.reason}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-teal-700">+{m.qty_change}</div>
                    <div className="text-slate-400">{new Date(m.created_at).toISOString().slice(0, 10)}</div>
                  </div>
                </div>
              </div>
            ))}
            {(movements ?? []).length === 0 && <p className="text-xs text-slate-400">No activity yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
