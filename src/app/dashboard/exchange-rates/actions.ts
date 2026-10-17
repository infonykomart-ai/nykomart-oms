"use server";

// Exchange Rate Master (round 11) — the exchange_rate_admin dashboard tile
// already pointed at /dashboard/exchange-rates and the exchange_rates
// table + get_official_rate_as_of() SQL function already existed (used
// elsewhere for the "official rate as of a date" business rule) — this
// page/action just adds the missing maintenance screen for that table.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadCustomsRates } from "@/lib/fx/customs";
import { revalidatePath } from "next/cache";

export type ExchangeRateFormState = { error: string | null; success: boolean };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export async function saveExchangeRate(_prev: ExchangeRateFormState, formData: FormData): Promise<ExchangeRateFormState> {
  const employee = await requireCapability("exchange_rate_admin");
  const supabase = createServiceRoleClient();

  const currencyCode = str(formData, "currency_code").toUpperCase();
  const effectiveFrom = str(formData, "effective_from");
  const rateStr = str(formData, "rate_to_inr");
  const rate = Number(rateStr);

  if (!currencyCode || !effectiveFrom) {
    return { error: "Currency and Effective From date are required.", success: false };
  }
  if (!rateStr || !Number.isFinite(rate) || rate <= 0) {
    return { error: "Rate to INR must be a positive number.", success: false };
  }

  const { error } = await supabase.from("exchange_rates").insert({
    currency_code: currencyCode,
    effective_from: effectiveFrom,
    rate_to_inr: rate,
    notification_no: strOrNull(formData, "notification_no"),
    remark: strOrNull(formData, "remark"),
    entered_by: employee.id,
  });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate key")) {
      return { error: "A rate for this currency on this Effective From date already exists.", success: false };
    }
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/exchange-rates");
  return { error: null, success: true };
}

/**
 * 2026-10-17 — "auto update rahe jisko chedna nahi pade". Forces an
 * immediate re-fetch from the DGFT → ICEGATE → eximin.net chain for every
 * currency, instead of waiting for the 12-hour automatic refresh.
 */
export async function refreshCustomsRates(): Promise<{ error: string | null; message?: string }> {
  await requireCapability("exchange_rate_admin");
  const supabase = createServiceRoleClient();
  const snapshot = await loadCustomsRates(supabase, { force: true });
  revalidatePath("/dashboard/exchange-rates");
  if (snapshot.rows.length === 0) {
    return { error: snapshot.warning ?? "No rates could be fetched from DGFT, ICEGATE or eximin.net." };
  }
  return {
    error: null,
    message: `${snapshot.rows.length} currencies refreshed from ${snapshot.provider}${
      snapshot.effectiveDate ? ` (notification effective ${snapshot.effectiveDate})` : ""
    }.`,
  };
}

export async function deleteExchangeRate(id: string): Promise<{ error: string | null }> {
  await requireCapability("exchange_rate_admin");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("exchange_rates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/exchange-rates");
  return { error: null };
}
