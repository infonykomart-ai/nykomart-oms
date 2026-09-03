"use client";

import { useState, type ReactNode } from "react";

// 3-tab shell for the Courier Ops Dashboard (2026-09-03) — Account Setup /
// Book Shipment / Track Shipments. Deliberately just a tab switcher: all
// 3 tabs' actual content is fetched server-side in page.tsx (a Server
// Component) and passed in here as pre-rendered ReactNode, so none of that
// data-fetching needs to move to the client. Initial tab is read from the
// `tab` search param (set by the Track Shipments filter form's hidden
// input, and by GenerateLabelButton's revalidatePath) so a filter submit or
// a label generation doesn't bounce the user back to the first tab.
export type CourierBookingTab = "setup" | "book" | "track";

const TABS: { key: CourierBookingTab; label: string }[] = [
  { key: "setup", label: "⚙️ Account Setup" },
  { key: "book", label: "📦 Book Shipment" },
  { key: "track", label: "🔍 Track Shipments" },
];

export function CourierBookingTabs({
  initialTab,
  setup,
  book,
  track,
}: {
  initialTab: CourierBookingTab;
  setup: ReactNode;
  book: ReactNode;
  track: ReactNode;
}) {
  const [tab, setTab] = useState<CourierBookingTab>(initialTab);

  return (
    <div className="space-y-4">
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
      <div hidden={tab !== "book"}>{book}</div>
      <div hidden={tab !== "track"}>{track}</div>
    </div>
  );
}
