// 2026-08-11 (round 2): "MY RECENT REPORT ME DIN BHAR ME SUBMIT KI GYI
// REPORT DIKH JAYE" — a read-only list of every report row submitted today,
// separate from the editable Submit Report cards above (matches the legacy
// tool's own "My Recent Reports" panel). Server Component — no client
// interactivity needed, it's just a log.
import { formatISTTime, formatDuration, liveElapsedSeconds } from "@/lib/attendance/timer";

type ServerLog = {
  id: string;
  log_date: string;
  category: string | null;
  description: string | null;
  work_status: string | null;
  updated_at: string;
  timer_started_at: string | null;
  time_spent_seconds: number;
  carried_from_log_id: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-slate-100 text-slate-600",
  "In Progress": "bg-sky-100 text-sky-700",
  Completed: "bg-green-100 text-green-700",
  "Next Day Carry On": "bg-amber-100 text-amber-700",
};

export function RecentReportsList({ logs }: { logs: ServerLog[] }) {
  const nowMs = new Date().getTime();
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">📋 My Recent Reports — Today</h2>
      {logs.length === 0 && <p className="text-xs text-slate-400">Nothing submitted yet today.</p>}
      <div className="space-y-1.5">
        {logs.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-100 px-2.5 py-1.5 text-xs">
            <span className="text-slate-400">{formatISTTime(l.updated_at)}</span>
            <span className="font-medium text-slate-800">{l.category ?? "—"}</span>
            <span className="flex-1 truncate text-slate-600">{l.description || "—"}</span>
            {l.carried_from_log_id && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700">Carried</span>}
            <span className="text-slate-400">
              {formatDuration(liveElapsedSeconds({ timeSpentSeconds: l.time_spent_seconds, timerStartedAt: l.timer_started_at }, nowMs))}
            </span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_BADGE[l.work_status ?? ""] ?? "bg-slate-100 text-slate-500"}`}>
              {l.work_status ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
