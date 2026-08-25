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
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-amber-500 disabled:cursor-wait disabled:opacity-60"
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
