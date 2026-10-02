import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { round2 } from "@/lib/b2b/erp";
import { B2BNav } from "../b2b-nav";
import { BuyersClient, type BuyerView } from "./buyers-client";

// 2026-10-02d — Customer / Buyer CRM (spec §3 + §24 + §30): the profile
// master plus the three formulas the spec insists be AUTO-calculated —
//   Lifetime value = total invoiced (cancelled orders excluded)
//   Outstanding   = Σ invoice − Σ payments received
//   Overdue       = outstanding instalments whose due date < today
// …all derived here at request time, never stored.
export default async function B2BBuyersPage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const companyId = me.currentCompanyId;

  const [buyersRes, ordersRes, paymentsRes, followupsRes] = await Promise.all([
    supabase.from("b2b_buyers").select("*").eq("company_id", companyId).order("name"),
    supabase.from("b2b_sales_orders").select("id, order_no, buyer_id, order_date, status, sales_value, exchange_rate").eq("company_id", companyId),
    supabase.from("b2b_order_payments").select("id, order_id, due_date, amount, received_amount").eq("company_id", companyId),
    supabase.from("b2b_followups").select("id, entity_type, entity_id, due_date, note").eq("company_id", companyId).eq("done", false),
  ]);

  const orders = ordersRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const followups = followupsRes.data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const ordersByBuyer = new Map<string, typeof orders>();
  for (const o of orders) {
    if (!o.buyer_id) continue;
    const list = ordersByBuyer.get(o.buyer_id) ?? [];
    list.push(o);
    ordersByBuyer.set(o.buyer_id, list);
  }
  const buyerFollowup = new Map<string, string>();
  for (const f of followups) {
    if (f.entity_type !== "Buyer") continue;
    const cur = buyerFollowup.get(f.entity_id);
    if (!cur || f.due_date < cur) buyerFollowup.set(f.entity_id, f.due_date);
  }

  const buyers: BuyerView[] = (buyersRes.data ?? []).map((b) => {
    const myOrders = (ordersByBuyer.get(b.id) ?? []).filter((o) => o.status !== "Cancelled");
    const cancelled = (ordersByBuyer.get(b.id) ?? []).filter((o) => o.status === "Cancelled");
    const orderIds = new Set((ordersByBuyer.get(b.id) ?? []).map((o) => o.id));
    const sales = round2(myOrders.reduce((s, o) => s + Number(o.sales_value) * (Number(o.exchange_rate) || 1), 0));
    const cancelledValue = round2(cancelled.reduce((s, o) => s + Number(o.sales_value) * (Number(o.exchange_rate) || 1), 0));
    let paid = 0;
    let overdue = 0;
    for (const p of payments) {
      if (!orderIds.has(p.order_id)) continue;
      paid += Number(p.received_amount);
      const short = Math.max(0, Number(p.amount) - Number(p.received_amount));
      if (short > 0 && p.due_date < today) overdue += short;
    }
    const lastOrder = myOrders.map((o) => o.order_date).sort().at(-1) ?? null;
    return {
      id: b.id,
      name: b.name,
      contactPerson: b.contact_person ?? "",
      email: b.email ?? "",
      phone: b.phone ?? "",
      country: b.country ?? "",
      city: b.city ?? "",
      website: b.website ?? "",
      buyerType: b.buyer_type,
      currency: b.currency,
      paymentTerms: b.payment_terms ?? "",
      shippingTerms: b.shipping_terms ?? "",
      salesperson: b.salesperson ?? "",
      notes: b.notes ?? "",
      active: b.active,
      totalOrders: myOrders.length,
      lifetimeValue: sales,
      cancelledValue,
      paid: round2(paid),
      outstanding: round2(Math.max(0, sales - paid)),
      overdue: round2(overdue),
      lastOrderDate: lastOrder,
      nextFollowUp: buyerFollowup.get(b.id) ?? null,
    };
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <B2BNav />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">👥 Customers / Buyers</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every international buyer&apos;s profile with lifetime value, outstanding and overdue computed live from orders +
          payment schedules. Sales orders created with a buyer link roll up here automatically.
        </p>
      </header>
      <BuyersClient buyers={buyers} />
    </main>
  );
}
