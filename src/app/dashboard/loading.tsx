// 2026-10-20 — "system thoda slow chl rha hai". Before this file existed the
// app had NO loading.tsx anywhere, so every sidebar/Module-tab click showed
// the OLD page frozen until the next page's server queries finished (its own
// requireCapability + data reads, ~1-3 round-trips) — no spinner, no skeleton,
// nothing. That reads as "the system hung" even when the total wait is under a
// second.
//
// This is the Suspense fallback Next streams the instant a /dashboard
// navigation starts: the shell (sidebar, header, tabs) stays put — the layout
// is NOT re-rendered for it — and only the content area swaps to this
// skeleton, then to the real page. Purely presentational: no data, no hooks,
// so it can never delay or break a page. Deliberately generic (not a specific
// table shape) because it covers every module.
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse space-y-4 p-1">
      <span className="sr-only">Loading…</span>

      {/* Page title + subtitle */}
      <div className="space-y-2">
        <div className="h-6 w-56 rounded-md bg-slate-200" />
        <div className="h-3 w-80 rounded bg-slate-100" />
      </div>

      {/* Stat / summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="h-2.5 w-16 rounded bg-slate-100" />
            <div className="mt-2 h-5 w-24 rounded bg-slate-200" />
          </div>
        ))}
      </div>

      {/* The register/table this page is about to render */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex gap-4 border-b border-slate-100 px-4 py-3">
          <div className="h-3 w-24 rounded bg-slate-100" />
          <div className="h-3 w-32 rounded bg-slate-100" />
          <div className="h-3 w-20 rounded bg-slate-100" />
        </div>
        <div className="divide-y divide-slate-50">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-3 w-6 shrink-0 rounded bg-slate-100" />
              <div className="h-3 w-40 rounded bg-slate-100" />
              <div className="h-3 w-24 rounded bg-slate-100" />
              <div className="ml-auto h-3 w-16 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
