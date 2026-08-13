import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { ExchangeRateForm } from "./exchange-rate-form";
import { ExchangeRateList } from "./exchange-rate-list";

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">💱 Exchange Rate Master</h1>
        <p className="mt-1 text-sm text-slate-500">
          Official CBIC/ICEGATE notified rates, one row per currency per Effective From date — the latest row on or
          before an order/invoice date is what the rest of the app uses (get_official_rate_as_of).
        </p>
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
