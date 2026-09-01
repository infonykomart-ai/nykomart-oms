"use client";

// 2026-09-01 — "Today's Work -> Carry Forward" (additive, on top of the
// existing Daily Work Report — see daily-report-form.tsx for where a task
// is actually added/edited; this section is purely a review/action list
// for whatever's still open). Owner's spec, verbatim: at end of day,
// automatically show every "Not Started" (= this table's existing
// "Pending" status — no separate value was added for this, see
// actions.ts's comment on why) or "In Progress" task here, with
// [✓ Complete Today] [→ Carry Forward] [Delete] actionable directly from
// this section — no navigating elsewhere.
//
// Carry Forward shows a small confirmation popup ("Carry this work to
// tomorrow?" + task name + Cancel/Carry to Tomorrow) before calling the
// server — the actual duplicate-prevention guard lives server-side
// (carryForwardDailyLog, backed by the existing partial unique index on
// carried_from_log_id), this popup is just the UX layer on top, per spec.
import { useState, useTransition } from "react";
import { carryForwardDailyLog, completeIncompleteWorkToday, deleteDailyLog } from "./actions";
import { formatDuration } from "@/lib/attendance/timer";

export type IncompleteLogRow = {
  id: string;
  category: string | null;
  description: string | null;
  workStatus: string; // "Pending" | "In Progress" (this section's own filter — see page.tsx)
  priority: string;
  estimatedTimeMinutes: number | null;
  timeSpentSeconds: number;
};

// "Not Started" is the owner's own wording for what this table already
// calls "Pending" — displayed here rather than renaming the underlying
// column value everywhere (Admin's Team Daily Work Log, Employee
// Performance, RecentReportsList, and the main form's own Work Status
// dropdown all already use "Pending" throughout).
function displayStatus(workStatus: string): string {
  return workStatus === "Pending" ? "Not Started" : workStatus;
}

const PRIORITY_BADGE: Record<string, string> = {
  Low: "bg-slate-100 text-slate-600",
  Medium: "bg-sky-100 text-sky-700",
  High: "bg-amber-100 text-amber-700",
  Urgent: "bg-red-100 text-red-700",
};

export function IncompleteWorkSection({ logs }: { logs: IncompleteLogRow[] }) {
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirmRow, setConfirmRow] = useState<IncompleteLogRow | null>(null);
  const [carriedNotice, setCarriedNotice] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const visibleLogs = logs.filter((l) => !removedIds.has(l.id));

  function withPending(id: string, fn: () => Promise<void>) {
    setPendingIds((prev) => new Set(prev).add(id));
    setRowErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    startTransition(async () => {
      await fn();
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }

  function handleCompleteToday(id: string) {
    withPending(id, async () => {
      const result = await completeIncompleteWorkToday(id);
      if (result.error) {
        setRowErrors((prev) => ({ ...prev, [id]: result.error as string }));
      } else {
        setRemovedIds((prev) => new Set(prev).add(id)); // now Completed+submitted — belongs in My Recent Reports, not here
      }
    });
  }

  function handleDelete(id: string) {
    withPending(id, async () => {
      const result = await deleteDailyLog(id);
      if (result.error) setRowErrors((prev) => ({ ...prev, [id]: result.error as string }));
      else setRemovedIds((prev) => new Set(prev).add(id));
    });
  }

  function handleConfirmCarryForward() {
    const row = confirmRow;
    if (!row) return;
    setConfirmRow(null);
    withPending(row.id, async () => {
      const result = await carryForwardDailyLog(row.id);
      if (result.error) {
        setRowErrors((prev) => ({ ...prev, [row.id]: result.error as string }));
      } else {
        setCarriedNotice((prev) => ({ ...prev, [row.id]: result.carriedToDate ?? "tomorrow" }));
        setRemovedIds((prev) => new Set(prev).add(row.id)); // original is now frozen/read-only in the Daily Work Report list above
      }
    });
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
      <h2 className="mb-1 text-sm font-semibold text-amber-900">🔄 Incomplete Work</h2>
      <p className="mb-3 text-xs text-amber-800/70">
        Today&apos;s tasks that are still Not Started or In Progress — finish, carry to tomorrow, or drop them right from here.
      </p>

      {visibleLogs.length === 0 ? (
        <p className="text-xs text-slate-400">Nothing incomplete right now — everything today is either Completed or already carried forward.</p>
      ) : (
        <div className="space-y-2">
          {visibleLogs.map((row) => {
            const expected = row.estimatedTimeMinutes ?? null;
            const spentMinutes = Math.round(row.timeSpentSeconds / 60);
            const remainingMinutes = expected !== null ? expected - spentMinutes : null;
            const rowPending = pendingIds.has(row.id);
            return (
              <div key={row.id} className="rounded-lg border border-amber-100 bg-white p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-800">{row.description || "—"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_BADGE[row.priority] ?? "bg-slate-100 text-slate-600"}`}>
                    {row.priority}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{displayStatus(row.workStatus)}</span>
                  {row.category && <span className="text-[11px] text-slate-400">[{row.category}]</span>}
                </div>
                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                  <span>Expected: {expected !== null ? formatDuration(expected * 60) : "—"}</span>
                  <span>Spent so far: {formatDuration(row.timeSpentSeconds)}</span>
                  <span>
                    Remaining:{" "}
                    {remainingMinutes === null
                      ? "—"
                      : remainingMinutes > 0
                        ? formatDuration(remainingMinutes * 60)
                        : remainingMinutes < 0
                          ? `Over by ${formatDuration(Math.abs(remainingMinutes) * 60)}`
                          : "0m"}
                  </span>
                </div>
                {rowErrors[row.id] && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-800">{rowErrors[row.id]}</p>}
                {carriedNotice[row.id] && (
                  <p className="mb-2 rounded bg-purple-50 px-2 py-1 text-[11px] text-purple-800">↪ Carried to {carriedNotice[row.id]}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={rowPending}
                    onClick={() => handleCompleteToday(row.id)}
                    className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ✓ Complete Today
                  </button>
                  <button
                    type="button"
                    disabled={rowPending}
                    onClick={() => setConfirmRow(row)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    → Carry Forward
                  </button>
                  <button
                    type="button"
                    disabled={rowPending}
                    onClick={() => handleDelete(row.id)}
                    className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Carry this work to tomorrow?</h3>
            <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{confirmRow.description || "—"}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRow(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleConfirmCarryForward}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Carry to Tomorrow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
