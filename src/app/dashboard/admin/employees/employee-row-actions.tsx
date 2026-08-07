"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { setEmployeeActive, resetEmployeePassword, type SimpleActionState } from "./actions";
import { EmployeeDetailsForm, type EmployeeDetails } from "./employee-details-form";

const initialResetState: SimpleActionState = { error: null, success: false };

export function EmployeeRowActions({ employeeId, active, details }: { employeeId: string; active: boolean; details: EmployeeDetails }) {
  const [isPending, startTransition] = useTransition();
  const [resetOpen, setResetOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await setEmployeeActive(employeeId, !active);
            })
          }
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
            active
              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
          }`}
        >
          {active ? "Deactivate" : "Activate"}
        </button>
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
        >
          Edit Details
        </button>
        <button
          type="button"
          onClick={() => setResetOpen((v) => !v)}
          className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Password Reset
        </button>
      </div>
      {resetOpen && <ResetPasswordInline employeeId={employeeId} onDone={() => setResetOpen(false)} />}
      {detailsOpen && <EmployeeDetailsForm employee={details} onDone={() => setDetailsOpen(false)} />}
    </div>
  );
}

function ResetPasswordInline({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(resetEmployeePassword, initialResetState);

  useEffect(() => {
    if (state.success) {
      const t = setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="flex w-full items-center gap-2 pt-1">
      <input type="hidden" name="employee_id" value={employeeId} />
      <input
        name="password"
        minLength={8}
        required
        placeholder="Naya password (8+ chars)"
        className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-amber-500"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
      >
        Save
      </button>
      {state.success && <span className="text-xs text-green-700">✓ Updated</span>}
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
