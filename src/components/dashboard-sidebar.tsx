"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CAPABILITY_INFO } from "@/lib/capability-info";

/**
 * Professional role-based left sidebar work menu — only shows tiles for
 * capabilities the signed-in employee's role actually has (server-resolved
 * in dashboard/layout.tsx, passed down as plain data). Direct answer to the
 * user's ask for a "professional style... attractive... badi company ke
 * employe ka desboard" sidebar, replacing the old flat capability-tile grid.
 */
export function DashboardSidebar({ capabilities }: { capabilities: string[] }) {
  const pathname = usePathname();
  const items = CAPABILITY_INFO.filter((c) => capabilities.includes(c.code));

  return (
    <aside className="flex w-64 flex-col border-r border-slate-200 bg-slate-900">
      <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-6">
        <span className="text-lg font-bold text-white">Work Menu</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        <Link
          href="/dashboard"
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
            pathname === "/dashboard"
              ? "bg-amber-500 text-white"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          <span>🏠</span>
          Home
        </Link>
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.code}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-amber-500 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
