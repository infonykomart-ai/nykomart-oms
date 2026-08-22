"use server";

// Courier Rate Card (Gap 5 part 1 of the 2026-08-20 five-gaps plan — see
// claude/five-gaps-implementation-plan-2026-08-20.md and
// db/2026-08-20-freight-rate-card-and-estimator.sql). A manually-
// maintained rate sheet, one row per (courier, zone, weight-slab), that
// the Freight Cost Estimator (../freight-estimate) reads. No courier API
// involved — covers any courier equally, including Aramex/On Point
// Express which ShipGlobal doesn't support at all.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type RateCardFormState = { error: string | null; success: boolean };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}
function numOrZero(formData: FormData, key: string): number {
  const v = str(formData, key);
  return v ? Number(v) : 0;
}

export async function saveCourierRate(_prev: RateCardFormState, formData: FormData): Promise<RateCardFormState> {
  const employee = await requireCapability("freight_rate_admin");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const courierName = str(formData, "courier_name");
  const zoneLabel = str(formData, "zone_label");
  const minWeightKg = numOrZero(formData, "min_weight_kg");
  const maxWeightKg = numOrZero(formData, "max_weight_kg");
  const baseRate = numOrZero(formData, "base_rate");
  const ratePerKg = numOrZero(formData, "rate_per_kg");
  const fuelSurchargePct = numOrZero(formData, "fuel_surcharge_pct");
  const otherCharges = numOrZero(formData, "other_charges");
  const currency = str(formData, "currency") || "INR";

  if (!companyId) return { error: "Select a company.", success: false };
  if (!employee.companyIds.includes(companyId)) return { error: "You do not have access to this company.", success: false };
  if (!courierName) return { error: "Courier name is required.", success: false };
  if (!zoneLabel) return { error: "Zone is required.", success: false };
  if (maxWeightKg <= minWeightKg) return { error: "Max Weight must be greater than Min Weight.", success: false };
  if (minWeightKg < 0) return { error: "Min Weight cannot be negative.", success: false };

  const { error } = await supabase.from("courier_rate_cards").insert({
    company_id: companyId,
    courier_name: courierName,
    zone_label: zoneLabel,
    min_weight_kg: minWeightKg,
    max_weight_kg: maxWeightKg,
    base_rate: baseRate,
    rate_per_kg: ratePerKg,
    fuel_surcharge_pct: fuelSurchargePct,
    other_charges: otherCharges,
    currency,
    remark: strOrNull(formData, "remark"),
    entered_by_employee_id: employee.id,
  });

  if (error) return { error: `Failed to save: ${error.message}`, success: false };
  revalidatePath("/dashboard/courier-rates");
  revalidatePath("/dashboard/freight-estimate");
  return { error: null, success: true };
}

export type SimpleResult = { error: string | null };

export async function deleteCourierRate(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("freight_rate_admin");
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase.from("courier_rate_cards").select("id, company_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Rate row not found." };
  if (!employee.companyIds.includes(row.company_id)) return { error: "You do not have access to this row." };

  const { error } = await supabase.from("courier_rate_cards").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/courier-rates");
  revalidatePath("/dashboard/freight-estimate");
  return { error: null };
}
