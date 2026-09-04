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
 */
export function DashboardMain({ children }: { children: ReactNode }) {
  const { navStyle, mounted } = useNavStyle();
  const dockActive = mounted && navStyle === "dock";

  return <main className={`flex-1 overflow-y-auto p-6 ${dockActive ? "pb-28" : ""}`}>{children}</main>;
}
