import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { RateCardForm } from "./rate-card-form";
import { RateCardList } from "./rate-card-list";

// Courier Rate Card (Gap 5 part 1, 2026-08-20) — see actions.ts header.
export default async function CourierRatesPage() {
  const employee = await requireCapability("freight_rate_admin");
  const supabase = createServiceRoleClient();

  const [{ data: companies }, { data: ratesRaw }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase
      .from("courier_rate_cards")
      .select(
        "id, company_id, courier_name, zone_label, min_weight_kg, max_weight_kg, base_rate, rate_per_kg, fuel_surcharge_pct, other_charges, currency, remark"
      )
      .in("company_id", employee.companyIds)
      .order("courier_name")
      .order("zone_label")
      .order("min_weight_kg"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const rows = (ratesRaw ?? []).map((r) => ({
    ...r,
    companyName: companyName.get(r.company_id) ?? "—",
    min_weight_kg: Number(r.min_weight_kg),
    max_weight_kg: Number(r.max_weight_kg),
    base_rate: Number(r.base_rate),
    rate_per_kg: Number(r.rate_per_kg),
    fuel_surcharge_pct: Number(r.fuel_surcharge_pct),
    other_charges: Number(r.other_charges),
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">📊 Courier Rate Card</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manually-maintained rate sheet by courier, zone and weight slab — feeds the Freight Cost Estimator. No
          courier API involved, so any courier (Aramex, On Point Express, or anything else) can be entered here.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <RateCardForm companies={companies ?? []} />
        </div>
        <div className="lg:col-span-2">
          <RateCardList rows={rows} />
        </div>
      </div>
    </div>
  );
}
