"use client";

// 2026-10-17 — "sellery edit delet, modify updte, last step tak ho ye sara":
// the Decide & Feed form could only ever ADD a version — a wrong figure or a
// mistyped date had no correction path at all, so the only fix was inserting
// yet another row (which is what made the whole system feel strange). This
// is the missing history: every decided version, editable in the same A4
// dialog used across Document Entry, and deletable.
import { useActionState, useState, useTransition } from "react";
import { A4Dialog } from "@/components/a4-dialog";
import { formatIST } from "@/lib/format-ist";
import { deleteSalaryVersion, updateSalaryVersion, type SimpleActionState } from "./actions";

export type SalaryHistoryRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  monthly_salary: number;
  allowed_leaves_per_month: number;
  effective_from: string;
  ctc_annual: number | null;
  employee_pf_amount_note?: string | null;
  /** employee_salary.created_at — when this version was entered. */
  created_at: string;
};

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function SalaryHistory({ rows }: { rows: SalaryHistoryRow[] }) {
  const [editing, setEditing] = useState<SalaryHistoryRow | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete(row: SalaryHistoryRow) {
    if (!window.confirm(`Delete ${row.employee_name}'s salary version effective ${row.effective_from}? Past paid months are unaffected.`)) {
      return;
    }
    setError(null);
    setDeleting(row.id);
    startTransition(async () => {
      const r = await deleteSalaryVersion(row.id);
      if (r.error) setError(r.error);
      setDeleting(null);
    });
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Salary History — Edit / Delete</h2>
      <p className="mb-3 text-xs text-slate-500">
        Every version ever decided, newest first. Editing a row corrects that decision in place; for a raise, use the
        form above with a NEW effective date so earlier months keep their old salary.
      </p>
      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-400">
              <th className="py-1 pr-3">Employee</th>
              <th className="px-2">Monthly Salary</th>
              <th className="px-2">Paid Leave/mo</th>
              <th className="px-2">Effective From</th>
              {/* 2026-10-19 — the effective date is a business date; this is
                  when the decision was actually entered. */}
              <th className="px-2">Entered</th>
              <th className="px-2">Structure</th>
              <th className="px-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-3 font-medium text-slate-800">{r.employee_name}</td>
                <td className="px-2">₹{r.monthly_salary.toLocaleString("en-IN")}</td>
                <td className="px-2">{r.allowed_leaves_per_month}</td>
                <td className="px-2">{r.effective_from}</td>
                <td className="whitespace-nowrap px-2 text-slate-500">{formatIST(r.created_at)}</td>
                <td className="px-2">{r.ctc_annual != null ? `CTC ₹${r.ctc_annual.toLocaleString("en-IN")}/yr` : "Flat"}</td>
                <td className="px-2 py-1.5 text-right">
                  <div className="inline-flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={isPending && deleting === r.id}
                      onClick={() => handleDelete(r)}
                      className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-center text-slate-400">
                  No salary decided yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <A4Dialog
          open
          onClose={() => setEditing(null)}
          title={`Edit Salary — ${editing.employee_name}`}
          subtitle={`Version effective ${editing.effective_from}. Existing paid months keep their snapshotted figures.`}
        >
          <EditForm row={editing} onDone={() => setEditing(null)} />
        </A4Dialog>
      )}
    </div>
  );
}

function EditForm({ row, onDone }: { row: SalaryHistoryRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateSalaryVersion, initialState);
  if (state.success) {
    return (
      <div className="space-y-3">
        <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">✓ Salary version updated.</p>
        <button type="button" onClick={onDone} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white">
          Close
        </button>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="employee_id" value={row.employee_id} />
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Monthly Salary *</label>
        <input
          name="monthly_salary"
          type="number"
          step="0.01"
          min="0"
          required
          defaultValue={row.monthly_salary}
          className={inputClass}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Paid Leaves / Month</label>
        <input
          name="allowed_leaves_per_month"
          type="number"
          step="0.5"
          min="0"
          defaultValue={row.allowed_leaves_per_month}
          className={inputClass}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Effective From *</label>
        <input name="effective_from" type="date" required defaultValue={row.effective_from} className={inputClass} />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save Changes"}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600">
          Cancel
        </button>
      </div>
    </form>
  );
}
