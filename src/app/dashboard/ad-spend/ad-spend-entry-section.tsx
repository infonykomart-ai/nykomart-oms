"use client";

import { useActionState, useState, useTransition } from "react";
import { saveAdSpendAction, deleteAdSpendAction, type AdSpendFormState } from "./actions";
import { AMAZON_COUNTRIES, amazonCountryLabel, isAmazonStore } from "./amazon-countries";
import { formatIST } from "@/lib/format-ist";

const initialState: AdSpendFormState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type Company = { id: string; name: string };
type Store = { id: string; name: string; company_id: string };
type RecentEntry = {
  id: string;
  storeId: string;
  storeName: string;
  companyName: string;
  date: string;
  countryCode: string;
  budget: number;
  spend: number;
  /** When these numbers were last saved (store_ad_spend.updated_at). */
  enteredAt: string;
};

// Daily entry — just Budget (USD) + Spend (USD) per store per day.
// Re-submitting the same store+date overwrites that day's numbers (see
// saveAdSpendAction's upsert), so this doubles as the "edit" screen: pick
// the same store/date again, type the corrected numbers, save. The list on
// the right (last 30 entries across all stores) is there so a mistake is
// visible without having to remember which store/date it was on, and can
// be cleared outright via Delete.
//
// 2026-10-15 — "AMAZON ME ALAG ALAG COUNTRY KE HISAB SE BUDGT & SPEND HOTA
// HAI": picking an Amazon store reveals a required Country field (the 12
// marketplace countries from amazon-countries.ts), and the same day can
// then hold one row per country. Non-Amazon stores (Etsy / eBay / Website)
// never see the field — their single row per day is unchanged.
export function AdSpendEntrySection({
  companies,
  stores,
  recentEntries,
}: {
  companies: Company[];
  stores: Store[];
  recentEntries: RecentEntry[];
}) {
  const [state, formAction, pending] = useActionState(saveAdSpendAction, initialState);
  // 2026-08-08: default to a company that actually has a store this
  // employee can enter for (relevant once ad-spend is scoped to a store-
  // restricted login — see page.tsx's canSeeAllStores) rather than always
  // picking companies[0], which could have zero stores in `stores` for a
  // scoped user and leave the Store dropdown looking empty on first load.
  const [companyId, setCompanyId] = useState(stores[0]?.company_id ?? companies[0]?.id ?? "");
  const [formKey, setFormKey] = useState(0); // bump to reset the form after a successful save
  // The Store select stays uncontrolled (it resets with the form), but the
  // chosen id is mirrored here purely so the Amazon-only Country field can
  // appear/disappear as the store changes.
  const [storeId, setStoreId] = useState("");
  const [countryCode, setCountryCode] = useState("");

  const companyStores = stores.filter((s) => s.company_id === companyId);
  const selectedStore = stores.find((s) => s.id === storeId);
  const isAmazon = isAmazonStore(selectedStore?.name);
  // Recent entries remember the store they were entered for, so a day with
  // several Amazon country rows shows which is which.
  const storeIsAmazon = new Map(stores.map((s) => [s.id, isAmazonStore(s.name)]));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Enter Budget / Spend</h2>
        {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">Saved.</p>}
        <form
          key={formKey}
          action={(fd) => {
            formAction(fd);
            setFormKey((k) => k + 1);
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="as_company">Company *</label>
              <select
                id="as_company"
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setStoreId("");
                }}
                className={inputClass}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="as_store">Store *</label>
              {/* Controlled (value={storeId}) on purpose: the form itself
                  is re-mounted after each save so Budget/Spend/Date reset,
                  but the chosen Store/Country stay put — otherwise an
                  Amazon day would mean re-picking the store 12 times, once
                  per country. */}
              <select
                id="as_store"
                name="store_id"
                required
                value={storeId}
                onChange={(e) => {
                  setStoreId(e.target.value);
                  setCountryCode("");
                }}
                className={inputClass}
              >
                <option value="" disabled>Select store</option>
                {companyStores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="as_date">Date *</label>
              <input
                id="as_date"
                name="spend_date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
            </div>
            {/* 2026-10-15 — Amazon-only Country. Rendered (and required)
                only when the selected store is an Amazon store; the action
                enforces the same rule server-side. */}
            {isAmazon ? (
              <div>
                <label className={labelClass} htmlFor="as_country">Country * (Amazon)</label>
                <select
                  id="as_country"
                  name="country_code"
                  required
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className={inputClass}
                >
                  <option value="" disabled>Select country</option>
                  {AMAZON_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label} · {c.currency}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div />
            )}
            <div>
              <label className={labelClass} htmlFor="as_budget">Budget (USD)</label>
              <input id="as_budget" name="budget_usd" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="as_spend">Spend (USD)</label>
              <input id="as_spend" name="spend_usd" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
            </div>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        </form>
        <p className="mt-3 text-xs text-slate-400">
          {isAmazon
            ? "Amazon store — enter one row per marketplace country (US, UK, Germany …). The store and country stay selected after Save so you can go country by country; re-saving the same store + date + country overwrites that day's numbers."
            : "Pick an Amazon store to get a Country field — Amazon is budgeted per marketplace country, other stores are one row per day."}
          {" "}QTY ORD / USD are not entered here — see the <strong>Report</strong> tab for the combined view against live
          Order Entry data.
        </p>
      </div>

      <RecentEntries entries={recentEntries} storeIsAmazon={storeIsAmazon} />
    </div>
  );
}

function RecentEntries({
  entries,
  storeIsAmazon,
}: {
  entries: RecentEntry[];
  storeIsAmazon: Map<string, boolean>;
}) {
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete the entry for ${label}?`)) return;
    setDeleteError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const result = await deleteAdSpendAction(id);
      if (result.error) setDeleteError((prev) => ({ ...prev, [id]: result.error! }));
      else setDeletedIds((prev) => new Set(prev).add(id));
    });
  }

  const visible = entries.filter((e) => !deletedIds.has(e.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Entries</h2>
      <div className="max-h-[28rem] space-y-1.5 overflow-y-auto">
        {visible.map((e) => {
          // Older rows (and every non-Amazon store) carry no country.
          const country = e.countryCode ? (amazonCountryLabel(e.countryCode) || e.countryCode) : "";
          const isAmazon = storeIsAmazon.get(e.storeId) ?? /amazon/i.test(e.storeName);
          return (
            <div key={e.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-900">{e.storeName}</div>
                  <div className="text-slate-400">
                    {e.companyName} · {e.date}
                    {country && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">{country}</span>}
                    {isAmazon && !country && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">no country</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-slate-700">Budget ${e.budget.toFixed(2)}</div>
                  <div className="text-slate-700">Spend ${e.spend.toFixed(2)}</div>
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                {/* 2026-10-19 — when the entry was made (IST), not just the
                    spend date: re-saving the same store+date+country
                    overwrites the row, so this is the last entry time. */}
                <p className="text-[10px] text-slate-400">Entered {formatIST(e.enteredAt)}</p>
                <p className="ml-auto text-red-600">{deleteError[e.id]}</p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(e.id, `${e.storeName}${country ? ` · ${country}` : ""} · ${e.date}`)}
                  className="shrink-0 rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <p className="text-xs text-slate-400">No entries yet.</p>}
      </div>
    </div>
  );
}
