"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CAPABILITY_INFO } from "@/lib/capability-info";

/**
 * Professional role-based left sidebar work menu — only shows tiles for
 * capabilities the signed-in employee's role actually has (server-resolved
 * in dashboard/layout.tsx, passed down as plain data).
 *
 * 2026-08-06: redesigned from a flat vertical link list into a 2-column
 * "app launcher" style box/tile grid, per the user's ask: "jo menu ek line
 * me aate hai vo boxes me style me aaye, pura dashboard bhara hua lage aur
 * pyara lage." Each item is a square-ish tile with its icon large and
 * centered, label below — denser and more visual than a row of text links,
 * while keeping the same dark sidebar theme, active-state highlight, and
 * capability-filtered items as before.
 */
export function DashboardSidebar({ capabilities }: { capabilities: string[] }) {
  const pathname = usePathname();
  const items = CAPABILITY_INFO.filter((c) => capabilities.includes(c.code));

  return (
    <aside className="flex w-72 flex-col border-r border-slate-200 bg-slate-900">
      <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-6">
        <span className="text-lg font-bold text-white">Work Menu</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2.5">
          <SidebarTile href="/dashboard" icon="🏠" label="Home" active={pathname === "/dashboard"} />
          {items.map((item) => (
            <SidebarTile
              key={item.code}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={pathname.startsWith(item.href)}
            />
          ))}
        </div>
      </nav>
    </aside>
  );
}

function SidebarTile({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-4 text-center transition ${
        active
          ? "border-amber-400 bg-amber-500 text-white shadow-md shadow-amber-500/20"
          : "border-slate-800 bg-slate-800/60 text-slate-300 hover:-translate-y-0.5 hover:border-amber-500/40 hover:bg-slate-800 hover:text-white hover:shadow-md"
      }`}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </Link>
  );
}
