"use client";

import { useCelebration } from "./celebration-context";
import type { Celebration } from "@/lib/celebration/today";

// Slim banner shown atop the dashboard for anyone whose company has a
// birthday/anniversary TODAY (see getTodaysCelebrations, computed
// server-side in dashboard/layout.tsx). Clicking "Celebrate" broadcasts
// the fireworks overlay to every employee currently on the app — see
// CelebrationProvider.
export function TodaysCelebrationsBanner({ celebrations }: { celebrations: Celebration[] }) {
  const { fireCelebration } = useCelebration();

  if (celebrations.length === 0) return null;

  const emoji = { birthday: "🎂", anniversary: "💍", work_anniversary: "🏆" } as const;
  const label = (c: Celebration) =>
    c.kind === "birthday" ? "Birthday" : c.kind === "anniversary" ? "Anniversary" : `${c.years} Saal Company me`;

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
      {celebrations.map((c) => (
        <div key={`${c.employeeId}-${c.kind}`} className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-amber-900">
            {emoji[c.kind]} Aaj <strong>{c.name}</strong> {c.kind === "work_anniversary" ? "ke" : "ka"} {label(c)}{" "}
            {c.kind === "work_anniversary" ? "poore ho gaye!" : "hai!"}
          </p>
          <button
            type="button"
            onClick={() => fireCelebration({ name: c.name, kind: c.kind, photoUrl: c.photoUrl, years: c.years })}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
          >
            Celebrate 🎆
          </button>
        </div>
      ))}
    </div>
  );
}
