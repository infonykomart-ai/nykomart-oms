"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 2026-08-25 — page-level motion. Wraps the routed page content inside
 * dashboard/layout.tsx's <main>. Keyed by pathname so every navigation (not
 * just the first load) remounts this wrapper and replays the `.oms-page-enter`
 * fade/rise-in defined in globals.css — the "page motion" half of the user's
 * request, alongside .oms-tile's per-card motion and .oms-icon-btn's header
 * button motion. Respects prefers-reduced-motion via that same CSS rule, so
 * this component itself needs no reduced-motion branching.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="oms-page-enter">
      {children}
    </div>
  );
}
