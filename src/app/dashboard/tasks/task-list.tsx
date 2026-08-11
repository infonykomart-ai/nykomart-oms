"use client";

// "My Tasks" — tasks assigned TO the signed-in employee, with the same
// live Start/Pause watch as the Daily Work Report (see
// src/lib/attendance/timer.ts), matching the legacy tool's per-task ▶
// Start / ⏸ Pause / ✔ Done buttons + live elapsed-time display.
import { useEffect, useState } from "react";
import { startTaskTimer, pauseTaskTimer, markTaskDone } from "./actions";
import { liveElapsedSeconds, formatDuration, formatISTTime } from "@/lib/attendance/timer";

export type TaskRow = {
  id: string;
  website: string | null;
  category: string | null;
  priority: string;
  deadline: string | null;
  status: string;
  description: string;
  created_at: string;
  assignedByName: string;
  timerStartedAt: string | null;
  timeSpentSeconds: number;
  firstStartedAt: string | null;
  lastPausedAt: string | null;
};

const PRIORITY_BADGE: Record<string, string> = {
  Low: "bg-slate-100 text-slate-500",
  Medium: "bg-sky-100 text-sky-700",
  High: "bg-amber-100 text-amber-700",
  Urgent: "bg-red-100 text-red-700",
};
const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-slate-100 text-slate-600",
  "In Progress": "bg-sky-100 text-sky-700",
  Done: "bg-green-100 text-green-700",
};

export function TaskList({ tasks }: { tasks: TaskRow[] }) {
  const [rows, setRows] = useState(tasks);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    // Re-sync local rows whenever the server sends fresh tasks (e.g. after
    // a revalidatePath from another tab/device) — this component's own
    // Start/Pause handlers already update `rows` optimistically, this just
    // keeps it from going stale relative to the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(tasks);
  }, [tasks]);

  const anyRunning = rows.some((r) => r.timerStartedAt);
  useEffect(() => {
    if (!anyRunning) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [anyRunning]);

  function withPending<T>(id: string, fn: () => Promise<T>): Promise<T> {
    setPendingIds((prev) => new Set(prev).add(id));
    return fn().finally(() => setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    }));
  }

  async function handleStart(id: string) {
    const result = await withPending(id, () => startTaskTimer(id));
    if (!result.error) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, timerStartedAt: result.timerStartedAt, timeSpentSeconds: result.timeSpentSeconds, firstStartedAt: result.firstStartedAt, status: result.status ?? r.status } : r)));
    }
  }
  async function handlePause(id: string) {
    const result = await withPending(id, () => pauseTaskTimer(id));
    if (!result.error) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, timerStartedAt: result.timerStartedAt, timeSpentSeconds: result.timeSpentSeconds, lastPausedAt: result.lastPausedAt } : r)));
    }
  }
  async function handleDone(id: string) {
    const result = await withPending(id, () => markTaskDone(id));
    if (!result.error) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, status: "Done", timerStartedAt: result.timerStartedAt, timeSpentSeconds: result.timeSpentSeconds, lastPausedAt: result.lastPausedAt }
            : r
        )
      );
    }
  }

  if (rows.length === 0) return <p className="text-xs text-slate-400">No tasks assigned to you.</p>;

  return (
    <div className="space-y-2">
      {rows.map((t) => (
        <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-medium ${PRIORITY_BADGE[t.priority] ?? "bg-slate-100 text-slate-500"}`}>{t.priority}</span>
                <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_BADGE[t.status] ?? "bg-slate-100 text-slate-500"}`}>{t.status}</span>
                {t.category && <span className="text-slate-400">[{t.category}]</span>}
                {t.website && <span className="text-slate-400">🌐 {t.website}</span>}
                {t.deadline && <span className="text-slate-400">Due {t.deadline}</span>}
              </div>
              <p className="mt-1 text-sm text-slate-800">{t.description}</p>
              <p className="mt-0.5 text-xs text-slate-400">From {t.assignedByName}</p>
            </div>
            <div className="flex flex-col items-end gap-1 text-xs">
              <div className="font-semibold text-amber-800">
                {formatDuration(liveElapsedSeconds({ timeSpentSeconds: t.timeSpentSeconds, timerStartedAt: t.timerStartedAt }, nowMs))}
              </div>
              <div className="text-slate-400">
                {formatISTTime(t.firstStartedAt)} → {t.timerStartedAt ? "Running…" : formatISTTime(t.lastPausedAt)}
              </div>
            </div>
          </div>
          {t.status !== "Done" && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={!!t.timerStartedAt || pendingIds.has(t.id)}
                onClick={() => handleStart(t.id)}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ▶ Start
              </button>
              <button
                type="button"
                disabled={!t.timerStartedAt || pendingIds.has(t.id)}
                onClick={() => handlePause(t.id)}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ⏸ Pause
              </button>
              <button
                type="button"
                disabled={pendingIds.has(t.id)}
                onClick={() => handleDone(t.id)}
                className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ✔ Done
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
