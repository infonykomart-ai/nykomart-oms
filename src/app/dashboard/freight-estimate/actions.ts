"use server";

// Freight Cost Estimator (Gap 5 part 1 of the 2026-08-20 five-gaps plan —
// see claude/five-gaps-implementation-plan-2026-08-20.md and
// db/2026-08-20-freight-rate-card-and-estimator.sql). Reads the manually-
// maintained courier_rate_cards to estimate a shipping cost by courier +
// zone + weight, BEFORE booking/dispatch — no courier API involved.
//
// Two actions: calculateFreightEstimate() is a pure preview (matches a
// rate slab, computes the breakdown, does NOT write to the DB) so staff
// can freely compare several couriers/zones without cluttering the saved-
// estimates table with throwaway trials. saveFreightEstimate() re-runs the
// same match+compute and THEN persists it — for the one they actually want
// on record (optionally linked to an order).
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export type EstimateBreakdown = {
  rateCardId: string;
  courierName: string;
  zoneLabel: string;
  weightKg: number;
  baseRate: number;
  weightCharge: number;
  fuelSurchargeAmt: number;
  otherCharges: number;
  estimatedTotal: number;
  currency: string;
};

export type CalcResult = { error: string | null; breakdown: EstimateBreakdown | null };

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

async function matchAndCompute(
  supabase: ServiceClient,
  companyIds: string[],
  companyId: string,
  courierName: string,
  zoneLabel: string,
  weightKg: number
): Promise<CalcResult> {
  if (!companyIds.includes(companyId)) return { error: "You do not have access to this company.", breakdown: null };
  if (!courierName || !zoneLabel) return { error: "Select a courier and zone.", breakdown: null };
  if (!Number.isFinite(weightKg) || weightKg <= 0) return { error: "Weight must be greater than 0.", breakdown: null };

  const { data: slab } = await supabase
    .from("courier_rate_cards")
    .select("id, base_rate, rate_per_kg, fuel_surcharge_pct, other_charges, currency")
    .eq("company_id", companyId)
    .eq("courier_name", courierName)
    .eq("zone_label", zoneLabel)
    .lte("min_weight_kg", weightKg)
    .gt("max_weight_kg", weightKg)
    .maybeSingle();

  if (!slab) {
    return {
      error: `No rate slab found for ${courierName} / ${zoneLabel} covering ${weightKg}kg — check the Courier Rate Card, or the weight may fall outside every entered slab.`,
      breakdown: null,
    };
  }

  const baseRate = Number(slab.base_rate);
  const weightCharge = Number(slab.rate_per_kg) * weightKg;
  const fuelSurchargeAmt = ((baseRate + weightCharge) * Number(slab.fuel_surcharge_pct)) / 100;
  const otherCharges = Number(slab.other_charges);
  const estimatedTotal = baseRate + weightCharge + fuelSurchargeAmt + otherCharges;

  return {
    error: null,
    breakdown: {
      rateCardId: slab.id,
      courierName,
      zoneLabel,
      weightKg,
      baseRate,
      weightCharge,
      fuelSurchargeAmt,
      otherCharges,
      estimatedTotal,
      currency: slab.currency,
    },
  };
}

export async function calculateFreightEstimate(formData: FormData): Promise<CalcResult> {
  const employee = await requireCapability("freight_estimate");
  const supabase = createServiceRoleClient();

  return matchAndCompute(
    supabase,
    employee.companyIds,
    str(formData, "company_id"),
    str(formData, "courier_name"),
    str(formData, "zone_label"),
    Number(str(formData, "weight_kg"))
  );
}

export type SaveResult = { error: string | null; breakdown: EstimateBreakdown | null; saved: boolean };

export async function saveFreightEstimate(formData: FormData): Promise<SaveResult> {
  const employee = await requireCapability("freight_estimate");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const orderId = strOrNull(formData, "order_id");

  // Defense-in-depth — the order lookup box already only surfaces orders
  // this employee's companies can see, but re-check server-side (same
  // pattern as every other module's server action here).
  if (orderId) {
    const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
    if (!order || order.company_id !== companyId) {
      return { error: "That order does not belong to the selected company.", breakdown: null, saved: false };
    }
  }

  const result = await matchAndCompute(
    supabase,
    employee.companyIds,
    companyId,
    str(formData, "courier_name"),
    str(formData, "zone_label"),
    Number(str(formData, "weight_kg"))
  );
  if (result.error || !result.breakdown) return { ...result, saved: false };
  const b = result.breakdown;

  const { error } = await supabase.from("freight_cost_estimates").insert({
    company_id: companyId,
    order_id: orderId,
    courier_name: b.courierName,
    zone_label: b.zoneLabel,
    weight_kg: b.weightKg,
    base_rate: b.baseRate,
    weight_charge: b.weightCharge,
    fuel_surcharge_amt: b.fuelSurchargeAmt,
    other_charges: b.otherCharges,
    estimated_total: b.estimatedTotal,
    currency: b.currency,
    rate_card_id: b.rateCardId,
    remark: strOrNull(formData, "remark"),
    created_by_employee_id: employee.id,
  });

  if (error) return { error: `Failed to save: ${error.message}`, breakdown: b, saved: false };

  revalidatePath("/dashboard/freight-estimate");
  return { error: null, breakdown: b, saved: true };
}

export type SimpleResult = { error: string | null };

export async function deleteFreightEstimate(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("freight_estimate");
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase.from("freight_cost_estimates").select("id, company_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Estimate not found." };
  if (!employee.companyIds.includes(row.company_id)) return { error: "You do not have access to this estimate." };

  const { error } = await supabase.from("freight_cost_estimates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/freight-estimate");
  return { error: null };
}

// Lightweight order lookup for this page — deliberately separate from
// documents/actions.ts's lookupOrderForEntry (that one is gated on
// doc_entry, a capability Order Entry/Logistics roles using THIS
// estimator won't necessarily have).
export type FreightOrderLookup = {
  error: string | null;
  order: { id: string; ref_no: string; company_id: string; destination_country: string | null; buyer_name_address: string | null } | null;
};

export async function lookupOrderForFreightEstimate(refNo: string): Promise<FreightOrderLookup> {
  const employee = await requireCapability("freight_estimate");
  const supabase = createServiceRoleClient();

  const trimmed = refNo.trim();
  if (!trimmed) return { error: "Enter a PO/RF/RG number.", order: null };

  const { data: order } = await supabase
    .from("orders")
    .select("id, ref_no, company_id, destination_country, buyer_name_address")
    .ilike("ref_no", trimmed)
    .in("company_id", employee.companyIds)
    .maybeSingle();

  if (!order) return { error: `No order found for "${trimmed}".`, order: null };
  return { error: null, order };
}
