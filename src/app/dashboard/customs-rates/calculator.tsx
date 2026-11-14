"use client";

// Customs conversion calculator (client side, since the amount is typed here).
// The RATE always comes from the verified register via a Server Action — the
// arithmetic below only multiplies by the rate the register returned.
import { useState, useTransition } from "react";
import { convertToInr, ratePerUnit } from "@/lib/customs/calculator";
import type { RateInForce } from "@/lib/customs/lookup";
import { lookupRateForCalculator } from "./actions";

type Currency = { code: string; name: string; unit: number };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

function money(value: number): string {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CustomsCalculator({
  currencies,
  today,
}: {
  currencies: Currency[];
  today: string;
}) {
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("1000");
  const [kind, setKind] = useState<"import" | "export">("import");
  const [date, setDate] = useState(today);
  const [rate, setRate] = useState<RateInForce | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  const amountNumber = Number(amount);
  const appliedRate = rate ? (kind === "import" ? rate.importRate : rate.exportRate) : null;

  let converted: { inr: number; raw: number } | null = null;
  let conversionError: string | null = null;
  if (appliedRate != null) {
    try {
      const result = convertToInr({ amount: amountNumber, rate: appliedRate, unit: rate!.currencyUnit });
      converted = { inr: result.inr, raw: result.raw };
    } catch (e) {
      conversionError = e instanceof Error ? e.message : "Invalid input.";
    }
  }

  function handleCalculate() {
    setError(null);
    setSearched(false);
    startTransition(async () => {
      const result = await lookupRateForCalculator(currency, date);
      if (result.error) {
        setError(result.error);
        setRate(null);
        return;
      }
      setRate(result.rate);
      setSearched(true);
      if (!result.rate) {
        setError(`No verified customs rate is on record for ${currency} on ${date}.`);
      }
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-800">🧮 Customs Conversion Calculator</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Applies the official Customs rate only. This is not a bank settlement rate, an RBI reference rate, or
          the rate your bank/payment provider used.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className={labelClass} htmlFor="calc-currency">Currency</label>
          <select
            id="calc-currency"
            value={currency}
            onChange={(e) => { setCurrency(e.target.value); setRate(null); }}
            className={inputClass}
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="calc-amount">Foreign currency amount</label>
          <input
            id="calc-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="calc-kind">Import or Export</label>
          <select
            id="calc-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value === "export" ? "export" : "import")}
            className={inputClass}
          >
            <option value="import">Import</option>
            <option value="export">Export</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="calc-date">Customs date</label>
          <input
            id="calc-date"
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); setRate(null); }}
            className={inputClass}
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={handleCalculate}
            disabled={isPending}
            className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isPending ? "Looking up…" : "Calculate INR value"}
          </button>
        </div>
      </div>

      <div className="border-t border-slate-100 px-5 py-4">
        {error && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>
        )}
        {conversionError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{conversionError}</p>
        )}

        {!error && !conversionError && converted && rate && appliedRate != null && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Customs value in INR</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-900">₹{money(converted.inr)}</p>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-700 sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Foreign currency amount</dt><dd className="font-medium">{amountNumber.toLocaleString("en-IN")} {rate.currencyCode}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Rate applied ({kind})</dt><dd className="font-medium">₹{appliedRate} per {rate.currencyUnit} {rate.currencyCode}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Rate per 1 unit</dt><dd className="font-medium">₹{ratePerUnit(appliedRate, rate.currencyUnit).toFixed(6)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Effective from</dt><dd className="font-medium">{rate.effectiveStartDate}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Effective to</dt><dd className="font-medium">{rate.effectiveEndDate ?? "until next notification"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Notification</dt><dd className="font-medium">{rate.notificationNo ?? "—"}</dd></div>
              <div className="flex justify-between gap-3 sm:col-span-2"><dt className="text-slate-500">Official source</dt><dd className="font-medium">ICEGATE / CBIC{rate.sourceDocumentRef ? ` · ${rate.sourceDocumentRef}` : ""} · verified</dd></div>
            </dl>
          </div>
        )}

        {!conversionError && searched && rate && appliedRate == null && !error && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This notification does not publish an {kind} rate for {rate.currencyCode}. Nothing has been
            substituted — use the other rate, or check the notification.
          </p>
        )}

        {!searched && !error && !conversionError && (
          <p className="text-xs text-slate-400">
            Pick a currency, amount and date, then calculate. Only verified official rates are used.
          </p>
        )}
      </div>
    </div>
  );
}
