"use client";

import { useActionState } from "react";
import { compareCourierRates, type CompareRatesState } from "./rate-compare-actions";

const initial: CompareRatesState = { error: null, rows: null, originSummary: null };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

function formatMoney(v: { amt: number; currency: string } | { amount: number; currency: string }): string {
  const amt = "amt" in v ? v.amt : v.amount;
  return `${v.currency} ${amt.toFixed(2)}`;
}

// "Compare all couriers' rates before booking" (2026-09-03) — user's own
// ask: "jab booking karenge to kya sabhi courier company ke rate dikhenge
// campair ke liye". Deliberately its own small form + table, NOT wired
// into CreateShipmentForm's per-courier state — the employee reads this,
// picks a courier, then fills that courier's own booking form below as
// before. Two columns per courier: a Rate Card estimate (instant, needs a
// Zone) and a Live API quote (real-time call, only attempted for couriers
// with credentials configured in Account Setup — see rate-compare-
// actions.ts's header comment on why some couriers' live quotes are
// UNVERIFIED against a real account).
export function RateComparison() {
  const [state, formAction, pending] = useActionState(compareCourierRates, initial);

  const sortedRows = state.rows
    ? [...state.rows].sort((a, b) => {
        const priceOf = (r: (typeof state.rows)[number]) =>
          r.liveQuote.attempted && r.liveQuote.ok ? r.liveQuote.amount : (r.rateCardEstimate?.amt ?? Infinity);
        return priceOf(a) - priceOf(b);
      })
    : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">⚖️ Compare Courier Rates</h2>
      <p className="mb-3 text-xs text-slate-500">
        Enter the destination and weight to see an estimate/quote from all 6 couriers side by side before picking one to book below. Zone
        is optional — fill it in to also include your Courier Rate Card estimate for each courier.
      </p>

      <form action={formAction} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5 md:items-end">
        <div>
          <label className={labelClass}>Destination Postcode *</label>
          <input name="dest_postcode" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Destination Country Code * (2-letter)</label>
          <input name="dest_country_code" required maxLength={2} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Weight (kg) *</label>
          <input name="weight_kg" type="number" step="0.001" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Zone (Courier Rate Card, optional)</label>
          <input name="zone_label" placeholder="e.g. Zone A" className={inputClass} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="h-[34px] rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Comparing…" : "Compare Rates"}
        </button>
      </form>

      {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      {sortedRows && (
        <div className="overflow-x-auto">
          {state.originSummary && <p className="mb-2 text-xs text-slate-400">Ship-from: {state.originSummary}</p>}
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Courier</th>
                <th className="py-1.5 pr-3 font-medium">Rate Card Estimate</th>
                <th className="py-1.5 pr-3 font-medium">Live Quote</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr key={row.courier} className={`border-b border-slate-100 ${i === 0 ? "bg-emerald-50/60" : ""}`}>
                  <td className="py-1.5 pr-3 font-medium text-slate-800">
                    {row.label}
                    {i === 0 && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Cheapest available</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-700">
                    {row.rateCardEstimate ? formatMoney(row.rateCardEstimate) : <span className="text-slate-400">{state.originSummary ? "No slab / enter Zone" : "—"}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-700">
                    {!row.liveQuote.attempted && <span className="text-slate-400">Not configured (Account Setup)</span>}
                    {row.liveQuote.attempted && row.liveQuote.ok && <span className="font-medium text-slate-900">{formatMoney(row.liveQuote)}</span>}
                    {row.liveQuote.attempted && !row.liveQuote.ok && <span className="text-amber-600" title={row.liveQuote.error}>Unavailable — {row.liveQuote.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-400">
            Live quotes call each courier&apos;s own rate/quote API in real time and can fail or be unavailable for reasons outside this
            app&apos;s control (account not enabled for rating, temporary API error, etc) — a missing live quote does not mean that
            courier can&apos;t be booked, only that no live price could be fetched right now. These new rate-quote integrations have not
            yet been exercised against a real courier account.
          </p>
        </div>
      )}
    </div>
  );
}
