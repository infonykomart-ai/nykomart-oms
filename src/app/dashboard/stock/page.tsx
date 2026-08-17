import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { StockTabs } from "./stock-tabs";

// Stock module (raw material) — 2026-08-10. See actions.ts header comment
// for the full "why this was still missing" story. The `stock_entry`
// capability + dashboard tile existed since the original seed, pointing
// here, but nothing had built the page — this fills in the 404.
const RECENT_LIMIT = 50;

export default async function StockPage() {
  await requireCapability("stock_entry");
  const supabase = await createClient();

  const [{ data: parties }, { data: stockIn }, { data: stockOut }, { data: currentStock }, { data: materialOutChalans }] = await Promise.all([
    supabase.from("parties").select("id, name").order("name"),
    supabase
      .from("stock_in")
      .select(
        "id, source_party_id, sku_code, product_name, chalan_no, in_date, quantity_in, rate_per_qty, party_chalan_no, our_chalan_no, bill_no, bill_date, paid_date, remark, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase
      .from("stock_out")
      .select("id, source_party_id, sku_code, product_name, chalan_no, chalan_id, out_date, quantity_out, remark, created_at")
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
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

  // Queried separately by chalan_id (rather than reusing the RECENT_LIMIT-
  // capped stockOut query above) so a chalan with several lines can't lose
  // some of them off the edge of that unrelated "most recent 50 Stock Out
  // rows overall" window.
  const chalanIds = (materialOutChalans ?? []).map((c) => c.id);
  const { data: chalanLines } = chalanIds.length
    ? await supabase.from("stock_out").select("chalan_id, sku_code, quantity_out").in("chalan_id", chalanIds)
    : { data: [] as { chalan_id: string | null; sku_code: string; quantity_out: number }[] };
  const materialOutChalanRows = (materialOutChalans ?? []).map((c) => ({
    id: c.id,
    chalan_no: c.chalan_no,
    chalan_date: c.chalan_date,
    remark: c.remark,
    partyName: partyName.get(c.party_id) ?? "—",
    lines: (chalanLines ?? [])
      .filter((r) => r.chalan_id === c.id)
      .map((r) => ({ sku_code: r.sku_code, quantity_out: r.quantity_out })),
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

      <StockTabs
        parties={parties ?? []}
        skuOptions={skuOptions}
        recentIn={(stockIn ?? []).map((r) => ({ ...r, sourceName: partyName.get(r.source_party_id) ?? "—" }))}
        recentOut={(stockOut ?? []).map((r) => ({ ...r, sourceName: partyName.get(r.source_party_id) ?? "—" }))}
        currentStock={currentStockRows.map((r) => ({ ...r, sourceName: partyName.get(r.source_party_id) ?? "—" }))}
        materialOutChalans={materialOutChalanRows}
      />
    </div>
  );
}
