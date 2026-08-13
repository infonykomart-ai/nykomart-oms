"use server";

// Exchange Rate Master (round 11) — the exchange_rate_admin dashboard tile
// already pointed at /dashboard/exchange-rates and the exchange_rates
// table + get_official_rate_as_of() SQL function already existed (used
// elsewhere for the "official rate as of a date" business rule) — this
// page/action just adds the missing maintenance screen for that table.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
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

export async function deleteExchangeRate(id: string): Promise<{ error: string | null }> {
  await requireCapability("exchange_rate_admin");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("exchange_rates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/exchange-rates");
  return { error: null };
}
