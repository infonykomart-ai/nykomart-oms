"use client";

// 2026-09-11 (Payroll Phase 3) — one employee's onboarding progress against
// the company's checklist template. A plain checkbox list; toggling calls
// toggleOnboardingItem directly (useTransition, same pattern as
// leave-approval-row.tsx's "Revoke" button), no form needed for a single
// boolean per row.
import { useState, useTransition } from "react";
import { toggleOnboardingItem } from "./actions";

export type ChecklistItemRow = { id: string; title: string };
export type ProgressRow = { checklist_item_id: string; completed_at: string | null };

export function EmployeeChecklistRow({
  employeeId,
  employeeName,
  active,
  items,
  progress,
}: {
  employeeId: string;
  employeeName: string;
  active: boolean;
  items: ChecklistItemRow[];
  progress: ProgressRow[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const completedAt = new Map(progress.map((p) => [p.checklist_item_id, p.completed_at]));
  const doneCount = items.filter((i) => completedAt.get(i.id)).length;

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <div>
          <span className={`text-sm font-semibold ${active ? "text-slate-800" : "text-slate-400"}`}>{employeeName}</span>
          {!active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Inactive</span>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            doneCount === items.length && items.length > 0 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {doneCount}/{items.length} done
        </span>
      </button>

      {open && (
        <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {items.map((item) => {
            const done = !!completedAt.get(item.id);
            return (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={done}
                  disabled={pending}
                  onChange={(e) => {
                    setPendingItemId(item.id);
                    const next = e.target.checked;
                    startTransition(async () => {
                      await toggleOnboardingItem(employeeId, item.id, next);
                    });
                  }}
                  className="h-4 w-4"
                />
                <span className={done ? "text-slate-500 line-through" : "text-slate-700"}>{item.title}</span>
                {pending && pendingItemId === item.id && <span className="text-xs text-slate-400">saving...</span>}
              </li>
            );
          })}
          {items.length === 0 && <li className="text-xs text-slate-400">No checklist items configured yet.</li>}
        </ul>
      )}
    </div>
  );
}
