import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { FY_START_MONTH, fyDateWindow } from "@/lib/fy-date";
import { BarChart, DonutChart, GroupedBarChart, LineChart } from "@/components/simple-charts";

// 2026-09-18 (later) — "Finance Dashboard" page. The owner sent a
// screenshot of a reference dashboard (KPI cards + Profit & Loss bar chart
// + Expense Breakdown donut + P&L Trend line + Shipping/Payment/
// Advertising/Returns transaction lists + a P&L summary + a P&L engine
// flow diagram, with Date Range / Marketplace / Country filters at the
// top) and said "esa desboard banega P&L ka" — build one like this.
//
// This is a DIFFERENT thing from the CRM page's "P&L by Company/Month/
// Marketplace" tabs: those are all-time or calendar-month comparisons.
// This page is a single-company, ARBITRARY-date-range dashboard, which is
// why it needs its own SQL (db/2026-09-18b-finance-dashboard-rpc.sql —
// finance_dashboard_monthly()) rather than reusing the existing views.
//
// 2026-09-18 (round 8) — owner correction on the first version of this
// page, which had lumped purchase/washing/office-overhead into one
// unsplittable "Other" bucket: "lekin agar purchase ho raha hai to order
// ke against me ho raha hai na or washing bhi ho raha hai to order ke
// against me ho raha hai. abhi data pura manage nahi hai to kya hua new
// fy se pura manage ho jayega." Correct — purchase_bills.order_id and
// washing_entries.order_id/store_id already exist (see db/2026-09-18c-pl-
// purchase-washing-order-linked.sql's header for the full trace through
// db/schema.sql). Purchase and Washing are now attributed via that link
// whenever it's filled in, and the page shows exactly how much is NOT yet
// linked (finance_dashboard_unlinked_purchase_washing) instead of hiding
// that gap inside "Other" — that "not yet linked" figure is the thing
// that shrinks toward zero as data entry gets more consistent, which is
// exactly the owner's own point about it improving from here.
//
// What's STILL genuinely unattributable, and stays as "Office Overhead":
// internal_expenses (rent, salary, electricity, etc.) has no order_id at
// all in this schema — those costs really aren't tied to any one order,
// so there's nothing to link. That's the only piece this page can't split
// by marketplace/country. Ad Spend also has no buyer_country on it
// (store_ad_spend is store+date only), so the Country filter never
// affects Advertising — stated in the UI, not silently ignored.

const inr2 = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd2 = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShortLabel = (dateStr: string | null | undefined) => {
  if (!dateStr) return "—";
  const [y, m] = dateStr.split("-").map(Number);
  return `${MONTH_SHORT[(m ?? 1) - 1] ?? "?"} '${String(y).slice(2)}`;
};
const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
};
const daysBetweenInclusive = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
};

