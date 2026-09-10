"use client";

// 2026-09-10 — "har 10-20 second me data sync hota rahe baar baar refresh
// nahi karna pade": scoped to 3 screens the user asked for (Orders hub,
// Attendance Admin, Courier Booking) rather than every page in the app —
// each of those is a Server Component whose data is fetched fresh on
// every render, so the established Next.js App Router way to get
// "near-live" data without a bigger Realtime rewrite is `router.refresh()`
// on a timer: it re-runs that page's server-side data fetch and patches
// the DOM with the new data, WITHOUT a full page reload or losing
// client-side component state (an open dropdown, a form's `useState`,
// scroll position) the way `location.reload()` or a manual browser
// refresh would.
//
// Two safety pauses, both deliberate:
//  1. Tab not visible (Page Visibility API) — no point re-fetching data
//     nobody's looking at; also cuts real server/DB load when an employee
//     has this tab open in the background all day.
//  2. Focus is inside a text input/textarea/select/contenteditable — an
//     employee actively typing (a search box, an inline "+ Assign to a
//     Party" form, a filter field) should never have their in-progress
//     input silently blown away by a background data refresh. The timer
//     keeps running underneath; it just skips firing `refresh()` while
//     focus is there, and resumes normally the moment focus leaves.
//
// Mount this once near the top of a page's JSX — it renders nothing.
//
// `enabled` (default true) — pass `false` to pause entirely without
// unmounting, e.g. Courier Booking mounts this INSIDE its client-side tab
// switcher (courier-booking-tabs.tsx) with `enabled={tab is one of the
// read-only tabs}`, so it stays off while the employee is on Book
// Shipment/Account Setup — long, higher-stakes forms — and turns on for
// Track Shipments/Pending Orders/etc. without needing a page reload when
// they switch tabs.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isEditingRightNow(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function AutoRefresh({ intervalMs = 15000, enabled = true }: { intervalMs?: number; enabled?: boolean }) {
  // `useRouter()`'s returned object is stable across renders in the Next.js
  // App Router (it doesn't change identity), so it's safe to use directly
  // inside the effect below without a ref — no "update a ref during
  // render" lint issue, and no stale-closure risk either.
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (isEditingRightNow()) return;
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled, router]);

  return null;
}
