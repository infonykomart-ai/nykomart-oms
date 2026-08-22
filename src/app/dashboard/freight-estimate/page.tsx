import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { EstimateForm } from "./estimate-form";
import { EstimateList } from "./estimate-list";

// Freight Cost Estimator (Gap 5 part 1, 2026-08-20) — see actions.ts
// header comment for full reasoning.
export default async function FreightEstimatePage() {
  const employee = await requireCapability("freight_estimate");
  const supabase = createServiceRoleClient();

  const [{ data: companies }, { data: rateRows }, { data: estimateRows }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase
      .from("courier_rate_cards")
      .select("company_id, courier_name, zone_label")
      .in("company_id", employee.companyIds),
    supabase
      .from("freight_cost_estimates")
      .select("id, company_id, order_id, courier_name, zone_label, weight_kg, estimated_total, currency, remark, created_at")
      .in("company_id", employee.companyIds)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));

  // Dedup (company, courier, zone) combos client-side rather than a
  // separate DISTINCT query — this table is small (a manual rate sheet,
  // not a transaction log), so pulling every row and deduping in JS is
  // simpler than a second round-trip.
  const seen = new Set<string>();
  const rateOptions = (rateRows ?? [])
    .filter((r) => {
      const key = `${r.company_id}|${r.courier_name}|${r.zone_label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({ companyId: r.company_id, courierName: r.courier_name, zoneLabel: r.zone_label }));

  const orderIds = Array.from(new Set((estimateRows ?? []).map((e) => e.order_id).filter((x): x is string => !!x)));
  const { data: orders } = orderIds.length
    ? await supabase.from("orders").select("id, ref_no").in("id", orderIds)
    : { data: [] };
  const orderRefNo = new Map((orders ?? []).map((o) => [o.id, o.ref_no]));

  const estimates = (estimateRows ?? []).map((e) => ({
    id: e.id,
    companyName: companyName.get(e.company_id) ?? "—",
    orderRefNo: e.order_id ? orderRefNo.get(e.order_id) ?? null : null,
    courier_name: e.courier_name,
    zone_label: e.zone_label,
    weight_kg: Number(e.weight_kg),
    estimated_total: Number(e.estimated_total),
    currency: e.currency,
    remark: e.remark,
    created_at: e.created_at,
  }));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧮 Freight Cost Estimator</h1>
          <p className="mt-1 text-sm text-slate-500">
            Estimate/compare shipping cost by courier, zone and weight — from the manually-maintained Courier Rate
            Card, before booking or dispatch.
          </p>
        </div>
        <Link
          href="/dashboard/courier-rates"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          📊 Manage Rate Card
        </Link>
      </div>

      <div className="space-y-6">
        <EstimateForm companies={companies ?? []} rateOptions={rateOptions} />
        <EstimateList rows={estimates} />
      </div>
    </div>
  );
}