// 2026-09-18 (round 9) — "p&l by market range vala jo desboard hai usme
// sara data aara usko fy se month se agar chaek karunga to kese": the page
// only had a raw From/To date picker, no FY/Month quick-select, unlike the
// CRM "P&L by Company/Month" tabs' ?fy=<startYear> dropdown (src/lib/
// fy-date.ts). Added a "Quick Range" dropdown here using the SAME
// April-start FY math (FY_START_MONTH/fyDateWindow, nothing hardcoded) plus
// a rolling last-24-months list — both just resolve to a from/to pair via
// ?range=fy:<startYear> or ?range=month:<YYYY-MM>, so the existing
// from/to-driven RPC calls below needed zero changes.
const fyStartYearOf = (dateStr: string) => {
  const [y, m] = dateStr.split("-").map(Number);
  return m < FY_START_MONTH ? y - 1 : y;
};
const fyLabelOf = (startYear: number) => `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
function lastDayOfMonth(year: number, month: number) {
  // month is 1-12; Date.UTC's month arg is 0-indexed, so passing `month`
  // (unshifted) with day 0 lands on the last day of the PREVIOUS 0-indexed
  // month, i.e. the last day of `month` itself.
  return toDateStr(new Date(Date.UTC(year, month, 0)));
}
function fyBounds(startYear: number): { from: string; to: string } {
  const from = `${startYear}-${String(FY_START_MONTH).padStart(2, "0")}-01`;
  const endMonthRaw = FY_START_MONTH - 1;
  const endYear = endMonthRaw === 0 ? startYear : startYear + 1;
  const endMonth = endMonthRaw === 0 ? 12 : endMonthRaw;
  return { from, to: lastDayOfMonth(endYear, endMonth) };
}
function monthsBackList(count: number, from: Date) {
  const out: { value: string; label: string }[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth() + 1; // 1-12
  for (let i = 0; i < count; i++) {
    out.push({ value: `month:${y}-${String(m).padStart(2, "0")}`, label: `${MONTH_SHORT[m - 1]} ${y}` });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
// Resolves a ?range= value to a {from, to} pair, or null when it's empty/
// invalid (falls back to the manual From/To fields). Caps the end date at
// "today" for the current/running FY or month — a quick range never asks
// for data that hasn't happened yet.
function resolveQuickRange(range: string, today: string): { from: string; to: string } | null {
  if (range.startsWith("fy:")) {
    const y = Number.parseInt(range.slice(3), 10);
    if (!Number.isFinite(y)) return null;
    const b = fyBounds(y);
    return { from: b.from, to: b.to < today ? b.to : today };
  }
  if (range.startsWith("month:")) {
    const [yStr, mStr] = range.slice(6).split("-");
    const y = Number.parseInt(yStr, 10);
    const m = Number.parseInt(mStr, 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const to0 = lastDayOfMonth(y, m);
    return { from, to: to0 < today ? to0 : today };
  }
  return null;
}
// vs-previous-period % change chip. null when the previous period has no
// baseline to compare against (avoids a meaningless "+∞%").
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
function ChangeChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[11px] text-[var(--oms-text-muted)]">vs. previous period: n/a</span>;
  const up = pct >= 0;
  return (
    <span className={`text-[11px] font-medium ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}% <span className="text-[var(--oms-text-muted)] font-normal">vs. previous period</span>
    </span>
  );
}

type MonthlyRow = {
  month: string;
  order_count: number;
  total_sale_value_inr: number;
  total_sale_value_usd: number;
  expense_courier_inr: number;
  expense_duty_inr: number;
  portal_fees_matched_inr: number;
  portal_expense_effective_inr: number;
  ad_spend_usd: number;
  returns_inr: number;
  expense_purchase_inr: number;
  expense_washing_inr: number;
};

function sumMonthly(rows: MonthlyRow[]) {
  return rows.reduce(
    (acc, r) => ({
      orderCount: acc.orderCount + Number(r.order_count ?? 0),
      saleInr: acc.saleInr + Number(r.total_sale_value_inr ?? 0),
      saleUsd: acc.saleUsd + Number(r.total_sale_value_usd ?? 0),
      courier: acc.courier + Number(r.expense_courier_inr ?? 0),
      duty: acc.duty + Number(r.expense_duty_inr ?? 0),
      portalFee: acc.portalFee + Number(r.portal_expense_effective_inr ?? 0),
      adSpendUsd: acc.adSpendUsd + Number(r.ad_spend_usd ?? 0),
      returns: acc.returns + Number(r.returns_inr ?? 0),
      purchase: acc.purchase + Number(r.expense_purchase_inr ?? 0),
      washing: acc.washing + Number(r.expense_washing_inr ?? 0),
    }),
    { orderCount: 0, saleInr: 0, saleUsd: 0, courier: 0, duty: 0, portalFee: 0, adSpendUsd: 0, returns: 0, purchase: 0, washing: 0 },
  );
}

// Every-cost-except-office-overhead, for one monthly row — used by both the
// Profit & Loss Overview bar chart and the P&L Trend line chart so the two
// always agree with each other and with the KPI cards.
function monthCostsInr(r: MonthlyRow, usdToInr: number) {
  return (
    Number(r.expense_courier_inr ?? 0) +
    Number(r.expense_duty_inr ?? 0) +
    Number(r.portal_expense_effective_inr ?? 0) +
    Number(r.returns_inr ?? 0) +
    Number(r.expense_purchase_inr ?? 0) +
    Number(r.expense_washing_inr ?? 0) +
    (usdToInr > 0 ? Number(r.ad_spend_usd ?? 0) * usdToInr : 0)
  );
}

