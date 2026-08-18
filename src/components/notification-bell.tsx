"use client";

import { useState } from "react";
import Link from "next/link";

export type NotificationItem = {
  key: string;
  label: string;
  count: number;
  href: string;
};

/**
 * 2026-08-18 — the "staff alerts" half of "WhatsApp customer/staff
 * notifications best banao". Deliberately NOT a WhatsApp message to staff
 * (that would need either the rejected OpenWA automation or a real per-
 * message cost via Meta's Cloud API — see BRAIN.md §9) — an in-app bell is
 * the honest "best I can build without either of those" version: instant,
 * free, no external dependency, and every item links straight to the page
 * that needs attention.
 *
 * Deliberately computed fresh on every page load from each item's own
 * source of truth (pending approvals, overdue bills) rather than a stored
 * notifications table with insert-triggers scattered across the app — see
 * the counts being passed in from layout.tsx. Simpler, always correct (no
 * risk of a stale/unread stored notification surviving after its
 * underlying condition is already resolved elsewhere), and avoids adding
 * a new subsystem for what 2 lightweight indexed counts already answer.
 */
export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const totalCount = items.reduce((sum, i) => sum + i.count, 0);

  if (items.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-slate-100"
        title="Notifications"
      >
        🔔
        {totalCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {totalCount > 99 ? "99+" : totalCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            <h3 className="mb-1 px-2 py-1 text-xs font-semibold text-slate-500">Needs your attention</h3>
            {totalCount === 0 ? (
              <p className="px-2 py-2 text-xs text-slate-400">All caught up — nothing pending.</p>
            ) : (
              items
                .filter((i) => i.count > 0)
                .map((i) => (
                  <Link
                    key={i.key}
                    href={i.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between rounded-md px-2 py-2 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <span>{i.label}</span>
                    <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">{i.count}</span>
                  </Link>
                ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
