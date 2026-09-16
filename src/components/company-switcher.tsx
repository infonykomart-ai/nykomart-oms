"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { switchCompanyAction, type SwitchCompanyState } from "@/lib/auth/switch-company";

// Lives here, not in switch-company.ts: a "use server" file may only export
// async functions (every other export becomes a callable server reference),
// so a plain object export there crashes at runtime. See that file's header
// note. This is the only consumer.
const initialSwitchCompanyState: SwitchCompanyState = { success: false, error: null };

/**
 * Header dropdown for logins that work across more than one company (see
 * db/schema.sql's employee_company_access, added 2026-08-05 after the user
 * confirmed staff routinely switch companies from one login). Hidden
 * entirely for single-company logins — nothing to switch between.
 *
 * Bug fixes (2026-08-22, per owner's repeated "switcher still has problems"
 * reports):
 *  1. switchCompanyAction() used to fail completely silently when the
 *     requested company wasn't actually accessible. The action now always
 *     returns {success, error}; shown inline as `state.error` below.
 *  2. No pending state at all — a slow request looked identical to "did
 *     nothing". useActionState's own pending flag now disables the select
 *     and swaps its label to "Switching…" while the request is in flight.
 *
 * 3. (2026-08-25, live-debugged against the owner's own real session, 3
 *    rounds — see claude/company-switcher-root-cause-2026-08-25.md in the
 *    project for the full trail) Found and fixed a request-storm causing
 *    intermittent 503s (dashboard-sidebar.tsx's and dashboard/page.tsx's
 *    tile grids were both speculatively prefetching all ~20-30 module
 *    routes' full data on every load), added a "still switching" hint for
 *    when a switch is genuinely slow, and — the part that took 3 live
 *    rounds to actually pin down — rewrote how the dropdown's displayed
 *    value is derived.
 *
 *    Every earlier version here stored the picked value in its own
 *    useState (`selected`) and tried to resync it back to the truth
 *    (`currentCompanyId`) via various render-time conditions — on a clean
 *    error response, then unconditionally when `pending` finished. Both
 *    versions still went stale live: after a switch that took a bumpy path
 *    (a 503, a retry, a delayed revalidation), the dropdown would settle on
 *    some earlier value — not the old company, not the new one, not even a
 *    real company id in one observed case, which made the native <select>
 *    silently fall back to its first listed option. The header (driven
 *    fresh from the `currentCompanyId` prop every render, no stored copy)
 *    never had this problem — which is the actual fix: stop storing a
 *    "last known good" copy of the server value at all. `displayValue`
 *    below is a plain expression, recomputed every render directly from
 *    `currentCompanyId` whenever a switch isn't actively in flight, so
 *    there is no stale copy left to resync in the first place. The only
 *    thing kept in state is `optimisticPick` — the just-clicked value,
 *    used solely to label the single "Switching…" placeholder option while
 *    `pending` is true, and never read once it's false.
 *
 * 4. (2026-09-12 — round 6, owner reported "ye abhi bhi CASA ARRA par atak
 *    jata hai" months after round 5 shipped. Live-reproduced against the
 *    owner's real production session, with a `window.fetch` interceptor to
 *    capture the actual server responses — round 5's `key`-remount trick
 *    IS live and did NOT fix it.) Two distinct, independently-confirmed
 *    problems, both upstream of anything this component can fix by
 *    rewriting its own render logic again:
 *
 *    a) Reproduced live: after a successful switch (header correctly
 *       showing the NEW company, `currentCompanyId` prop correctly the new
 *       id — confirmed via a captured 200 response), this exact <select>
 *       node still rendered showing "CASA ARRA" — not the old company, not
 *       the new one, but always the FIRST option in the (alphabetically
 *       ordered) list. That is the browser's own documented fallback
 *       behaviour for a <select> whose `value` doesn't match any of its
 *       current <option>s at the moment the browser evaluates it — i.e.
 *       exactly the DOM-ordering race round 5's comment above already
 *       diagnosed, just surviving the key-remount instead of being fixed
 *       by it. Five rounds of ever-more-careful client-side state/DOM
 *       tricks on this same native <select> have now each found a new way
 *       to hit this same browser-level race — that's a sign the control
 *       itself (a value-bound native <select>, patched live by React on
 *       every switch) is the wrong tool here, not that the trick was
 *       almost right.
 *
 *    b) Also reproduced live, separately: the same POST this action
 *       responds on (switchCompanyAction's request, which also carries the
 *       revalidated /dashboard layout back in the same round trip)
 *       intermittently comes back as a bare HTTP 500 — captured console
 *       error was React's own #441, "An error occurred in the Server
 *       Components render" (production builds omit the message; see
 *       react.dev/errors/441). Because that 500 happens INSIDE the
 *       layout's own re-render (triggered by this action's
 *       revalidatePath), it doesn't fail gracefully into `state.error`
 *       like a normal denied-access response — the browser has no HTML to
 *       render at all and falls back to its own blank "This page couldn't
 *       load" interstitial, wiping the whole app shell (not just this
 *       dropdown). Whatever transient error is thrown in one of
 *       dashboard/layout.tsx's ~9 parallel Supabase queries during that
 *       re-render (see that file's own fix, same round, for the defensive
 *       change) is the trigger — not anything in this file.
 *
 *    The fix for (a): stop trusting client-side reconciliation for this
 *    control at all. On a confirmed-successful switch this component now
 *    forces a real full-page reload (`window.location.reload()`) instead
 *    of letting Next.js patch the existing React tree — a freshly parsed
 *    HTML document has the correct `selected` attribute burned into the
 *    <option> tag server-side before any client JS runs, so there is no
 *    DOM-ordering window left for the browser's value-vs-options race to
 *    land in. This trades one extra full navigation per switch (a rare,
 *    deliberate action — not a hot path) for eliminating the entire class
 *    of bug five rounds of client-state rewrites couldn't close.
 */
