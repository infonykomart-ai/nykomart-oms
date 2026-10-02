"use client";

// Add-Department form on the Department master — same useActionState
// pattern as holiday-form on the attendance admin screen.
import { useActionState } from "react";
import { createDepartment, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500";

export function DepartmentForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState(createDepartment, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="company_id" value={companyId} />
      <input
        name="name"
        required
        placeholder="Department name (e.g. Sales, Accounts, Warehouse)"
        className={`${inputClass} w-72`}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
      >
        {pending ? "Adding…" : "+ Add Department"}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      {state.success && <span className="text-xs text-green-600">✓ Added.</span>}
    </form>
  );
}
