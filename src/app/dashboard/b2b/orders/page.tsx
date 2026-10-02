import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { B2BNav } from "../b2b-nav";
import { OrdersClient, type OrderListItem, type OrderPaymentView } from "./orders-client";

// 2026-10-02d — Sales Orders (spec §7 + §19 + §20): the pipeline register.
// Per order we hand the client the header (status, FX snapshot, cost
// buckets), its lines (price + cost per line → product profitability), and
// its payment schedule (advance/balance rows the terms engine generated).
// The order P&L / "why is profit low?" drill-down and the packing
// calculator both compute client-side from these same numbers via
// @/lib/b2b/erp, so what's shown always matches what's stored.
export default async function B2BOrdersPage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const companyId = me.currentCompanyId;

  const [ordersRes, itemsRes, paymentsRes, buyersRes] = await Promise.all([
    supabase
      .from("b2b_sales_orders")
      .select("*")
      .eq("company_id", companyId)
      .order("order_date", { ascending: false })
      .order("order_no", { ascending: false }),
    supabase.from("b2b_sales_order_items").select("*").order("display_order"),
    supabase.from("b2b_order_payments").select("*").order("due_date"),
    supabase.from("b2b_buyers").select("id, name, country, currency, payment_terms").eq("company_id", companyId),
  ]);

  const buyers = buyersRes.data ?? [];
  const buyerName = new Map(buyers.map((b) => [b.id, b.name]));

  const itemsByOrder = new Map<string, OrderListItem["order_items"]>();
  for (const it of itemsRes.data ?? []) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    // GENERATED columns come back nullable from the introspected types —
    // coalesce at the load boundary so the client keeps its number contract.
    list.push({ ...it, line_total: it.line_total ?? 0, line_cost: it.line_cost ?? 0 });
    itemsByOrder.set(it.order_id, list);
  }
  const paymentsByOrder = new Map<string, OrderPaymentView[]>();
  for (const p of paymentsRes.data ?? []) {
    const list = paymentsByOrder.get(p.order_id) ?? [];
    list.push(p);
    paymentsByOrder.set(p.order_id, list);
  }

  const orders: OrderListItem[] = (ordersRes.data ?? []).map((o) => ({
    ...o,
    buyerName: o.buyer_id ? (buyerName.get(o.buyer_id) ?? null) : null,
    order_items: (itemsByOrder.get(o.id) ?? []).map((it) => ({
      ...it,
      line_total: it.line_total ?? 0,
      line_cost: it.line_cost ?? 0,
    })),
    payments: paymentsByOrder.get(o.id) ?? [],
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <B2BNav />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">🧾 Sales Orders</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pipeline (Confirmed → Production → QC → Packing → Ready → Booked → In Transit → Delivered), per-order P&amp;L with
          the &quot;why is profit low?&quot; drill-down, packing calculator and the automatic payment schedule.
        </p>
      </header>
      <OrdersClient orders={orders} />
    </main>
  );
}
