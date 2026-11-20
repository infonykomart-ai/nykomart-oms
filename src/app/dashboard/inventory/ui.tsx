import Link from "next/link";

// Small shared presentational pieces for the Inventory module. Plain server
// components — no client JS is needed anywhere in this module: every action is
// a server action that redirects with ?ok= / ?error=.
export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500";
export const labelClass = "mb-1 block text-xs font-medium text-slate-500";
export const cardClass = "rounded-xl border border-slate-200 bg-white";

const TABS = [
  { href: "/dashboard/inventory", label: "Dashboard" },
  { href: "/dashboard/inventory/stock", label: "Current Stock" },
  { href: "/dashboard/inventory/reservations", label: "Reservations" },
  { href: "/dashboard/inventory/processing", label: "Printing & Washing" },
  { href: "/dashboard/inventory/challans", label: "Challan & Dispatch" },
  { href: "/dashboard/inventory/ledger", label: "Stock Ledger" },
  { href: "/dashboard/inventory/reports", label: "Reports" },
  // 2026-11-20 — central Master SKU layer, added above the untouched engine.
  { href: "/dashboard/inventory/masters", label: "Master SKUs" },
  { href: "/dashboard/inventory/mappings", label: "Store SKU Map" },
  { href: "/dashboard/inventory/settings", label: "Settings" },
];

export function InventoryTabs({ active }: { active: string }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
      {TABS.map((tab) => {
        const selected = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              selected ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

export function MessageBanner({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div
      className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
        error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
    >
      {error ?? ok}
    </div>
  );
}

export function Stat({ label, value, unit, tone = "slate" }: { label: string; value: number | string; unit?: string; tone?: string }) {
  const tones: Record<string, string> = {
    slate: "text-slate-900",
    teal: "text-teal-700",
    amber: "text-amber-600",
    rose: "text-rose-600",
    indigo: "text-indigo-700",
  };
  return (
    <div className={`${cardClass} p-3`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tones[tone] ?? tones.slate}`}>
        {typeof value === "number" ? value.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : value}
        {unit ? <span className="ml-1 text-xs font-normal text-slate-400">{unit}</span> : null}
      </div>
    </div>
  );
}

export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-slate-400">
        {message}
      </td>
    </tr>
  );
}

export function th(extra = "") {
  return `whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${extra}`;
}
export function td(extra = "") {
  return `whitespace-nowrap px-3 py-2 text-sm text-slate-700 ${extra}`;
}

export function PageHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
