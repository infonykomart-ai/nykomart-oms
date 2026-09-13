"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { CAPABILITY_INFO } from "@/lib/capability-info";

// 2026-09-13 — request #1: "tab system banana hai jis se ek sath kai kaam
// kiye ja sake — Multiple modules ek saath khule (Recommended)". Until now
// the dashboard was strictly one module at a time: every sidebar tile
// replaced the whole page, so checking a bill in Bill Payment while
// entering orders meant navigating back and forth. This adds a
// browser-style module tab strip under the header: every module you visit
// opens a tab and STAYS open — switch between Orders, Bill Payment,
// Documents etc. with one click, close what you're done with.
//
// How it stays a ~zero-touch change across 100+ pages: tabs are keyed by
// TOP-LEVEL MODULE href (the same CAPABILITY_INFO hrefs the sidebar tiles
// use). The provider watches the URL and auto-opens the tab for whatever
// module is on screen — no page needs to opt in, and deep links
// (/dashboard/orders/123) open their parent module's tab. Nothing else
// about navigation changes; the sidebar/dock work exactly as before.
//
// Open tabs persist per browser via localStorage, so reopening the app
// restores your last working set. The tab strip is rendered from the same
// --oms-sidebar-* theme tokens the header/sidebar use, so it sits cleanly
// under the header in all 7 themes.

export type ModuleTab = { href: string; label: string; icon: string };

const STORAGE_KEY = "oms_module_tabs_v1";
const HOME_TAB: ModuleTab = { href: "/dashboard", label: "Home", icon: "🏠" };

/** Longest-prefix module match over CAPABILITY_INFO — /dashboard/orders/123 → the Orders module. */
function moduleForPath(pathname: string): ModuleTab {
  let best: { href: string; label: string; icon: string } | null = null;
  for (const c of CAPABILITY_INFO) {
    if (pathname === c.href || pathname.startsWith(c.href + "/")) {
      if (!best || c.href.length > best.href.length) best = c;
    }
  }
  if (best) return { href: best.href, label: best.label, icon: best.icon };
  return HOME_TAB;
}

type ModuleTabsValue = {
  tabs: ModuleTab[];
  activeHref: string;
  openTab: (tab: ModuleTab) => void;
  closeTab: (href: string) => void;
};

const ModuleTabsContext = createContext<ModuleTabsValue | null>(null);

export function useModuleTabs(): ModuleTabsValue {
  const ctx = useContext(ModuleTabsContext);
  if (!ctx) throw new Error("useModuleTabs must be used inside ModuleTabsProvider");
  return ctx;
}

export function ModuleTabsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tabs, setTabs] = useState<ModuleTab[]>([HOME_TAB]);
  const [mounted, setMounted] = useState(false);
  // Tabs are appended-to only; a ref of hrefs avoids re-running the open
  // effect when the tabs array identity changes.
  const openHrefs = useRef<Set<string>>(new Set([HOME_TAB.href]));

  // One-time restore of the saved tab set. Runs before the pathname effect
  // below can add the current module (both are mount effects; the pathname
  // effect re-runs whenever pathname changes, so ordering is safe either
  // way — openTab dedupes).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const restored: ModuleTab[] = [HOME_TAB];
          for (const t of parsed) {
            if (
              t &&
              typeof t === "object" &&
              typeof (t as ModuleTab).href === "string" &&
              typeof (t as ModuleTab).label === "string" &&
              typeof (t as ModuleTab).icon === "string" &&
              (t as ModuleTab).href !== HOME_TAB.href
            ) {
              restored.push(t as ModuleTab);
            }
          }
          openHrefs.current = new Set(restored.map((t) => t.href));
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTabs(restored);
        }
      }
    } catch {
      // Corrupted storage — start fresh rather than crash the dashboard.
    }
    setMounted(true);
  }, []);

  const openTab = useCallback((tab: ModuleTab) => {
    if (openHrefs.current.has(tab.href)) return;
    openHrefs.current.add(tab.href);
    setTabs((prev) => {
      const next = [...prev, tab];
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage full/blocked — tabs still work this session.
      }
      return next;
    });
  }, []);

  // Auto-open the tab for whatever module is currently on screen — this
  // one effect is the entire "open a tab by navigating" mechanism.
  const current = useMemo(() => moduleForPath(pathname), [pathname]);
  useEffect(() => {
    if (!mounted) return;
    openTab(current);
  }, [mounted, current, openTab]);

  const closeTab = useCallback(
    (href: string) => {
      if (href === HOME_TAB.href) return; // Home is permanent
      openHrefs.current.delete(href);
      setTabs((prev) => {
        const next = prev.filter((t) => t.href !== href);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore — see openTab
        }
        return next;
      });
      if (pathname === href || pathname.startsWith(href + "/")) {
        // Closing the module you're looking at → move to the nearest
        // remaining tab (rightmost before it, else Home).
        const idx = tabs.findIndex((t) => t.href === href);
        const fallback = tabs[idx - 1] ?? tabs[idx + 1] ?? HOME_TAB;
        router.push(fallback.href);
      }
    },
    [pathname, router, tabs]
  );

  const value = useMemo<ModuleTabsValue>(
    () => ({ tabs, activeHref: current.href, openTab, closeTab }),
    [tabs, current.href, openTab, closeTab]
  );

  return <ModuleTabsContext.Provider value={value}>{children}</ModuleTabsContext.Provider>;
}

export function ModuleTabBar() {
  const { tabs, activeHref, closeTab } = useModuleTabs();
  // Hides itself pre-mount (SSR renders nothing) to avoid a flash of a
  // Home-only strip that immediately fills in.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted) return null;

  return (
    <div className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-[var(--oms-sidebar-border)] bg-[var(--oms-sidebar-bg)] px-2 py-1">
      {tabs.map((t) => {
        const active = t.href === activeHref;
        const closable = t.href !== HOME_TAB.href;
        return (
          <div key={t.href} className="relative flex shrink-0 items-center">
            <Link
              href={t.href}
              prefetch={false}
              // Same prefetch={false} reasoning as the sidebar tiles: a
              // growing strip of module tabs must not fire a full layout
              // data-fetch per tab on every render.
              className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-[var(--oms-accent)] bg-[var(--oms-sidebar-tile-bg)] text-[var(--oms-sidebar-text)]"
                  : "border-transparent text-[var(--oms-sidebar-text-muted)] hover:bg-[var(--oms-sidebar-tile-bg)]/60 hover:text-[var(--oms-sidebar-text)]"
              }`}
            >
              <span className="text-sm leading-none">{t.icon}</span>
              <span className="whitespace-nowrap">{t.label}</span>
            </Link>
            {closable && (
              <button
                type="button"
                onClick={() => closeTab(t.href)}
                title={`Close ${t.label}`}
                aria-label={`Close ${t.label}`}
                className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded px-1 text-[10px] leading-none text-[var(--oms-sidebar-text-muted)] hover:bg-[var(--oms-sidebar-border)] hover:text-[var(--oms-sidebar-text)]"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
