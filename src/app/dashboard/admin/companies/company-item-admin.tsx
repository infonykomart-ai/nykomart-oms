"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createCompany, createItemCategory, createSize, setCompanyActive, type SimpleFormState } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const initialState: SimpleFormState = { error: null, success: false };

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export type CompanyRow = {
  id: string;
  name: string;
  short_code: string;
  ref_prefix: string;
  master_invoice_prefix: string | null;
  active: boolean;
  weekly_off_days: number[];
};
export type ItemCategoryRow = { id: string; name: string; hsn_code: string | null; harmonized_tariff_number: string | null };
export type SizeRow = { id: string; label: string };

export function CompanyItemAdmin({
  companies,
  itemCategories,
  sizes,
}: {
  companies: CompanyRow[];
  itemCategories: ItemCategoryRow[];
  sizes: SizeRow[];
}) {
  const [tab, setTab] = useState<"companies" | "categories" | "sizes">("companies");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {[
          { key: "companies" as const, label: `🏢 Companies (${companies.length})` },
          { key: "categories" as const, label: `🗂️ Item Categories (${itemCategories.length})` },
          { key: "sizes" as const, label: `📏 Sizes (${sizes.length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === t.key ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "companies" && <CompaniesPanel companies={companies} />}
      {tab === "categories" && <ItemCategoriesPanel itemCategories={itemCategories} />}
      {tab === "sizes" && <SizesPanel sizes={sizes} />}
    </div>
  );
}

function CompaniesPanel({ companies }: { companies: CompanyRow[] }) {
  const [state, formAction, pending] = useActionState(createCompany, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-1">
        <h2 className="text-sm font-semibold text-slate-800">Add Company</h2>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Company added.</p>}
        <div>
          <label className={labelClass} htmlFor="name">Name *</label>
          <input id="name" name="name" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="short_code">Short Code *</label>
          <input id="short_code" name="short_code" placeholder="e.g. NM" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ref_prefix">Order Ref Prefix *</label>
          <input id="ref_prefix" name="ref_prefix" placeholder="e.g. PO" required className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">Used in order numbers like PO-0001 — cannot be changed later without affecting existing orders.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="master_invoice_prefix">Master Invoice Prefix</label>
          <input id="master_invoice_prefix" name="master_invoice_prefix" placeholder="e.g. NYM" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="logo_url">Logo URL</label>
          <input id="logo_url" name="logo_url" placeholder="https://..." className={inputClass} />
        </div>
        <div>
          <span className={labelClass}>Weekly Off Day(s)</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" name="weekly_off_days" value={d.value} defaultChecked={d.value === 0} />
                {d.label}
              </label>
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Add Company"}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Name</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Short Code</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Ref Prefix</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Weekly Off</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((c) => (
                <CompanyRowView key={c.id} company={c} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CompanyRowView({ company }: { company: CompanyRow }) {
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState(company.active);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !active;
    setError(null);
    startTransition(async () => {
      const r = await setCompanyActive(company.id, next);
      if (r.error) setError(r.error);
      else setActive(next);
    });
  }

  const offDays = (company.weekly_off_days ?? []).map((d) => WEEKDAYS.find((w) => w.value === d)?.label ?? d).join(", ");

  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-800">{company.name}</td>
      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{company.short_code}</td>
      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{company.ref_prefix}</td>
      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{offDays || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2">
        <button
          type="button"
          disabled={isPending}
          onClick={toggle}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
          }`}
        >
          {active ? "Active" : "Inactive"}
        </button>
        {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
      </td>
    </tr>
  );
}

function ItemCategoriesPanel({ itemCategories }: { itemCategories: ItemCategoryRow[] }) {
  const [state, formAction, pending] = useActionState(createItemCategory, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-1">
        <h2 className="text-sm font-semibold text-slate-800">Add Item Category</h2>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Item Category added.</p>}
        <div>
          <label className={labelClass} htmlFor="ic_name">Name *</label>
          <input id="ic_name" name="name" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="hsn_code">HSN Code</label>
          <input id="hsn_code" name="hsn_code" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="harmonized_tariff_number">Harmonized Tariff No.</label>
          <input id="harmonized_tariff_number" name="harmonized_tariff_number" className={inputClass} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Add Item Category"}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Name</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">HSN Code</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Harmonized Tariff No.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {itemCategories.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-800">{c.name}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{c.hsn_code ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{c.harmonized_tariff_number ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SizesPanel({ sizes }: { sizes: SizeRow[] }) {
  const [state, formAction, pending] = useActionState(createSize, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-1">
        <h2 className="text-sm font-semibold text-slate-800">Add Size</h2>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Size added.</p>}
        <div>
          <label className={labelClass} htmlFor="label">Size Label *</label>
          <input id="label" name="label" placeholder="e.g. 5X5 FT" required className={inputClass} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Add Size"}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
        <div className="flex flex-wrap gap-2">
          {sizes.length === 0 && <p className="text-sm text-slate-400">No sizes yet.</p>}
          {sizes.map((s) => (
            <span key={s.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
