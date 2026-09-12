"use client";

import { useEffect } from "react";

// 2026-09-12 — round 6 of the company-switcher investigation (see
// company-switcher.tsx's fix-4b note and dashboard/layout.tsx's own note on
// the Promise.all hardening for the full trail). There was NO error
// boundary anywhere in this app before this file — confirmed by searching
// the whole repo for error.tsx and finding none. That's why an uncaught
// exception in dashboard/layout.tsx's render (a Supabase network blip
// during one of its ~9 parallel queries, live-reproduced during a company
// switch) fell all the way through to the *browser's own* blank "This page
// couldn't load" interstitial instead of anything this app controls — the
// worst possible failure mode for a non-technical user to land on.
//
// This is Next.js's standard per-segment error boundary (app/dashboard/
// error.tsx) — it catches any render/data error thrown anywhere under
// /dashboard (this layout included) and shows this instead of the blank
// browser page. It's a safety net, not a fix for any specific query: the
// Promise.all in layout.tsx was separately hardened so the known queries
// degrade to safe defaults instead of throwing at all — this file is what
// catches whatever isn't (or can't be) anticipated that way.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Same reasoning as every .catch() added in layout.tsx this round:
    // never swallow the real error silently — it still needs to show up in
    // Vercel's function logs (searchable by digest) even though the user
    // only ever sees the friendly message below.
    console.error("[dashboard] segment error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-amber-50/40 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-6 text-center shadow-sm">
        <p className="text-3xl">⚠️</p>
        <h1 className="mt-3 text-lg font-semibold text-slate-800">Something went wrong loading the dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">
          This was usually just a slow or dropped connection to the server — it isn&apos;t something you did. Try
          again below; if it keeps happening, let the team know.
        </p>
        {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