export function CompanySwitcher({
  companies,
  currentCompanyId,
}: {
  companies: { id: string; name: string }[];
  currentCompanyId: string;
}) {
  const [state, formAction, pending] = useActionState(switchCompanyAction, initialSwitchCompanyState);
  const router = useRouter();

  // Only ever read while `pending` is true (see `displayValue` below) — so
  // it never needs resyncing back to truth; there's no window where a
  // stale copy of it can be shown.
  const [optimisticPick, setOptimisticPick] = useState(currentCompanyId);

  // "Still switching" hint after 3s of no response — see 2026-08-25 note
  // above. A real timer/subscription is the canonical valid useEffect use;
  // it never calls setState synchronously in the effect body itself (only
  // inside the timer callback), so it doesn't trip the project's
  // set-state-in-effect lint rule.
  const [slow, setSlow] = useState(false);
  const [prevPending, setPrevPending] = useState(pending);
  if (pending !== prevPending) {
    setPrevPending(pending);
    if (!pending) setSlow(false);
  }
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  // 2026-09-12 (round 6, fix 4a above) — on a confirmed success, throw away
  // this whole client-rendered tree and let the browser parse a fresh
  // document instead of trusting React/Next to patch the existing one.
  // `state` is a new object every time the action settles, so this only
  // ever fires once per real success (never on the initial render, never
  // on a denied/error response) — a plain effect-on-value-change, same
  // pattern as the `slow` timer above, not a set-state-in-render.
  useEffect(() => {
    if (state.success) {
      window.location.reload();
    }
  }, [state.success]);

  if (companies.length <= 1) return null;

  // The one true displayed value. Not stored, not resynced — just derived
  // fresh every render: the optimistic pick while a switch is in flight,
  // otherwise always exactly `currentCompanyId` (this render's real prop,
  // the same value the header text above is built from). There is no
  // "previous" copy of this to go stale, which is the whole point.
  const displayValue = pending ? optimisticPick : currentCompanyId;

  return (
    <div className="relative">
      <form action={formAction}>
        <select
          // 2026-08-25 (round 5 — even the fully-derived `displayValue`
          // above still showed a stale value live, despite being computed
          // fresh from `currentCompanyId` every render with no stored copy
          // at all: verified via raw server HTML that the SERVER was
          // already correctly rendering the new company while this exact
          // <select> node in the live browser kept showing the old one).
          // That points at a DOM-level issue, not a React state/logic one
          // — likely how the browser applies a new `.value` to a <select>
          // in the same commit its <option> children also change (1
          // "Switching…" option swapping for the full 3-option list).
          // `key` forces React to throw away and recreate the DOM node
          // instead of patching it whenever the settled value changes, so
          // the correct value is always what the node is BORN with, never
          // something applied after the fact — sidesteps the ordering
          // issue entirely rather than trying to out-think it.
          key={pending ? `pending-${optimisticPick}` : currentCompanyId}
          name="company_id"
          value={displayValue}
          disabled={pending}
          onChange={(e) => {
            setOptimisticPick(e.target.value);
            e.currentTarget.form?.requestSubmit();
          }}
          className="max-w-[9.5rem] truncate rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-amber-500 disabled:cursor-wait disabled:opacity-60 md:max-w-none"
          aria-label="Switch company"
          aria-busy={pending}
        >
          {pending && <option value={optimisticPick}>Switching…</option>}
          {!pending &&
            companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </form>
      {slow && (
        <p
          role="status"
          className="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-md"
        >
          Still switching — the server is slow to respond right now. It
          usually finishes on its own in a few seconds; if this sits for a
          while,{" "}
          <button
            type="button"
            onClick={() => router.refresh()}
            className="font-semibold underline underline-offset-2"
          >
            click here to refresh
          </button>{" "}
          and check.
        </p>
      )}
      {state.error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 shadow-md"
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
