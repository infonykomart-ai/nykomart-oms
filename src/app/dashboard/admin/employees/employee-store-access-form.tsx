"use client";

import { useActionState, useEffect } from "react";
import { updateEmployeeStoreAccess, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };

// "Store Access" inline panel — assigns/edits which store(s) an EXISTING
// employee is scoped to for the Store Ad Spend module (2026-08-08 ask: "AD
// SPEND VALI JO ENTRY HAI VO SIRF UTNI HI ENTRY DIKHNI CHAHIYE JIS BANDE KO
// JIS STORE PAR KAAM KAR RAHA HAI"). Same toggle-from-EmployeeRowActions
// pattern as the existing "Edit Details" / "Password Reset" panels. The 15
// employees created before this existed all need this backfilled here,
// same as the Employee Master fields did in the 2026-08-07 round.
export function EmployeeStoreAccessForm({
  employeeId,
  stores,
  currentStoreIds,
  onDone,
}: {
  employeeId: string;
  stores: { id: string; name: string; company_id: string }[];
  currentStoreIds: string[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateEmployeeStoreAccess, initialState);

  useEffect(() => {
    if (state.success) {
      const t = setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="employee_id" value={employeeId} />
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Saved successfully.</p>}

      <p className="text-xs text-slate-500">
        Only matters for Store Ad Spend. Finance/Higher Authority/MD/Admin see every store regardless — this is for
        scoping any other login down to just the store(s) they actually work on.
      </p>

      <div className="flex flex-wrap gap-2">
        {stores.map((s) => (
          <label key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name="store_access"
              value={s.id}
              defaultChecked={currentStoreIds.includes(s.id)}
              className="rounded border-slate-300"
            />
            {s.name}
          </label>
        ))}
        {stores.length === 0 && <p className="text-xs text-slate-400">No stores set up yet.</p>}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
