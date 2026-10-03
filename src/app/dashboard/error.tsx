"use client";

import { useEffect, useState } from "react";
import { CAPABILITY_INFO } from "@/lib/capability-info";

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
//
// 2026-10-03 — "koi koi page work nahi karte or id logout vala issue start
// ho jata hai": TWO more causes were landing on this same screen and both
// READ AS A LOGOUT to the user, which is exactly what they were reporting:
//   c) ForbiddenError — the signed-in role lacks the capability that page
//      calls requireCapability() for (deep links, in-page nav strips and
//      sub-reports are NOT capability-filtered the way sidebar tiles are).
//      In production Next redacts the thrown error's message, so the
//      boundary can't read "ForbiddenError" off `error` — instead it
//      re-derives WHICH capabilities this path needs (CAPABILITY_INFO
//      longest-prefix + the few known cross-module overrides below) and
//      asks /api/auth-check?capability=… — a 403 back means: still signed
//      in, just not allowed here → render a real Access Denied card with a
//      way HOME, never a sign-in prompt;
//   d) any other page/data error while signed in — the copy now says
//      plainly that you are still signed in (this is NOT a logout) and
//      offers Go Home alongside Try again, with Sign in demoted to a
//      quiet link so it can no longer be mistaken for the fix.
type Phase = "probing" | "denied" | "error";

// Pages whose required capability differs from what a longest-prefix
// CAPABILITY_INFO match would guess (requireAnyCapability pairs included —
// ANY of the listed codes passes, same rule the server uses).
const CAPABILITY_OVERRIDES: { prefix: string; codes: string[] }[] = [
  { prefix: "/dashboard/attendance/admin/salary-report", codes: ["salary_admin"] },
  { prefix: "/dashboard/attendance/admin/salary-details", codes: ["salary_admin"] },
  { prefix: "/dashboard/reports/finance-dashboard", codes: ["crm_dashboard"] },
  { prefix: "/dashboard/admin/departments", codes: ["employee_admin"] },
  { prefix: "/dashboard/credit-notes-register", codes: ["bill_payment", "doc_entry"] },
];

function requiredCapabilitiesFor(pathname: string): string[] | null {
  for (const o of CAPABILITY_OVERRIDES) {
    if (pathname === o.prefix || pathname.startsWith(o.prefix + "/")) return o.codes;
  }
  // Party ledger is gated bill_payment but lives under /dashboard/parties
  // (party_admin), and Team Directory accepts team_directory OR
  // employee_admin — both would be mis-guessed by prefix alone.
  if (/^\/dashboard\/parties\/[^/]+\/ledger(\/|$)/.test(pathname)) return ["bill_payment"];
  if (pathname === "/dashboard/team" || pathname.startsWith("/dashboard/team/")) {
    return ["team_directory", "employee_admin"];
  }
  // Longest-prefix over CAPABILITY_INFO; when several codes share the
  // winning href (attendance_admin/performance_admin,
  // courier_booking_shipment/courier_credentials_admin) all of them count,
  // mirroring the server's "any of these" evaluation.
  let bestHref = "";
  let codes: string[] = [];
  for (const c of CAPABILITY_INFO) {
    if (pathname === c.href || pathname.startsWith(c.href + "/")) {
      if (c.href.length > bestHref.length) {
        bestHref = c.href;
        codes = [c.code];
      } else if (c.href.length === bestHref.length && !codes.includes(c.code)) {
        codes.push(c.code);
      }
    }
  }
  return codes.length > 0 ? codes : null;
}

