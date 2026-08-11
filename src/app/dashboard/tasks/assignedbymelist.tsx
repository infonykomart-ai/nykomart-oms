"use client";

// "Tasks I Assigned" — read-only status view of tasks this employee handed
// out to others, with a Cancel option (only while still Pending/In
// Progress — a Done task is left alone, matching cancelTask's own
// server-side guard).
import { useState, useTransition } from "react";
import { cancelTask } from "./actions";

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
