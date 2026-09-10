"use client";

import type { ReactNode } from "react";
import { useNavStyle } from "@/components/nav-style-context";

/**
 * 2026-09-04 — thin client wrapper around dashboard/layout.tsx's <main>,
 * existing only so it can read NavStyleContext and add bottom padding
 * while Dock mode is active. DashboardDock is `fixed` to the bottom of the
 * viewport, above page content, so without this the last bit of scrollable
 * page content would sit underneath it. Sidebar mode (default, and every
 * page before this preference has been read on mount) is untouched — same
 * `p-6` as before, byte-for-byte.
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
 */
export function DashboardMain({ children }: { children: ReactNode }) {
  const { navStyle, mounted } = useNavStyle();
  const dockActive = mounted && navStyle === "dock";

  return <main className={`flex-1 overflow-y-auto p-6 ${dockActive ? "pb-28" : "pb-24"}`}>{children}</main>;
}