function moduleLabelFor(codes: string[]): { label: string; icon: string } {
  const info = CAPABILITY_INFO.find((c) => codes.includes(c.code));
  return info ? { label: info.label, icon: info.icon } : { label: codes.join(" / "), icon: "🔒" };
}

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [phase, setPhase] = useState<Phase>("probing");
  const [denied, setDenied] = useState<{ label: string; icon: string; roleName: string | null } | null>(null);

  useEffect(() => {
    // Same reasoning as every .catch() added in layout.tsx this round:
    // never swallow the real error silently — it still needs to show up in
    // Vercel's function logs (searchable by digest) even though the user
    // only ever sees the friendly message below.
    console.error("[dashboard] segment error boundary caught:", error);

    let cancelled = false;
    // redirect:"manual" so a 30x from the auth proxy never lands as HTML in
    // a fetch body — we only care about the status code.
    const here = window.location.pathname + window.location.search;
    const codes = requiredCapabilitiesFor(window.location.pathname);
    const probeUrl = codes ? `/api/auth-check?capability=${encodeURIComponent(codes.join(","))}` : "/api/auth-check";
    fetch(probeUrl, { redirect: "manual", cache: "no-store" })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 401 || res.redirected) {
          // Case (a): really signed out. Send the user to login, preserving
          // where they were trying to go — same shape the proxy builds.
          window.location.replace(`/login?redirectTo=${encodeURIComponent(here)}`);
          return; // full-page nav in flight; leave this screen up meanwhile
        }
        if (res.status === 403) {
          // Case (c): signed in, role just lacks this module's capability.
          const label = codes ? moduleLabelFor(codes) : { label: "this module", icon: "🔒" };
          res
            .json()
            .then((body: { roleName?: string }) => {
              if (cancelled) return;
              setDenied({ label: label.label, icon: label.icon, roleName: body?.roleName ?? null });
              setPhase("denied");
            })
            .catch(() => {
              if (cancelled) return;
              setDenied({ label: label.label, icon: label.icon, roleName: null });
              setPhase("denied");
            });
          return;
        }
        // 200 (or anything else): still signed in → the failure was (b) or
        // (d), or something non-auth entirely. The Try-again screen is
        // correct — with copy that says out loud it is NOT a logout.
        if (!cancelled) setPhase("error");
      })
      .catch(() => {
        // Probe itself failed (offline etc.) — never block the friendly
        // screen on the probe; fall back to showing it.
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [error]);

  if (phase === "denied" && denied) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-amber-50/40 px-4">
        <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-6 text-center shadow-sm">
          <p className="text-3xl">🔒</p>
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Access Denied — {denied.label}</h1>
          <p className="mt-2 text-sm text-slate-600">
            You are still signed in{denied.roleName ? ` (as ${denied.roleName})` : ""} — your role just doesn&apos;t have
            permission for {denied.icon} {denied.label}. This is not a logout. Ask your Admin to grant access from Roles
            &amp; Permissions, or go back to your work menu.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <a
              href="/dashboard"
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              🏠 Go to Home
            </a>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // While probing we render the same card (no flash), just with a quieter
  // caption instead of the buttons — probing takes one fast round-trip and
  // normally resolves to either an instant redirect to /login or the full
  // card within a moment.
  if (phase === "probing") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-amber-50/40 px-4">
        <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-6 text-center shadow-sm">
          <p className="text-3xl">⚠️</p>
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Something went wrong loading this page</h1>
          <p className="mt-2 text-sm text-slate-600">Checking your session and access…</p>
          {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-amber-50/40 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-6 text-center shadow-sm">
        <p className="text-3xl">⚠️</p>
        <h1 className="mt-3 text-lg font-semibold text-slate-800">This page couldn&apos;t load</h1>
        <p className="mt-2 text-sm text-slate-600">
          You are still signed in — this is a page error, not a logout. Try again below; if it keeps happening, go back
          to Home and open the page from the menu, or sign in again from the small link.
        </p>
        {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            🏠 Go to Home
          </a>
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => {
              const here = window.location.pathname + window.location.search;
              // replace (not assign) — the broken page has no business
              // staying in back-history; same lint-clean choice as the
              // probe path above.
              window.location.replace(`/login?redirectTo=${encodeURIComponent(here)}`);
            }}
            className="text-xs font-medium text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-600"
          >
            Still stuck? Sign in again
          </button>
        </div>
      </div>
    </div>
  );
}
