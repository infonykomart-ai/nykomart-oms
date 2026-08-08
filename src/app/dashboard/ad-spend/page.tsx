import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdSpendEntrySection } from "./ad-spend-entry-section";
import { AdSpendReportTable, type AdSpendDailyRow, type AdSpendMonthlyRow } from "./ad-spend-report-table";

// Store-level Daily Spend tracking (pending item 3, 2026-08-08 —
// "STORE KI REPORT NIKALENGE TO EASY WAY MIL JAYEGI SABHI CHIJE EK DUSRE SE
// CONNECT RAHEGI"). Design confirmed with the user: QTY ORD and USD (order
// count / order value) are computed LIVE by joining `orders` here — never
// stored. Only Budget/Spend (USD) are genuinely external ad-platform
// numbers, entered manually per store per day into store_ad_spend (see
// db/2026-08-08-store-ad-spend.sql). Two tabs: Entry (today's/any day's
// Budget+Spend per store) and Report (Daily master + Monthly roll-up,
// matching the old system's SUMMERY2026.html / MONTHLY REPORT.html shapes).
export default async function AdSpendPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  const tab = sp.tab === "report" ? "report" : "entry";
  const companyFilter = typeof sp.company === "string" && sp.company ? sp.company : "";

  // 2026-08-08: "AD SPEND VALI JO ENTRY HAI VO SIRF UTNI HI ENTRY DIKHNI
  // CHAHIYE JIS BANDE KO JIS STORE PAR KAAM KAR RAHA HAI, BAKI JISKO APN
  // PERMISION DE USKO DIKHE COMPLEATE REPORT — ADMIN MD FINANCE KO DIKHE
  // JISME SABHI COMPANY STORE KA DATA DEKHA JA SAKE." Anyone with the
  // separate ad_spend_report_all capability (Finance/Higher Authority/MD/
  // Admin) sees everything, exactly like before. Everyone else with plain
  // ad_spend_entry is scoped down to only their own assigned store(s) — see
  // employee_store_access (db/2026-08-08-employee-store-access.sql). No
  // stores assigned yet means they see nothing until an Admin assigns one,
  // not "everything" — never default-open.
  const canSeeAllStores = employee.capabilities.includes("ad_spend_report_all");

  const [{ data: companies }, { data: allStores }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("stores").select("id, name, company_id").in("company_id", employee.companyIds).order("name"),
  ]);

  const stores = canSeeAllStores
    ? (allStores ?? [])
    : (allStores ?? []).filter((s) => employee.storeIds.includes(s.id));

  const storeName = new Map((allStores ?? []).map((s) => [s.id, s.name]));
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const storeCompanyId = new Map((allStores ?? []).map((s) => [s.id, s.company_id]));
  const relevantStoreIds = stores
    .filter((s) => !companyFilter || s.company_id === companyFilter)
    .map((s) => s.id);

  let dailyRows: AdSpendDailyRow[] = [];
  let monthlyRows: AdSpendMonthlyRow[] = [];
  const now = new Date(); // fine here — server-render time, not inside a workflow script
  const defaultMonth = now.toISOString().slice(0, 7);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : defaultMonth;

  let recentEntries: { id: string; storeName: string; companyName: string; date: string; budget: number; spend: number }[] = [];
  if (tab === "entry") {
    const allStoreIds = (stores ?? []).map((s) => s.id);
    const { data: recent } = allStoreIds.length
      ? await supabase
          .from("store_ad_spend")
          .select("id, store_id, spend_date, budget_usd, spend_usd")
          .in("store_id", allStoreIds)
          .order("spend_date", { ascending: false })
          .limit(30)
      : { data: [] };
    recentEntries = (recent ?? []).map((r) => ({
      id: r.id,
      storeName: storeName.get(r.store_id) ?? "—",
      companyName: companyName.get(storeCompanyId.get(r.store_id) ?? "") ?? "—",
      date: r.spend_date,
      budget: Number(r.budget_usd ?? 0),
      spend: Number(r.spend_usd ?? 0),
    }));
  }

  if (tab === "report" && relevantStoreIds.length > 0) {
    const monthStart = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month

    const [{ data: orders }, { data: spend }] = await Promise.all([
      supabase
        .from("orders")
        .select("store_id, order_date, order_value_usd")
        .in("store_id", relevantStoreIds)
        .gte("order_date", monthStart)
        .lte("order_date", monthEnd),
      supabase
        .from("store_ad_spend")
        .select("id, store_id, spend_date, budget_usd, spend_usd")
        .in("store_id", relevantStoreIds)
        .gte("spend_date", monthStart)
        .lte("spend_date", monthEnd),
    ]);

    type Cell = { qty: number; usd: number; budget: number; spend: number };
    const dailyMap = new Map<string, Cell>();
    const monthlyMap = new Map<string, Cell>();

    function bump(map: Map<string, Cell>, key: string, delta: Partial<Cell>) {
      const cur = map.get(key) ?? { qty: 0, usd: 0, budget: 0, spend: 0 };
      map.set(key, {
        qty: cur.qty + (delta.qty ?? 0),
        usd: cur.usd + (delta.usd ?? 0),
        budget: cur.budget + (delta.budget ?? 0),
        spend: cur.spend + (delta.spend ?? 0),
      });
    }

    for (const o of orders ?? []) {
      const dKey = `${o.store_id}__${o.order_date}`;
      bump(dailyMap, dKey, { qty: 1, usd: Number(o.order_value_usd ?? 0) });
      bump(monthlyMap, o.store_id, { qty: 1, usd: Number(o.order_value_usd ?? 0) });
    }
    for (const s of spend ?? []) {
      const dKey = `${s.store_id}__${s.spend_date}`;
      bump(dailyMap, dKey, { budget: Number(s.budget_usd ?? 0), spend: Number(s.spend_usd ?? 0) });
      bump(monthlyMap, s.store_id, { budget: Number(s.budget_usd ?? 0), spend: Number(s.spend_usd ?? 0) });
    }

    dailyRows = [...dailyMap.entries()]
      .map(([key, c]) => {
        const [storeId, date] = key.split("__");
        return {
          storeId,
          storeName: storeName.get(storeId) ?? "—",
          companyName: companyName.get(storeCompanyId.get(storeId) ?? "") ?? "—",
          date,
          qty: c.qty,
          usd: c.usd,
          budget: c.budget,
          spend: c.spend,
        };
      })
      .sort((a, b) => (a.date === b.date ? a.storeName.localeCompare(b.storeName) : a.date.localeCompare(b.date)));

    monthlyRows = relevantStoreIds
      .map((storeId) => {
        const c = monthlyMap.get(storeId) ?? { qty: 0, usd: 0, budget: 0, spend: 0 };
        return {
          storeId,
          storeName: storeName.get(storeId) ?? "—",
          companyName: companyName.get(storeCompanyId.get(storeId) ?? "") ?? "—",
          qty: c.qty,
          usd: c.usd,
          avg: c.qty > 0 ? c.usd / c.qty : 0,
          budget: c.budget,
          spend: c.spend,
        };
      })
      .filter((r) => r.qty > 0 || r.usd > 0 || r.budget > 0 || r.spend > 0)
      .sort((a, b) => b.usd - a.usd);
  }

  const tabClass = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-amber-500 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📈 Store Ad Spend</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter daily Budget/Spend per store. QTY ORD and USD are pulled automatically from Order Entry — no manual
            duplication.
          </p>
          {!canSeeAllStores && (
            <p className="mt-1 text-xs text-amber-700">
              {stores.length > 0
                ? "Showing your assigned store(s) only. The complete cross-company report is visible to Admin/MD/Finance."
                : "No store is assigned to your login yet — ask an Admin to assign one under Employees → Store Access."}
            </p>
          )}
        </div>
        <Link
          href="/dashboard"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Dashboard
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        <Link href="/dashboard/ad-spend?tab=entry" className={tabClass(tab === "entry")}>Daily Entry</Link>
        <Link href="/dashboard/ad-spend?tab=report" className={tabClass(tab === "report")}>Report</Link>
      </div>

      {tab === "entry" ? (
        <AdSpendEntrySection companies={companies ?? []} stores={stores ?? []} recentEntries={recentEntries} />
      ) : (
        <AdSpendReportTable
          companies={companies ?? []}
          filters={{ month, companyId: companyFilter }}
          dailyRows={dailyRows}
          monthlyRows={monthlyRows}
        />
      )}
    </div>
  );
}