export default async function FinanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; store?: string; country?: string; range?: string }>;
}) {
  const employee = await requireCapability("crm_dashboard");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const sp = await searchParams;

  const today = todayIST();
  const defaultFrom = addDays(today, -29); // last 30 days, inclusive of today
  const rangeParam = typeof sp.range === "string" ? sp.range : "";
  const quickRange = rangeParam ? resolveQuickRange(rangeParam, today) : null;
  const from = quickRange?.from ?? (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : defaultFrom);
  const to = quickRange?.to ?? (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today);
  const storeId = sp.store && sp.store !== "all" ? sp.store : null;
  const country = sp.country && sp.country !== "all" ? sp.country : null;

  // FY options mirror the CRM "P&L by Company/Month" tabs' ?fy= dropdown —
  // same fyDateWindow() window (current FY − 10 … current FY + 1), nothing
  // hardcoded. Month options are a rolling last 24 months from today.
  const fyMinStartYear = Number(fyDateWindow().min.slice(0, 4));
  const fyMaxStartYear = fyStartYearOf(fyDateWindow().max);
  const fyQuickOptions = Array.from(
    { length: fyMaxStartYear - fyMinStartYear + 1 },
    (_, i) => fyMaxStartYear - i,
  ).map((y) => ({ value: `fy:${y}`, label: `FY ${fyLabelOf(y)}` }));
  const monthQuickOptions = monthsBackList(24, new Date(`${today}T00:00:00Z`));

  const periodDays = daysBetweenInclusive(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(periodDays - 1));

  const [
    { data: stores },
    { data: countryRows },
    { data: monthlyRows, error: monthlyErr },
    { data: prevMonthlyRows },
    { data: rateRow },
    { data: recentOrdersForLists },
    { data: overheadRows },
    { data: prevOverheadRows },
    { data: unlinkedRow },
  ] = await Promise.all([
    supabase.from("stores").select("id, name").eq("company_id", employee.currentCompanyId).eq("active", true).order("name"),
    // Distinct buyer countries for the filter dropdown — capped scan
    // (same 1000-3000-row cap other report pages use) rather than a
    // full-table DISTINCT, which the query builder can't express anyway
    // without a view/RPC.
    supabase.from("orders").select("buyer_country").eq("company_id", employee.currentCompanyId).not("buyer_country", "is", null).limit(3000),
    // 2026-09-18 (later, then round 8) — db/2026-09-18b-finance-dashboard-
    // rpc.sql + db/2026-09-18c-pl-purchase-washing-order-linked.sql.
    // Feature-detected: if neither migration has run yet, monthlyErr is
    // set and the page shows a "run this migration first" message.
    finSupabase.rpc("finance_dashboard_monthly", {
      p_company_id: employee.currentCompanyId,
      p_from: from,
      p_to: to,
      p_store_id: storeId,
      p_buyer_country: country,
    }),
    finSupabase.rpc("finance_dashboard_monthly", {
      p_company_id: employee.currentCompanyId,
      p_from: prevFrom,
      p_to: prevTo,
      p_store_id: storeId,
      p_buyer_country: country,
    }),
    finSupabase.rpc("get_official_rate_as_of", { p_currency_code: "USD", p_as_of: to }),
    // Recent-orders pool for the Shipping/Returns transaction-detail lists
    // below (need order ids matching the SAME filters to join shipments/
    // refunds against) — capped, same reasoning as the Reports hub's own
    // .limit(1000) pattern; a "recent activity" panel doesn't need every
    // matching order, just enough to find the latest 8 shipments/refunds.
    (() => {
      let q = supabase
        .from("orders")
        .select("id, ref_no, order_date, store_id, buyer_country, status")
        .eq("company_id", employee.currentCompanyId)
        .neq("status", "Cancelled")
        .gte("order_date", from)
        .lte("order_date", to)
        .order("order_date", { ascending: false })
        .limit(500);
      if (storeId) q = q.eq("store_id", storeId);
      if (country) q = q.eq("buyer_country", country);
      return q;
    })(),
    // Office/internal overhead (rent, salary, electricity...) — the ONE
    // cost this page still can't attribute to an order/marketplace, since
    // internal_expenses has no order_id at all (nothing to link — these
    // genuinely aren't tied to any one order). Company-wide by definition.
    finSupabase.from("internal_expenses").select("amount_inr").eq("company_id", employee.currentCompanyId).gte("expense_date", from).lte("expense_date", to),
    finSupabase.from("internal_expenses").select("amount_inr").eq("company_id", employee.currentCompanyId).gte("expense_date", prevFrom).lte("expense_date", prevTo),
    // 2026-09-18 (round 8) — how much purchase/washing is NOT linked to an
    // order yet (see db/2026-09-18c-...sql). Shown as a plain "not yet
    // linked" figure rather than silently folded into anything else.
    finSupabase.rpc("finance_dashboard_unlinked_purchase_washing", {
      p_company_id: employee.currentCompanyId,
      p_from: from,
      p_to: to,
    }),
  ]);

  const financeAvailable = !monthlyErr;
  const rows: MonthlyRow[] = (monthlyRows ?? []) as MonthlyRow[];
  const prevRows: MonthlyRow[] = (prevMonthlyRows ?? []) as MonthlyRow[];
  const usdToInr = Number(rateRow?.[0]?.rate_to_inr ?? 0);
  const unlinked = unlinkedRow?.[0];

  const orderIds = (recentOrdersForLists ?? []).map((o) => o.id);
  const orderById = new Map((recentOrdersForLists ?? []).map((o) => [o.id, o]));

  const officeOverheadInr = (overheadRows ?? []).reduce((s, r) => s + Number(r.amount_inr ?? 0), 0);
  const prevOfficeOverheadInr = (prevOverheadRows ?? []).reduce((s, r) => s + Number(r.amount_inr ?? 0), 0);

  const [
    { data: shipments },
    { data: payments },
    { data: adSpendRows },
    { data: refunds },
  ] = await Promise.all([
    // Transaction Details — Shipping: latest 8 shipments among the
    // filtered order pool, with net courier/duty cost per order.
    orderIds.length > 0
      ? finSupabase.from("order_shipments").select("id, order_id, courier_name, awb_no, delivered_status, delivered_date, created_at").in("order_id", orderIds).order("created_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] as { id: string; order_id: string; courier_name: string | null; awb_no: string | null; delivered_status: string | null; delivered_date: string | null; created_at: string }[] }),
    // Payment — portal_payment_reconciliation has its own store_id, so
    // it's filtered directly (country doesn't apply — no country column
    // on this table; noted in the panel's own copy).
    (() => {
      let q = finSupabase
        .from("portal_payment_reconciliation")
        .select("id, store_id, marketplace_order_id, invoice_no, total_inr, total_exp_inr, invoice_date, payment_receive_refund_date")
        .gte("invoice_date", from)
        .lte("invoice_date", to)
        .order("invoice_date", { ascending: false })
        .limit(8);
      if (storeId) q = q.eq("store_id", storeId);
      return q;
    })(),
    (() => {
      let q = finSupabase.from("store_ad_spend").select("id, store_id, spend_date, budget_usd, spend_usd").gte("spend_date", from).lte("spend_date", to).order("spend_date", { ascending: false }).limit(8);
      if (storeId) q = q.eq("store_id", storeId);
      return q;
    })(),
    // Returns — latest 8 refunds among the filtered order pool.
    orderIds.length > 0
      ? finSupabase.from("order_refunds").select("id, order_id, refund_date, reason, refund_amount_inr, credit_note_id").in("order_id", orderIds).order("refund_date", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] as { id: string; order_id: string; refund_date: string; reason: string | null; refund_amount_inr: number | null; credit_note_id: string | null }[] }),
  ]);

  const totals = sumMonthly(rows);
  const prevTotals = sumMonthly(prevRows);
  const adSpendInr = usdToInr > 0 ? totals.adSpendUsd * usdToInr : 0;
  const prevAdSpendInr = usdToInr > 0 ? prevTotals.adSpendUsd * usdToInr : 0;
  const totalExpensesInr = totals.courier + totals.duty + totals.portalFee + adSpendInr + totals.returns + totals.purchase + totals.washing + officeOverheadInr;
  const prevTotalExpensesInr = prevTotals.courier + prevTotals.duty + prevTotals.portalFee + prevAdSpendInr + prevTotals.returns + prevTotals.purchase + prevTotals.washing + prevOfficeOverheadInr;
  const netProfitInr = totals.saleInr - totalExpensesInr;
  const prevNetProfitInr = prevTotals.saleInr - prevTotalExpensesInr;

  const countryOptions = Array.from(new Set((countryRows ?? []).map((r) => r.buyer_country).filter((c): c is string => !!c))).sort();

  const monthlyChronological = [...rows].sort((a, b) => (a.month < b.month ? -1 : 1));
  const plOverviewGroups = monthlyChronological.map((r) => {
    const monthExpenses = monthCostsInr(r, usdToInr);
    return {
      label: monthShortLabel(r.month),
      values: [Number(r.total_sale_value_inr ?? 0), monthExpenses, Number(r.total_sale_value_inr ?? 0) - monthExpenses],
    };
  });
  const plTrendSeries = [
    { name: "Revenue (INR)", color: "#0284c7", points: monthlyChronological.map((r) => ({ x: monthShortLabel(r.month), value: Number(r.total_sale_value_inr ?? 0) })) },
    { name: "Expenses (INR)", color: "#dc2626", points: monthlyChronological.map((r) => ({ x: monthShortLabel(r.month), value: monthCostsInr(r, usdToInr) })) },
    {
      name: "Net Profit (INR)",
      color: "#059669",
      points: monthlyChronological.map((r) => ({ x: monthShortLabel(r.month), value: Number(r.total_sale_value_inr ?? 0) - monthCostsInr(r, usdToInr) })),
    },
  ];

  // 2026-09-18 (round 8) — Purchase and Washing are their own slices now
  // (were folded into an unexplained "Other" before the owner's
  // correction), sourced from the RPC's order-linked figures. "Office
  // Overhead" is what's left — genuinely not order-linkable (see file
  // header). Palette checked via the dataviz skill's validate_palette.js:
  // 6 real hues pass every check; the 7th (Office Overhead, a genuine
  // catch-all) is a deliberately low-chroma neutral, legal per the skill's
  // own rule only when always paired with a visible label+value — this
  // donut's legend always shows both.
  const expenseBreakdown = [
    { label: "Shipping (Courier)", value: totals.courier, color: "#0284c7" },
    { label: "Duty", value: totals.duty, color: "#ea580c" },
    { label: "Marketplace/Portal Fee", value: totals.portalFee, color: "#7c3aed" },
    { label: "Purchase (order-linked)", value: totals.purchase, color: "#0d9488" },
    { label: "Washing (order-linked)", value: totals.washing, color: "#4f46e5" },
    { label: "Advertising", value: adSpendInr, color: "#db2777" },
    { label: "Returns", value: totals.returns, color: "#dc2626" },
    { label: "Office Overhead", value: officeOverheadInr, color: "#475569" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oms-text)]">💹 Finance Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--oms-text-muted)]">
            Complete P&amp;L — Shipping · Payment · Expense · Advertising · Returns (current company).
          </p>
        </div>
        <Link href="/dashboard/crm?tab=pl-marketplace" className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-3 py-1.5 text-xs font-medium text-[var(--oms-text-muted)] hover:bg-[var(--oms-canvas)]">
          ← CRM P&amp;L tabs
        </Link>
      </div>

      <form method="GET" className="oms-card flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--oms-text-muted)]">Quick Range</label>
          <select name="range" defaultValue={rangeParam} className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-2 py-1.5 text-sm text-[var(--oms-text)] outline-none focus:border-amber-500">
            <option value="">Custom (use dates below)</option>
            <optgroup label="Financial Year">
              {fyQuickOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="Month">
              {monthQuickOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--oms-text-muted)]">From</label>
          <input type="date" name="from" defaultValue={from} className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-2 py-1.5 text-sm text-[var(--oms-text)] outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--oms-text-muted)]">To</label>
          <input type="date" name="to" defaultValue={to} className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-2 py-1.5 text-sm text-[var(--oms-text)] outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--oms-text-muted)]">Marketplace</label>
          <select name="store" defaultValue={storeId ?? "all"} className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-2 py-1.5 text-sm text-[var(--oms-text)] outline-none focus:border-amber-500">
            <option value="all">All Marketplaces</option>
            {(stores ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--oms-text-muted)]">Country</label>
          <select name="country" defaultValue={country ?? "all"} className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-2 py-1.5 text-sm text-[var(--oms-text)] outline-none focus:border-amber-500">
            <option value="all">All Countries</option>
            {countryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">Apply</button>
        {(storeId || country || rangeParam || from !== defaultFrom || to !== today) && (
          <Link href="/dashboard/reports/finance-dashboard" className="text-xs text-[var(--oms-text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--oms-text)]">
            Reset to last 30 days
          </Link>
        )}
      </form>
      {rangeParam && (
        <p className="-mt-3 text-[11px] text-[var(--oms-text-muted)]">
          Showing {rangeParam.startsWith("fy:") ? `FY ${fyLabelOf(Number.parseInt(rangeParam.slice(3), 10))}` : "the selected month"} ({from} to {to}).
          To pick your own dates, set Quick Range back to &quot;Custom&quot; first — otherwise it keeps overriding From/To.
        </p>
      )}

      {!financeAvailable ? (
        <div className="oms-card rounded-xl border p-4 text-xs text-[var(--oms-text-muted)]">
          This dashboard needs db/2026-09-18b-finance-dashboard-rpc.sql AND db/2026-09-18c-pl-purchase-washing-order-linked.sql
          run in Supabase SQL Editor first (in that order) — ask whoever runs your database migrations to apply them, then
          reload this page.
        </div>
      ) : (
        <>
          {(storeId || country) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              {storeId && country
                ? "Marketplace + Country filter applied. Office Overhead and Advertising Spend stay company-wide — they aren't tracked per marketplace/country in this system. Purchase/Washing only count here when linked to an order matching the filter."
                : storeId
                  ? "Marketplace filter applied. Office Overhead stays company-wide. Purchase/Washing only count here when linked to an order at this marketplace (washing via its own store tag, purchase via its order's store)."
                  : "Country filter applied. Office Overhead and Advertising Spend stay company-wide — buyer country isn't tracked against either. Purchase/Washing only count here when linked to an order for this country."}
            </p>
          )}

          {(Number(unlinked?.unlinked_purchase_bill_count ?? 0) > 0 || Number(unlinked?.unlinked_washing_entry_count ?? 0) > 0) && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              Not yet linked to an order in this range (excluded from Marketplace/Country-filtered figures above, but always
              counted when viewing All Marketplaces/All Countries): {Number(unlinked?.unlinked_purchase_bill_count ?? 0)}{" "}
              purchase bill{Number(unlinked?.unlinked_purchase_bill_count ?? 0) === 1 ? "" : "s"} (₹{inr2(unlinked?.unlinked_purchase_inr)}),{" "}
              {Number(unlinked?.unlinked_washing_entry_count ?? 0)} washing entr{Number(unlinked?.unlinked_washing_entry_count ?? 0) === 1 ? "y" : "ies"} (₹
              {inr2(unlinked?.unlinked_washing_inr)}). Linking these to their order going forward makes this dashboard more
              complete automatically — no further setup needed.
            </p>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="oms-card rounded-xl border p-4">
              <p className="text-xs font-medium text-[var(--oms-text-muted)]">Total Sales</p>
              <p className="mt-1 text-xl font-bold pl-in text-sky-700">₹{inr2(totals.saleInr)}</p>
              <p className="text-[11px] text-[var(--oms-text-muted)]">${usd2(totals.saleUsd)}</p>
              <div className="mt-1"><ChangeChip pct={pctChange(totals.saleInr, prevTotals.saleInr)} /></div>
            </div>
            <div className="oms-card rounded-xl border p-4">
              <p className="text-xs font-medium text-[var(--oms-text-muted)]">Total Expenses</p>
              <p className="mt-1 text-xl font-bold pl-out text-rose-600">₹{inr2(totalExpensesInr)}</p>
              <div className="mt-1"><ChangeChip pct={pctChange(totalExpensesInr, prevTotalExpensesInr)} /></div>
            </div>
            <div className="oms-card rounded-xl border p-4">
              <p className="text-xs font-medium text-[var(--oms-text-muted)]">Advertising Spend</p>
              <p className="mt-1 text-xl font-bold text-[var(--oms-text)]">${usd2(totals.adSpendUsd)}</p>
              {usdToInr > 0 && <p className="text-[11px] text-[var(--oms-text-muted)]">≈ ₹{inr2(adSpendInr)} (rate as of {to})</p>}
              <div className="mt-1"><ChangeChip pct={pctChange(totals.adSpendUsd, prevTotals.adSpendUsd)} /></div>
            </div>
            <div className="oms-card rounded-xl border p-4">
              <p className="text-xs font-medium text-[var(--oms-text-muted)]">Returns (Refunds)</p>
              <p className="mt-1 text-xl font-bold text-rose-600">₹{inr2(totals.returns)}</p>
              <div className="mt-1"><ChangeChip pct={pctChange(totals.returns, prevTotals.returns)} /></div>
            </div>
            <div className="oms-card rounded-xl border p-4">
              <p className="text-xs font-medium text-[var(--oms-text-muted)]">Net Profit</p>
              <p className={`mt-1 text-xl font-bold ${netProfitInr >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>₹{inr2(netProfitInr)}</p>
              <div className="mt-1"><ChangeChip pct={pctChange(netProfitInr, prevNetProfitInr)} /></div>
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="oms-card rounded-xl border p-4 lg:col-span-1">
              <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Profit &amp; Loss Overview</h2>
              <GroupedBarChart
                groups={plOverviewGroups}
                series={[
                  { name: "Revenue", color: "#0284c7" },
                  { name: "Expenses", color: "#dc2626" },
                  { name: "Net Profit", color: "#059669" },
                ]}
                valueFormatter={(v) => inr2(v)}
              />
            </div>
            <div className="oms-card rounded-xl border p-4 lg:col-span-1">
              <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Expense Breakdown</h2>
              <DonutChart data={expenseBreakdown} valueFormatter={(v) => `₹${inr2(v)}`} centerLabel={{ title: "Total Expenses", value: `₹${(totalExpensesInr / 1000).toFixed(1)}k` }} />
            </div>
            <div className="oms-card rounded-xl border p-4 lg:col-span-1">
              <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">P&amp;L Trend</h2>
              <LineChart series={plTrendSeries} valueFormatter={(v) => inr2(v)} />
            </div>
          </div>

          {/* Transaction Details */}
          <div>
            <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">Transaction Details (latest, within the selected range)</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="oms-card rounded-xl border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[var(--oms-text)]">🚚 Shipping</h3>
                  <Link href="/dashboard/reports/freight-duty" className="text-[11px] text-sky-600 hover:underline">View All →</Link>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  {(shipments ?? []).length === 0 && <p className="text-[var(--oms-text-muted)]">No shipments yet.</p>}
                  {(shipments ?? []).map((s) => (
                    <div key={s.id} className="border-b border-[var(--oms-surface-border)] pb-1.5 last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[var(--oms-text)]">{orderById.get(s.order_id)?.ref_no ?? "—"}</span>
                        <span className="rounded-full bg-[var(--oms-canvas)] px-1.5 py-0.5 text-[10px] text-[var(--oms-text-muted)]">{s.delivered_status ?? "—"}</span>
                      </div>
                      <div className="flex items-center justify-between text-[var(--oms-text-muted)]">
                        <span>{s.courier_name ?? "—"} · {s.awb_no ?? "—"}</span>
                        <span>{orderById.get(s.order_id)?.order_date ?? "—"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="oms-card rounded-xl border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[var(--oms-text)]">💳 Payment</h3>
                  <Link href="/dashboard/statements" className="text-[11px] text-sky-600 hover:underline">View All →</Link>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  {(payments ?? []).length === 0 && <p className="text-[var(--oms-text-muted)]">No reconciled payments yet.</p>}
                  {(payments ?? []).map((p) => (
                    <div key={p.id} className="border-b border-[var(--oms-surface-border)] pb-1.5 last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[var(--oms-text)]">{p.marketplace_order_id ?? p.invoice_no ?? "—"}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${p.payment_receive_refund_date ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                          {p.payment_receive_refund_date ? "Received" : "Pending"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[var(--oms-text-muted)]">
                        <span>₹{inr2(p.total_inr)} · fee ₹{inr2(p.total_exp_inr)}</span>
                        <span>{p.invoice_date ?? "—"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="oms-card rounded-xl border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[var(--oms-text)]">📣 Advertising</h3>
                  <Link href="/dashboard/admin/companies" className="text-[11px] text-sky-600 hover:underline">Manage →</Link>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  {(adSpendRows ?? []).length === 0 && <p className="text-[var(--oms-text-muted)]">No ad spend entries yet.</p>}
                  {(adSpendRows ?? []).map((a) => (
                    <div key={a.id} className="border-b border-[var(--oms-surface-border)] pb-1.5 last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[var(--oms-text)]">{(stores ?? []).find((s) => s.id === a.store_id)?.name ?? "—"}</span>
                        <span className="text-[var(--oms-text-muted)]">{a.spend_date}</span>
                      </div>
                      <div className="text-[var(--oms-text-muted)]">Spend ${usd2(a.spend_usd)} · Budget ${usd2(a.budget_usd)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="oms-card rounded-xl border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[var(--oms-text)]">↩️ Returns</h3>
                  <Link href="/dashboard/returns" className="text-[11px] text-sky-600 hover:underline">View All →</Link>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  {(refunds ?? []).length === 0 && <p className="text-[var(--oms-text-muted)]">No returns yet.</p>}
                  {(refunds ?? []).map((r) => (
                    <div key={r.id} className="border-b border-[var(--oms-surface-border)] pb-1.5 last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[var(--oms-text)]">{orderById.get(r.order_id)?.ref_no ?? "—"}</span>
                        <span className="font-medium text-rose-600">₹{inr2(r.refund_amount_inr)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[var(--oms-text-muted)]">
                        <span className="line-clamp-1">{r.reason ?? "—"}</span>
                        <span>{r.refund_date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* P&L Summary + Engine Flow */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="oms-card rounded-xl border p-4">
              <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">P&amp;L Summary ({from} to {to})</h2>
              <div className="space-y-1 text-sm">
                {[
                  ["Total Sales (INR)", totals.saleInr, "text-sky-700"],
                  ["Shipping (Courier)", -totals.courier, "text-rose-600"],
                  ["Duty", -totals.duty, "text-rose-600"],
                  ["Marketplace/Portal Fee", -totals.portalFee, "text-rose-600"],
                  ["Purchase (order-linked)", -totals.purchase, "text-rose-600"],
                  ["Washing (order-linked)", -totals.washing, "text-rose-600"],
                  ["Advertising Spend", -adSpendInr, "text-rose-600"],
                  ["Returns (Refunds)", -totals.returns, "text-rose-600"],
                  ["Office Overhead", -officeOverheadInr, "text-rose-600"],
                ].map(([label, val, cls]) => (
                  <div key={label as string} className="flex items-center justify-between border-b border-[var(--oms-surface-border)] py-1">
                    <span className="text-[var(--oms-text-muted)]">{label}</span>
                    <span className={`font-medium ${cls}`}>{Number(val) < 0 ? "− " : ""}₹{inr2(Math.abs(Number(val)))}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2">
                  <span className="font-semibold text-[var(--oms-text)]">Net Profit</span>
                  <span className={`text-base font-bold ${netProfitInr >= 0 ? "pl-profit text-emerald-700" : "pl-loss text-rose-700"}`}>₹{inr2(netProfitInr)}</span>
                </div>
              </div>
            </div>
            <div className="oms-card rounded-xl border p-4">
              <h2 className="mb-3 text-sm font-semibold text-[var(--oms-text)]">P&amp;L Engine Flow</h2>
              <div className="flex flex-col items-center gap-2 text-[11px] text-[var(--oms-text)]">
                <div className="flex flex-wrap justify-center gap-2">
                  {["Order", "Purchase", "Washing", "Shipping", "Payment", "Advertising"].map((s) => (
                    <span key={s} className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-1.5 font-medium">{s}</span>
                  ))}
                </div>
                <span className="text-[var(--oms-text-muted)]">↓</span>
                <span className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-1.5 font-medium">Returns</span>
                <span className="text-[var(--oms-text-muted)]">↓</span>
                <span className="rounded-lg bg-violet-100 px-3 py-1.5 font-semibold text-violet-800">P&amp;L Engine</span>
                <span className="text-[var(--oms-text-muted)]">↓</span>
                <div className="flex flex-wrap justify-center gap-2">
                  <span className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-1.5 font-medium">Gross Profit</span>
                  <span className="text-[var(--oms-text-muted)]">→</span>
                  <span className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-1.5 font-medium">Contribution Profit</span>
                  <span className="text-[var(--oms-text-muted)]">→</span>
                  <span className="rounded-lg bg-emerald-100 px-3 py-1.5 font-semibold text-emerald-800">Net Profit</span>
                </div>
                <span className="text-[var(--oms-text-muted)]">↓</span>
                <span className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-1.5 font-medium">Dashboard / Reports</span>
              </div>
              <p className="mt-3 text-[11px] text-[var(--oms-text-muted)]">
                &quot;Gross Profit&quot; and &quot;Contribution Profit&quot; are shown as steps here for the same reasoning the
                reference layout used; this app currently computes and shows the two numbers either side of them (Total
                Sales and Net Profit) rather than storing those two intermediate figures separately — ask if a line-by-line
                Gross/Contribution split is wanted and it can be added.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
