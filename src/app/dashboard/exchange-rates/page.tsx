import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCustomsRates } from "@/lib/fx/customs";
import { ExchangeRateForm } from "./exchange-rate-form";
import { ExchangeRateList } from "./exchange-rate-list";
import { CustomsRateAuto } from "./customs-rate-auto";

// Exchange Rate Master (round 11) — see actions.ts header comment.
export default async function ExchangeRatesPage() {
  await requireCapability("exchange_rate_admin");
  const supabase = await createClient();

  const [{ data: currencies }, { data: ratesRaw }] = await Promise.all([
    supabase.from("currencies").select("code, name").order("code"),
    supabase
      .from("exchange_rates")
      .select("id, currency_code, effective_from, rate_to_inr, notification_no, remark, entered_on")
      .order("effective_from", { ascending: false })
      .order("currency_code"),
  ]);

  const rates = (ratesRaw ?? []).map((r) => ({ ...r, rate_to_inr: Number(r.rate_to_inr) }));

  // 2026-10-17 — automatic DGFT → ICEGATE → eximin.net rates. This call
  // refreshes the snapshot when it is older than 12 hours, so simply opening
  // this page (or any other screen that needs a customs rate) keeps every
  // currency current without a cron job. It never throws: an outage shows
  // the last saved rates with a warning instead of breaking the page.
  const autoRates = await loadCustomsRates(createServiceRoleClient());

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">💱 Exchange Rate Master</h1>
        <p className="mt-1 text-xs text-slate-500">
          Automatic customs/export rates for every currency are fetched from DGFT first, then ICEGATE, then
          eximin.net — and re-checked every 12 hours. The manual form below stays for a specific CBIC notification
          override.
        </p>
      </div>

      <div className="mb-6">
        <CustomsRateAuto snapshot={autoRates} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ExchangeRateForm currencies={currencies ?? []} />
        </div>
        <div className="lg:col-span-2">
          <ExchangeRateList rates={rates} />
        </div>
      </div>
    </div>
  );
}
