import { Fragment } from "react";
import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { FY_START_MONTH, fyDateWindow } from "@/lib/fy-date";
import { BarChart, GroupedBarChart, LineChart } from "@/components/simple-charts";

// 2026-09-17 (evening) — CRM page restructure: "CRM me ye jo section hai
// sabhi CRM page par menu ban jaye ya phir dropdown lag jaye or sabhi
// section ka digram/graph vagera" — the page used to be one long scroll of
// 6 sections; it's now a `?tab=` menu (same convention as
// dashboard/documents/document-entry-tabs.tsx's TABS) with exactly one
// section visible at a time, and every section now carries a chart (see
// simple-charts.tsx). Quick Find stays above the tab bar — it's a search
// utility used regardless of which section you're looking at, not one of
// the 6 listed report sections.
const CRM_TABS = [
  { key: "buyers", label: "Top Buyers" },
  { key: "orders", label: "Orders by Status" },
  { key: "attendance", label: "Today's Attendance" },
  { key: "alerts", label: "Data Quality Alerts" },
  { key: "pl-company", label: "P&L by Company" },
  { key: "pl-month", label: "P&L by Month" },
  // 2026-09-18 — "P&L by Marketplace", added in response to the uploaded
  // pL.md blueprint doc's "Marketplace Profitability" idea (Sales/Fees/Ad
  // Spend/ROAS/Shipping/Profit per channel). Built on the EXISTING schema
  // (stores = the document's "marketplaces" concept, already one row per
  // Amazon US/Amazon UK/Etsy/Website/Wholesale etc. per company) via
  // db/2026-09-18-pl-by-marketplace-store.sql — see that file's header for
  // why the document's separate Node.js/Express + new-schema rebuild
  // wasn't the right move here.
  { key: "pl-marketplace", label: "P&L by Marketplace" },
] as const;
type CrmTabKey = (typeof CRM_TABS)[number]["key"];
function isCrmTabKey(v: string | undefined): v is CrmTabKey {
  return !!v && CRM_TABS.some((t) => t.key === v);
}

// Status → semantic color (good/warning/critical/neutral), never used as
// the ONLY identity signal — every bar in these charts also carries its
// own value + text label, so color-blind readers aren't relying on hue
// alone. Palette validated via dataviz skill's validate_palette.js.
const ORDER_STATUS_COLOR: Record<string, string> = {
  Pending: "#94a3b8", // slate — not yet in motion
  Confirmed: "#0284c7", // sky — in flow
  "In Production": "#0284c7",
  Dispatched: "#0284c7",
  Delivered: "#059669", // emerald — good/done
  Hold: "#f59e0b", // amber — warning/needs attention
  Cancelled: "#dc2626", // rose — critical
  Returned: "#dc2626",
};
const ATTENDANCE_STATUS_COLOR: Record<string, string> = {
  Present: "#059669",
  Absent: "#dc2626",
  Late: "#f59e0b",
  "Half Day": "#f59e0b",
  "Week Off": "#94a3b8",
  Leave: "#94a3b8",
  Holiday: "#94a3b8",
};

function tabHref(key: CrmTabKey) {
  return `/dashboard/crm?tab=${key}`;
}

// 2026-09-17 — "jo jo expense huye vo sab aane chahiye na jis se confirm
// ho ki kya kya kese kese ghataya jara": the single "Expenses (INR)"
// number is now hover-expandable into its 5 sources (courier, duty,
// purchase bills, Debit/Credit-Note adjustments shown negative, and the
// pre-orders CSV history). Data comes from the views' breakdown columns
// (db/2026-09-17-pl-expense-breakdown.sql) — pure display, nothing here
// recomputes. A tiny client island inside this otherwise server page
// (details/summary needs no JS but React must render it; "use client"
// scope comes via this shared component being imported by the server
// component below without a directive — React renders <details> as plain
// HTML, so no island is actually needed; kept as a plain function).
type PlRow = {
  // 2026-09-18 — per-company month view (db/2026-09-18-pl-month-per-
  // company.sql) adds company_id/company_name to pl_dashboard_by_month_view.
  company_id?: string | null;
  company_name?: string | null;
  expense_courier_inr?: number | null;
  expense_duty_inr?: number | null;
  expense_purchase_inr?: number | null;
  expense_purchase_adjustments_inr?: number | null;
  expense_washing_inr?: number | null;
  expense_historical_inr?: number | null;
  portal_fees_matched_inr?: number | null;
  portal_expense_effective_inr?: number | null;
  bank_inflow_inr?: number | null;
  total_sale_value_inr?: number | null;
  total_sale_value_usd?: number | null;
  total_expenses_inr?: number | null;
  net_earn?: number | null;
  portal_expenses_25pct?: number | null;
};

const inr2 = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd2 = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// 2026-09-17 (evening) — short "Sep '26" x-axis tick label for the P&L by
// Month trend chart (view rows are "YYYY-MM-01").
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShortLabel = (dateStr: string | null | undefined) => {
  if (!dateStr) return "—";
  const [y, m] = dateStr.split("-").map(Number);
  return `${MONTH_SHORT[(m ?? 1) - 1] ?? "?"} '${String(y).slice(2)}`;
};

