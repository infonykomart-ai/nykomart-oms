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
 *     requested company wasn't actually accessible — the <select> is
 *     uncontrolled, so nothing here ever reset it, and the only visible
 *     symptom was the page eventually looking like the switch "didn't
 *     take". The action now always returns {success, error}; on error we
 *     show it inline AND snap the dropdown back to the real current
 *     company (it can't be trusted to revert itself — see `selected`
 *     below).
 *  2. No pending state at all — a slow request looked identical to "did
 *     nothing". useActionState's own pending flag now disables the select
 *     and swaps its label to "Switching…" while the request is in flight.
 *
 * 3. (2026-08-25, live-debugged against the owner's own real session after
 *    another "switch abhi bhi problem kar raha hai" report) The dashboard
 *    sidebar's ~30 tiles were all speculatively prefetching their full page
 *    data on every load (see dashboard-sidebar.tsx), which occasionally
 *    swamps the deployment and makes THIS action's own POST 503 along with
 *    everything else. It still finishes correctly a few seconds later once
 *    the burst clears, but with zero feedback that was indistinguishable
 *    from "broken" — the header/company mismatch the owner screenshotted
 *    was this: the dropdown sitting on the picked value while the real
 *    switch was still (successfully, just slowly) in flight. Fixed the
 *    prefetch storm at the source, and added a "still switching" hint here
 *    with a one-click refresh so a slow response no longer reads as a dead
 *    one.
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

  // 2026-08-25: "switch abhi bhi problem kar raha hai" — live-debugged with
  // the owner's own browser session. Root cause: the dashboard sidebar's
  // ~30 tiles were all prefetching their full page data on every load (see
  // dashboard-sidebar.tsx's 2026-08-25 note), which occasionally causes the
  // switch action's own POST to get caught in that self-inflicted burst and
  // 503. It usually still completes a few seconds later once the burst
  // clears — Next re-fetches the layout via revalidatePath() regardless —
  // but until now the dropdown just sat on "Switching…" with zero
  // indication anything was still happening, which reads as "broken" long
  // before it actually is. This is a genuine side effect (a wall-clock
  // timer), not state derived from props, so a plain useEffect is the
  // correct tool here per the project's own render-time-adjustment rule.
  const [slow, setSlow] = useState(false);
  const [prevPending, setPrevPending] = useState(pending);
  if (pending !== prevPending) {
    setPrevPending(pending);
    if (!pending) setSlow(false);
  }
  useEffect(() => {
    // Effect body only starts/clears a timer (a real external subscription,
    // the canonical valid useEffect use) — it never calls setState directly
    // in the body itself; the reset-to-false above happens at render time
    // instead, same convention as `selected`'s reset further down.
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  // The <select> has to be controlled: on a denied/failed switch the
  // employee's real currentCompanyId prop doesn't change (the cookie was
  // never set), so nothing forces the DOM back to it on its own — it would
  // just sit on whatever the employee picked, looking like the switch
  // silently "worked" until something else reloads the page.
  //
  // Reset it during render rather than in a useEffect (React's own
  // recommended "adjusting state when a prop changes" pattern —
  // https://react.dev/learn/you-might-not-need-an-effect — and this
  // project's lint rules forbid setState-in-effect anyway): track what
  // currentCompanyId/state were last rendered with, and if either moved,
  // resync `selected` right here before paint instead of one render later.
  const [selected, setSelected] = useState(currentCompanyId);
  const [prevCompanyId, setPrevCompanyId] = useState(currentCompanyId);
  const [prevState, setPrevState] = useState(state);

  if (currentCompanyId !== prevCompanyId) {
    setPrevCompanyId(currentCompanyId);
    setSelected(currentCompanyId);
  }
  if (state !== prevState) {
    setPrevState(state);
    if (state.error) setSelected(currentCompanyId);
  }

  if (companies.length <= 1) return null;

  return (
    <div className="relative">
      <form action={formAction}>
        <select
          name="company_id"
          value={selected}
          disabled={pending}
          onChange={(e) => {
            setSelected(e.target.value);
            e.currentTarget.form?.requestSubmit();
          }}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-amber-500 disabled:cursor-wait disabled:opacity-60"
          aria-label="Switch company"
          aria-busy={pending}
        >
          {pending && <option value={selected}>Switching…</option>}
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
