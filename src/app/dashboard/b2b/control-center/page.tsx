import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { BarChart, DonutChart, LineChart, type BarDatum, type DonutDatum, type LineSeriesDef } from "@/components/simple-charts";
import { fmtMoney, round2 } from "@/lib/b2b/erp";
import { B2BNav } from "../b2b-nav";

// 2026-10-02d — B2B EXPORT CONTROL CENTER (spec §1 + §27 + §30): the home
// screen of the export ERP. Everything is DERIVED at request time from the
// b2b tables — no KPI is ever stored, so it can't go stale:
//   • Sales = Σ order sales_value × exchange_rate (snapshot) excluding
//     Cancelled, split month / FY-quarter / FY-to-date.
//   • Receivable / Overdue = the payment schedule's (amount − received),
//     overdue where due_date < today.
//   • Stock Value = finished stock qty × cost price (product master);
//     Raw Material Value = stock_in value released at average cost
//     (Σ in-value − out-qty × avg rate, per party+SKU — stock_out carries
//     no rate, so average-cost is the only honest valuation).
//   • Gross Profit = order sales − the order's cost buckets; Net Profit =
//     gross (FY) − internal_expenses (FY).
//   • The 🔴/🟡/🟢 alert panel is the spec's automatic-alert list, built
//     from live rows (overdue payments, delayed shipments, near deadlines,
//     below-min stock, QC rejections, due follow-ups, ready-to-dispatch).
export default async function B2BControlCenterPage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const companyId = me.currentCompanyId;
  const today = todayIST();

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const quarterStart = `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  const fyStart = month >= 4 ? `${year}-04-01` : `${year - 1}-04-01`;
  const sevenDaysAgo = shiftDays(today, -7);
  const inThreeDays = shiftDays(today, 3);

  const [
    ordersRes,
    paymentsRes,
    itemsRes,
    inquiriesRes,
    quotesRes,
    productionsRes,
    qcRes,
    shipmentsRes,
    productsRes,
    buyersRes,
    followupsRes,
    expensesRes,
    stockInRes,
    stockOutRes,
  ] = await Promise.all([
    supabase
      .from("b2b_sales_orders")
      .select(
        "id, order_no, status, order_date, sales_value, exchange_rate, product_cost, labour_cost, packing_cost, freight_cost, documentation_cost, bank_charges, other_costs, buyer_id, destination_country"
      )
      .eq("company_id", companyId)
      .order("order_date", { ascending: false }),
    supabase.from("b2b_order_payments").select("id, order_id, due_date, amount, received_amount").eq("company_id", companyId),
    supabase.from("b2b_sales_order_items").select("order_id, product_id, description, line_total, line_cost"),
    supabase
      .from("b2b_inquiries")
      .select("id, status, follow_up_date, inquiry_date, buyer_name, buyer_id")
      .eq("company_id", companyId),
    supabase.from("b2b_quotations").select("id, inquiry_id, quote_no, sent_at").eq("company_id", companyId),
    supabase.from("b2b_productions").select("id, status, due_date, planned_qty, produced_qty, description").eq("company_id", companyId),
    supabase.from("b2b_qc_inspections").select("id, qc_no, order_id, rejected_qty, inspection_date").eq("company_id", companyId).order("inspection_date", { ascending: false }).limit(100),
    supabase.from("b2b_shipments").select("id, shipment_no, status, eta, order_id").eq("company_id", companyId),
    supabase.from("b2b_products").select("id, sku, name, product_type, stock_qty, min_stock_qty, cost_price, wholesale_price").eq("company_id", companyId),
    supabase.from("b2b_buyers").select("id, name, country").eq("company_id", companyId),
    supabase.from("b2b_followups").select("id, entity_type, entity_label, due_date, note").eq("company_id", companyId).eq("done", false),
    supabase.from("internal_expenses").select("expense_date, amount_inr").eq("company_id", companyId).gte("expense_date", fyStart),
    supabase.from("stock_in").select("source_party_id, sku_code, quantity_in, total_amt"),
    supabase.from("stock_out").select("source_party_id, sku_code, quantity_out"),
  ]);

  const orders = ordersRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const items = itemsRes.data ?? [];
  const inquiries = inquiriesRes.data ?? [];
  const quotes = quotesRes.data ?? [];
  const productions = productionsRes.data ?? [];
  const qcRows = qcRes.data ?? [];
  const shipments = shipmentsRes.data ?? [];
  const products = productsRes.data ?? [];
  const buyers = buyersRes.data ?? [];
  const followups = followupsRes.data ?? [];
  const expenses = expensesRes.data ?? [];

  const activeOrders = orders.filter((o) => o.status !== "Cancelled");
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const buyerName = new Map(buyers.map((b) => [b.id, b.name]));
  const buyerCountry = new Map(buyers.map((b) => [b.id, b.country ?? ""]));
  const inr = (salesValue: number, rate: number) => salesValue * (Number(rate) || 1);

  const sumSales = (from: string) =>
    round2(activeOrders.filter((o) => o.order_date >= from).reduce((s, o) => s + inr(o.sales_value, o.exchange_rate), 0));

  const salesMonth = sumSales(monthStart);
  const salesQuarter = sumSales(quarterStart);
  const salesYear = sumSales(fyStart);
  const grossProfitYear = round2(
    activeOrders
      .filter((o) => o.order_date >= fyStart)
      .reduce((s, o) => {
        const costs =
          Number(o.product_cost) + Number(o.labour_cost) + Number(o.packing_cost) + Number(o.freight_cost) + Number(o.documentation_cost) + Number(o.bank_charges) + Number(o.other_costs);
        return s + inr(Number(o.sales_value) - costs, o.exchange_rate);
      }, 0)
  );
  const expensesYear = round2(expenses.reduce((s, e) => s + Number(e.amount_inr), 0));
  const netProfitYear = round2(grossProfitYear - expensesYear);

  // ── receivable / overdue (the payment schedule, excluding cancelled orders)
  let receivable = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const p of payments) {
    const order = orderById.get(p.order_id);
    if (!order || order.status === "Cancelled") continue;
    const short = Math.max(0, Number(p.amount) - Number(p.received_amount));
    if (short <= 0) continue;
    receivable += short;
    if (p.due_date < today) {
      overdue += short;
      overdueCount += 1;
    }
  }
  receivable = round2(receivable);
  overdue = round2(overdue);

  // ── stock valuations ─────────────────────────────────────────────────────
  const stockValue = round2(products.reduce((s, p) => s + Number(p.stock_qty) * Number(p.cost_price), 0));
  const rawMaterialValue = round2(valuateRawMaterial(stockInRes.data ?? [], stockOutRes.data ?? []));

  // ── pipeline counts ──────────────────────────────────────────────────────
  const statusCount = (s: string) => activeOrders.filter((o) => o.status === s).length;
  const prodPending = productions.filter((p) => p.status === "Planned").length;
  const prodInProgress = productions.filter((p) => p.status === "In Progress" || p.status === "Delayed").length;

  // ── alerts (the spec's automatic list) ───────────────────────────────────
  type Alert = { sev: "red" | "yellow" | "green"; text: string; href: string };
  const alerts: Alert[] = [];
  if (overdueCount > 0) alerts.push({ sev: "red", text: `${overdueCount} payment${overdueCount > 1 ? "s" : ""} overdue — ${fmtMoney(overdue)}`, href: "/dashboard/b2b/orders" });
  const delayedShipments = shipments.filter((s) => s.eta && s.eta < today && s.status !== "Arrived" && s.status !== "Delivered");
  if (delayedShipments.length > 0) alerts.push({ sev: "red", text: `${delayedShipments.length} shipment${delayedShipments.length > 1 ? "s" : ""} delayed (ETA passed)`, href: "/dashboard/b2b/shipments" });
  const nearDeadline = productions.filter((p) => p.status !== "Completed" && p.due_date && p.due_date <= inThreeDays);
  const lateProduction = nearDeadline.filter((p) => p.due_date && p.due_date < today).length;
  if (lateProduction > 0) alerts.push({ sev: "red", text: `${lateProduction} production${lateProduction > 1 ? "s" : ""} delayed past due date`, href: "/dashboard/b2b/production" });
  const nearCount = nearDeadline.length - lateProduction;
  if (nearCount > 0) alerts.push({ sev: "red", text: `${nearCount} production deadline${nearCount > 1 ? "s" : ""} within 3 days`, href: "/dashboard/b2b/production" });
  const lowStock = products.filter((p) => Number(p.min_stock_qty) > 0 && Number(p.stock_qty) < Number(p.min_stock_qty));
  if (lowStock.length > 0) alerts.push({ sev: "red", text: `${lowStock.length} product${lowStock.length > 1 ? "s" : ""} below minimum stock`, href: "/dashboard/b2b/products" });
  const qcFailed = qcRows.filter((q) => q.inspection_date >= sevenDaysAgo && Number(q.rejected_qty) > 0);
  if (qcFailed.length > 0) alerts.push({ sev: "red", text: `${qcFailed.length} QC inspection${qcFailed.length > 1 ? "s" : ""} with rejections (last 7 days)`, href: "/dashboard/b2b/production" });
  const quoteDue = inquiries.filter(
    (i) => i.follow_up_date && i.follow_up_date <= today && ["Open", "In Discussion", "Quotation Sent"].includes(i.status)
  );
  const openFollowups = followups.filter((f) => f.due_date <= today);
  const followupCount = quoteDue.length + openFollowups.length;
  if (followupCount > 0) alerts.push({ sev: "yellow", text: `${followupCount} follow-up${followupCount > 1 ? "s" : ""} due today`, href: "/dashboard/b2b" });
  const waitingOnBuyer = quotes.filter((q) => {
    if (!q.sent_at) return false;
    const inq = inquiries.find((i) => i.id === q.inquiry_id);
    return inq?.status === "Quotation Sent" && q.sent_at.slice(0, 10) <= sevenDaysAgo;
  });
  if (waitingOnBuyer.length > 0) alerts.push({ sev: "yellow", text: `${waitingOnBuyer.length} buyer${waitingOnBuyer.length > 1 ? "s" : ""} has not responded (7+ days)`, href: "/dashboard/b2b" });
  const readyToDispatch = statusCount("Ready to Dispatch");
  if (readyToDispatch > 0) alerts.push({ sev: "green", text: `${readyToDispatch} order${readyToDispatch > 1 ? "s" : ""} ready to dispatch`, href: "/dashboard/b2b/shipments" });

  // ── charts ───────────────────────────────────────────────────────────────
  const productSales = new Map<string, number>();
  for (const it of items) {
    const order = orderById.get(it.order_id);
    if (!order || order.status === "Cancelled") continue;
    const key = it.product_id ? (products.find((p) => p.id === it.product_id)?.name ?? it.description) : it.description;
    productSales.set(key, (productSales.get(key) ?? 0) + inr(Number(it.line_total), order.exchange_rate));
  }
  const productBars: BarDatum[] = [...productSales.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value: round2(value) }));

  const statusPalette: Record<string, string> = {
    Confirmed: "#f59e0b",
    "In Production": "#f97316",
    QC: "#a855f7",
    Packing: "#14b8a6",
    "Ready to Dispatch": "#0ea5e9",
    Booked: "#6366f1",
    "In Transit": "#3b82f6",
    Delivered: "#22c55e",
    Closed: "#64748b",
  };
  const statusDonut: DonutDatum[] = ["Confirmed", "In Production", "QC", "Packing", "Ready to Dispatch", "Booked", "In Transit", "Delivered", "Closed"]
    .map((s) => ({ label: s, value: statusCount(s), color: statusPalette[s] ?? "#94a3b8" }))
    .filter((d) => d.value > 0);

  const monthlyPoints: { x: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    const ym = d.toISOString().slice(0, 7);
    const total = round2(activeOrders.filter((o) => o.order_date.startsWith(ym)).reduce((s, o) => s + inr(Number(o.sales_value), o.exchange_rate), 0));
    monthlyPoints.push({ x: MONTH_LABEL[Number(ym.slice(5, 7)) - 1], value: total });
  }
  const monthlySeries: LineSeriesDef[] = [{ name: "Sales", color: "#f59e0b", points: monthlyPoints }];

  // ── country-wise + top-5 tables ─────────────────────────────────────────
  const countryAgg = new Map<string, { orders: number; sales: number; outstanding: number; products: Set<string> }>();
  const outstandingByOrder = new Map<string, number>();
  for (const p of payments) {
    const short = Math.max(0, Number(p.amount) - Number(p.received_amount));
    outstandingByOrder.set(p.order_id, (outstandingByOrder.get(p.order_id) ?? 0) + short);
  }
  for (const o of activeOrders) {
    const country = o.destination_country || buyerCountry.get(o.buyer_id ?? "") || "—";
    const agg = countryAgg.get(country) ?? { orders: 0, sales: 0, outstanding: 0, products: new Set<string>() };
    agg.orders += 1;
    agg.sales += inr(Number(o.sales_value), o.exchange_rate);
    agg.outstanding += outstandingByOrder.get(o.id) ?? 0;
    for (const it of items.filter((i) => i.order_id === o.id)) {
      const p = products.find((x) => x.id === it.product_id);
      agg.products.add(p ? p.product_type : it.description);
    }
    countryAgg.set(country, agg);
  }
  const countryRows = [...countryAgg.entries()]
    .map(([country, a]) => ({ country, orders: a.orders, sales: round2(a.sales), outstanding: round2(a.outstanding), products: [...a.products].slice(0, 3).join(", ") }))
    .sort((a, b) => b.sales - a.sales);

  const buyerSales = new Map<string, number>();
  for (const o of activeOrders) {
    const key = o.buyer_id ? (buyerName.get(o.buyer_id) ?? "—") : "Unassigned";
    buyerSales.set(key, (buyerSales.get(key) ?? 0) + inr(Number(o.sales_value), o.exchange_rate));
  }
  const topBuyers = [...buyerSales.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, sales]) => ({ name, sales: round2(sales) }));
  const topProducts = [...productSales.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, sales]) => ({ name, sales: round2(sales) }));

  const enquiryMonth = inquiries.filter((i) => i.inquiry_date >= monthStart).length;
  const pendingQuotations = inquiries.filter((i) => i.status === "Quotation Sent").length;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <B2BNav />
      <header className="mb-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white">
        <h1 className="text-2xl font-bold tracking-tight">B2B EXPORT CONTROL CENTER</h1>
        <p className="mt-1 text-sm text-slate-300">
          Live KPIs, automatic alerts and profitability — every number recomputed from the register on each load.
        </p>
      </header>

      {/* ── top KPI cards (spec §30 home screen) ─────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Sales — this month" value={fmtMoney(salesMonth)} tone="amber" />
        <Kpi label="Sales — this quarter" value={fmtMoney(salesQuarter)} tone="slate" />
        <Kpi label="Sales — FY to date" value={fmtMoney(salesYear)} tone="slate" />
        <Kpi label="Receivable" value={fmtMoney(receivable)} tone={receivable > 0 ? "red" : "green"} />
        <Kpi label="Total Orders" value={String(activeOrders.length)} tone="slate" />
        <Kpi label="New Enquiries (month)" value={String(enquiryMonth)} tone="slate" />
        <Kpi label="Pending Quotations" value={String(pendingQuotations)} tone={pendingQuotations > 0 ? "amber" : "slate"} />
        <Kpi label="Overdue Payment" value={fmtMoney(overdue)} tone={overdue > 0 ? "red" : "green"} />
        <Kpi label="Production Pending" value={String(prodPending)} tone={prodPending > 0 ? "amber" : "green"} />
        <Kpi label="Production in Progress" value={String(prodInProgress)} tone="slate" />
        <Kpi label="QC Pending" value={String(statusCount("QC"))} tone={statusCount("QC") > 0 ? "amber" : "green"} />
        <Kpi label="Ready to Dispatch" value={String(readyToDispatch)} tone={readyToDispatch > 0 ? "amber" : "slate"} />
        <Kpi label="In Transit" value={String(statusCount("In Transit") + statusCount("Booked"))} tone="slate" />
        <Kpi label="Delivered" value={String(statusCount("Delivered") + statusCount("Closed"))} tone="green" />
        <Kpi label="Stock Value" value={fmtMoney(stockValue)} tone="slate" />
        <Kpi label="Raw Material Value" value={fmtMoney(rawMaterialValue)} tone="slate" />
        <Kpi label="Gross Profit (FY)" value={fmtMoney(grossProfitYear)} tone={grossProfitYear >= 0 ? "green" : "red"} />
        <Kpi label="Net Profit (FY)" value={fmtMoney(netProfitYear)} tone={netProfitYear >= 0 ? "green" : "red"} />
      </div>

      {/* ── alerts ───────────────────────────────────────────────────────── */}
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Automatic alerts</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">All clear — nothing needs attention right now. 🟢</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {alerts.map((a, i) => (
              <li key={i}>
                <Link
                  href={a.href}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition hover:brightness-95 ${
                    a.sev === "red"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : a.sev === "yellow"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  <span>{a.sev === "red" ? "🔴" : a.sev === "yellow" ? "🟡" : "🟢"}</span>
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── charts ───────────────────────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Monthly sales (INR)</h2>
          <LineChart series={monthlySeries} height={200} />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Order pipeline</h2>
          <div className="flex justify-center">
            <DonutChart data={statusDonut} size={180} centerLabel={{ title: "ORDERS", value: String(activeOrders.length) }} />
          </div>
        </section>
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Product sales (top 6, INR)</h2>
          <BarChart data={productBars} height={200} valueFormatter={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`} />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Export value by country (INR)</h2>
          <BarChart
            data={countryRows.slice(0, 6).map((c) => ({ label: c.country, value: c.sales }))}
            height={200}
            valueFormatter={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`}
          />
        </section>
      </div>

      {/* ── top 5 buyers / products + country table ─────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Top 5 buyers</h2>
          <ol className="space-y-2">
            {topBuyers.length === 0 && <li className="text-sm text-slate-500">No orders yet.</li>}
            {topBuyers.map((b, i) => (
              <li key={b.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium text-slate-800">
                  {i + 1}. {b.name}
                </span>
                <span className="shrink-0 font-semibold text-slate-900">{fmtMoney(b.sales)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Top 5 products</h2>
          <ol className="space-y-2">
            {topProducts.length === 0 && <li className="text-sm text-slate-500">No orders yet.</li>}
            {topProducts.map((p, i) => (
              <li key={p.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium text-slate-800">
                  {i + 1}. {p.name}
                </span>
                <span className="shrink-0 font-semibold text-slate-900">{fmtMoney(p.sales)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Follow-ups due</h2>
          <ul className="space-y-2 text-sm">
            {openFollowups.length === 0 && quoteDue.length === 0 && <li className="text-slate-500">Nothing due. 🟢</li>}
            {openFollowups.slice(0, 6).map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-2">
                <span className="text-slate-800">
                  <span className="font-semibold">{f.entity_type}</span>
                  {f.entity_label ? ` — ${f.entity_label}` : ""}
                  {f.note ? <span className="block text-xs text-slate-500">{f.note}</span> : null}
                </span>
                <span className="shrink-0 text-xs font-medium text-amber-600">{f.due_date}</span>
              </li>
            ))}
            {quoteDue.slice(0, 4).map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-2">
                <span className="text-slate-800">
                  <span className="font-semibold">Inquiry</span> — {i.buyer_name}
                  <span className="block text-xs text-slate-500">Follow-up {i.status}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-amber-600">{i.follow_up_date}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── country-wise dashboard (spec §23) ───────────────────────────── */}
      <section className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Country-wise dashboard</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-4">Country</th>
              <th className="py-2 pr-4">Orders</th>
              <th className="py-2 pr-4">Sales</th>
              <th className="py-2 pr-4">Outstanding</th>
              <th className="py-2">Products</th>
            </tr>
          </thead>
          <tbody>
            {countryRows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-slate-500">
                  No orders yet — the table fills as sales orders land.
                </td>
              </tr>
            )}
            {countryRows.map((c) => (
              <tr key={c.country} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-medium text-slate-800">{c.country}</td>
                <td className="py-2 pr-4">{c.orders}</td>
                <td className="py-2 pr-4 font-semibold text-slate-900">{fmtMoney(c.sales)}</td>
                <td className={`py-2 pr-4 ${c.outstanding > 0 ? "font-semibold text-red-600" : "text-slate-500"}`}>{fmtMoney(c.outstanding)}</td>
                <td className="py-2 text-slate-600">{c.products || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

// ── small helpers ───────────────────────────────────────────────────────────

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shiftDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Average-cost valuation of raw material still in the godown. */
function valuateRawMaterial(
  stockIn: { source_party_id: string; sku_code: string; quantity_in: number | null; total_amt: number | null }[],
  stockOut: { source_party_id: string; sku_code: string; quantity_out: number | null }[]
): number {
  const agg = new Map<string, { qtyIn: number; valueIn: number; qtyOut: number }>();
  for (const r of stockIn) {
    const key = `${r.source_party_id}::${r.sku_code}`;
    const a = agg.get(key) ?? { qtyIn: 0, valueIn: 0, qtyOut: 0 };
    a.qtyIn += Number(r.quantity_in) || 0;
    a.valueIn += Number(r.total_amt) || 0;
    agg.set(key, a);
  }
  for (const r of stockOut) {
    const key = `${r.source_party_id}::${r.sku_code}`;
    const a = agg.get(key) ?? { qtyIn: 0, valueIn: 0, qtyOut: 0 };
    a.qtyOut += Number(r.quantity_out) || 0;
    agg.set(key, a);
  }
  let total = 0;
  for (const a of agg.values()) {
    const avgRate = a.qtyIn > 0 ? a.valueIn / a.qtyIn : 0;
    total += Math.max(0, a.valueIn - a.qtyOut * avgRate);
  }
  return total;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "slate" | "amber" | "red" | "green" }) {
  const tones: Record<string, string> = {
    slate: "border-slate-200 bg-white text-slate-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone ?? "slate"]}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 truncate text-xl font-bold">{value}</div>
    </div>
  );
}
