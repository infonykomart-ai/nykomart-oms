import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdSpendEntrySection } from "./ad-spend-entry-section";
import { AdSpendReportTable } from "./ad-spend-report-table";
// 2026-11-21 (part 2) — "DAILY ENTRY VALE SECTION SE NIKAL KAR ALAG TAB
// BANAO ... DAILY ORDER SHEET KE RIGHT ME": the daily advertisement sheet is
// its own fourth tab now, scoped to the same Store Access as the other three.
import { DailyAdReport } from "./daily-ad-report-table";
// 2026-11-21 (round 2) — "MONTH SELECT KARNE KA ... TOTAL BHI AAJAYE": the
// daily tab is month-based now (the current month stops at today), and its
// per-store targets live in store_ad_targets.
import { isoDaysBack, isoMonthDates, monthOptions, type DailyAdTarget } from "./daily-ad-report";
// 2026-10-15 — the Report tab's math (Amazon country split + statement
// verification) lives in its own module, same as the Daily Order Sheet's
// daily-sheet-stats.ts: page.tsx fetches/scopes, the module decides numbers.
import { buildAdSpendReport, type AdSpendReport, type AdSpendSpendRow } from "./ad-spend-stats";
// 2026-10-15b — live FX snapshot for the Amazon country-wise totals
// ("ACTUAL CONVERSION KE HISAB SE JO DAILY BASIS PAR UPDATE HO AUTOMATICLLY").
import { loadFxSnapshot } from "@/lib/fx/rates";
import { AMAZON_CURRENCIES } from "./amazon-countries";
// 2026-10-15 — "STORE KI MONTHLY STATEMENT SE BHI VERFY... OR LINK HO
// JAYE": the statement match is the SAME helper the Orders hub and the
// Store Expense Report use, so "verified" means the same thing everywhere.
import { matchMarketplaceFees } from "@/lib/orders/marketplace-fees";
// 2026-10-13 — Daily Order Sheet (third tab) + the PO-date month rule.
import { DailyOrderSheet, type DailyOrderSheetData } from "./daily-order-sheet";
// 2026-10-13 (part 2) — "1/2 2/2 JESE ORDER EK HI MANA JAYE": the sheet's
// numbers (base-PO order dedup + every breakdown) live in one pure module
// so the math can be stub-tested; this page only fetches and scopes.
import { buildDailySheet } from "./daily-sheet-stats";
import { todayIST } from "@/lib/attendance/ist-date";
import { storesForAdSpend } from "./store-scope";
// 2026-11-21 — the Daily Entry's channel metrics (Amazon / eBay / Etsy) and
// their 14-day chart read the same stored columns the save action writes.
import type { DailyAdOrderRow, DailyAdSpendRow } from "./daily-ad-report";
// 2026-11-25 — one filtered+paged read for the entry list and its export.
import { listAdSpendEntries, parseEntryFilters } from "@/lib/ad-spend/entries";

/** The columns the Recent Entries list reads; ad_orders is optional because
 *  it ships in its own migration (db/2026-11-20e-…). */
type AdSpendListRow = {
  id: string;
  store_id: string;
  spend_date: string;
  country_code: string;
  budget_usd: number;
  spend_usd: number;
  updated_at: string;
  created_at?: string | null;
  deleted_at?: string | null;
  ad_orders?: number | null;
  clicks?: number | null;
  impressions?: number | null;
  visits?: number | null;
  etsy_visits_daily?: number | null;
  etsy_visits_monthly?: number | null;
  etsy_conversion_rate_monthly?: number | null;
  etsy_revenue_usd?: number | null;
  etsy_orders?: number | null;
  etsy_ad_clicks?: number | null;
  ad_revenue_usd?: number | null;
};

