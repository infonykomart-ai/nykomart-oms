"use client";

import type { ReactNode } from "react";

/**
 * 2026-09-04 — thin client wrapper around dashboard/layout.tsx's <main>.
 *
 * 2026-09-17 — Dock nav mode (and its NavStyleContext) was removed entirely
 * per owner request, so this no longer needs to read any nav-style
 * preference or add extra bottom padding for it — just the fixed
 * MessengerPopup/AI-Companion clearance from the 2026-09-10 note below.
 *
 * 2026-09-10 — "pich button chup raha hai": the SAME class of problem as
 * the Dock-nav one above, just from two DIFFERENT always-on-top fixed
 * widgets that this component previously didn't account for at all —
 * MessengerPopup (`fixed bottom-6 right-24`, mounted for every employee)
 * and, when this employee has it turned on, the AI Companion dock
 * (`.oms-companion-dock`, `fixed right:16px bottom:16px`). Neither is tied
 * to the Dock-nav toggle above (both float regardless of Sidebar vs Dock
 * nav mode), so a page whose own content happens to place a normal,
 * in-flow button near the bottom-right of the viewport — e.g. the Order
 * detail page's "+ Assign to a Party" button — could render directly
 * underneath them with zero reserved space, making that button
 * unclickable/invisible. Fix: reserve bottom clearance in EVERY nav mode,
 * not just Dock mode — `pb-24` covers both floating buttons' combined
 * footprint (each sits ~80px tall including its own bottom offset) with a
 * safety margin; Dock mode keeps its own taller `pb-28` since the Dock bar
 * itself is wider/taller and already needed more room before this fix.
 *
 * 2026-09-15 — "mobile view & tablate view sahi nahi hai ek dusre par chadh
 * rahe hain, page ese hona chahiye ki screen auto adjust hojaye": padding
 * now scales with the viewport (p-3 on phones → p-6 on desktop). Most
 * content overlap on small screens comes from page-level grids, so the
 * main scroll container also opts in to Tailwind's CSS-container queries —
 * pages using `@container` / `@lg:` variants now adapt to THEIR OWN width
 * instead of the browser window, which is what makes grids reflow
 * correctly even when this main pane is sharing width with the sidebar.
 */
export function DashboardMain({ children }: { children: ReactNode }) {
  return (
    <main className="@container flex-1 overflow-y-auto p-3 pb-24 md:p-6">
      {children}
    </main>
  );
}
