"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createCompany, createItemCategory, createSize, createStore, renameStore, setCompanyActive, setStoreActive, type SimpleFormState } from "./actions";

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
// 2026-09-13 — Store management (#3): the Stores tab's row shape, fed from
// the page's new stores query. company_name is resolved server-side so the
// table can show "which company a store belongs to" without a client-side
// join.
export type StoreRow = { id: string; company_id: string; company_name: string; name: string; active: boolean; invoice_ref_prefix: string | null };

export function CompanyItemAdmin({
  companies,
  itemCategories,
  sizes,
  stores,
}: {
  companies: CompanyRow[];
  itemCategories: ItemCategoryRow[];
  sizes: SizeRow[];
  stores: StoreRow[];
}) {
  const [tab, setTab] = useState<"companies" | "stores" | "categories" | "sizes">("companies");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {[
          { key: "companies" as const, label: `🏢 Companies (${companies.length})` },
          { key: "stores" as const, label: `🏬 Stores (${stores.length})` },
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
      {tab === "stores" && <StoresPanel companies={companies} stores={stores} />}
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

// ---------------------------------------------------------------------------
// Stores tab (2026-09-13, #3): add a store under a chosen company, rename,
// activate/deactivate. Deactivate is the "delete" — see actions.ts's
// createStore header comment for why a hard DELETE would break order
// history (orders.store_id FK etc.). Company column makes "kis company me
// add ho raha" explicit both on the form and in the table.
// ---------------------------------------------------------------------------
function StoresPanel({ companies, stores }: { companies: CompanyRow[]; stores: StoreRow[] }) {
  const [state, formAction, pending] = useActionState(createStore, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-1">
        <h2 className="text-sm font-semibold text-slate-800">Add Store</h2>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Store added.</p>}
        <div>
          <label className={labelClass} htmlFor="store_name">Store Name *</label>
          <input id="store_name" name="name" required placeholder="e.g. Amazon Nyko Mart" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="store_company">Belongs to Company *</label>
          <select id="store_company" name="company_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">Pick carefully — a store permanently belongs to the company it&apos;s created under (this is what shows in Ad Spend &amp; order entry).</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="store_prefix">Invoice Ref Prefix (optional)</label>
          <input id="store_prefix" name="invoice_ref_prefix" placeholder="e.g. AOJ" className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">Leave blank if this store doesn&apos;t generate CSB-V invoices.</p>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Add Store"}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Store Name</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Company</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Invoice Prefix</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stores.map((s) => (
                <StoreRowView key={s.id} store={s} />
              ))}
              {stores.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-slate-400">No stores yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StoreRowView({ store }: { store: StoreRow }) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(store.name);
  const [active, setActive] = useState(store.active);
  const [error, setError] = useState<string | null>(null);

  function saveRename() {
    setError(null);
    startTransition(async () => {
      const r = await renameStore(store.id, name);
      if (r.error) setError(r.error);
      else setEditing(false);
    });
  }

  function toggle() {
    const next = !active;
    setError(null);
    startTransition(async () => {
      const r = await setStoreActive(store.id, next);
      if (r.error) setError(r.error);
      else setActive(next);
    });
  }

  return (
    <tr className={active ? "" : "opacity-60"}>
      <td className="px-4 py-2 font-medium text-slate-800">
        {editing ? (
          <span className="flex items-center gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-48 rounded-lg border border-amber-400 bg-white px-2 py-1 text-sm outline-none focus:border-amber-500"
              autoFocus
            />
            <button type="button" onClick={saveRename} disabled={isPending} className="rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
              Save
            </button>
            <button type="button" onClick={() => { setEditing(false); setName(store.name); }} className="text-xs text-slate-500 underline">
              Cancel
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            {store.name}
            <button type="button" onClick={() => setEditing(true)} title="Rename store" className="text-xs text-amber-600 hover:underline">
              ✏️
            </button>
          </span>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{store.company_name}</td>
      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{store.invoice_ref_prefix ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-2">
        <button
          type="button"
          disabled={isPending}
          onClick={toggle}
          title={active ? "Deactivate (hides from Ad Spend &amp; order entry; history kept)" : "Re-activate"}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
          }`}
        >
          {active ? "Active" : "Deactivated"}
        </button>
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
