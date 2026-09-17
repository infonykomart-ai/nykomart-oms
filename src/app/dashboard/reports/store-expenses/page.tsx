import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { matchMarketplaceFees } from "@/lib/orders/marketplace-fees";
import {
  StoreExpenseReportTable,
  type ByOrderRow,
  type MonthlyRow,
  type StoreRow,
} from "./store-expense-report-table";

// Store Expense Report (2026-09-09) — "sabhi order ke store expances kaha
// dikh rahe hai agar kisi perticular order ka dekhe ya monthly dekhe ya
// store wise dekhe". Follow-up to the 2026-08-13 per-order Etsy/eBay/
// Amazon fee-matching feature on the Orders hub (that's per-order only, no
// rollup) — this is a dedicated report on the SAME matched-fee data
// (matchMarketplaceFees(), shared with orders/page.tsx so the two can
// never drift apart), viewable 3 ways: By Order (one row per order that
// has a matched fee, itemized lines expandable), Monthly (summed per
// month), and Store-wise (summed per store). Deliberately does NOT invent
// a combined "total expense" figure across Etsy (₹)/eBay ($)/Amazon
// (multi-currency) — see each row/column comment below for why.
//
// This is real matched marketplace-statement fee data, NOT the flat
// 25%-of-order-value assumption the Sale & Profit report uses (see that
// page's own header comment on why it can't attribute real per-order
// fees) — an order only appears here once its store's Etsy Ledger / eBay
// Tax Invoice / Amazon Transactions statement has actually been imported
// and its order number matched.
export default async function StoreExpenseReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const storeId = typeof sp.store === "string" && sp.store ? sp.store : "";
  const now = new Date(); // server-render time, fine here (not inside a workflow script)
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const defaultTo = now.toISOString().slice(0, 10);
  const fromDate = typeof sp.from === "string" && sp.from ? sp.from : defaultFrom;
  const toDate = typeof sp.to === "string" && sp.to ? sp.to : defaultTo;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const scopedCompanyIds = companyId ? [companyId] : employee.companyIds;

  const [{ data: companies }, { data: allStores }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("stores").select("id, name, company_id").in("company_id", employee.companyIds).order("name"),
  ]);
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const storeName = new Map((allStores ?? []).map((s) => [s.id, s.name]));
  const storesForFilter = (allStores ?? []).filter((s) => !companyId || s.company_id === companyId);

  let orderQuery = supabase
    .from("orders")
    .select("id, ref_no, order_date, company_id, store_id, status, marketplace_order_no")
    .in("company_id", scopedCompanyIds)
    .gte("order_date", fromDate)
    .lte("order_date", toDate)
    .order("order_date", { ascending: false })
    .limit(2000);
  if (storeId) orderQuery = orderQuery.eq("store_id", storeId);
  if (q) orderQuery = orderQuery.or(`ref_no.ilike.%${q}%,marketplace_order_no.ilike.%${q}%`);

  const { data: orders } = await orderQuery;

  const { etsyFeesByOrder, ebayFeesByOrder, amazonFeesByOrder } = await matchMarketplaceFees(
    supabase,
    orders ?? [],
    scopedCompanyIds
  );

  const byOrderRows: ByOrderRow[] = (orders ?? [])
    .filter((o) => etsyFeesByOrder[o.id] || ebayFeesByOrder[o.id] || amazonFeesByOrder[o.id])
    .map((o) => ({
      orderId: o.id,
      refNo: o.ref_no,
      orderDate: o.order_date,
      companyName: companyName.get(o.company_id) ?? "—",
      storeName: o.store_id ? (storeName.get(o.store_id) ?? "—") : "—",
      status: o.status,
      marketplaceOrderNo: o.marketplace_order_no,
      etsy: etsyFeesByOrder[o.id] ?? null,
      ebay: ebayFeesByOrder[o.id] ?? null,
      amazon: amazonFeesByOrder[o.id] ?? null,
    }));

  // Monthly and Store-wise roll-ups: sum each marketplace's currency
  // SEPARATELY (never mixed with another marketplace or another currency —
  // Etsy is always ₹, eBay is always $, Amazon can be any of several). A
  // "month" key here is the order's own order_date's YYYY-MM (IST/UTC
  // distinction doesn't matter at day granularity for a monthly rollup).
  type Bucket = { orderCount: number; etsyInr: number; ebayUsd: number; amazonByCurrency: Map<string, number> };
  function bump(bucket: Bucket, o: (typeof byOrderRows)[number]) {
    bucket.orderCount += 1;
    if (o.etsy) bucket.etsyInr += o.etsy.totalFeesInr;
    if (o.ebay) bucket.ebayUsd += o.ebay.totalFeesUsd;
    if (o.amazon) {
      for (const t of o.amazon.totalsByCurrency) {
        bucket.amazonByCurrency.set(t.currency, (bucket.amazonByCurrency.get(t.currency) ?? 0) + t.totalFees);
      }
    }
  }
  function emptyBucket(): Bucket {
    return { orderCount: 0, etsyInr: 0, ebayUsd: 0, amazonByCurrency: new Map() };
  }
  function amazonText(m: Map<string, number>): string {
    return Array.from(m.entries())
      .map(([cur, total]) => `${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${cur}`)
      .join(", ");
  }

  const monthlyMap = new Map<string, Bucket>();
  const storeMap = new Map<string, Bucket>();
  for (const o of byOrderRows) {
    const monthKey = o.orderDate ? o.orderDate.slice(0, 7) : "—";
    bump(monthlyMap.get(monthKey) ?? monthlyMap.set(monthKey, emptyBucket()).get(monthKey)!, o);
    const storeKey = o.storeName;
    bump(storeMap.get(storeKey) ?? storeMap.set(storeKey, emptyBucket()).get(storeKey)!, o);
  }

  const monthlyRows: MonthlyRow[] = Array.from(monthlyMap.entries())
    .map(([month, b]) => ({
      month,
      orderCount: b.orderCount,
      etsyInr: b.etsyInr,
      ebayUsd: b.ebayUsd,
      amazonText: amazonText(b.amazonByCurrency),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));

  const storeRows: StoreRow[] = Array.from(storeMap.entries())
    .map(([storeNameKey, b]) => ({
      storeName: storeNameKey,
      orderCount: b.orderCount,
      etsyInr: b.etsyInr,
      ebayUsd: b.ebayUsd,
      amazonText: amazonText(b.amazonByCurrency),
    }))
    .sort((a, b) => b.orderCount - a.orderCount);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Store Expense Report</h1>
        </div>
        <Link
          href="/dashboard/reports"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Reports
        </Link>
      </div>

      <StoreExpenseReportTable
        companies={companies ?? []}
        stores={storesForFilter}
        filters={{ companyId, storeId, fromDate, toDate, q }}
        byOrderRows={byOrderRows}
        monthlyRows={monthlyRows}
        storeRows={storeRows}
      />
    </div>
  );
}
