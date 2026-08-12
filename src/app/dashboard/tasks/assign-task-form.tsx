"use client";

import { useActionState } from "react";
import { assignTask, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

export function AssignTaskForm({
  employees,
  websites,
}: {
  employees: { id: string; name: string; companyName: string }[];
  websites: string[];
}) {
  const [state, formAction, pending] = useActionState(assignTask, initialState);

  return (
    <form key={state.success ? "sent" : "idle"} action={formAction} className="grid grid-cols-1 gap-2 md:grid-cols-3">
      {state.error && <p className="col-span-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="col-span-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">✓ Task assigned.</p>}

      {/* 2026-08-11 (round 4): "koi bhi kisi ko assign kar sakta hai phir
          company chahe koi bhi ho" — this list spans every active employee
          across all 3 companies, not just ones the assigner has access to,
          so the company name is shown alongside each name for clarity. */}
      <select name="assigned_to_employee_id" required defaultValue="" className={inputClass}>
        <option value="" disabled>Assign To…</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>{e.name} — {e.companyName}</option>
        ))}
      </select>

      <input list="task-websites" name="website" placeholder="Website / Store (optional)" className={inputClass} />
      <datalist id="task-websites">
        {websites.map((w) => (
          <option key={w} value={w} />
        ))}
      </datalist>

      <input name="category" placeholder="Category (optional)" className={inputClass} />

      <select name="priority" defaultValue="Medium" className={inputClass}>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <input type="date" name="deadline" className={inputClass} />

      <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
        {pending ? "Assigning..." : "Assign Task"}
      </button>

      <div className="md:col-span-3">
        <textarea name="description" required rows={2} placeholder="Task description…" className={inputClass} />
      </div>
    </form>
  );
}
