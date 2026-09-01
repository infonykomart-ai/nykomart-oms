// Shared fallback: when a courier's create-shipment response has no
// pricing (confirmed for Delhivery and Aramex this round — see their
// header comments; possible for FedEx/UPS/Shiprocket too if a given
// account has rating disabled), estimate the booking cost from the same
// manually-maintained Courier Rate Card the Freight Cost Estimator already
// uses (src/app/dashboard/freight-estimate/actions.ts's
// calculateFreightEstimate/matchAndCompute).
//
// Deliberately a SEPARATE small implementation, not an import of that
// "use server" actions file's internals — matchAndCompute there isn't
// exported (only the two Server Actions wrapping it are), and duplicating
// this ~15-line slab-matching query here keeps the booking-attempt code
// path independent of documents/freight-estimate's own action surface
// (same reasoning this app already uses elsewhere for a "lightweight own
// lookup" — see lookupOrderForFreightEstimate's own comment on why it
// doesn't reuse documents/actions.ts's lookupOrderForEntry). If the slab-
// matching formula ever changes, both copies need updating — flagged here
// deliberately rather than silently.
import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type RateCardEstimate = { amt: number; currency: string } | null;

export async function estimateBookedAmountFromRateCard(
  supabase: ServiceClient,
  companyId: string,
  courierName: string,
  zoneLabel: string,
  weightKg: number
): Promise<RateCardEstimate> {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

  const { data: slab } = await supabase
    .from("courier_rate_cards")
    .select("base_rate, rate_per_kg, fuel_surcharge_pct, other_charges, currency")
    .eq("company_id", companyId)
    .eq("courier_name", courierName)
    .eq("zone_label", zoneLabel)
    .lte("min_weight_kg", weightKg)
    .gt("max_weight_kg", weightKg)
    .maybeSingle();

  if (!slab) return null;

  const baseRate = Number(slab.base_rate);
  const weightCharge = Number(slab.rate_per_kg) * weightKg;
  const fuelSurchargeAmt = ((baseRate + weightCharge) * Number(slab.fuel_surcharge_pct)) / 100;
  const otherCharges = Number(slab.other_charges);
  const estimatedTotal = baseRate + weightCharge + fuelSurchargeAmt + otherCharges;

  return { amt: Math.round(estimatedTotal * 100) / 100, currency: slab.currency };
}
