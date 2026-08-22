"use client";

import { useEffect, useState } from "react";
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
 *
 * 2026-08-17 — "MENU SECTION HIDE HO JAYE JAB KUCH DHUNDHNA HO TO SIDE ME
 * DIKH JAYE, HIDE AUTO HIDE KA OPTION HO JIS SE WINDOW BADI HO JAYE" — both
 * requested behaviors: a pin button (click to permanently hide/show, no
 * layout width reserved while hidden — <main> gets the space back) AND,
 * while unpinned, a thin hover strip on the left edge that slides the full
 * menu in as an overlay on hover and back out on mouse-leave, so it's still
 * one hover away without taking up permanent width. Preference persists via
 * localStorage so it survives reloads. Defaults to pinned (today's
 * behavior) so nothing changes for anyone who doesn't touch the new button.
 */
const PIN_STORAGE_KEY = "oms_sidebar_pinned";

export function DashboardSidebar({ capabilities }: { capabilities: string[] }) {
  const pathname = usePathname();
  const items = CAPABILITY_INFO.filter((c) => capabilities.includes(c.code));

  const [pinned, setPinned] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Reading localStorage (an external system) on mount, not deriving from
    // props/state React already knows about — the "mounted" gate above (and
    // the pinned-layout fallback while !mounted) exists specifically so this
    // one-time sync can't cause a hydration mismatch.
    const saved = window.localStorage.getItem(PIN_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved !== null) setPinned(saved === "1");
    setMounted(true);
  }, []);

  function togglePinned() {
    setPinned((prev) => {
      const next = !prev;
      window.localStorage.setItem(PIN_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const menu = (
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
  );

  // Render the pinned layout during SSR + first paint (before localStorage
  // has been read) so there's no flash of the wrong layout.
  if (!mounted || pinned) {
    return (
      <aside className="flex w-72 flex-col border-r border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)]">
        <div className="flex h-16 items-center justify-between gap-2 border-b border-[var(--oms-sidebar-border)] px-6">
          <span className="text-lg font-bold text-[var(--oms-sidebar-text)]">Work Menu</span>
          <button
            type="button"
            onClick={togglePinned}
            title="Hide menu (hover the edge to bring it back)"
            className="rounded-lg px-2 py-1.5 text-[var(--oms-sidebar-text-muted)] transition hover:bg-[var(--oms-sidebar-tile-bg)] hover:text-[var(--oms-sidebar-text)]"
          >
            📌
          </button>
        </div>
        {menu}
      </aside>
    );
  }

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="group flex h-full w-3 shrink-0 cursor-pointer flex-col items-center border-r border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] pt-3">
        <div className="h-10 w-1 rounded-full bg-[var(--oms-sidebar-tile-border)] transition group-hover:bg-[var(--oms-accent)]" />
      </div>
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] shadow-2xl transition-transform duration-200 ease-out ${
          hovered ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-[var(--oms-sidebar-border)] px-6">
          <span className="text-lg font-bold text-[var(--oms-sidebar-text)]">Work Menu</span>
          <button
            type="button"
            onClick={togglePinned}
            title="Keep menu pinned open"
            className="rounded-lg px-2 py-1.5 text-[var(--oms-sidebar-text-muted)] transition hover:bg-[var(--oms-sidebar-tile-bg)] hover:text-[var(--oms-sidebar-text)]"
          >
            📌
          </button>
        </div>
        {menu}
      </aside>
    </div>
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
          ? "border-[var(--oms-accent)] bg-[var(--oms-accent)] text-[var(--oms-accent-contrast)] shadow-md shadow-[var(--oms-accent)]/20"
          : "border-[var(--oms-sidebar-tile-border)] bg-[var(--oms-sidebar-tile-bg)] text-[var(--oms-sidebar-text-muted)] hover:-translate-y-0.5 hover:border-[var(--oms-accent)]/40 hover:bg-[var(--oms-sidebar-border)] hover:text-[var(--oms-sidebar-text)] hover:shadow-md"
      }`}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </Link>
  );
}