// 2026-09-17 — P&L by Month FY selector helpers. Same April-start FY math
// as fy_label()/src/lib/fy-date.ts — kept local because the page only
// needs start-year bucketing + the '26-27' label shape.
const fyStartYearOf = (dateStr: string) => {
  const [y, m] = dateStr.split("-").map(Number);
  return m < FY_START_MONTH ? y - 1 : y;
};
const fyLabelOf = (startYear: number) => `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;

// 2026-09-17 (evening) — the user's layout ask: "arrow ke sath hi usi entry
// ke niche dikh jaye" + per-company/month expense split + money colors +
// bank inflow vs order value difference. This renders an INLINE expansion
// row under the clicked entry (no floating popover — that floated mid-
// screen, the screenshot bug). Color language (same on every table):
//   expense lines  rose-600  |  credits/negative  emerald-600
//   profit         emerald-700 |  money-in (bank)  sky-700
// Net-profit chain is shown line by line so "Sale − Expenses − Portal = Net"
// is auditable without doing math in the head.
function PlExpenseBreakdown({ row }: { row: PlRow }) {
  if (row.expense_courier_inr === undefined) return null;
  const sale = Number(row.total_sale_value_inr ?? 0);
  const exp = Number(row.total_expenses_inr ?? 0);
  const est25 = Number(row.portal_expenses_25pct ?? sale * 0.25);
  const fees = Number(row.portal_fees_matched_inr ?? 0);
  // 2026-09-17 (late): REAL-IF-KNOWN — matched fees when the scope has
  // any, else the 25% estimate (same CASE as the SQL view).
  const portalEff = fees > 0 ? fees : est25;
  const net = Number(row.net_earn ?? sale - exp - portalEff);
  const bank = Number(row.bank_inflow_inr ?? 0);
  const inflowDiff = bank - sale;
  const portalMode = fees > 0 ? "real fees" : "25% estimate";
  // 2026-09-17 (evening) — REVERTED back to English. Round 2 same-day had
  // translated these labels to Hindi (Devanagari) reading the owner's
  // "hinglish ke word remove karne hai ... hindi me hona chahiye" too
  // broadly — that request was about two specific casual-Hinglish phrases
  // ("kam kya raha", "Bank me aaya"), not this whole table, which was
  // already plain English before that round. Owner corrected: "JO ENGLISH
  // ME KARNA THA USKO HINDI ME KAR DIYA ... ENGLISH ME KARO" — back to
  // English labels, same links kept.
  //
  // "ye jo payment jaha jaha se aari vaha unke page bhi link hona chahiye":
  // each line still links to the report/entry screen that actually produces
  // that number, so a user can jump straight from "why is this ₹X" to the
  // underlying bills/entries instead of hunting for the right screen.
  const lines: Array<[string, number | null | undefined, string]> = [
    ["Courier (net of credit notes)", row.expense_courier_inr, "/dashboard/reports/freight-duty"],
    ["Duty (net of credit notes)", row.expense_duty_inr, "/dashboard/reports/freight-duty"],
    ["Purchase Bills (incl. GST)", row.expense_purchase_inr, "/dashboard/reports/purchase-bills"],
    ["Debit/Credit Note Adjustments", row.expense_purchase_adjustments_inr, "/dashboard/credit-notes-register"],
    ["Washing Chalans (auto)", row.expense_washing_inr, "/dashboard/documents?tab=washing-entry"],
    ["Old CSV History (pre-orders)", row.expense_historical_inr, "/dashboard/csv-upload"],
  ];
  return (
    <div className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-2 text-[11px]">
      <div className="grid gap-x-8 gap-y-0.5 sm:grid-cols-2">
        <div className="font-semibold pl-out text-rose-600">Expense Breakdown (where it went)</div>
        <div className="font-semibold text-[var(--oms-text-muted)]">How Net Profit was built</div>
        {lines.map(([label, val, href]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <Link href={href} className="text-[var(--oms-text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--oms-text)]">
              {label}
            </Link>
            <span className={`font-medium ${Number(val ?? 0) < 0 ? "pl-profit text-emerald-600" : "pl-out text-rose-600"}`}>
              {Number(val ?? 0) < 0 ? "+" : "−"} {inr2(Math.abs(Number(val ?? 0)))}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4">
          <Link href="/dashboard/statements" className="text-[var(--oms-text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--oms-text)]">
            Portal Fees, Matched (real)
          </Link>
          <span className="font-medium text-sky-700">{inr2(fees)}</span>
        </div>
        <div className="sm:col-span-2 mt-1 border-t border-[var(--oms-surface-border)] pt-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">Sale Value (INR)</span>
            <span className="pl-in font-semibold text-sky-700">{inr2(sale)}</span>
          </div>
          {row.total_sale_value_usd !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-[var(--oms-text-muted)]">Sale Value (USD)</span>
              <span className="pl-in font-semibold text-sky-700">${usd2(row.total_sale_value_usd)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">− Total Expenses</span>
            <span className="font-semibold pl-out text-rose-600">{inr2(exp)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">
              − Portal ({portalMode}{fees > 0 ? `: ${inr2(fees)} matched, estimate was ${inr2(est25)}` : `: ${inr2(est25)}`})
            </span>
            <span className="font-semibold pl-out text-rose-600">{inr2(portalEff)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-[var(--oms-surface-border)] pt-1">
            <span className="font-semibold text-[var(--oms-text)]">= Net Earn</span>
            <span className={`font-bold ${net >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{inr2(net)}</span>
          </div>
        </div>
        <div className="sm:col-span-2 mt-1 border-t border-[var(--oms-surface-border)] pt-1">
          <div className="flex items-center justify-between gap-4">
            <Link href="/dashboard/bank-recon" className="text-[var(--oms-text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--oms-text)]">
              Bank Inflow (verified statement credit)
            </Link>
            <span className="pl-in font-semibold text-sky-700">{inr2(bank)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--oms-text-muted)]">
              Order Value vs Bank Difference {bank === 0 ? "(shows once a statement is uploaded/linked)" : ""}
            </span>
            <span className={`font-semibold ${inflowDiff >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>
              {inflowDiff >= 0 ? "+" : "−"} {inr2(Math.abs(inflowDiff))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// CRM Overview (round 11) — rebuild of the old Apps Script system's
// getCrmDashboardData()/getAlerts_() (see claude/hr-attendance-crm-notes.md
// for the old design this is modeled on: order-status counts, today's
// attendance breakdown, a capped list of concrete data-quality checks) +
// the P&L Dashboard (old: 100% live-formula sheet, ported to
// pl_dashboard_by_company_view/pl_dashboard_by_month_view in
// db/schema.sql SECTION 12 — this page is the first thing to actually
// query those views). Also includes a "Quick Find" (PO/RF/RG/buyer/contact
// search, capped 20) — in the old system this sat on every Dashboard page;
// here it's only on this one screen for now (scope call, flagged rather
// than silently different — see delivery notes).
export default async function CrmOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; fy?: string; fyc?: string; fyco?: string; tab?: string }>;
}) {
  const employee = await requireCapability("crm_dashboard");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const { q, fy: fyParam, fyc: fycParam, fyco: fyCompanyParam, tab: tabParam } = await searchParams;
  const query = (q ?? "").trim();
  const activeTab: CrmTabKey = isCrmTabKey(tabParam) ? tabParam : "buyers";

  const today = todayIST();

  // 2026-08-17 fix — same bug/fix as Party Ledger / Bill Payment /
  // Statements: order-status counts, today's attendance, alerts and Quick
  // Find used to scope to `employee.companyIds` (every company this login
  // can access) instead of the currently selected company. "P&L by
  // Company" (plByCompany) is left scoped to `companyIds` deliberately —
  // it's a one-row-per-company COMPARISON table by design
  // (`pl_dashboard_by_company_view` is `GROUP BY company`), so narrowing
  // it to a single company would defeat the point of that specific
  // widget. "P&L by Month" (plByMonth) had no company_id column then —
  // 2026-09-18 — RESOLVED: the month view now carries company_id/company_name
  // (db/2026-09-18-pl-month-per-company.sql) so plByMonth below is filtered
  // to employee.companyIds the same way the comparison table above is — one
  // row per company+month, no more all-companies-merged totals. The FY
  // selector still works on top; fallback column lists below were widened to
  // include company_id so the company filter survives a missing migration.
  //
  // 2026-08-20 — Gap 4 (office/cash expenses, see
  // claude/five-gaps-implementation-plan-2026-08-20.md and
  // db/2026-08-20-internal-expenses.sql): both views gained
  // total_internal_expenses_inr + net_earn_after_overhead, sourced from the
  // new `internal_expenses` table. Deliberately kept as a SEPARATE line
  // from total_expenses_inr (which is per-order marketplace/shipping
  // expense from sale_profit_ledger) rather than merged into it — office
  // overhead and order-level expense are different things. plByMonth can
  // now also show a month with expenses but zero sales (e.g. rent paid in
  // a slow month), which plByMonth previously never surfaced at all.
  const [
    { data: orderStatusCountRows },
    { data: attendanceRows },
    { data: alerts },
    { data: plByCompany, error: plByCompanyErr },
    { data: plByMonth, error: plByMonthErr },
    { data: plByCompanyMonth, error: plByCompanyMonthErr },
    { data: plByStore, error: plByStoreErr },
    quickFindResult,
    { data: buyerOrderRows },
  ] = await Promise.all([
    // 2026-08-17 perf fix — was `.select("status")` with no limit (every
    // order row for the company pulled just to count-by-status in Node).
    // get_order_status_counts() does the same GROUP BY in the database
    // instead, using idx_orders_status. See
    // db/2026-08-17-ebay-indexes-and-order-status-rpc.sql.
    supabase.rpc("get_order_status_counts", { p_company_id: employee.currentCompanyId }),
    finSupabase.from("attendance").select("status").eq("company_id", employee.currentCompanyId).eq("attendance_date", today),
    finSupabase.from("data_quality_alerts_view").select("order_id, ref_no, alert_type, detail").eq("company_id", employee.currentCompanyId).limit(50),
    finSupabase.from("pl_dashboard_by_company_view").select("company_id, company_name, total_sale_value_inr, total_sale_value_usd, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead, portal_expenses_25pct, expense_courier_inr, expense_duty_inr, expense_purchase_inr, expense_purchase_adjustments_inr, expense_washing_inr, expense_historical_inr, portal_fees_matched_inr, bank_inflow_inr").in("company_id", employee.companyIds),
    finSupabase.from("pl_dashboard_by_month_view").select("company_id, company_name, month, total_sale_value_inr, total_sale_value_usd, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead, portal_expenses_25pct, expense_courier_inr, expense_duty_inr, expense_purchase_inr, expense_purchase_adjustments_inr, expense_washing_inr, expense_historical_inr, portal_fees_matched_inr, bank_inflow_inr").in("company_id", employee.companyIds),
    // 2026-09-17 (evening) — new pl_dashboard_by_company_month_view (see
    // db/2026-09-17b-pl-usd-and-company-month.sql), fetched ONLY so the
    // "P&L by Company" FY selector below can sum an FY's months per
    // company client-side. Feature-detected: if this migration hasn't been
    // run yet on the DB, the query errors, plByCompanyMonth stays
    // undefined, and the FY selector on that section simply doesn't
    // render (falls back to the existing all-time view) instead of
    // breaking the page.
    finSupabase
      .from("pl_dashboard_by_company_month_view")
      .select(
        "company_id, company_name, month, total_sale_value_inr, total_sale_value_usd, total_expenses_inr, total_internal_expenses_inr, expense_courier_inr, expense_duty_inr, expense_purchase_inr, expense_purchase_adjustments_inr, expense_washing_inr, expense_historical_inr, portal_fees_matched_inr, bank_inflow_inr",
      )
      .in("company_id", employee.companyIds),
    // 2026-09-18 — pl_dashboard_by_store_view (see db/2026-09-18-pl-by-
    // marketplace-store.sql). Feature-detected exactly like plByCompanyMonth
    // above: if that migration hasn't been run yet on the DB, this query
    // errors, plByStore stays undefined, and the "P&L by Marketplace" tab
    // shows a not-yet-available message instead of breaking the page.
    // Scoped to the currently selected company only (not employee.companyIds)
    // — unlike "P&L by Company" this is a per-store DETAIL table, not a
    // company-comparison table, and a login with access to several
    // companies would otherwise see every store across all of them mixed
    // into one list.
    finSupabase
      .from("pl_dashboard_by_store_view")
      .select(
        "store_id, store_name, company_id, company_name, order_count, total_sale_value_inr, total_sale_value_usd, expense_courier_inr, expense_duty_inr, portal_expenses_25pct, portal_expense_effective_inr, portal_fees_matched_inr, ad_spend_usd, ad_budget_usd, expense_purchase_inr, expense_washing_inr, net_before_overhead_inr, profit_pct_before_overhead, roas",
      )
      .eq("company_id", employee.currentCompanyId),
    query
      ? supabase
          .from("orders")
          .select("id, ref_no, company_id, buyer_name_address, contact_no, marketplace_order_no, status")
          .eq("company_id", employee.currentCompanyId)
          .or(`ref_no.ilike.%${query}%,buyer_name_address.ilike.%${query}%,contact_no.ilike.%${query}%,marketplace_order_no.ilike.%${query}%`)
          .limit(20)      : Promise.resolve({ data: [] as { id: string; ref_no: string; company_id: string; buyer_name_address: string | null; contact_no: string | null; marketplace_order_no: string | null; status: string }[] }),
    // 2026-08-17 — Top Buyers (gap identified in an OMS-features audit:
    // "customer database" had no repeat-buyer view). Grouped in JS below
    // by contact_no (falling back to buyer_name_address when contact_no is
    // blank) since there's no separate customer table — buyer identity
    // only exists as free text on each order (see orders.buyer_name_address
    // comment in schema.sql). Same un-limited per-company select pattern
    // already used for Orders by Status above — flagged in the same
    // 2026-08-17 performance review as something to revisit once order
    // volume grows large enough to matter (not yet, at current volume).
    supabase.from("orders").select("buyer_name_address, contact_no, order_value_usd").eq("company_id", employee.currentCompanyId),
  ]);

  // 2026-09-17 — blank-P&L guard. If either view query failed because the
  // migration's new columns aren't in the DB yet (42703 "column does not
  // exist"), retry ONCE with the pre-migration column list so the tables
  // still render today's real numbers instead of an empty shell; the ▾
  // breakdown renders nothing for those rows (undefined columns). Any
  // other error also falls back the same way — P&L visibility is too
  // important to blank the whole page over one missing column.
  const baseCompanyCols = "company_id, company_name, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead";
  // 2026-09-18 — company_id kept in the fallback list: it ships WITH the
  // first version of the per-company month view (this migration) so the
  // company filter below keeps working even on the retry-on-error rows.
  const baseMonthCols = "company_id, company_name, month, total_sale_value_inr, total_expenses_inr, net_earn, profit_pct, total_internal_expenses_inr, net_earn_after_overhead";
  let plCompanyRows = plByCompany;
  let plMonthRows = plByMonth;
  if (plByCompanyErr || plByMonthErr) {
    const [retryCompany, retryMonth] = await Promise.all([
      finSupabase.from("pl_dashboard_by_company_view").select(baseCompanyCols).in("company_id", employee.companyIds),
      finSupabase.from("pl_dashboard_by_month_view").select(baseMonthCols),
    ]);
    // Cast is honest: base rows genuinely lack the breakdown columns at
    // runtime — PlExpenseBreakdown's `undefined` check renders nothing for
    // them, and every other cell reads with ?? 0.
    if (!retryCompany.error) plCompanyRows = retryCompany.data as typeof plByCompany;
    if (!retryMonth.error) plMonthRows = retryMonth.data as typeof plByMonth;
    console.error("P&L breakdown columns unavailable — rendered base P&L instead. Run db/2026-09-17-pl-expense-breakdown.sql. Errors:", plByCompanyErr?.message, plByMonthErr?.message);
  }

  // 2026-09-17 — P&L by Month FY selector ("kahi par fy year select karne
  // ka option to nahi diya"). Options derive from the SAME fyDateWindow()
  // the entry validators use (current FY − 10 … current FY + 1) — nothing
  // hardcoded, slides forward every April by itself. ?fy=<startYear>
  // filters the month table to that FY; empty/all keeps the old
  // most-recent-24 view. The view already orders month DESC and holds no
  // data, so fetching all months (limit removed above) and slicing here
  // is the whole implementation — zero SQL/view changes.
  const fyMinStartYear = Number(fyDateWindow().min.slice(0, 4));
  const fyMaxStartYear = fyStartYearOf(fyDateWindow().max);
  const fyOptions = Array.from(
    { length: fyMaxStartYear - fyMinStartYear + 1 },
    (_, i) => fyMaxStartYear - i,
  );
  const fySelectedRaw = Number.parseInt(fyParam ?? "", 10);
  const fySelected =
    Number.isFinite(fySelectedRaw) && fySelectedRaw >= fyMinStartYear && fySelectedRaw <= fyMaxStartYear
      ? fySelectedRaw
      : null;
  const allMonthRows = plMonthRows ?? [];
  // 2026-09-18 — company switcher scope: the month table now follows the
  // currently selected company (same convention as every other company-
  // scoped widget here). "All companies" remains available via the new
  // dropdown for the MD-style comparison view; per the user's ask the
  // DEFAULT is their own company's rows only ("alag company ke hisab se
  // aayega"). fyco=<companyId> pins one company; fyco="all" shows every
  // accessible company.
  const monthCompanyFilter =
    fyCompanyParam === "all"
      ? allMonthRows
      : fyCompanyParam
        ? allMonthRows.filter((r) => r.company_id === fyCompanyParam)
        : allMonthRows.filter((r) => r.company_id === employee.currentCompanyId);
  const plMonthRowsFiltered = monthCompanyFilter
    .filter((r) => (fySelected ? r.month && fyStartYearOf(r.month) === fySelected : true))
    .slice(0, fySelected ? undefined : 48);

  // 2026-09-17 (evening) — "P&L by Company (FY add karna hai)": same
  // ?fy=<startYear> convention as P&L by Month above, but its own param
  // (`fyc`) since the two selectors are independent. `pl_dashboard_by_company_view`
  // is all-time (GROUP BY company only, no month), so an FY cut needs the
  // new per-(company,month) view instead — summed here in JS for the
  // selected FY, then net_earn/profit_pct/net_earn_after_overhead are
  // RECOMPUTED from the summed raw figures using the exact same
  // real-fees-else-25%-estimate CASE the SQL views use (see
  // db/2026-09-17b-pl-usd-and-company-month.sql's own comment on this
  // view) — summing each row's already-computed net_earn would double-count
  // the estimate differently per month, so the sum must happen on the raw
  // components, not the derived ones.
  const fycSelectedRaw = Number.parseInt(fycParam ?? "", 10);
  const fycSelected =
    Number.isFinite(fycSelectedRaw) && fycSelectedRaw >= fyMinStartYear && fycSelectedRaw <= fyMaxStartYear
      ? fycSelectedRaw
      : null;
  type CompanyMonthRow = NonNullable<typeof plByCompanyMonth>[number];
  function aggregateCompanyForFy(rows: CompanyMonthRow[], fyStart: number) {
    const byCompany = new Map<
      string,
      {
        company_id: string;
        company_name: string | null;
        total_sale_value_inr: number;
        total_sale_value_usd: number;
        total_expenses_inr: number;
        total_internal_expenses_inr: number;
        expense_courier_inr: number;
        expense_duty_inr: number;
        expense_purchase_inr: number;
        expense_purchase_adjustments_inr: number;
        expense_washing_inr: number;
        expense_historical_inr: number;
        portal_fees_matched_inr: number;
        bank_inflow_inr: number;
      }
    >();
    for (const r of rows) {
      if (!r.month || !r.company_id || fyStartYearOf(r.month) !== fyStart) continue;
      const acc = byCompany.get(r.company_id) ?? {
        company_id: r.company_id,
        company_name: r.company_name,
        total_sale_value_inr: 0,
        total_sale_value_usd: 0,
        total_expenses_inr: 0,
        total_internal_expenses_inr: 0,
        expense_courier_inr: 0,
        expense_duty_inr: 0,
        expense_purchase_inr: 0,
        expense_purchase_adjustments_inr: 0,
        expense_washing_inr: 0,
        expense_historical_inr: 0,
        portal_fees_matched_inr: 0,
        bank_inflow_inr: 0,
      };
      acc.total_sale_value_inr += Number(r.total_sale_value_inr ?? 0);
      acc.total_sale_value_usd += Number(r.total_sale_value_usd ?? 0);
      acc.total_expenses_inr += Number(r.total_expenses_inr ?? 0);
      acc.total_internal_expenses_inr += Number(r.total_internal_expenses_inr ?? 0);
      acc.expense_courier_inr += Number(r.expense_courier_inr ?? 0);
      acc.expense_duty_inr += Number(r.expense_duty_inr ?? 0);
      acc.expense_purchase_inr += Number(r.expense_purchase_inr ?? 0);
      acc.expense_purchase_adjustments_inr += Number(r.expense_purchase_adjustments_inr ?? 0);
      acc.expense_washing_inr += Number(r.expense_washing_inr ?? 0);
      acc.expense_historical_inr += Number(r.expense_historical_inr ?? 0);
      acc.portal_fees_matched_inr += Number(r.portal_fees_matched_inr ?? 0);
      acc.bank_inflow_inr += Number(r.bank_inflow_inr ?? 0);
      byCompany.set(r.company_id, acc);
    }
    return Array.from(byCompany.values())
      .map((acc) => {
        const sale = acc.total_sale_value_inr;
        const est25 = sale * 0.25;
        const fees = acc.portal_fees_matched_inr;
        const portalEff = fees > 0 ? fees : est25;
        const netEarn = sale - acc.total_expenses_inr - portalEff;
        return {
          company_id: acc.company_id,
          company_name: acc.company_name,
          total_sale_value_inr: sale,
          total_sale_value_usd: acc.total_sale_value_usd,
          total_expenses_inr: acc.total_expenses_inr,
          net_earn: netEarn,
          profit_pct: sale !== 0 ? netEarn / sale : 0,
          total_internal_expenses_inr: acc.total_internal_expenses_inr,
          net_earn_after_overhead: netEarn - acc.total_internal_expenses_inr,
          portal_expenses_25pct: est25,
          expense_courier_inr: acc.expense_courier_inr,
          expense_duty_inr: acc.expense_duty_inr,
          expense_purchase_inr: acc.expense_purchase_inr,
          expense_purchase_adjustments_inr: acc.expense_purchase_adjustments_inr,
          expense_washing_inr: acc.expense_washing_inr,
          expense_historical_inr: acc.expense_historical_inr,
          portal_fees_matched_inr: fees,
          bank_inflow_inr: acc.bank_inflow_inr,
        };
      })
      .sort((a, b) => b.total_sale_value_inr - a.total_sale_value_inr);
  }
  // Only offer the FY selector when the new view actually returned data —
  // if the migration hasn't been run yet, `fycOptionsAvailable` is false
  // and the section quietly stays on the existing all-time view.
  const fycOptionsAvailable = !plByCompanyMonthErr && (plByCompanyMonth ?? []).length > 0;
  const plCompanyRowsFiltered =
    fycSelected && plByCompanyMonth ? aggregateCompanyForFy(plByCompanyMonth, fycSelected) : (plCompanyRows ?? []);

  // 2026-09-18 — "P&L by Marketplace" rows. Same feature-detection pattern:
  // if the migration hasn't run yet, plByStoreErr is set and the tab shows
  // a friendly "not set up yet" message instead of an empty/broken table.
  const plStoreAvailable = !plByStoreErr;
  const plStoreRows = (plByStore ?? []).filter((r) => Number(r.total_sale_value_inr ?? 0) !== 0 || Number(r.order_count ?? 0) > 0);

  const orderStatusCounts = new Map<string, number>();
  for (const row of orderStatusCountRows ?? []) {
    if (row.status) orderStatusCounts.set(row.status, Number(row.cnt));
  }
  const ORDER_STATUSES = ["Pending", "Confirmed", "In Production", "Dispatched", "Delivered", "Hold", "Cancelled", "Returned"];

  const attendanceCounts = new Map<string, number>();
  for (const a of attendanceRows ?? []) {
    if (a.status) attendanceCounts.set(a.status, (attendanceCounts.get(a.status) ?? 0) + 1);
  }
  const ATTENDANCE_STATUSES = ["Present", "Absent", "Late", "Half Day", "Week Off", "Leave", "Holiday"];

  const quickFindRows = "data" in quickFindResult ? quickFindResult.data ?? [] : [];

  // Top Buyers — group by contact_no when present (a phone number is a
  // much more reliable dedup key than free-text buyer_name_address, which
  // varies row to row for the same real buyer — different spelling,
  // extra address details, etc.), falling back to the name text only when
  // no contact number was captured. Rows with neither are skipped (not a
  // real identifiable buyer to group).
  const buyerKey = (b: { buyer_name_address: string | null; contact_no: string | null }) =>
    b.contact_no?.trim() || b.buyer_name_address?.trim() || null;
  const buyerStats = new Map<string, { label: string; orderCount: number; totalUsd: number }>();
  for (const o of buyerOrderRows ?? []) {
    const key = buyerKey(o);
    if (!key) continue;
    const existing = buyerStats.get(key);
    const usd = Number(o.order_value_usd ?? 0);
    if (existing) {
      existing.orderCount += 1;
      existing.totalUsd += usd;
    } else {
      buyerStats.set(key, { label: o.buyer_name_address?.trim() || key, orderCount: 1, totalUsd: usd });
    }
  }
  const topBuyers = Array.from(buyerStats.values())
    .filter((b) => b.orderCount > 1) // "repeat" buyers — a single one-off order isn't a repeat-customer signal
    .sort((a, b) => b.orderCount - a.orderCount || b.totalUsd - a.totalUsd)
    .slice(0, 15);

  // Data Quality Alerts — counted by alert_type for the section's chart.
  const alertTypeCounts = new Map<string, number>();
  for (const a of alerts ?? []) {
    if (!a.alert_type) continue;
    alertTypeCounts.set(a.alert_type, (alertTypeCounts.get(a.alert_type) ?? 0) + 1);
  }
  const alertTypeChartData = Array.from(alertTypeCounts.entries())
    .map(([label, value]) => ({ label, value, color: "#f59e0b" }))
    .sort((a, b) => b.value - a.value);

  // P&L by Month trend chart — chronological (view rows are DESC), capped
  // to the same rows the table already shows so the chart and table always
  // agree with each other. 2026-09-18: rows are per-company now, so the
  // x labels carry the company short-name too ("NM Sep '26") when the
  // All-Companies view is on — otherwise every company's same month would
  // collapse into one indistinguishable tick.
  const plMonthChronological = [...plMonthRowsFiltered].reverse();
  const monthTick = (r: (typeof allMonthRows)[number]) => {
    const label = monthShortLabel(r.month);
    if (fyCompanyParam !== "all") return label;
    const short = (plCompanyRows ?? []).find((c) => c.company_id === r.company_id)?.company_name ?? "?";
    return `${short.split(" ")[0]} ${label}`;
  };
  const plMonthChartSeries = [
    { name: "Sale Value (INR)", color: "#0284c7", points: plMonthChronological.map((r) => ({ x: monthTick(r), value: Number(r.total_sale_value_inr ?? 0) })) },
    { name: "Net Earn (INR)", color: "#059669", points: plMonthChronological.map((r) => ({ x: monthTick(r), value: Number(r.net_earn ?? 0) })) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--oms-text)]">📊 CRM Overview</h1>
        <p className="mt-1 text-sm text-[var(--oms-text-muted)]">Company-wide order/attendance snapshot, data-quality alerts, and the P&amp;L Dashboard.</p>
      </div>

      <form method="GET" className="oms-card rounded-xl border p-4">
        <input type="hidden" name="tab" value={activeTab} />
        <label className="mb-1 block text-xs font-medium text-[var(--oms-text-muted)]">Quick Find — PO/RF/RG No., buyer name, contact no., or marketplace order no.</label>
        <div className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="e.g. PO-0001 or a buyer name"
            className="w-full max-w-md rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-3 py-2 text-sm text-[var(--oms-text)] outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">Search</button>
        </div>
        {query && (
          <div className="mt-3 space-y-1 text-sm">
            {quickFindRows.length === 0 && <p className="text-[var(--oms-text-muted)]">No matches.</p>}
            {quickFindRows.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--oms-surface-border)] py-1.5 last:border-0">
                <span className="font-medium text-[var(--oms-text)]">{o.ref_no}</span>
                <span className="text-[var(--oms-text-muted)]">{o.buyer_name_address ?? "—"}</span>
                <span className="text-[var(--oms-text-muted)]">{o.contact_no ?? "—"}</span>
                <span className="rounded-full bg-[var(--oms-canvas)] px-2 py-0.5 text-xs text-[var(--oms-text-muted)]">{o.status}</span>
              </div>
            ))}
          </div>
        )}
      </form>

      {/* 2026-09-17 (evening) — CRM section menu. Server-driven (plain
          <Link>s to ?tab=...), not client useState, since every section
          below already round-trips its own GET forms (FY selectors, Quick
          Find) — a URL-driven tab needs no extra client JS/island and the
          FY forms just carry a hidden `tab` field to land back on the same
          tab after Apply. */}
      <div className="oms-card flex flex-wrap gap-1 rounded-xl border p-1">
        {CRM_TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === t.key ? "bg-amber-500 text-white" : "text-[var(--oms-text-muted)] hover:bg-[var(--oms-canvas)]"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {activeTab === "buyers" && (
        <div className="oms-card rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Top Buyers — Repeat Customers (current company)</h2>
          <p className="mb-3 text-xs text-[var(--oms-text-muted)]">
            Grouped by contact number (falls back to buyer name when no number was captured). Only buyers with more than
            one order are shown.
          </p>
          <div className="mb-4 rounded-lg bg-[var(--oms-canvas)] p-3">
            <p className="mb-2 text-xs font-semibold text-[var(--oms-text-muted)]">Orders per buyer (top 10)</p>
            <BarChart
              data={topBuyers.slice(0, 10).map((b) => ({ label: b.label, value: b.orderCount, color: "#0284c7" }))}
              valueFormatter={(v) => String(v)}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--oms-surface-border)] text-sm">
              <thead className="bg-[var(--oms-canvas)]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--oms-text-muted)]">Buyer</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Orders</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Total Value (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oms-surface-border)]">
                {topBuyers.map((b) => (
                  <tr key={b.label + b.orderCount}>
                    <td className="px-3 py-2 font-medium text-[var(--oms-text)]">{b.label}</td>
                    <td className="px-3 py-2 text-right text-[var(--oms-text)]">{b.orderCount}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[var(--oms-text)]">${b.totalUsd.toFixed(2)}</td>
                  </tr>
                ))}
                {topBuyers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-[var(--oms-text-muted)]">
                      No repeat buyers yet for this company.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "orders" && (
        <div className="oms-card rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Orders by Status</h2>
          <div className="mb-4 rounded-lg bg-[var(--oms-canvas)] p-3">
            <BarChart
              data={ORDER_STATUSES.map((s) => ({ label: s, value: orderStatusCounts.get(s) ?? 0, color: ORDER_STATUS_COLOR[s] }))}
              valueFormatter={(v) => String(v)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ORDER_STATUSES.map((s) => (
              <div key={s} className="rounded-lg bg-[var(--oms-canvas)] p-3 text-center">
                <div className="text-xl font-bold text-[var(--oms-text)]">{orderStatusCounts.get(s) ?? 0}</div>
                <div className="text-xs text-[var(--oms-text-muted)]">{s}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "attendance" && (
        <div className="oms-card rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Today&apos;s Attendance ({today})</h2>
          <div className="mb-4 rounded-lg bg-[var(--oms-canvas)] p-3">
            <BarChart
              data={ATTENDANCE_STATUSES.map((s) => ({ label: s, value: attendanceCounts.get(s) ?? 0, color: ATTENDANCE_STATUS_COLOR[s] }))}
              valueFormatter={(v) => String(v)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ATTENDANCE_STATUSES.map((s) => (
              <div key={s} className="rounded-lg bg-[var(--oms-canvas)] p-3 text-center">
                <div className="text-xl font-bold text-[var(--oms-text)]">{attendanceCounts.get(s) ?? 0}</div>
                <div className="text-xs text-[var(--oms-text-muted)]">{s}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "alerts" && (
        <div className="oms-card rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Data Quality Alerts ({(alerts ?? []).length} of up to 50)</h2>
          {alertTypeChartData.length > 0 && (
            <div className="mb-4 rounded-lg bg-[var(--oms-canvas)] p-3">
              <p className="mb-2 text-xs font-semibold text-[var(--oms-text-muted)]">Alerts by type</p>
              <BarChart data={alertTypeChartData} valueFormatter={(v) => String(v)} />
            </div>
          )}
          <div className="space-y-1 text-xs">
            {(alerts ?? []).length === 0 && <p className="text-[var(--oms-text-muted)]">No alerts. 🎉</p>}
            {(alerts ?? []).map((a, i) => (
              <div key={`${a.order_id}-${i}`} className="flex items-start gap-2 border-b border-[var(--oms-surface-border)] py-1.5 last:border-0">
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">{a.alert_type}</span>
                <span className="text-[var(--oms-text-muted)]">{a.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "pl-company" && (
        <div className="oms-card rounded-xl border p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--oms-text)]">
              P&amp;L by Company{fycSelected && fycOptionsAvailable ? ` — FY ${fyLabelOf(fycSelected)}` : " (all time)"}
            </h2>
            {fycOptionsAvailable && (
              <form method="GET" className="flex items-center gap-2">
                <input type="hidden" name="tab" value="pl-company" />
                <label htmlFor="pl-fyc" className="text-xs text-[var(--oms-text-muted)]">Financial Year</label>
                <select
                  id="pl-fyc"
                  name="fyc"
                  defaultValue={fycSelected ? String(fycSelected) : "all"}
                  className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-2 py-1 text-xs text-[var(--oms-text)] outline-none focus:border-amber-500"
                >
                  <option value="all">All time</option>
                  {fyOptions.map((y) => (
                    <option key={y} value={String(y)}>FY {fyLabelOf(y)}</option>
                  ))}
                </select>
                <button type="submit" className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600">Apply</button>
              </form>
            )}
          </div>
          <div className="mb-4 rounded-lg bg-[var(--oms-canvas)] p-3">
            <GroupedBarChart
              groups={plCompanyRowsFiltered.map((r) => ({
                label: r.company_name ?? "—",
                values: [Number(r.total_sale_value_inr ?? 0), Number(r.total_expenses_inr ?? 0), Number(r.net_earn ?? 0)],
              }))}
              series={[
                { name: "Sale Value (INR)", color: "#0284c7" },
                { name: "Expenses (INR)", color: "#dc2626" },
                { name: "Net Earn (INR)", color: "#059669" },
              ]}
              valueFormatter={(v) => inr2(v)}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--oms-surface-border)] text-sm">
              <thead className="bg-[var(--oms-canvas)]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--oms-text-muted)]">Company</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Sale Value (INR)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Sale Value (USD)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Expenses (INR)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Net Earn</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Profit %</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Internal Expenses (INR)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Net Earn (After Overhead)</th>
                  <th className="w-8 px-2 py-2"><span className="sr-only">Expand</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oms-surface-border)]">
                {plCompanyRowsFiltered.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-[var(--oms-text-muted)]">No Sale &amp; Profit Ledger data yet — import via CSV Upload.</td></tr>
                )}
                {plCompanyRowsFiltered.map((r) => (
                  <Fragment key={r.company_id}>
                    <tr className="pl-expand align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--oms-text)]">{r.company_name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right pl-in font-semibold text-sky-700">{Number(r.total_sale_value_inr ?? 0).toFixed(2)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right pl-in font-semibold text-sky-700">${usd2(r.total_sale_value_usd)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold pl-out text-rose-600" title="Courier + Duty + Purchase − Note adjustments + Washing + history — click ▾ for the line-by-line split">
                        {Number(r.total_expenses_inr ?? 0).toFixed(2)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${Number(r.net_earn ?? 0) >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{Number(r.net_earn ?? 0).toFixed(2)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">{(Number(r.profit_pct ?? 0) * 100).toFixed(2)}%</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{Number(r.total_internal_expenses_inr ?? 0).toFixed(2)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${Number(r.net_earn_after_overhead ?? 0) >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{Number(r.net_earn_after_overhead ?? 0).toFixed(2)}</td>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" className="pl-toggle" aria-label={`Expand ${r.company_name ?? "company"} P&L breakdown`} />
                      </td>
                    </tr>
                    <tr className="pl-detail">
                      <td colSpan={9} className="bg-[var(--oms-canvas)] px-6 py-2">
                        <PlExpenseBreakdown row={r} />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "pl-month" && (
        <div className="oms-card rounded-xl border p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--oms-text)]">
              P&amp;L by Month{fySelected ? ` — FY ${fyLabelOf(fySelected)}` : ""} · {fyCompanyParam === "all" ? "All Companies" : (plCompanyRows ?? []).find((c) => c.company_id === (fyCompanyParam || employee.currentCompanyId))?.company_name ?? "Current Company"}
            </h2>
            <form method="GET" className="flex items-center gap-2">
              <input type="hidden" name="tab" value="pl-month" />
              {/* 2026-09-18 — FY + company selectors side by side (the company
                  dropdown is the per-company month view ask). Both live in ONE
                  GET form so Apply applies both at once; fyco="all" is the
                  all-companies comparison view, otherwise it defaults to the
                  currently switched company like every other widget here. */}
              <label htmlFor="pl-fy" className="text-xs text-[var(--oms-text-muted)]">Financial Year</label>
              <select
                id="pl-fy"
                name="fy"
                defaultValue={fySelected ? String(fySelected) : "all"}
                className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-2 py-1 text-xs text-[var(--oms-text)] outline-none focus:border-amber-500"
              >
                <option value="all">All FYs</option>
                {fyOptions.map((y) => (
                  <option key={y} value={String(y)}>FY {fyLabelOf(y)}</option>
                ))}
              </select>
              <label htmlFor="pl-fyco" className="text-xs text-[var(--oms-text-muted)]">Company</label>
              <select
                id="pl-fyco"
                name="fyco"
                defaultValue={fyCompanyParam === "all" ? "all" : fyCompanyParam ?? employee.currentCompanyId}
                className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-2 py-1 text-xs text-[var(--oms-text)] outline-none focus:border-amber-500"
              >
                <option value="all">All Companies</option>
                {(plCompanyRows ?? []).map((c) => (
                  <option key={c.company_id} value={c.company_id ?? ""}>{c.company_name ?? ""}</option>
                ))}
              </select>
              <button type="submit" className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600">Apply</button>
            </form>
          </div>
          <div className="mb-4 rounded-lg bg-[var(--oms-canvas)] p-3">
            <LineChart series={plMonthChartSeries} valueFormatter={(v) => inr2(v)} />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--oms-surface-border)] text-sm">
              <thead className="bg-[var(--oms-canvas)]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--oms-text-muted)]">Month</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Sale Value (INR)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Sale Value (USD)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Expenses (INR)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Net Earn</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Profit %</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Internal Expenses (INR)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Net Earn (After Overhead)</th>
                  <th className="w-8 px-2 py-2"><span className="sr-only">Expand</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oms-surface-border)]">
                {plMonthRowsFiltered.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-[var(--oms-text-muted)]">No Sale &amp; Profit Ledger data yet — import via CSV Upload.</td></tr>
                )}
                {plMonthRowsFiltered.map((r) => (
                  <Fragment key={`${r.company_id ?? "all"}:${r.month ?? ""}`}>
                    <tr className="pl-expand align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--oms-text)]">{r.month}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right pl-in font-semibold text-sky-700">{Number(r.total_sale_value_inr ?? 0).toFixed(2)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right pl-in font-semibold text-sky-700">${usd2(r.total_sale_value_usd)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold pl-out text-rose-600" title="Courier + Duty + Purchase − Note adjustments + Washing + history — click ▾ for the line-by-line split">
                        {Number(r.total_expenses_inr ?? 0).toFixed(2)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${Number(r.net_earn ?? 0) >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{Number(r.net_earn ?? 0).toFixed(2)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">{(Number(r.profit_pct ?? 0) * 100).toFixed(2)}%</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{Number(r.total_internal_expenses_inr ?? 0).toFixed(2)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${Number(r.net_earn_after_overhead ?? 0) >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{Number(r.net_earn_after_overhead ?? 0).toFixed(2)}</td>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" className="pl-toggle" aria-label={`Expand ${r.month ?? "month"} P&L breakdown`} />
                      </td>
                    </tr>
                    <tr className="pl-detail">
                      <td colSpan={9} className="bg-[var(--oms-canvas)] px-6 py-2">
                        <PlExpenseBreakdown row={r} />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "pl-marketplace" && (
        <div className="oms-card rounded-xl border p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--oms-text)]">P&amp;L by Marketplace (current company, all time)</h2>
            <Link href="/dashboard/reports/finance-dashboard" className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
              💹 Full Finance Dashboard (date range + charts) →
            </Link>
          </div>
          {!plStoreAvailable ? (
            <p className="mt-3 rounded-lg bg-[var(--oms-canvas)] p-3 text-xs text-[var(--oms-text-muted)]">
              This section needs db/2026-09-18-pl-by-marketplace-store.sql AND db/2026-09-18c-pl-purchase-washing-order-linked.sql
              run in Supabase SQL Editor first — ask whoever runs your database migrations to apply them, then reload this page.
            </p>
          ) : (
            <>
              {/* 2026-09-18 (round 8) — owner correction: purchase_bills and
                  washing_entries DO already carry an order_id (washing_entries
                  even has its own store_id), so Purchase/Washing ARE now
                  attributed here via that link — only genuinely order-
                  independent office overhead (rent/salary/electricity — see
                  P&L by Company/Month) is still excluded. See
                  db/2026-09-18c-pl-purchase-washing-order-linked.sql's header. */}
              <p className="mb-3 text-xs text-[var(--oms-text-muted)]">
                One row per store (Amazon US, Amazon UK, Etsy, Website, Wholesale, etc.). Shows Sale Value, Courier + Duty,
                matched Portal/Marketplace Fees, Purchase + Washing (attributed via each bill/entry&apos;s order link — see
                Finance Dashboard for how much is not yet linked), Ad Spend and ROAS. &quot;Net (before overhead)&quot; below
                still excludes office/rent/salary overhead only — that genuinely has no order to attribute to. See P&amp;L
                by Company/Month for the complete number including that.
              </p>
              <div className="mb-4 rounded-lg bg-[var(--oms-canvas)] p-3">
                <p className="mb-2 text-xs font-semibold text-[var(--oms-text-muted)]">Sale Value vs Courier+Duty+Fees+Purchase+Washing vs Net (before office overhead), by marketplace</p>
                <GroupedBarChart
                  groups={plStoreRows.map((r) => ({
                    label: r.store_name ?? "—",
                    values: [
                      Number(r.total_sale_value_inr ?? 0),
                      Number(r.expense_courier_inr ?? 0) + Number(r.expense_duty_inr ?? 0) + Number(r.portal_expense_effective_inr ?? 0) + Number(r.expense_purchase_inr ?? 0) + Number(r.expense_washing_inr ?? 0),
                      Number(r.net_before_overhead_inr ?? 0),
                    ],
                  }))}
                  series={[
                    { name: "Sale Value (INR)", color: "#0284c7" },
                    { name: "Courier+Duty+Fees+Purchase+Washing (INR)", color: "#dc2626" },
                    { name: "Net, before office overhead (INR)", color: "#059669" },
                  ]}
                  valueFormatter={(v) => inr2(v)}
                />
              </div>
              {plStoreRows.some((r) => Number(r.ad_spend_usd ?? 0) > 0) && (
                <div className="mb-4 rounded-lg bg-[var(--oms-canvas)] p-3">
                  <p className="mb-2 text-xs font-semibold text-[var(--oms-text-muted)]">ROAS (Sale Value USD ÷ Ad Spend USD) — marketplaces with ad spend entered</p>
                  <BarChart
                    data={plStoreRows
                      .filter((r) => Number(r.ad_spend_usd ?? 0) > 0)
                      .map((r) => ({ label: r.store_name ?? "—", value: Number(r.roas ?? 0), color: "#7c3aed" }))}
                    valueFormatter={(v) => `${v.toFixed(2)}x`}
                  />
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--oms-surface-border)] text-sm">
                  <thead className="bg-[var(--oms-canvas)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--oms-text-muted)]">Marketplace / Store</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Orders</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Sale Value (INR)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Sale Value (USD)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Courier (INR)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Duty (INR)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Portal Fees (INR)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Purchase (INR)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Washing (INR)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Ad Spend (USD)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">ROAS</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--oms-text-muted)]">Net (before office overhead)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--oms-surface-border)]">
                    {plStoreRows.length === 0 && (
                      <tr><td colSpan={12} className="px-3 py-6 text-center text-[var(--oms-text-muted)]">No orders yet for this company.</td></tr>
                    )}
                    {(() => {
                      const totals = plStoreRows.reduce(
                        (acc, r) => ({
                          orders: acc.orders + Number(r.order_count ?? 0),
                          saleInr: acc.saleInr + Number(r.total_sale_value_inr ?? 0),
                          saleUsd: acc.saleUsd + Number(r.total_sale_value_usd ?? 0),
                          courier: acc.courier + Number(r.expense_courier_inr ?? 0),
                          duty: acc.duty + Number(r.expense_duty_inr ?? 0),
                          fees: acc.fees + Number(r.portal_expense_effective_inr ?? 0),
                          purchase: acc.purchase + Number(r.expense_purchase_inr ?? 0),
                          washing: acc.washing + Number(r.expense_washing_inr ?? 0),
                          adSpend: acc.adSpend + Number(r.ad_spend_usd ?? 0),
                          net: acc.net + Number(r.net_before_overhead_inr ?? 0),
                        }),
                        { orders: 0, saleInr: 0, saleUsd: 0, courier: 0, duty: 0, fees: 0, purchase: 0, washing: 0, adSpend: 0, net: 0 },
                      );
                      return (
                        <>
                          {plStoreRows.map((r) => (
                            <tr key={r.store_id}>
                              <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--oms-text)]">
                                {r.store_name}
                                <span className="ml-1.5 text-[10px] font-normal text-[var(--oms-text-muted)]">{r.company_name}</span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">{r.order_count ?? 0}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-in font-semibold text-sky-700">{inr2(r.total_sale_value_inr)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-in font-semibold text-sky-700">${usd2(r.total_sale_value_usd)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{inr2(r.expense_courier_inr)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{inr2(r.expense_duty_inr)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600" title={Number(r.portal_fees_matched_inr ?? 0) > 0 ? "real, matched fees" : "25% estimate — no matched statement fees yet"}>
                                {inr2(r.portal_expense_effective_inr)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600" title="Purchase bills linked to an order at this store (order_id) — unlinked bills aren't counted here">
                                {inr2(r.expense_purchase_inr)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600" title="Washing entries tagged to this store">
                                {inr2(r.expense_washing_inr)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">${usd2(r.ad_spend_usd)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">
                                {r.roas !== null && r.roas !== undefined ? `${Number(r.roas).toFixed(2)}x` : "—"}
                              </td>
                              <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${Number(r.net_before_overhead_inr ?? 0) >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>
                                {inr2(r.net_before_overhead_inr)}
                              </td>
                            </tr>
                          ))}
                          {plStoreRows.length > 0 && (
                            <tr className="bg-[var(--oms-canvas)] font-semibold">
                              <td className="whitespace-nowrap px-3 py-2 text-[var(--oms-text)]">Total ({plStoreRows.length} marketplaces)</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">{totals.orders}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-in text-sky-700">{inr2(totals.saleInr)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-in text-sky-700">${usd2(totals.saleUsd)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{inr2(totals.courier)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{inr2(totals.duty)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{inr2(totals.fees)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{inr2(totals.purchase)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right pl-out text-rose-600">{inr2(totals.washing)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">${usd2(totals.adSpend)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right text-[var(--oms-text)]">
                                {totals.adSpend > 0 ? `${(totals.saleUsd / totals.adSpend).toFixed(2)}x` : "—"}
                              </td>
                              <td className={`whitespace-nowrap px-3 py-2 text-right ${totals.net >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>{inr2(totals.net)}</td>
                            </tr>
                          )}
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
