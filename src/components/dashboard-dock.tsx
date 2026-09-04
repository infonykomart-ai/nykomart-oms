"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CAPABILITY_INFO } from "@/lib/capability-info";
import { useNavStyle } from "@/components/nav-style-context";

/**
 * 2026-09-04 — macOS-Dock-style bottom-center nav bar, an opt-in
 * alternative to the left Work Menu sidebar (dashboard-sidebar.tsx). Same
 * real tiles as the sidebar (same `CAPABILITY_INFO` filter, same Home tile,
 * same `pathname.startsWith(item.href)` active check), just laid out as a
 * floating pill anchored to the bottom of the viewport instead of a column
 * on the left. Renders nothing at all in Sidebar mode (the default) or
 * before the localStorage-backed nav-style preference has been read on
 * mount — see nav-style-context.tsx.
 *
 * Hover/focus "magnify" (the hovered tile grows, its immediate neighbors
 * grow a little too) is pure CSS (.oms-dock-tile / .oms-dock-icon-wrap in
 * globals.css, using :has() for the neighbor effect) rather than a
 * mousemove-driven JS/state loop — with every tile visible at once (same
 * shape as the sidebar's ~30-tile grid), a per-mousemove state update would
 * re-render the whole dock on every pixel of pointer movement for no real
 * benefit.
 */
export function DashboardDock({ capabilities }: { capabilities: string[] }) {
  const pathname = usePathname();
  const { navStyle, mounted, setNavStyle } = useNavStyle();
  const items = CAPABILITY_INFO.filter((c) => capabilities.includes(c.code));

  // Render nothing until mounted, and nothing outside Dock mode — Sidebar
  // mode (default, and SSR/first paint) never has a hidden dock in the DOM.
  if (!mounted || navStyle !== "dock") return null;

  return (
    <nav aria-label="Work menu (dock)" className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3">
      <div className="oms-dock-inner pointer-events-auto flex max-w-[92vw] items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)]/95 px-2 pb-2 pt-10 shadow-2xl backdrop-blur">
        <DockTile href="/dashboard" icon="🏠" label="Home" active={pathname === "/dashboard"} />
        {items.map((item) => (
          <DockTile
            key={item.code}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={pathname.startsWith(item.href)}
          />
        ))}
        <div className="mx-1 h-8 w-px shrink-0 self-center bg-[var(--oms-sidebar-border)]" aria-hidden="true" />
        <DockButton icon="⬅️" label="Switch to sidebar menu" onClick={() => setNavStyle("sidebar")} />
      </div>
    </nav>
  );
}

function DockTile({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      // Same reasoning as SidebarTile in dashboard-sidebar.tsx — every tile
      // here sits in the viewport at once, so default link-prefetching
      // would fire a full layout+page data-fetch per tile on every
      // dashboard load. See that component's comment for the full story.
      prefetch={false}
      title={label}
      className={`oms-dock-tile group relative flex shrink-0 flex-col items-center gap-1 rounded-xl px-1.5 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--oms-accent)] ${
        active ? "text-[var(--oms-accent)]" : "text-[var(--oms-sidebar-text-muted)] hover:text-[var(--oms-sidebar-text)]"
      }`}
    >
      <DockTooltip label={label} />
      <span className="oms-dock-icon-wrap flex h-10 w-10 items-center justify-center text-2xl leading-none">{icon}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[var(--oms-accent)]" : "bg-transparent"}`} aria-hidden="true" />
    </Link>
  );
}

function DockButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="oms-dock-tile group relative flex shrink-0 flex-col items-center gap-1 rounded-xl px-1.5 py-1 text-[var(--oms-sidebar-text-muted)] outline-none transition-colors hover:text-[var(--oms-sidebar-text)] focus-visible:ring-2 focus-visible:ring-[var(--oms-accent)]"
    >
      <DockTooltip label={label} />
      <span className="oms-dock-icon-wrap flex h-10 w-10 items-center justify-center text-xl leading-none">{icon}</span>
      <span className="h-1.5 w-1.5 rounded-full bg-transparent" aria-hidden="true" />
    </button>
  );
}

function DockTooltip({ label }: { label: string }) {
  // Not aria-hidden — its text is the tile's accessible name (the icon
  // glyph alone isn't a reliable label for screen readers). Visually
  // hidden at rest via opacity (see .oms-dock-tooltip in globals.css), not
  // display/visibility, so it stays in the accessibility tree either way;
  // pointer-events-none just keeps it from intercepting the tile's click.
  return (
    <span className="oms-dock-tooltip pointer-events-none absolute bottom-full left-1/2 mb-2 whitespace-nowrap rounded-md border border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] px-2 py-1 text-[11px] font-medium text-[var(--oms-sidebar-text)] shadow-lg">
      {label}
    </span>
  );
}
