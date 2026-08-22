import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { StockTabs } from "./stock-tabs";

// Stock module (raw material) — 2026-08-10. See actions.ts header comment
// for the full "why this was still missing" story. The `stock_entry`
// capability + dashboard tile existed since the original seed, pointing
// here, but nothing had built the page — this fills in the 404.
const RECENT_LIMIT = 50;
// 2026-08-17 — Reorder Alerts window: "past 3-6 month sale rate se reorder
// alert" from the OMS-features gap audit. Landed on 90 days (3 months) as
// the consumption-rate lookback — long enough to smooth out one-off
// spikes, short enough to still reflect recent real usage rather than
// stale demand from 6 months ago.
const CONSUMPTION_WINDOW_DAYS = 90;
// Below this many days of cover at the recent consumption rate, flag it —
// intentionally simple (average daily usage, not a seasonality model);
// see the section's own on-page caption for the same caveat in plain
// language for the person reading it.
const REORDER_ALERT_DAYS_OF_COVER = 30;

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// 2026-08-22 — filter UI added (GET-form + searchParams, same pattern as
// Orders). Before this, Stock had no filter UI at all — Stock In / Stock
// Out each showed a plain "most recent RECENT_LIMIT rows" list with
// nothing to narrow it down. Applies to both stock ledger entries (Stock
// In's in_date, Stock Out's out_date) — party (source_party_id) and sku
// (sku_code) are the same columns on both tables so one filter form covers
// both tabs.
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireCapability("stock_entry");
  const supabase = await createClient();
  const sp = await searchParams;

  const partyFilter = typeof sp.party === "string" ? sp.party : "";
  const skuFilter = typeof sp.sku === "string" ? sp.sku : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";

  let stockInQuery = supabase
    .from("stock_in")
    .select(
      "id, source_party_id, sku_code, product_name, chalan_no, in_date, quantity_in, rate_per_qty, party_chalan_no, our_chalan_no, bill_no, bill_date, paid_date, remark, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (partyFilter) stockInQuery = stockInQuery.eq("source_party_id", partyFilter);
  if (skuFilter) stockInQuery = stockInQuery.eq("sku_code", skuFilter);
  if (fromDate) stockInQuery = stockInQuery.gte("in_date", fromDate);
  if (toDate) stockInQuery = stockInQuery.lte("in_date", toDate);

  let stockOutQuery = supabase
    .from("stock_out")
    .select("id, source_party_id, sku_code, product_name, chalan_no, chalan_id, out_date, quantity_out, remark, created_at")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (partyFilter) stockOutQuery = stockOutQuery.eq("source_party_id", partyFilter);
  if (skuFilter) stockOutQuery = stockOutQuery.eq("sku_code", skuFilter);
  if (fromDate) stockOutQuery = stockOutQuery.gte("out_date", fromDate);
  if (toDate) stockOutQuery = stockOutQuery.lte("out_date", toDate);

  const [{ data: parties }, { data: stockIn }, { data: stockOut }, { data: currentStock }, { data: materialOutChalans }, { data: recentConsumption }] =
    await Promise.all([
    supabase.from("parties").select("id, name").order("name"),
    stockInQuery,
    stockOutQuery,
    supabase
      .from("stock_current_view")
      .select("source_party_id, sku_code, product_name, current_stock")
      .order("sku_code"),
    // 2026-08-17 — Material OUT Chalan (see stock/actions.ts's
    // createMaterialOutChalan): one header can cover several stock_out
    // rows, so its own "recent" list is built from the header table, with
    // matching lines pulled from the stockOut query above (same chalan_id)
    // rather than a second round-trip.
    supabase
      .from("material_out_chalans")
      .select("id, chalan_no, chalan_date, party_id, remark, created_at")
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    // 2026-08-17 — Reorder Alerts: every Stock Out row (unbounded by
    // RECENT_LIMIT unlike the "recent activity" query above, since this
    // needs the FULL last-90-days picture per SKU to compute a real
    // consumption rate, not just the latest 50 rows system-wide) in the
    // lookback window, minimal columns only.
    supabase
      .from("stock_out")
      .select("source_party_id, sku_code, quantity_out, out_date")
      .gte("out_date", daysAgoIso(CONSUMPTION_WINDOW_DAYS)),
  ]);

  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));
  // stock_current_view's columns come back nullable in the generated types
  // (Postgres views built on LEFT JOINs are always reported nullable, even
  // though source_party_id/sku_code are NOT NULL on the underlying
  // stock_items table) — filter out the theoretical null case rather than
  // coercing with `!`, so a real null can't silently produce a broken row.
  const currentStockRows = (currentStock ?? []).filter(
    (r): r is typeof r & { source_party_id: string; sku_code: string; current_stock: number } =>
      r.source_party_id !== null && r.sku_code !== null && r.current_stock !== null
  );
  const skuOptions = Array.from(new Set(currentStockRows.map((r) => r.sku_code))).sort();

  // Reorder Alerts — simple average-daily-usage forecast, no seasonality:
  // consumption rate = (sum of Stock Out over the last CONSUMPTION_WINDOW_DAYS)
  // / CONSUMPTION_WINDOW_DAYS, days of cover = current_stock / that rate.
  // Deliberately excludes SKUs with zero recent consumption — a low
  // current_stock on something nobody's actually using isn't a reorder
  // signal, it's just an unused item.
  const consumptionBySku = new Map<string, number>();
  for (const row of recentConsumption ?? []) {
    const key = `${row.source_party_id}::${row.sku_code}`;
    consumptionBySku.set(key, (consumptionBySku.get(key) ?? 0) + Number(row.quantity_out));
  }
  const reorderAlerts = currentStockRows
    .map((r) => {
      const key = `${r.source_party_id}::${r.sku_code}`;
      const consumedInWindow = consumptionBySku.get(key) ?? 0;
      const dailyRate = consumedInWindow / CONSUMPTION_WINDOW_DAYS;
      const daysOfCover = dailyRate > 0 ? r.current_stock / dailyRate : null;
      return { ...r, consumedInWindow, dailyRate, daysOfCover };
    })
    .filter((r) => r.daysOfCover !== null && r.daysOfCover < REORDER_ALERT_DAYS_OF_COVER)
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));

  // Queried separately by chalan_id (rather than reusing the RECENT_LIMIT-
  // capped stockOut query above) so a chalan with several lines can't lose
  // some of them off the edge of that unrelated "most recent 50 Stock Out
  // rows overall" window.
  const chalanIds = (materialOutChalans ?? []).map((c) => c.id);
  const { data: chalanLines } = chalanIds.length
    ? await supabase.from("stock_out").select("id, chalan_id, sku_code, quantity_out").in("chalan_id", chalanIds)
    : { data: [] as { id: string; chalan_id: string | null; sku_code: string; quantity_out: number }[] };

  // 2026-08-17 — "KACHA MAAL BAHR SE BINA PO KE AA SKATA HAI LEKIN JA NAHI
  // SAKTA": pull the optional order links for every stock_out row we're
  // about to render (both the plain Stock Out recent list and every
  // Material OUT Chalan line), joined to the order's ref_no for display —
  // see db/2026-08-17-stock-out-order-links.sql.
  const allStockOutIds = Array.from(
    new Set([...(stockOut ?? []).map((r) => r.id), ...(chalanLines ?? []).map((r) => r.id)])
  );
  const { data: orderLinks } = allStockOutIds.length
    ? await supabase
        .from("stock_out_order_links")
        .select("stock_out_id, order_id, orders(ref_no)")
        .in("stock_out_id", allStockOutIds)
    : { data: [] as { stock_out_id: string; order_id: string; orders: { ref_no: string } | null }[] };
  const linkedOrdersByStockOutId = new Map<string, { orderId: string; refNo: string }[]>();
  for (const link of orderLinks ?? []) {
    if (!link.orders) continue;
    const list = linkedOrdersByStockOutId.get(link.stock_out_id) ?? [];
    list.push({ orderId: link.order_id, refNo: link.orders.ref_no });
    linkedOrdersByStockOutId.set(link.stock_out_id, list);
  }

  const materialOutChalanRows = (materialOutChalans ?? []).map((c) => ({
    id: c.id,
    chalan_no: c.chalan_no,
    chalan_date: c.chalan_date,
    remark: c.remark,
    partyName: partyName.get(c.party_id) ?? "—",
    lines: (chalanLines ?? [])
      .filter((r) => r.chalan_id === c.id)
      .map((r) => ({
        sku_code: r.sku_code,
        quantity_out: r.quantity_out,
        linkedOrders: linkedOrdersByStockOutId.get(r.id) ?? [],
      })),
  }));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📦 Stock (Raw Material)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stock In / Stock Out per Source + SKU — Chalan No. mandatory on every live entry. Current Stock is always
            computed live from the In/Out ledger, never stored.
          </p>
        </div>
        <Link
          href="/dashboard/stock/bulk-upload"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          📤 Bulk Upload (CSV)
        </Link>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="party">Source (Party)</label>
          <select id="party" name="party" defaultValue={partyFilter} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All</option>
            {(parties ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
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
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
        <a href="/dashboard/stock" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">🔔 Reorder Alerts</h2>
        <p className="mb-3 text-xs text-slate-500">
          Simple forecast, not a seasonality model: current stock ÷ average daily Stock Out over the last{" "}
          {CONSUMPTION_WINDOW_DAYS} days. Items with under {REORDER_ALERT_DAYS_OF_COVER} days of cover left at that
          rate are listed below. An item with zero recent Stock Out is never flagged, even at 0 stock — no recent
          usage means no reorder signal, not a shortage.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr>
                <th className="whitespace-nowrap px-3 py-1.5 text-left text-xs font-semibold text-slate-500">Source</th>
                <th className="whitespace-nowrap px-3 py-1.5 text-left text-xs font-semibold text-slate-500">SKU</th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right text-xs font-semibold text-slate-500">Current Stock</th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right text-xs font-semibold text-slate-500">
                  Used (last {CONSUMPTION_WINDOW_DAYS}d)
                </th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right text-xs font-semibold text-slate-500">Days of Cover Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reorderAlerts.map((r) => (
                <tr key={`${r.source_party_id}-${r.sku_code}`}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{partyName.get(r.source_party_id) ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">{r.sku_code}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">{r.current_stock}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">{r.consumedInWindow}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-red-700">
                    {r.daysOfCover !== null ? Math.max(0, Math.round(r.daysOfCover)) : "—"}
                  </td>
                </tr>
              ))}
              {reorderAlerts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                    Nothing under {REORDER_ALERT_DAYS_OF_COVER} days of cover right now. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <StockTabs
        parties={parties ?? []}
        skuOptions={skuOptions}
        recentIn={(stockIn ?? []).map((r) => ({ ...r, sourceName: partyName.get(r.source_party_id) ?? "—" }))}
        recentOut={(stockOut ?? []).map((r) => ({
          ...r,
          sourceName: partyName.get(r.source_party_id) ?? "—",
          linkedOrders: linkedOrdersByStockOutId.get(r.id) ?? [],
        }))}
        currentStock={currentStockRows.map((r) => ({ ...r, sourceName: partyName.get(r.source_party_id) ?? "—" }))}
        materialOutChalans={materialOutChalanRows}
      />
    </div>
  );
}
