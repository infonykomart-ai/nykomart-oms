import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { B2BNav } from "../b2b-nav";
import { ShipmentsClient, type ShipmentView } from "./shipments-client";

// 2026-10-02d — Export shipment dashboard (spec §16): Booking → Delivered
// status ladder with the ports/containers/BL-AWB/ETD-ETA fields, and the
// 🔴 delayed derivation (ETA passed, not yet Arrived/Delivered) computed
// at read time — no stored "Delayed" state to go stale.
export default async function B2BShipmentsPage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const companyId = me.currentCompanyId;

  const [shipsRes, ordersRes, buyersRes] = await Promise.all([
    supabase.from("b2b_shipments").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(200),
    supabase
      .from("b2b_sales_orders")
      .select("id, order_no, buyer_id, status, destination_country")
      .eq("company_id", companyId)
      .order("order_date", { ascending: false })
      .limit(300),
    supabase.from("b2b_buyers").select("id, name").eq("company_id", companyId),
  ]);

  const buyerName = new Map((buyersRes.data ?? []).map((b) => [b.id, b.name]));
  const orderById = new Map((ordersRes.data ?? []).map((o) => [o.id, o]));

  const shipments: ShipmentView[] = (shipsRes.data ?? []).map((s) => {
    const order = s.order_id ? orderById.get(s.order_id) : undefined;
    return {
      ...s,
      orderNo: order?.order_no ?? null,
      buyerName: order?.buyer_id ? (buyerName.get(order.buyer_id) ?? null) : null,
      orderStatus: order?.status ?? null,
      destination: s.destination_country ?? order?.destination_country ?? "",
    };
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <B2BNav />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">🚢 Export Shipments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Booking → Ready → Stuffed → Departed → In Transit → Arrived → Delivered. Moving a shipment advances the linked
          order (Booked → In Transit → Delivered); an ETA in the past flags the row 🔴 delayed.
        </p>
      </header>
      <ShipmentsClient shipments={shipments} orders={(ordersRes.data ?? []).map((o) => ({ id: o.id, orderNo: o.order_no }))} />
    </main>
  );
}
