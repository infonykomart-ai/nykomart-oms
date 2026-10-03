"use client";

// 2026-10-03 — the attendance reporting suite's nav cluster used to exist
// ONLY inside /dashboard/attendance/admin/page.tsx's dark header, so every
// sub-report (Daily/Monthly/Periodic/Yearly/Import/Month Summary/Location/
// GPS/Leave/COFF/Salary/Salary Details/Other/GPS Approvals) was a dead end
// — no way to jump to a sibling report except browser-back or the sidebar.
// One shared component now renders that same cluster in both places:
//   • variant="inline"  → the bare nav row inside the root page's header
//     (exactly where it always lived), with the active link now derived
//     from the URL instead of hard-coded;
//   • variant="strip"   → a dark card above every SUB-report page's own
//     content, via attendance/admin/layout.tsx — hidden on the suite root
//     so the page's own header nav isn't doubled up.
// Same look as before: amber active pill, ghost inactive pills, GPS
// Approvals keeps its emerald emphasis (it's an action queue, not a
// report).
import Link from "next/link";
import { usePathname } from "next/navigation";

type Entry = { href: string; label: string; accent?: boolean };

const ENTRIES: Entry[] = [
  { href: "/dashboard/attendance/admin", label: "🏠 Home" },
  { href: "/dashboard/attendance/admin/overview", label: "📊 Dashboard" },
  { href: "/dashboard/attendance/admin/daily-report", label: "📅 Daily" },
  { href: "/dashboard/attendance/admin/monthly-report", label: "📆 Monthly" },
  { href: "/dashboard/attendance/admin/periodic-report", label: "🗓️ Periodic" },
  { href: "/dashboard/attendance/admin/yearly-report", label: "📈 Yearly" },
  { href: "/dashboard/attendance/admin/import", label: "⬆️ Import" },
  { href: "/dashboard/attendance/admin/month-summary", label: "📒 Month Summary" },
  { href: "/dashboard/attendance/admin/location-report", label: "📍 Location" },
  { href: "/dashboard/attendance/admin/gps-report", label: "📡 GPS" },
  { href: "/dashboard/attendance/admin/leave-report", label: "🌴 Leave" },
  { href: "/dashboard/attendance/admin/coff-report", label: "🏖️ COFF" },
  { href: "/dashboard/attendance/admin/salary-report", label: "💰 Salary" },
  { href: "/dashboard/attendance/admin/salary-details", label: "🧾 Salary Details" },
  { href: "/dashboard/attendance/admin/other-report", label: "🧩 Other" },
  { href: "/dashboard/attendance/admin/gps-approvals", label: "🛰️ GPS Approvals", accent: true },
];

export function AttendanceAdminNav({ variant = "inline" }: { variant?: "inline" | "strip" }) {
  const pathname = usePathname();

  // Layout variant: the root page renders the same cluster itself (inside
  // its header), so the strip must stay out of the way there.
  if (variant === "strip" && (pathname === "/dashboard/attendance/admin" || pathname === "")) return null;

  const nav = (
    <nav aria-label="Attendance admin reports" className="flex flex-wrap items-center gap-2 text-sm">
      {ENTRIES.map((e) => {
        const active = pathname === e.href;
        const base = "rounded-lg px-3 py-2 transition";
        const classes = e.accent
          ? `${base} font-semibold text-white ${active ? "bg-emerald-600 hover:bg-emerald-500" : "bg-emerald-600/90 hover:bg-emerald-500"}`
          : active
            ? `${base} bg-amber-500 font-semibold text-white hover:bg-amber-400`
            : `${base} border border-white/20 font-medium text-slate-100 hover:bg-white/10`;
        return (
          <Link key={e.href} href={e.href} prefetch={false} className={classes}>
            {e.label}
          </Link>
        );
      })}
    </nav>
  );

  if (variant === "inline") return nav;
  return (
    <div className="mb-4 rounded-xl bg-slate-900 px-4 py-2 shadow-sm">
      {nav}
    </div>
  );
}
