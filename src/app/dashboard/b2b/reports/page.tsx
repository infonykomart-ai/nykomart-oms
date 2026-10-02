import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { BarChart, type BarDatum } from "@/components/simple-charts";
import { fmtMoney, round2 } from "@/lib/b2b/erp";
import { B2BNav } from "../b2b-nav";

// 2026-10-02d — Analytics / Reports (spec §22 + §23 + §29): month-wise
// sales, product / buyer / salesperson profitability, production summary,
// country-wise export and the finance strip (revenue → cost → gross →
// net, receivable). Every table derives from the same order lines +
// cost buckets the P&L pages edit, so the three views can never disagree.
export default async function B2BReportsPage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const companyId = me.currentCompanyId;
  const today = todayIST();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const fyStart = month >= 4 ? `${year}-04-01` : `${year - 1}-04-01`;

  const [ordersRes, itemsRes, paymentsRes, buyersRes, prodRes, expensesRes] = await Promise.all([
    supabase
      .from("b2b_sales_orders")
      .select(
        "id, order_no, status, order_date, sales_value, exchange_rate, buyer_id, destination_country, product_cost, labour_cost, packing_cost, freight_cost, documentation_cost, bank_charges, other_costs"
      )
      .eq("company_id", companyId),
    supabase.from("b2b_sales_order_items").select("order_id, product_id, description, qty, line_total, line_cost"),
    supabase.from("b2b_order_payments").select("order_id, amount, received_amount, due_date").eq("company_id", companyId),
    supabase.from("b2b_buyers").select("id, name, country, salesperson").eq("company_id", companyId),
    supabase.from("b2b_productions").select("status, planned_qty, produced_qty").eq("company_id", companyId),
    supabase.from("internal_expenses").select("expense_date, amount_inr").eq("company_id", companyId).gte("expense_date", fyStart),
  ]);

  const orders = (ordersRes.data ?? []).filter((o) => o.status !== "Cancelled");
  const items = itemsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const buyers = buyersRes.data ?? [];
  const productions = prodRes.data ?? [];
  const expenses = expensesRes.data ?? [];

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const buyerById = new Map(buyers.map((b) => [b.id, b]));
  const inr = (v: number, rate: number) => v * (Number(rate) || 1);
  const orderCost = (o: (typeof orders)[number]) =>
    Number(o.product_cost) + Number(o.labour_cost) + Number(o.packing_cost) + Number(o.freight_cost) + Number(o.documentation_cost) + Number(o.bank_charges) + Number(o.other_costs);

  // ── month-wise sales (last 12 months, FY buckets for the table) ─────────
  const monthRows: { ym: string; label: string; orders: number; sales: number; cost: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    const ym = d.toISOString().slice(0, 7);
    const inMonth = orders.filter((o) => o.order_date.startsWith(ym));
    monthRows.push({
      ym,
      label: MONTHS[Number(ym.slice(5, 7)) - 1],
      orders: inMonth.length,
      sales: round2(inMonth.reduce((s, o) => s + inr(Number(o.sales_value), o.exchange_rate), 0)),
      cost: round2(inMonth.reduce((s, o) => s + inr(orderCost(o), o.exchange_rate), 0)),
    });
  }

  // ── product profitability ───────────────────────────────────────────────
  const productAgg = new Map<string, { name: string; qty: number; sales: number; cost: number }>();
  for (const it of items) {
    const o = orderById.get(it.order_id);
    if (!o) continue;
    const key = it.product_id ?? `desc:${it.description}`;
    const a = productAgg.get(key) ?? { name: it.description, qty: 0, sales: 0, cost: 0 };
    a.qty += Number(it.qty) || 0;
    a.sales += inr(Number(it.line_total) || 0, o.exchange_rate);
    a.cost += inr(Number(it.line_cost) || 0, o.exchange_rate);
    productAgg.set(key, a);
  }
  const productRows = [...productAgg.values()]
    .map((a) => ({ ...a, sales: round2(a.sales), cost: round2(a.cost), profit: round2(a.sales - a.cost) }))
    .sort((a, b) => b.sales - a.sales);

  // ── buyer + salesperson profitability ───────────────────────────────────
  const buyerAgg = new Map<string, { name: string; salesperson: string; country: string; orders: number; sales: number; cost: number; outstanding: number }>();
  const outstandingByOrder = new Map<string, number>();
  for (const p of payments) {
    outstandingByOrder.set(p.order_id, (outstandingByOrder.get(p.order_id) ?? 0) + Math.max(0, Number(p.amount) - Number(p.received_amount)));
  }
  for (const o of orders) {
    const b = o.buyer_id ? buyerById.get(o.buyer_id) : undefined;
    const key = o.buyer_id ?? "unassigned";
    const a = buyerAgg.get(key) ?? { name: b?.name ?? "Unassigned", salesperson: b?.salesperson ?? "—", country: b?.country ?? o.destination_country ?? "—", orders: 0, sales: 0, cost: 0, outstanding: 0 };
    a.orders += 1;
    a.sales += inr(Number(o.sales_value), o.exchange_rate);
    a.cost += inr(orderCost(o), o.exchange_rate);
    a.outstanding += outstandingByOrder.get(o.id) ?? 0;
    buyerAgg.set(key, a);
  }
  const buyerRows = [...buyerAgg.values()]
    .map((a) => ({ ...a, sales: round2(a.sales), cost: round2(a.cost), profit: round2(a.sales - a.cost), outstanding: round2(a.outstanding) }))
    .sort((a, b) => b.sales - a.sales);

  const repAgg = new Map<string, { orders: number; sales: number }>();
  for (const a of buyerAgg.values()) {
    const rep = a.salesperson || "Unassigned";
    const r = repAgg.get(rep) ?? { orders: 0, sales: 0 };
    r.orders += a.orders;
    r.sales += a.sales;
    repAgg.set(rep, r);
  }
  const repRows = [...repAgg.entries()].map(([name, r]) => ({ name, orders: r.orders, sales: round2(r.sales) })).sort((a, b) => b.sales - a.sales);

  // ── country-wise export with shipment counts ───────────────────────────
  const [shipsRes] = await Promise.all([
    supabase.from("b2b_shipments").select("id, destination_country, status").eq("company_id", companyId),
  ]);
  const shipByCountry = new Map<string, number>();
  for (const s of shipsRes.data ?? []) {
    const c = s.destination_country || "—";
    shipByCountry.set(c, (shipByCountry.get(c) ?? 0) + 1);
  }
  const countryAgg = new Map<string, { orders: number; sales: number; outstanding: number }>();
  for (const o of orders) {
    const b = o.buyer_id ? buyerById.get(o.buyer_id) : undefined;
    const c = o.destination_country || b?.country || "—";
    const a = countryAgg.get(c) ?? { orders: 0, sales: 0, outstanding: 0 };
    a.orders += 1;
    a.sales += inr(Number(o.sales_value), o.exchange_rate);
    a.outstanding += outstandingByOrder.get(o.id) ?? 0;
    countryAgg.set(c, a);
  }
  const countryRows = [...countryAgg.entries()]
    .map(([country, a]) => ({ country, ...a, sales: round2(a.sales), outstanding: round2(a.outstanding), shipments: shipByCountry.get(country) ?? 0 }))
    .sort((a, b) => b.sales - a.sales);

  // ── finance strip (FY) ──────────────────────────────────────────────────
  const fyOrders = orders.filter((o) => o.order_date >= fyStart);
  const revenue = round2(fyOrders.reduce((s, o) => s + inr(Number(o.sales_value), o.exchange_rate), 0));
  const cost = round2(fyOrders.reduce((s, o) => s + inr(orderCost(o), o.exchange_rate), 0));
  const grossProfit = round2(revenue - cost);
  const expenseTotal = round2(expenses.reduce((s, e) => s + Number(e.amount_inr), 0));
  const receivable = round2(
    payments.reduce((s, p) => {
      const o = orderById.get(p.order_id);
      if (!o) return s;
      return s + Math.max(0, Number(p.amount) - Number(p.received_amount));
    }, 0)
  );

  const prodSummary = {
    planned: round2(productions.reduce((s, p) => s + Number(p.planned_qty), 0)),
    produced: round2(productions.reduce((s, p) => s + Number(p.produced_qty), 0)),
    pending: productions.filter((p) => p.status === "Planned").length,
    inProgress: productions.filter((p) => p.status === "In Progress").length,
    completed: productions.filter((p) => p.status === "Completed").length,
    delayed: productions.filter((p) => p.status === "Delayed").length,
  };

  const productBars: BarDatum[] = productRows.slice(0, 8).map((p) => ({ label: p.name, value: p.sales }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <B2BNav />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">📊 B2B Reports</h1>
        <p className="mt-1 text-sm text-slate-500">Sales · production · finance · export — all derived from order lines and cost buckets.</p>
      </header>

      {/* finance strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Fin label="Revenue (FY)" value={fmtMoney(revenue)} />
        <Fin label="Cost (FY)" value={fmtMoney(cost)} />
        <Fin label="Gross profit" value={fmtMoney(grossProfit)} tone={grossProfit >= 0 ? "green" : "red"} />
        <Fin label="Expenses (FY)" value={fmtMoney(expenseTotal)} />
        <Fin label="Net profit" value={fmtMoney(round2(grossProfit - expenseTotal))} tone={grossProfit - expenseTotal >= 0 ? "green" : "red"} />
        <Fin label="Receivable" value={fmtMoney(receivable)} tone={receivable > 0 ? "amber" : "green"} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Product sales (top 8, INR)</h2>
          <BarChart data={productBars} height={210} valueFormatter={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`} />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Production summary</h2>
          <div className="grid grid-cols-2 gap-3">
            <Fin label="Planned qty" value={String(prodSummary.planned)} />
            <Fin label="Produced qty" value={String(prodSummary.produced)} />
            <Fin label="Pending plans" value={String(prodSummary.pending)} tone="amber" />
            <Fin label="In progress" value={String(prodSummary.inProgress)} />
            <Fin label="Completed" value={String(prodSummary.completed)} tone="green" />
            <Fin label="Delayed" value={String(prodSummary.delayed)} tone={prodSummary.delayed > 0 ? "red" : "green"} />
          </div>
        </section>
      </div>

      <Table
        title="Month-wise sales (last 12 months)"
        columns={["Month", "Orders", "Sales (INR)", "Cost (INR)", "Profit", "Margin %"]}
        rows={monthRows.map((m) => [
          m.label,
          String(m.orders),
          fmtMoney(m.sales),
          fmtMoney(m.cost),
          fmtMoney(round2(m.sales - m.cost)),
          m.sales > 0 ? `${(((m.sales - m.cost) / m.sales) * 100).toFixed(1)}%` : "—",
        ])}
      />

      <Table
        title="Product profitability"
        columns={["Product", "Qty sold", "Sales", "Cost", "Profit", "Margin %"]}
        rows={productRows.map((p) => [
          p.name,
          String(Math.round(p.qty)),
          fmtMoney(p.sales),
          fmtMoney(p.cost),
          fmtMoney(p.profit),
          p.sales > 0 ? `${((p.profit / p.sales) * 100).toFixed(1)}%` : "—",
        ])}
        empty="No order lines yet."
      />

      <Table
        title="Customer profitability"
        columns={["Buyer", "Country", "Salesperson", "Orders", "Sales", "Profit", "Outstanding"]}
        rows={buyerRows.map((b) => [b.name, b.country, b.salesperson, String(b.orders), fmtMoney(b.sales), fmtMoney(b.profit), fmtMoney(b.outstanding)])}
        empty="No orders yet."
      />

      <Table
        title="Salesperson-wise"
        columns={["Salesperson", "Orders", "Sales"]}
        rows={repRows.map((r) => [r.name, String(r.orders), fmtMoney(r.sales)])}
        empty="Assign salespeople on the Buyers page."
      />

      <Table
        title="Export value by country"
        columns={["Country", "Orders", "Shipments", "Sales", "Outstanding"]}
        rows={countryRows.map((c) => [c.country, String(c.orders), String(c.shipments), fmtMoney(c.sales), fmtMoney(c.outstanding)])}
        empty="No exports yet."
      />
    </main>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Fin({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" | "amber" }) {
  const tones: Record<string, string> = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone ?? ""] ?? "border-slate-200 bg-white"}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 truncate text-lg font-bold">{value}</div>
    </div>
  );
}

function Table({ title, columns, rows, empty }: { title: string; columns: string[]; rows: string[][]; empty?: string }) {
  return (
    <section className="mb-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">{title}</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c, i) => (
              <th key={c} className={`py-2 pr-3 ${i > 0 ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-5 text-center text-slate-500">
                {empty ?? "No data yet."}
              </td>
            </tr>
          )}
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-0">
              {r.map((cell, ci) => (
                <td key={ci} className={`py-2 pr-3 ${ci > 0 ? "text-right" : "font-medium text-slate-800"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
