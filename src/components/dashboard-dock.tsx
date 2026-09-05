"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef } from "react";
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
 * REDESIGNED 2026-09-04 (same day, user feedback on the first cut):
 * 1. **Glass pill, not a solid bar** — the fill is fully transparent
 *    (`bg-transparent`, no tint at all — an earlier pass tried a 25%-opacity
 *    tint of `--oms-sidebar-bg` via Tailwind's `bg-[var(...)]/25` syntax,
 *    but that still reads as a visible solid-colored box, which is exactly
 *    what the user asked to have removed). Only `backdrop-blur-2xl` (a
 *    frosted-glass distortion of whatever is behind the dock, not a color)
 *    plus the `--oms-sidebar-border` outline remain, so the pill's outline
 *    and icons stay visible while the inside of the pill shows no fill
 *    color at all, in any per-company theme (see globals.css's per-company
 *    `--oms-*` blocks).
 * 2. **A capped-width "viewport" window, not a native horizontal
 *    scrollbar.** Only ~9-10 tiles show at once; the rest are panned into
 *    view by moving the mouse left/right over the dock (`onPointerMove`
 *    below maps cursor-x-within-viewport → a `translateX` on the tile
 *    track), so the visible bar never has to stretch wide enough to reach
 *    a page's own bottom-right chat widget. No scrollbar exists to hide —
 *    the viewport is `overflow-hidden` and panning is transform-only.
 *    Keyboard users get the same effect on `focus` (tabbing to a tile
 *    outside the current window pans it into view) so nothing becomes
 *    keyboard-unreachable just because it's visually hidden.
 * 3. **A cursor-following glow** (`.oms-dock-glow`) — a blurred radial
 *    gradient in the page's own `--oms-accent` color, moved via a ref
 *    (never React state) on every pointer move so tracking the cursor
 *    costs a style write, not a re-render of the whole dock; a CSS
 *    `transition` on that same property is what gives it its trailing/
 *    "electric" chase feel rather than snapping straight to the cursor.
 * 4. The switch-to-sidebar button and the divider before it sit OUTSIDE
 *    the panning viewport (`shrink-0`, not part of the track) — it's a
 *    persistent mode control, not a page tile, so it should never be one
 *    of the ~20 things that can scroll out of view.
 *
 * Hover/focus "magnify" (the hovered tile grows, its immediate neighbors
 * grow a little too) is still pure CSS (.oms-dock-tile / .oms-dock-icon-wrap
 * in globals.css, using :has() for the neighbor effect) — that part never
 * needed a mousemove/state loop and still doesn't; only the NEW pan/glow
 * behavior below reads pointer position, and it does so via refs so it
 * stays a style write per pixel, never a re-render per pixel.
 */
export function DashboardDock({ capabilities }: { capabilities: string[] }) {
  const pathname = usePathname();
  const { navStyle, mounted, setNavStyle } = useNavStyle();
  const items = CAPABILITY_INFO.filter((c) => capabilities.includes(c.code));

  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  // How far the track can pan left, in px — recomputed on every move
  // rather than cached, since the tile count (company-dependent
  // capabilities) never changes after mount but this stays cheap either
  // way (two element reads, no layout thrash beyond what the browser
  // already does for :hover/:focus-visible on the tiles themselves).
  const maxShift = useCallback(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return 0;
    return Math.max(0, track.scrollWidth - viewport.clientWidth);
  }, []);

  const panTrackTo = useCallback((fraction: number) => {
    const track = trackRef.current;
    if (!track) return;
    const shift = maxShift() * Math.min(1, Math.max(0, fraction));
    track.style.transform = `translateX(-${shift}px)`;
  }, [maxShift]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const glow = glowRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (glow) {
      glow.style.transform = `translate(${x}px, ${y}px)`;
      glow.style.opacity = "1";
    }
    panTrackTo(x / rect.width);
  }, [panTrackTo]);

  const handlePointerLeave = useCallback(() => {
    panTrackTo(0);
    if (glowRef.current) glowRef.current.style.opacity = "0";
  }, [panTrackTo]);

  // Keyboard users don't fire pointermove — bring a tab-focused tile into
  // the visible window the same way a mouse hover would, so nothing that
  // is off-screen (panned away) becomes unreachable by keyboard.
  const handleFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const target = e.target as HTMLElement;
    if (!viewport || !track) return;
    const shift = maxShift();
    if (shift <= 0) return;
    const currentShift = -(Number(track.style.transform.replace(/[^-\d.]/g, "")) || 0);
    const tileLeft = target.offsetLeft;
    const tileRight = tileLeft + target.offsetWidth;
    const visibleLeft = currentShift;
    const visibleRight = currentShift + viewport.clientWidth;
    let nextShift = currentShift;
    if (tileLeft < visibleLeft) nextShift = tileLeft;
    else if (tileRight > visibleRight) nextShift = tileRight - viewport.clientWidth;
    track.style.transform = `translateX(-${Math.min(shift, Math.max(0, nextShift))}px)`;
  }, [maxShift]);

  // Render nothing until mounted, and nothing outside Dock mode — Sidebar
  // mode (default, and SSR/first paint) never has a hidden dock in the DOM.
  if (!mounted || navStyle !== "dock") return null;

  return (
    <nav aria-label="Work menu (dock)" className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3">
      <div className="oms-dock-inner pointer-events-auto flex w-[min(94vw,580px)] items-center gap-1 rounded-2xl border border-[var(--oms-sidebar-border)] bg-transparent px-2 pb-2 pt-10 shadow-2xl backdrop-blur-2xl">
        <div
          ref={viewportRef}
          className="oms-dock-viewport relative min-w-0 flex-1 overflow-hidden"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onFocus={handleFocus}
        >
          <div ref={glowRef} className="oms-dock-glow" aria-hidden="true" />
          <div ref={trackRef} className="oms-dock-track flex items-center gap-1">
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
          </div>
        </div>
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
      <span className="oms-dock-icon-wrap flex h-11 w-11 items-center justify-center text-[26px] leading-none">{icon}</span>
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
      <span className="oms-dock-icon-wrap flex h-11 w-11 items-center justify-center text-2xl leading-none">{icon}</span>
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
