"use client";

// "Tasks I Assigned" — read-only status view of tasks this employee handed
// out to others, with a Cancel option (only while still Pending/In
// Progress — a Done task is left alone, matching cancelTask's own
// server-side guard).
//
// 2026-08-11 (round 4): "jab vo us task par kaam kare to mujhe pata chal
// jaye ki vo mere dawara assign task par work kar raha hai" — the assigner
// (who may not have task_admin, so the company-wide Live Now panel isn't
// visible to them) now sees a live "🟢 Working now" badge + running timer
// on their own assigned-out tasks the moment the assignee hits Start,
// without needing a page refresh.
import { useEffect, useState, useTransition } from "react";
import { cancelTask } from "./actions";
import { liveElapsedSeconds, formatDuration } from "@/lib/attendance/timer";

export type AssignedTaskRow = {
  id: string;
  category: string | null;
  priority: string;
  status: string;
  description: string;
  deadline: string | null;
  assignedToName: string;
  timeSpentSeconds: number;
  timerStartedAt: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-slate-100 text-slate-600",
  "In Progress": "bg-sky-100 text-sky-700",
  Done: "bg-green-100 text-green-700",
};

export function AssignedByMeList({ tasks }: { tasks: AssignedTaskRow[] }) {
  const [rows, setRows] = useState(tasks);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(tasks);
  }, [tasks]);

  const anyRunning = rows.some((r) => r.timerStartedAt);
  const [nowMs, setNowMs] = useState(() => new Date().getTime());
  useEffect(() => {
    if (!anyRunning) return;
    const interval = setInterval(() => setNowMs(new Date().getTime()), 1000);
    return () => clearInterval(interval);
  }, [anyRunning]);

  if (rows.length === 0) return <p className="text-xs text-slate-400">You haven&apos;t assigned any tasks yet.</p>;

  return (
    <div className="space-y-1.5">
      {rows.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-100 px-2.5 py-1.5 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_BADGE[t.status] ?? "bg-slate-100 text-slate-500"}`}>{t.status}</span>
          <span className="font-medium text-slate-800">{t.assignedToName}</span>
          {t.category && <span className="text-slate-400">[{t.category}]</span>}
          <span className="flex-1 truncate text-slate-600">{t.description}</span>
          {t.deadline && <span className="text-slate-400">Due {t.deadline}</span>}
          {t.timerStartedAt && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
              🟢 Working now — {formatDuration(liveElapsedSeconds({ timeSpentSeconds: t.timeSpentSeconds, timerStartedAt: t.timerStartedAt }, nowMs))}
            </span>
          )}
          {t.status !== "Done" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await cancelTask(t.id);
                  if (result.success) setRows((prev) => prev.filter((r) => r.id !== t.id));
                })
              }
              className="text-rose-600 hover:underline disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
