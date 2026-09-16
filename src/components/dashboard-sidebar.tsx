"use client";

// 2026-09-15 — "mobile view & tablate view sahi nahi hai ek dusre par chadh
// rahe hain, page ese hona chahiye ki screen auto adjust hojaye": the sidebar
// is now width-responsive and phone-aware:
//
//   • ≥1024px (lg) — exactly today's behavior: w-72 pinned column, pin/hover
//     strip, dock switch. Nothing changes on desktop.
//   • 768–1023px (tablet) — same pinned column but narrower (w-60), so the
//     page content keeps most of the width instead of the old fixed 288px
//     squeezing tables under the fold.
//   • <768px (phone) — the pinned sidebar NEVER takes layout width; it
//     slides in as a fixed overlay over the page (with a backdrop), opened
//     from a ☰ button in the header, and auto-closes after choosing a
//     tile. The hover-strip stays desktop-only (touch has no hover).
//
// The pinned-vs-hovered localStorage preference keeps controlling lg+
// behavior exactly as before; on phones it's ignored in favor of the
// overlay drawer. Custom event `oms:sidebar-open` (fired by the header's
// hamburger) is the cross-component open signal — same lightweight
// pattern the dock already uses internally.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CAPABILITY_INFO } from "@/lib/capability-info";
import { useNavStyle } from "@/components/nav-style-context";

const PIN_STORAGE_KEY = "oms_sidebar_pinned";
export const SIDEBAR_OPEN_EVENT = "oms:sidebar-open";

export function DashboardSidebar({ capabilities }: { capabilities: string[] }) {
  const pathname = usePathname();
  const items = CAPABILITY_INFO.filter((c) => capabilities.includes(c.code));

  const [pinned, setPinned] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { navStyle, mounted: navStyleMounted, setNavStyle } = useNavStyle();

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

  // Phone drawer: opened by the header hamburger via the custom event,
  // closed on Escape. (Closing on tile-tap happens in SidebarTile's own
  // onClick — an effect on `pathname` would fire a cascading re-render.)
  useEffect(() => {
    function onOpen() {
      setMobileOpen(true);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener(SIDEBAR_OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(SIDEBAR_OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function togglePinned() {
    setPinned((prev) => {
      const next = !prev;
      window.localStorage.setItem(PIN_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  // Dock mode fully replaces this sidebar — see the 2026-09-04 header
  // comment above. Nothing renders here (not even the thin hover-strip)
  // once the preference is confirmed as "dock"; DashboardDock takes over.
  if (navStyleMounted && navStyle === "dock") return null;

  const menu = (
    <nav className="flex-1 overflow-y-auto p-3">
      <div className="grid grid-cols-2 gap-2.5">
        <SidebarTile
          href="/dashboard"
          icon="🏠"
          label="Home"
          active={pathname === "/dashboard"}
          onNavigate={pathname === "/dashboard" ? undefined : () => setMobileOpen(false)}
        />
        {items.map((item) => (
          <SidebarTile
            key={item.code}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={pathname.startsWith(item.href)}
            onNavigate={pathname.startsWith(item.href) ? undefined : () => setMobileOpen(false)}
          />
        ))}
      </div>
    </nav>
  );

  const chrome = (closeBtn: boolean) => (
    <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--oms-sidebar-border)] px-4 md:px-6">
      <span className="text-lg font-bold text-[var(--oms-sidebar-text)]">Work Menu</span>
      <div className="flex items-center gap-1">
        {closeBtn && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            title="Close menu"
            className="rounded-lg px-2 py-1.5 text-lg text-[var(--oms-sidebar-text-muted)] transition hover:bg-[var(--oms-sidebar-tile-bg)] hover:text-[var(--oms-sidebar-text)] md:hidden"
          >
            ✕
          </button>
        )}
        <button
          type="button"
          onClick={() => setNavStyle("dock")}
          title="Switch to Dock menu (bottom bar)"
          className="rounded-lg px-2 py-1.5 text-[var(--oms-sidebar-text-muted)] transition hover:bg-[var(--oms-sidebar-tile-bg)] hover:text-[var(--oms-sidebar-text)]"
        >
          ⬇️
        </button>
        <button
          type="button"
          onClick={togglePinned}
          title={closeBtn ? "Hide menu (reopen with ☰)" : "Keep menu pinned open"}
          className="rounded-lg px-2 py-1.5 text-[var(--oms-sidebar-text-muted)] transition hover:bg-[var(--oms-sidebar-tile-bg)] hover:text-[var(--oms-sidebar-text)]"
        >
          📌
        </button>
      </div>
    </div>
  );

  // ── Phone drawer (below md): fixed overlay, never steals layout width ──
  const drawer = (
    <div className={`md:hidden ${mobileOpen ? "" : "pointer-events-none"}`}>
      {/* Backdrop — tap anywhere outside to close */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={() => setMobileOpen(false)}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`oms-sidebar fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] shadow-2xl transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {chrome(true)}
        {menu}
      </aside>
    </div>
  );

  // Render the pinned layout during SSR + first paint (before localStorage
  // has been read) so there's no flash of the wrong layout.
  if (!mounted || pinned) {
    return (
      <>
        {/* ≥md: pinned in-flow column (w-72 desktop / w-60 tablet) */}
        <aside className="oms-sidebar hidden w-72 flex-col border-r border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] md:flex lg:w-60">
          {chrome(false)}
          {menu}
        </aside>
        {drawer}
      </>
    );
  }

  // Unpinned (desktop hover-strip) layout — the strip itself is desktop-only.
  return (
    <>
      <div
        className="hidden md:block"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="group flex h-full w-3 shrink-0 cursor-pointer flex-col items-center border-r border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] pt-3">
          <div className="h-10 w-1 rounded-full bg-[var(--oms-sidebar-tile-border)] transition group-hover:bg-[var(--oms-accent)]" />
        </div>
        <aside
          className={`oms-sidebar fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] shadow-2xl transition-transform duration-200 ease-out lg:w-60 ${
            hovered ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {chrome(false)}
          {menu}
        </aside>
      </div>
      {drawer}
    </>
  );
}

function SidebarTile({
  href,
  icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  // 2026-09-15 — phone drawer closes itself when a tile that actually
  // navigates is tapped (undefined for the already-active tile so tapping
  // it doesn't flash the drawer shut for no reason). No-op on desktop.
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      // 2026-08-25: prefetch={false} — every one of the ~30 tiles here sits
      // in the viewport at once, so Next.js's default link-prefetching was
      // firing a full layout+page data-fetch (getAuthedEmployee() + ~8 more
      // Supabase queries, per dashboard/layout.tsx) for EVERY tile on every
      // dashboard load — a self-inflicted burst of 20-30 concurrent
      // serverless invocations. Confirmed live (2026-08-25 company-switcher
      // investigation) as the source of intermittent 503s across unrelated
      // routes, including the switchCompanyAction POST itself getting
      // caught in its own prefetch storm. A tile click is still an instant
      // client-side navigation either way — this only removes the
      // speculative fetch that happened before any click.
      prefetch={false}
      data-active={active}
      onClick={onNavigate}
      className={`oms-nav-tile group flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-4 text-center transition ${
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
