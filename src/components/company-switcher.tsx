"use client";

import { useActionState, useState } from "react";
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
 */
export function CompanySwitcher({
  companies,
  currentCompanyId,
}: {
  companies: { id: string; name: string }[];
  currentCompanyId: string;
}) {
  const [state, formAction, pending] = useActionState(switchCompanyAction, initialSwitchCompanyState);

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
