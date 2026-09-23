"use client";

// 2026-09-17 — Two-part request, with screenshots of the Claude app's own
// left sidebar as the style reference:
//   (a) "isme se dock (docer) remove karna hai" — remove Dock nav mode
//       entirely. Done below — no useNavStyle import, no dock early return.
//   (b) FIRST PASS: "vese pin option nahi rakhna" was read as "remove the
//       hide/show control entirely" and the whole ⋮ menu + toggle was
//       deleted. OWNER CORRECTED THIS the same day: "claude ai app me menu
//       hide karne ka jese option hai vese chahiye tha" — I DID want a
//       hide-the-menu option, like Claude's own app has. So the toggle is
//       back, just not as a "pin" (hover-to-reveal strip + ⋮ dropdown) —
//       a single, explicit click-to-hide / click-to-show button, the way
//       Claude's own sidebar has one clear collapse control rather than a
//       hidden options menu. State still persists per browser
//       (localStorage `oms_sidebar_hidden`), read once on mount behind the
//       same `mounted` gate pattern used everywhere else in this file so
//       SSR/first paint never mismatches the client.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CAPABILITY_INFO } from "@/lib/capability-info";

const HIDDEN_STORAGE_KEY = "oms_sidebar_hidden";
export const SIDEBAR_OPEN_EVENT = "oms:sidebar-open";

export function DashboardSidebar({ capabilities }: { capabilities: string[] }) {
  const pathname = usePathname();
  const items = CAPABILITY_INFO.filter((c) => capabilities.includes(c.code));

  const [hidden, setHidden] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // Reading localStorage (an external system) on mount, not deriving from
    // props/state React already knows about — the "mounted" gate exists
    // specifically so this one-time sync can't cause a hydration mismatch.
    // Default (unmounted / never-set) is always visible.
    const saved = window.localStorage.getItem(HIDDEN_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "1") setHidden(true);
    setMounted(true);
  }, []);

  function toggleHidden() {
    setHidden((prev) => {
      const next = !prev;
      window.localStorage.setItem(HIDDEN_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

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

  // Header strip — title, a desktop-only hide button (⇤), and a mobile-only
  // ✕ close button on the phone drawer. No ⋮ dropdown — one visible button,
  // one job, same as Claude's own sidebar collapse control.
  const chrome = (closeBtn: boolean, showHideButton: boolean) => (
    <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--oms-sidebar-border)] px-4 md:px-6">
      <span className="truncate text-lg font-bold text-[var(--oms-sidebar-text)]">Work Menu</span>
      <div className="flex items-center gap-1">
        {showHideButton && (
          <button
            type="button"
            onClick={toggleHidden}
            title="Hide menu"
            className="hidden rounded-lg px-2 py-1.5 text-lg text-[var(--oms-sidebar-text-muted)] transition hover:bg-[var(--oms-sidebar-tile-bg)] hover:text-[var(--oms-sidebar-text)] md:inline-flex"
          >
            ⇤
          </button>
        )}
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
      </div>
    </div>
  );

  // ── Phone drawer (below md): fixed overlay, never steals layout width ──
  // 2026-09-23 — "print left menu bar ko cover karta hai": `visibility:
  // hidden` (from print-view.tsx's blanket `body * { visibility: hidden }`
  // rule) makes hidden elements invisible but NOT removed from layout, so
  // every one of these three states was still reserving its real on-screen
  // width/position during print, squeezing or offsetting the actual
  // printable content. `print:hidden` (Tailwind's print-only `display:
  // none`) genuinely removes each from layout at print time, same fix
  // already applied to the "Details" panel these sidebar states sit next
  // to in every printable page.
  const drawer = (
    <div className={`print:hidden md:hidden ${mobileOpen ? "" : "pointer-events-none"}`}>
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
        {chrome(true, false)}
        {menu}
      </aside>
    </div>
  );

  // Render the full sidebar during SSR + first paint (before localStorage
  // has been read) so there's no flash of the wrong layout.
  const showFull = !mounted || !hidden;

  return (
    <>
      {showFull ? (
        // ≥md: always-visible in-flow column (w-72 desktop / w-60 tablet).
        <aside className="oms-sidebar hidden w-72 flex-col border-r border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] md:flex lg:w-60 print:hidden">
          {chrome(false, true)}
          {menu}
        </aside>
      ) : (
        // Hidden: a slim always-there rail with just one button to bring
        // the menu back — same idea as Claude's own collapsed sidebar edge.
        <div className="hidden w-10 shrink-0 flex-col items-center border-r border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] pt-3 md:flex print:hidden">
          <button
            type="button"
            onClick={toggleHidden}
            title="Show menu"
            className="rounded-lg px-2 py-1.5 text-lg text-[var(--oms-sidebar-text-muted)] transition hover:bg-[var(--oms-sidebar-tile-bg)] hover:text-[var(--oms-sidebar-text)]"
          >
            ⇥
          </button>
        </div>
      )}
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
