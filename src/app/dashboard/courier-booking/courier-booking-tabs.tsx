"use client";

import { useState, type ReactNode } from "react";
import { AutoRefresh } from "@/components/auto-refresh";

// 3-tab shell for the Courier Ops Dashboard (2026-09-03) — Account Setup /
// Book Shipment / Track Shipments. Deliberately just a tab switcher: all
// 3 tabs' actual content is fetched server-side in page.tsx (a Server
// Component) and passed in here as pre-rendered ReactNode, so none of that
// data-fetching needs to move to the client. Initial tab is read from the
// `tab` search param (set by the Track Shipments filter form's hidden
// input, and by GenerateLabelButton's revalidatePath) so a filter submit or
// a label generation doesn't bounce the user back to the first tab.
export type CourierBookingTab = "setup" | "book" | "track" | "pending" | "pickup" | "report" | "ndr" | "performance";

// 2026-09-04 (EGS-integration round) — 3 new tabs added alongside the
// original 3: Pending Orders / Pickup Request / Daily Shipment Report,
// per the user's own choice in this round's scoping (existing dashboard,
// new tabs, not a separate section).
//
// 2026-09-09 — "NDR" tab added: the reason-wise unresolved-NDR summary
// panel (per-shipment logging itself lives on the Shipment Detail page,
// see shipment/ndr-panel.tsx) — same "existing dashboard, new tab" choice
// as the 2026-09-04 round, not a separate section.
//
// 2026-09-09 (same round) — one more: Courier Performance by Country, same
// pattern (new tab, gated on the same courier_booking_shipment capability
// as every other tab here — no new capability invented).
const TABS: { key: CourierBookingTab; label: string }[] = [
  { key: "setup", label: "⚙️ Account Setup" },
  { key: "pending", label: "📥 Pending Orders" },
  { key: "book", label: "📦 Book Shipment" },
  { key: "pickup", label: "🚚 Pickup Request" },
  { key: "track", label: "🔍 Track Shipments" },
  { key: "ndr", label: "🚫 NDR" },
  { key: "report", label: "📊 Daily Report" },
  { key: "performance", label: "🌍 Courier Performance" },
];

// 2026-09-10 — "har 10-20 second me data sync hota rahe": scoped to the
// read-only viewing tabs the user specifically asked for (Track Shipments
// / Pending Orders, plus the same-shape Pickup Request/NDR/Report/
// Performance tabs). Deliberately EXCLUDES "book" (Book Shipment — a long
// real-shipment-booking form) and "setup" (Account Setup — courier
// credential entry) so a background refresh never fires while an employee
// could be mid-way through either of those higher-stakes forms, even
// though all 8 tabs' content actually stays mounted in the DOM at once
// (see the `hidden` attributes below) — this only controls whether the
// TIMER is armed, keyed off which tab is currently visible.
const AUTO_REFRESH_TABS = new Set<CourierBookingTab>(["pending", "pickup", "track", "ndr", "report", "performance"]);

export function CourierBookingTabs({
  initialTab,
  setup,
  book,
  track,
  pending,
  pickup,
  report,
  ndr,
  performance,
}: {
  initialTab: CourierBookingTab;
  setup: ReactNode;
  book: ReactNode;
  track: ReactNode;
  pending: ReactNode;
  pickup: ReactNode;
  report: ReactNode;
  ndr: ReactNode;
  performance: ReactNode;
}) {
  const [tab, setTab] = useState<CourierBookingTab>(initialTab);

  return (
    <div className="space-y-4">
      <AutoRefresh intervalMs={15000} enabled={AUTO_REFRESH_TABS.has(tab)} />
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border border-b-0 border-slate-200 bg-white text-slate-900"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div hidden={tab !== "setup"}>{setup}</div>
      <div hidden={tab !== "pending"}>{pending}</div>
      <div hidden={tab !== "book"}>{book}</div>
      <div hidden={tab !== "pickup"}>{pickup}</div>
      <div hidden={tab !== "track"}>{track}</div>
      <div hidden={tab !== "ndr"}>{ndr}</div>
      <div hidden={tab !== "report"}>{report}</div>
      <div hidden={tab !== "performance"}>{performance}</div>
    </div>
  );
}
