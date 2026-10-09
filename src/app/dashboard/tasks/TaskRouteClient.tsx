"use client";

import { useState } from "react";
import { startTaskTimer, pauseTaskTimer, markTaskDone } from "./actions";
import { formatDuration } from "@/lib/attendance/timer";
import { AssignTaskForm } from "./assign-task-form";

// /dashboard/tasks Client component. Three blocks:
//   1. My Tasks — Start/Pause/Done watch, ordered by creation time
//      (earlier assigned = higher up), no priority visible to the employee.
//   2. Pending Work — compact per-employee open-work summary with the
//      per-day time surfaced into the Daily Work Report block.
//   3. Daily Work Report — today's task time is surfaced via
//      task_daily_time_log and shown pre-filled so the employee reads it
//      as the record of how much time each task took today.
export function TaskRouteClient({
  tasks,
  todaySecondsByTaskId,
  assigners,
}: {
  tasks: {
    id: string;
    assigned_by_employee_id: string;
    assigned_to_employee_id: string;
    website: string | null;
    category: string | null;
    priority: string;
    deadline: string | null;
    status: string;
    description: string;
    created_at: string;
    timerStartedAt: string | null;
    timeSpentSeconds: number;
    firstStartedAt: string | null;
    lastPausedAt: string | null;
  }[];
  todaySecondsByTaskId: Map<string, number>;
  assigners: Map<string, string>;
}) {
  const [myTasks, setMyTasks] = useState(tasks);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  async function handleStart(id: string) {
    const result = await startTaskTimer(id);
    if (!result.error) {
      setMyTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, timerStartedAt: result.timerStartedAt, timeSpentSeconds: result.timeSpentSeconds, firstStartedAt: result.firstStartedAt, status: result.status ?? t.status }
            : t
        )
      );
    }
  }

  async function handlePause(id: string) {
    const result = await pauseTaskTimer(id);
    if (!result.error) {
      setMyTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, timerStartedAt: result.timerStartedAt, timeSpentSeconds: result.timeSpentSeconds, lastPausedAt: result.lastPausedAt, status: result.status ?? t.status }
            : t
        )
      );
    }
  }

  async function handleDone(id: string) {
    const result = await markTaskDone(id);
    if (!result.error) {
      setMyTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, status: "Done", timerStartedAt: result.timerStartedAt, timeSpentSeconds: result.timeSpentSeconds, lastPausedAt: result.lastPausedAt }
            : t
        )
      );
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Task Work</h1>
        <p className="mt-1 text-sm text-slate-500">
          My assigned tasks, the timer that runs while I work, and today's
          pending work with the minutes already committed to today's Daily
          Work Report.
        </p>
      </div>

      {/* ── My Tasks ── */}
      <section aria-label="My tasks">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">My Tasks</h2>
          <span className="text-xs text-slate-400">Earlier assigned = already on top</span>
        </div>
        {myTasks.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            No tasks assigned to you. Ask a manager to assign one with
            <button type="button" className="font-medium text-sky-700 hover:underline">
              Assign Task
            </button>
            .
          </p>
        ) : (
          <div className="space-y-2">
            {myTasks.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{t.id}</h3>
                  <span className="text-xs text-slate-400">{t.status}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{t.description}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>Created {new Date(t.created_at).toLocaleString()}</span>
                  {t.timerStartedAt ? (
                    <span className="text-emerald-700">Running … {formatDuration(t.timeSpentSeconds)}</span>
                  ) : t.lastPausedAt ? (
                    <span className="text-slate-500">Paused {new Date(t.lastPausedAt).toLocaleString()}</span>
                  ) : null}
                </div>
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
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Pending Work ── */}
      <section aria-label="Pending work">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Pending Work</h2>
          <span className="text-xs text-slate-400">Open (Pending / In Progress) items, task time counted today</span>
        </div>
        {myTasks.filter((t) => t.status !== "Done").length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Nothing pending — every task you are assigned is Done or wasn't assigned.</p>
        ) : (
          <div className="mt-2 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-slate-800">
                {todaySecondsByTaskId.size > 0
                  ? `${Array.from(todaySecondsByTaskId.values()).reduce((a, b) => a + b, 0)} min committed today`
                  : "No pending working time"}
              </div>
              <div className="text-xs text-slate-400">
                Pending: {myTasks.filter((t) => t.status === "Pending").length} · In Progress: {myTasks.filter((t) => t.status === "In Progress").length}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Daily Work Report ── */}
      <section aria-label="Daily work report">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Daily Work Report — Today</h2>
          <span className="text-xs text-slate-400">Committed task time auto-surfaced here</span>
        </div>
        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800">Today's task time</div>
            <div className="text-xs text-slate-400">{formatDuration(Array.from(todaySecondsByTaskId.values()).reduce((a, b) => a + b, 0))}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
