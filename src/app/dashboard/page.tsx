import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { CAPABILITY_INFO } from "@/lib/capability-info";
import Link from "next/link";

/**
 * Post-login landing view — a work-summary tile grid of everything the
 * signed-in employee's role can do, one tile per capability. Direct answer
 * to the user's ask: "login karne se pahle work report show honi chahiye
 * sabhi work ki jo uske pass allot hai". Per-module summary counts (e.g.
 * "3 pending approvals") get added module-by-module as each one is built —
 * this shell is the professional landing surface they attach to.
 */
export default async function DashboardHome() {
  const employee = await getAuthedEmployee();
  const tiles = CAPABILITY_INFO.filter((c) => employee.capabilities.includes(c.code));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          Welcome, {employee.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {employee.roleName} — here&apos;s everything on your desk today.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.code}
            href={tile.href}
            // 2026-08-25: same fix as dashboard-sidebar.tsx's tiles, and the
            // one actually missed on the first pass — THIS is the /dashboard
            // route itself, so its own ~20-30 module cards were still
            // auto-prefetching (full layout+page data per card) on every
            // single dashboard load even after the sidebar was fixed. Live
            // Chrome re-test after that first fix showed the identical
            // request storm/503s, unchanged — this grid was the other half
            // of it.
            prefetch={false}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-xl">
              {tile.icon}
            </div>
            <h3 className="font-semibold text-slate-900 group-hover:text-amber-600">
              {tile.label}
            </h3>
            <p className="mt-1 text-sm text-slate-500">{tile.description}</p>
          </Link>
        ))}
      </div>

      {tiles.length === 0 && (
        <p className="text-sm text-slate-500">
          No capabilities have been assigned to your role yet — please contact an Admin.
        </p>
      )}
    </div>
  );
}
