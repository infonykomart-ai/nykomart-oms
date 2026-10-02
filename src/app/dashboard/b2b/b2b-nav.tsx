"use client";

// 2026-10-02d — one nav cluster for the whole B2B Export ERP suite, the
// same pattern as the attendance reporting suite's header nav. Rendered at
// the top of every /dashboard/b2b/* page (including the original inquiry
// register, which keeps working exactly as before — this only adds links).
import Link from "next/link";
import { usePathname } from "next/navigation";

const ENTRIES: { href: string; label: string }[] = [
  { href: "/dashboard/b2b/control-center", label: "🎛️ Control Center" },
  { href: "/dashboard/b2b", label: "📋 Register" },
  { href: "/dashboard/b2b/buyers", label: "👥 Buyers" },
  { href: "/dashboard/b2b/products", label: "📦 Products" },
  { href: "/dashboard/b2b/engine", label: "🧮 Quotation Engine" },
  { href: "/dashboard/b2b/orders", label: "🧾 Sales Orders" },
  { href: "/dashboard/b2b/production", label: "🏭 Production & QC" },
  { href: "/dashboard/b2b/shipments", label: "🚢 Shipments" },
  { href: "/dashboard/b2b/reports", label: "📊 Reports" },
];

export function B2BNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-900 p-2 text-sm shadow-sm">
      {ENTRIES.map((e) => {
        // Exact match for the register (bare /dashboard/b2b), prefix match
        // for the rest so /orders/<anything> keeps its tab lit.
        const active = e.href === "/dashboard/b2b" ? pathname === e.href : pathname.startsWith(e.href);
        return (
          <Link
            key={e.href}
            href={e.href}
            className={
              active
                ? "rounded-lg bg-amber-500 px-3 py-2 font-semibold text-white transition hover:bg-amber-400"
                : "rounded-lg border border-white/20 px-3 py-2 font-medium text-slate-100 transition hover:bg-white/10"
            }
          >
            {e.label}
          </Link>
        );
      })}
    </nav>
  );
}