// Store-level Daily Spend tracking (pending item 3, 2026-08-08 —
// "STORE KI REPORT NIKALENGE TO EASY WAY MIL JAYEGI SABHI CHIJE EK DUSRE SE
// CONNECT RAHEGI"). Design confirmed with the user: QTY ORD and USD (order
// count / order value) are computed LIVE by joining `orders` here — never
// stored. Only Budget/Spend (USD) are genuinely external ad-platform
// numbers, entered manually per store per day into store_ad_spend (see
// db/2026-08-08-store-ad-spend.sql). Three tabs: Entry (today's/any day's
// Budget+Spend per store), Report (Daily master + Monthly roll-up, matching
// the old system's SUMMERY2026.html / MONTHLY REPORT.html shapes) and the
// Daily Order Sheet, and (2026-11-21) the Daily Ad Report.
//
// 2026-10-15 — two user-requested additions, both scoped exactly as asked:
//  (1) an AMAZON-only Country dimension — "AMAZON ME ALAG ALAG COUNTRY KE
//      HISAB SE BUDGT & SPEND HOTA HAI TO USKA MERE HISAB SE COUNTRY SECTION
//      OR BAN JAYE JO SIRF AMAZON PAR WORK KARE" (12 marketplace countries,
//      see amazon-countries.ts + db/2026-10-15-ad-spend-amazon-country.sql),
//  (2) a per-row STATEMENT VERIFICATION with a link into that store's own
//      statement for the month — "ETSY EBAY WEBSITE KA TO SAHI DATA HOTA HAI
//      BS YE STORE KI MONTHLY STATEMENT SE BHI VERFY NAHI HOTA HAI TO YE US
//      SE BHI VERFY HO JAYE TO SAHI HOYEGA OR LINK HO JAYE".
// The numbers themselves now live in ad-spend-stats.ts (pure, like
// daily-sheet-stats.ts), so screen / print / exports cannot disagree.
export default async function AdSpendPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  const tab =
    sp.tab === "report" ? "report" : sp.tab === "sheet" ? "sheet" : sp.tab === "daily" ? "daily" : "entry";
  const companyFilter = typeof sp.company === "string" && sp.company ? sp.company : "";
  // 2026-11-21 — "store wise filter karne ka option nahi hai total filter ke
  // according update ho": an optional store filter. Applied HERE (server side)
  // so the report module never sees another store's rows — the tables, footer
  // totals and summary tiles all follow the filter by construction.
  const storeParam = typeof sp.store === "string" ? sp.store : "";
  // Daily Order Sheet's date: ?date=YYYY-MM-DD, defaulting to today (IST).
  const dateParam = typeof sp.date === "string" ? sp.date : "";
  const sheetDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIST();

  // 2026-08-08: "AD SPEND VALI JO ENTRY HAI VO SIRF UTNI HI ENTRY DIKHNI
  // CHAHIYE JIS BANDE KO JIS STORE PAR KAAM KAR RAHA HAI, BAKI JISKO APN
  // PERMISION DE USKO DIKHE COMPLEATE REPORT — ADMIN MD FINANCE KO DIKHE
  // JISME SABHI COMPANY STORE KA DATA DEKHA JA SAKE." Anyone with the
  // separate ad_spend_report_all capability (Finance/Higher Authority/MD/
  // Admin, or any role an Admin grants it to) sees everything. Everyone else
  // sees ONLY the store(s) ticked for them under Employees → Store Access
  // (employee_store_access, db/2026-08-08-employee-store-access.sql) —
  // 2026-11-21: "JISKE PASS JO STORE HO VAHI DIKHE SARE STORE NAHI", so a
  // company with no explicit store grant now shows no store at all instead
  // of every store of the company. The whole rule lives in store-scope.ts so
  // the three tabs and the save/delete actions can never disagree.
  const canSeeAllStores = employee.capabilities.includes("ad_spend_report_all");
  // 2026-11-21 — the empty-module messages point straight at the Employees
  // page's Store Access banner (only admins can open that page).
  const storeAccessHref = employee.capabilities.includes("employee_admin")
    ? "/dashboard/admin/employees#store-access"
    : null;
  const storeScope = {
    companyIds: employee.companyIds,
    assignedStoreIds: employee.storeIds,
    canSeeAllStores,
  };

  const [{ data: companies }, { data: allStores }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("stores").select("id, name, company_id").in("company_id", employee.companyIds).order("name"),
  ]);

  const stores = storesForAdSpend(allStores ?? [], storeScope);
  // Only companies that actually hold a store this login may work on are
  // offered as filters — an empty company would just show an empty Store
  // dropdown on all three tabs.
  const visibleCompanies = (companies ?? []).filter((c) => stores.some((s) => s.company_id === c.id));

  const entryFilters = parseEntryFilters(sp as Record<string, string | string[] | undefined>, stores.map((s) => s.id));

  const storeName = new Map((allStores ?? []).map((s) => [s.id, s.name]));
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const storeCompanyId = new Map((allStores ?? []).map((s) => [s.id, s.company_id]));
  // The company filter narrows both the store list AND the report rows —
  // kept as the store rows themselves (not just their ids) so the report
  // module can tell an Amazon store from an Etsy/eBay/Website one.
  // An unknown/foreign store id is ignored (never widens the scope).
  const storeFilter = stores.some((s) => s.id === storeParam) ? storeParam : "";
  const scopedStores = stores.filter(
    (s) => (!companyFilter || s.company_id === companyFilter) && (!storeFilter || s.id === storeFilter)
  );
  const relevantStoreIds = scopedStores.map((s) => s.id);

  let report: AdSpendReport | null = null;
  let fx: Awaited<ReturnType<typeof loadFxSnapshot>> | null = null;
  let sheet: DailyOrderSheetData | null = null;
  const now = new Date(); // fine here — server-render time, not inside a workflow script
  const defaultMonth = now.toISOString().slice(0, 7);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : defaultMonth;

  let recentEntries: {
    id: string;
    storeId: string;
    storeName: string;
    companyName: string;
    date: string;
    countryCode: string;
    budget: number;
    spend: number;
    adOrders: number | null;
    clicks: number | null;
    impressions: number | null;
    visits: number | null;
    etsyVisitsDaily: number | null;
    etsyVisitsMonthly: number | null;
    etsyConversionRateMonthly: number | null;
    etsyRevenueUsd: number | null;
    etsyOrders: number | null;
    etsyAdClicks: number | null;
    adRevenueUsd: number | null;
    enteredAt: string;
    created: string;
    updated: string;
  }[] = [];
  // 2026-11-25 — the entry list is filtered + paged by the URL (store, date
  // range, search) and the same filter set drives the CSV/Excel export.
  let recentTotal = 0;
  let recentPage = 1;
  let deletedEntries: typeof recentEntries = [];
  // 2026-11-21 — the channel chart's history (last 14 days) and the Etsy
  // monthly spend % (this month's summed spend) share this read.
  let channelRows: DailyAdSpendRow[] = [];
  // The Daily Ad Report tab's own 30-day read (spend rows + our orders),
  // scoped exactly like every other tab: the login's stores only, unless the
  // login holds ad_spend_report_all (MD/Admin/Finance) and therefore sees all.
  let dailySpendRows: DailyAdSpendRow[] = [];
  let dailyOrderRows: DailyAdOrderRow[] = [];
  // 2026-11-21 (round 2) — the month the daily tab is showing. Validated
  // here; a past month is whole, the current month stops at today.
  const dailyMonth =
    typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : defaultMonth;
  // 2026-11-21 (round 3) — quick rolling windows next to the month select:
  // ?range=7 / 30 / 90. A range and a month are mutually exclusive; a range
  // wins because it is the more specific choice in the URL. Pacing is only
  // shown for a calendar month (a rolling window has no "month budget").
  const dailyRange =
    sp.range === "7" ? 7 : sp.range === "30" ? 30 : sp.range === "90" ? 90 : null;
  const dailyDates = dailyRange ? isoDaysBack(todayIST(), dailyRange) : isoMonthDates(dailyMonth, todayIST());
  const dailyMonthOptions = monthOptions(todayIST(), 12);
  const dailyTargets: Record<string, DailyAdTarget> = {};
  if (tab === "entry") {
    const allStoreIds = (stores ?? []).map((s) => s.id);
    if (allStoreIds.length > 0) {
      const today = todayIST();
      const chartFromDate = new Date(`${today}T00:00:00Z`);
      // 30 days feeds the daily advertisement report; the trend chart slices
      // its own last 14 out of the same rows.
      chartFromDate.setUTCDate(chartFromDate.getUTCDate() - 29);
      const chartFrom = chartFromDate.toISOString().slice(0, 10);
      const monthFrom = `${defaultMonth}-01`;
      const from = chartFrom < monthFrom ? chartFrom : monthFrom;
      // "*" so the optional metric columns simply come back when their
      // migration has been run, and are absent (→ null) before that.
      const { data: historyData } = await supabase
        .from("store_ad_spend")
        .select("*")
        .in("store_id", allStoreIds)
        .gte("spend_date", from);
      // Soft-deleted days must not reach the trend chart or the Etsy
      // monthly-spend tile (2026-11-25); filtered here so a database that
      // has not run the soft-delete migration still works.
      channelRows = ((historyData ?? []) as unknown as (DailyAdSpendRow & { deleted_at?: string | null })[]).filter(
        (r) => !r.deleted_at
      );
    }
    // country_code rides along so an Amazon day's rows are told apart; the
    // entry timestamp is created_at (first save) and updated_at (last change).
    const mapEntry = (r: AdSpendListRow) => ({
      id: r.id,
      storeId: r.store_id,
      storeName: storeName.get(r.store_id) ?? "—",
      companyName: companyName.get(storeCompanyId.get(r.store_id) ?? "") ?? "—",
      date: r.spend_date,
      countryCode: r.country_code ?? "",
      budget: Number(r.budget_usd ?? 0),
      spend: Number(r.spend_usd ?? 0),
      adOrders: typeof r.ad_orders === "number" ? r.ad_orders : null,
      clicks: typeof r.clicks === "number" ? r.clicks : null,
      impressions: typeof r.impressions === "number" ? r.impressions : null,
      visits: typeof r.visits === "number" ? r.visits : null,
      etsyVisitsDaily: typeof r.etsy_visits_daily === "number" ? r.etsy_visits_daily : null,
      etsyVisitsMonthly: typeof r.etsy_visits_monthly === "number" ? r.etsy_visits_monthly : null,
      etsyConversionRateMonthly:
        typeof r.etsy_conversion_rate_monthly === "number" ? r.etsy_conversion_rate_monthly : null,
      etsyRevenueUsd: typeof r.etsy_revenue_usd === "number" ? r.etsy_revenue_usd : null,
      etsyOrders: typeof r.etsy_orders === "number" ? r.etsy_orders : null,
      etsyAdClicks: typeof r.etsy_ad_clicks === "number" ? r.etsy_ad_clicks : null,
      adRevenueUsd: typeof r.ad_revenue_usd === "number" ? r.ad_revenue_usd : null,
      // 2026-11-25 — the entry time (when it was first saved) and the last
      // change are now separate columns; older rows only have updated_at.
      enteredAt: r.created_at ?? r.updated_at,
      created: r.created_at ?? "",
      updated: r.updated_at ?? "",
    });

    // 2026-11-25 — the list now honours the store/date/search filters in the
    // URL and pages 25 at a time instead of silently showing the last 30
    // rows of everything. Same query the export uses (lib/ad-spend/entries).
    const listed = await listAdSpendEntries(supabase, {
      ...entryFilters,
      storeName: (id) => storeName.get(id) ?? "",
    });
    recentTotal = listed.total;
    recentPage = listed.page;
    recentEntries = listed.rows.map((row) => mapEntry(row as unknown as AdSpendListRow));

    // Admin-only: soft-deleted rows, so a delete can be undone rather than
    // being gone for good.
    if (canSeeAllStores) {
      const { data: deleted } = await supabase
        .from("store_ad_spend")
        .select("*")
        .in("store_id", (stores ?? []).map((s) => s.id))
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(50);
      deletedEntries = ((deleted ?? []) as unknown as AdSpendListRow[]).map((row) => mapEntry(row));
    }
  }

  if (tab === "daily") {
    const allStoreIds = stores.map((s) => s.id);
    if (allStoreIds.length > 0 && dailyDates.length > 0) {
      const from = dailyDates[0];
      const to = dailyDates[dailyDates.length - 1];
      const [{ data: dailySpend }, { data: dailyOrders }, { data: targetRows }] = await Promise.all([
        supabase
          .from("store_ad_spend")
          .select("*")
          .in("store_id", allStoreIds)
          .gte("spend_date", from)
          .lte("spend_date", to),
        // Organic side of the sheet: same columns and same PO-date rule the
        // Daily Order Sheet uses (the report module applies the rule).
        supabase
          .from("orders")
          .select("id, ref_no, store_id, order_date, po_date, order_value_usd, buyer_country, destination_country")
          .in("store_id", allStoreIds)
          .or(
            `and(po_date.gte.${from},po_date.lte.${to}),and(order_date.gte.${from},order_date.lte.${to})`
          ),
        // Monthly budget / ROAS target per store (its own migration).
        supabase
          .from("store_ad_targets")
          .select("store_id, monthly_budget_usd, roas_target")
          .in("store_id", allStoreIds),
      ]);
      // Soft-deleted days never reach the report (2026-11-25); filtered here
      // so the read also works on a database without the soft-delete columns.
      dailySpendRows = ((dailySpend ?? []) as unknown as (DailyAdSpendRow & { deleted_at?: string | null })[]).filter(
        (r) => !r.deleted_at
      );
      dailyOrderRows = (dailyOrders ?? []) as unknown as DailyAdOrderRow[];
      for (const t of targetRows ?? []) {
        if (!allStoreIds.includes(t.store_id)) continue;
        dailyTargets[t.store_id] = {
          monthlyBudgetUsd: t.monthly_budget_usd === null ? null : Number(t.monthly_budget_usd),
          roasTarget: t.roas_target === null ? null : Number(t.roas_target),
        };
      }
    }
  }

  if (tab === "report" && relevantStoreIds.length > 0) {
    const monthStart = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month

    // 2026-11-20 — ad_orders (ad-platform attributed orders) is read alongside
    // Budget/Spend when its migration has been run; until then the older
    // column list is used and the report simply hides the ad/organic split.
    const spendQuery = async (withAdOrders: boolean) => {
      const res = withAdOrders
        ? await supabase
            .from("store_ad_spend")
            .select("*")
            .in("store_id", relevantStoreIds)
            .gte("spend_date", monthStart)
            .lte("spend_date", monthEnd)
        : await supabase
            .from("store_ad_spend")
            .select("id, store_id, spend_date, country_code, budget_usd, spend_usd")
            .in("store_id", relevantStoreIds)
            .gte("spend_date", monthStart)
            .lte("spend_date", monthEnd);
      return { data: (res.data ?? []) as unknown as AdSpendSpendRow[], error: res.error };
    };

    const [{ data: orders }, spendRes] = await Promise.all([
      // 2026-10-13 — "order date ki bajaye po date se clear ho": an order
      // belongs to the month its PO DATE falls in (blank PO date falls
      // back to the entry/order date — the effective date below). The
      // fetch is widened to EITHER date inside the month, then filtered on
      // the effective date in the loop — so an order entered in October
      // but PO'd in September lands in SEPTEMBER's roll-up, never both.
      // 2026-10-15 — id/company_id/marketplace_order_no ride along for the
      // statement verification, buyer_country for the Amazon country
      // split; both are read-only extras the same row already has.
      supabase
        .from("orders")
        .select(
          "id, company_id, store_id, order_date, po_date, order_value_usd, marketplace_order_no, buyer_country, destination_country"
        )
        .in("store_id", relevantStoreIds)
        .or(
          `and(po_date.gte.${monthStart},po_date.lte.${monthEnd}),and(order_date.gte.${monthStart},order_date.lte.${monthEnd})`
        ),
      spendQuery(true),
    ]);
    const spend = ((spendRes.error ? (await spendQuery(false)).data : spendRes.data) ?? []).filter(
      (r) => !(r as AdSpendSpendRow & { deleted_at?: string | null }).deleted_at
    );

    const monthOrders = orders ?? [];
    // 2026-10-15 — "STORE KI MONTHLY STATEMENT SE BHI VERFY... OR LINK HO
    // JAYE": which of this month's orders actually appear in their store's
    // imported marketplace statement (Etsy Ledger / eBay Tax Invoice /
    // Amazon Transactions), matched by marketplace order no. — the same
    // helper the Orders hub and Store Expense Report call, so all three
    // agree by construction.
    const matches = await matchMarketplaceFees(supabase, monthOrders, employee.companyIds);

    // All of the aggregation — country split included — is in
    // ad-spend-stats.ts (pure, so it can be stub-tested); this page only
    // fetched and scoped.
    report = buildAdSpendReport({
      month,
      orders: monthOrders,
      spendRows: spend ?? [],
      stores: scopedStores,
      companyName,
      matches,
    });

    // 2026-10-15b — the loader keeps the rates fresh on its own: it re-pulls
    // from the provider once the cached snapshot is 12h old. 2026-11-21 — the
    // report's money columns are USD only again, so the snapshot is loaded
    // only when the Amazon country section (its pre-existing conversion
    // strip) is actually rendered. It never breaks the page either way.
    if (report.hasAmazonStore) fx = await loadFxSnapshot(supabase, AMAZON_CURRENCIES);
  }

  // 2026-10-13 — "DAILY ORDER SHEET ... AAJ SABHI STORE PAR KITNE ORDER
  // AMMOUNT QTY ... COUNTRY WISE, SKU WISE, SIZE WISE (AGAR NAHI BANA
  // HUA TO BANAO ISME)": one day, same store scoping as the Report tab,
  // headline totals + store/country/SKU/size breakdowns. Same effective-
  // date rule as the Monthly Roll-up (PO date, fallback order date) so
  // the two views can never disagree about which day an order belongs to.
  if (tab === "sheet" && relevantStoreIds.length > 0) {
    // id + ref_no ride along for the 2026-10-13 (part 2) features:
    // ref_no is the PO no. the base-PO dedup counts on, and the day's
    // ids feed the Generate-PO-File link (see daily-sheet-stats.ts).
    const { data: sheetOrders } = await supabase
      .from("orders")
      .select(
        "id, ref_no, store_id, order_date, po_date, qty, order_value_usd, sku_label, size_label, buyer_country, destination_country"
      )
      .in("store_id", relevantStoreIds)
      .or(`po_date.eq.${sheetDate},order_date.eq.${sheetDate}`);

    sheet = buildDailySheet({
      orders: sheetOrders ?? [],
      date: sheetDate,
      storeName,
      companyName,
      storeCompanyId,
    });
  }

  const tabClass = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-amber-500 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📈 Store Ad Spend</h1>
          {!canSeeAllStores && (
            <p className="mt-1 text-xs text-amber-700">
              {stores.length > 0 ? (
                <>
                  All three tabs show only the store(s) assigned to you under{" "}
                  {storeAccessHref ? (
                    <Link href={storeAccessHref} className="font-semibold underline hover:text-amber-900">
                      Employees → Store Access
                    </Link>
                  ) : (
                    <b>Employees → Store Access</b>
                  )}{" "}
                  (never every store of a company). The complete report is shown to logins approved for it
                  (ad_spend_report_all — MD/Admin/Finance by default).
                </>
              ) : (
                <>
                  No store is assigned to your login yet. Ask an Admin to tick your store(s) under{" "}
                  {storeAccessHref ? (
                    <Link href={storeAccessHref} className="font-semibold underline hover:text-amber-900">
                      Employees → Store Access
                    </Link>
                  ) : (
                    <b>Employees → Store Access</b>
                  )}{" "}
                  — only the stores given to you are shown here.
                </>
              )}
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

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/dashboard/ad-spend?tab=entry" className={tabClass(tab === "entry")}>Daily Entry</Link>
        <Link href="/dashboard/ad-spend?tab=report" className={tabClass(tab === "report")}>Report</Link>
        <Link href="/dashboard/ad-spend?tab=sheet" className={tabClass(tab === "sheet")}>🧾 Daily Order Sheet</Link>
        <Link href="/dashboard/ad-spend?tab=daily" className={tabClass(tab === "daily")}>
          📋 Daily Ad Report
        </Link>
      </div>

      {tab === "entry" ? (
        <AdSpendEntrySection
          companies={visibleCompanies}
          stores={stores ?? []}
          recentEntries={recentEntries}
          channelRows={channelRows}
          month={defaultMonth}
          filters={{
            storeId: entryFilters.storeId,
            from: entryFilters.from,
            to: entryFilters.to,
            q: entryFilters.q,
          }}
          total={recentTotal}
          page={recentPage}
          pageSize={entryFilters.pageSize}
          canRestore={canSeeAllStores}
          deletedEntries={deletedEntries}
        />
      ) : tab === "daily" ? (
        <DailyAdReport
          stores={(stores ?? []).map((s) => ({
            ...s,
            companyName: companyName.get(s.company_id) ?? "",
          }))}
          spendRows={dailySpendRows}
          orderRows={dailyOrderRows}
          dates={dailyDates}
          month={dailyMonth}
          range={dailyRange}
          monthOptions={dailyMonthOptions}
          targets={dailyTargets}
          initialStore={storeFilter}
          canSeeAllStores={canSeeAllStores}
          canEditTargets={canSeeAllStores}
          storeAccessHref={storeAccessHref}
        />
      ) : tab === "sheet" ? (
        <DailyOrderSheet
          companies={visibleCompanies}
          filters={{ date: sheetDate, companyId: companyFilter }}
          data={sheet}
          storeAccessHref={storeAccessHref}
        />
      ) : (
        <AdSpendReportTable
          companies={visibleCompanies}
          stores={stores ?? []}
          filters={{ month, companyId: companyFilter, storeId: storeFilter }}
          dailyRows={report?.dailyRows ?? []}
          monthlyRows={report?.monthlyRows ?? []}
          amazonCountryRows={report?.amazonCountryRows ?? []}
          hasAmazonStore={report?.hasAmazonStore ?? false}
          hasAdOrderData={report?.hasAdOrderData ?? false}
          fx={fx}
        />
      )}
    </div>
  );
}
