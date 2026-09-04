"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * 2026-09-04 — per-employee, per-browser choice between the classic left
 * "Work Menu" sidebar (dashboard-sidebar.tsx, default/unchanged for
 * everyone unless they opt in) and the new macOS-Dock-style bottom-center
 * bar (dashboard-dock.tsx). Same localStorage-preference convention
 * dashboard-sidebar.tsx already uses for its own pin/unpin flag
 * (oms_sidebar_pinned) — a plain string, read once on mount behind a
 * `mounted` gate so SSR/first paint always renders the "sidebar" default
 * (today's behavior, unchanged) with no hydration mismatch, then synced
 * from localStorage in a useEffect.
 *
 * A single shared React context (rather than DashboardSidebar,
 * DashboardDock, and the <main> bottom-padding each independently
 * re-reading localStorage) because all three must react to the SAME
 * toggle in the SAME render — clicking the switch in the sidebar's header
 * has to hide the sidebar and show the dock immediately, not just after a
 * reload.
 */
const NAV_STYLE_STORAGE_KEY = "oms_nav_style";

export type NavStyle = "sidebar" | "dock";

type NavStyleContextValue = {
  navStyle: NavStyle;
  /** False until the localStorage read has happened once on mount — mirrors
   *  DashboardSidebar's own `mounted` gate. Callers should treat `!mounted`
   *  the same as `navStyle === "sidebar"` (today's default), same as
   *  DashboardSidebar treats `!mounted` as `pinned`. */
  mounted: boolean;
  setNavStyle: (style: NavStyle) => void;
};

const NavStyleContext = createContext<NavStyleContextValue | null>(null);

export function NavStyleProvider({ children }: { children: ReactNode }) {
  const [navStyle, setNavStyleState] = useState<NavStyle>("sidebar");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Reading localStorage (an external system) on mount, not deriving from
    // props/state React already knows about — the "mounted" gate above (and
    // the sidebar-default fallback while !mounted, used by every consumer
    // of this context) exists specifically so this one-time sync can't
    // cause a hydration mismatch. Same pattern as dashboard-sidebar.tsx's
    // own pin-state read.
    const saved = window.localStorage.getItem(NAV_STYLE_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "dock") setNavStyleState("dock");
    setMounted(true);
  }, []);

  function setNavStyle(style: NavStyle) {
    setNavStyleState(style);
    window.localStorage.setItem(NAV_STYLE_STORAGE_KEY, style);
  }

  return <NavStyleContext.Provider value={{ navStyle, mounted, setNavStyle }}>{children}</NavStyleContext.Provider>;
}

export function useNavStyle(): NavStyleContextValue {
  const ctx = useContext(NavStyleContext);
  if (!ctx) throw new Error("useNavStyle() must be used within a NavStyleProvider");
  return ctx;
}
