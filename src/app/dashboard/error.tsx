"use client";

import { useEffect, useState } from "react";

// 2026-09-12 — round 6 of the company-switcher investigation (see
// company-switcher.tsx's fix-4b note and dashboard/layout.tsx's own note on
// the Promise.all hardening for the full trail). There was NO error
// boundary anywhere in this app before this file — confirmed by searching
// the whole repo for error.tsx and finding none. That's why an uncaught
// exception in dashboard/layout.tsx's render (a Supabase network blip
// during one of its ~9 parallel queries, live-reproduced during a company
// switch) fell all this way through to the *browser's own* blank "This page
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
//
// ---------------------------------------------------------------------------
// 2026-09-13 — digest 109271716 autopsy: the first error this boundary ever
// swallowed was `UnauthorizedError: Not signed in.` thrown by
// getAuthedEmployee() inside a page render (requireCapability at the top of
// every page). Two distinct causes share that one error message:
//   a) the session REALLY expired (tab left open overnight — Supabase Auth
//      default is 1 hour of inactivity, refreshable on activity) — in that
//      case the correct behaviour is /login, NOT this screen, because
//      "Try again" can never succeed and "Reload page" just comes back here
//      (the proxy only bounces /dashboard requests server-side when the
//      session cookie is already gone at request time — it can't help a
//      cached client render that just failed);
//   b) a transient Supabase auth-server blip while still signed in —
//      getUser() rejected once; Try again genuinely works there.
// The boundary can't tell them apart on its own, so it now probes
// /api/auth-check (deliberately session-only — just supabase.auth.getUser(),
// no employee fan-out) exactly once:
//   - probe says signed OUT → redirect() to /login?redirectTo=<this page>
//     (same convention the proxy and every other signed-out bounce in this
//     app uses) — no dead-end screen for case (a) ever again;
//   - probe says still signed IN (or the probe itself fails) → show the
//     friendly Try-again screen as before, which is right for case (b).
// One more subtlety from the same autopsy: this screen must say "session
// expired" when it can't rule it out — the old copy said "it isn't
// something you did", which read as blaming the connection when the real
// cause was simply an expired login.
// ---------------------------------------------------------------------------
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [probing, setProbing] = useState(true);

  useEffect(() => {
    // Same reasoning as every .catch() added in layout.tsx this round:
    // never swallow the real error silently — it still needs to show up in
    // Vercel's function logs (searchable by digest) even though the user
    // only ever sees the friendly message below.
    console.error("[dashboard] segment error boundary caught:", error);

    let cancelled = false;
    // redirect:"manual" so a 30x from the auth proxy never lands as HTML in
    // a fetch body — we only care about the status code.
    fetch("/api/auth-check", { redirect: "manual", cache: "no-store" })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 401 || res.redirected) {
          // Case (a): really signed out. Send the user to login, preserving
          // where they were trying to go — same shape the proxy builds.
          const here = window.location.pathname + window.location.search;
          window.location.replace(`/login?redirectTo=${encodeURIComponent(here)}`);
          return; // full-page nav in flight; leave this screen up meanwhile
        }
        // 200 (or anything else): still signed in → the failure was (b), or
        // something non-auth entirely. The Try-again screen is correct.
        setProbing(false);
      })
      .catch(() => {
        // Probe itself failed (offline etc.) — never block the friendly
        // screen on the probe; fall back to showing it.
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [error]);

  // While probing we render the same card (no flash), just with a quieter
  // caption instead of the buttons — probing takes one fast round-trip and
  // normally resolves to either an instant redirect to /login or the full
  // card within a moment.
  if (probing) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-amber-50/40 px-4">
        <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-6 text-center shadow-sm">
          <p className="text-3xl">⚠️</p>
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Something went wrong loading the dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">Checking your session…</p>
          {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-amber-50/40 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-6 text-center shadow-sm">
        <p className="text-3xl">⚠️</p>
        <h1 className="mt-3 text-lg font-semibold text-slate-800">Something went wrong loading the dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your session may have expired, or the server had a brief hiccup — neither is something you did wrong. Try
          again below; if it keeps happening, sign in again from the button below or let the team know.
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
            onClick={() => {
              const here = window.location.pathname + window.location.search;
              // replace (not assign) — the broken page has no business
              // staying in back-history; same lint-clean choice as the
              // probe path above.
              window.location.replace(`/login?redirectTo=${encodeURIComponent(here)}`);
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
