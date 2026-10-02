import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { B2BNav } from "../b2b-nav";
import { ProductionClient, type ProductionListItem, type QcListItem, type ProdOrderOption, type ProdProductOption } from "./production-client";

// 2026-10-02d — Production board + QC desk (spec §8, §17, §19). Completion
// % = produced ÷ planned (recomputed, never stored); QC pass/reject/defect
// % come from the four counters. Both feed the Control Center alerts and
// auto-advance the order pipeline through the ops-actions triggers.
export default async function B2BProductionPage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const companyId = me.currentCompanyId;

  const [prodRes, qcRes, ordersRes, productsRes] = await Promise.all([
    supabase
      .from("b2b_productions")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("b2b_qc_inspections")
      .select("*")
      .eq("company_id", companyId)
      .order("inspection_date", { ascending: false })
      .limit(200),
    supabase
      .from("b2b_sales_orders")
      .select("id, order_no, buyer_id, status, delivery_date, destination_country")
      .eq("company_id", companyId)
      .order("order_date", { ascending: false })
      .limit(200),
    supabase.from("b2b_products").select("id, sku, name, product_type").eq("company_id", companyId).order("name"),
  ]);

  const orders: ProdOrderOption[] = (ordersRes.data ?? []).map((o) => ({
    id: o.id,
    orderNo: o.order_no,
    status: o.status,
    deliveryDate: o.delivery_date,
    destination: o.destination_country ?? "",
  }));
  const orderNo = new Map(orders.map((o) => [o.id, o.orderNo]));

  const products: ProdProductOption[] = (productsRes.data ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    productType: p.product_type,
  }));
  const productLabel = new Map(products.map((p) => [p.id, `${p.sku} ${p.name}`]));

  const productions: ProductionListItem[] = (prodRes.data ?? []).map((p) => ({
    ...p,
    orderNo: p.order_id ? (orderNo.get(p.order_id) ?? null) : null,
    productLabel: p.product_id ? (productLabel.get(p.product_id) ?? null) : null,
    stages: Array.isArray(p.stages) ? (p.stages as string[]) : [],
  }));

  const prodNo = new Map(productions.map((p) => [p.id, p.production_no]));
  const inspections: QcListItem[] = (qcRes.data ?? []).map((q) => ({
    ...q,
    orderNo: q.order_id ? (orderNo.get(q.order_id) ?? null) : null,
    productionNo: q.production_id ? (prodNo.get(q.production_id) ?? null) : null,
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <B2BNav />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">🏭 Production &amp; QC</h1>
        <p className="mt-1 text-sm text-slate-500">
          Planned vs produced with auto completion %, configurable stage routing (customizable per production), due-date
          alerts, and QC inspections with pass/reject/rework + defect %. Completing production moves the order to QC; a
          spotless inspection releases it to Packing.
        </p>
      </header>
      <ProductionClient productions={productions} inspections={inspections} orders={orders} products={products} />
    </main>
  );
}
