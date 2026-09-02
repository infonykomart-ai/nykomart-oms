"use client";

// 2026-09-02: "pending work,next day carry on vala work sabhi employe ki
// sheet par dikhnae sath me admin ko bhi dikhe ki kiska kitna kaam baki
// hai" — before this, an employee's still-open (Pending / In Progress)
// Daily Work Report rows were only ever visible to that employee
// themselves (the Incomplete Work section on their own /dashboard/
// attendance page). Admin had no team-wide view of who has how much work
// still open. This panel is that view: a compact per-employee summary
// (Pending count / In Progress count), each row expandable to the actual
// list of open items — chosen over either a bare-summary-only or a
// full-detail-only view (per the owner's own pick when asked).
import { Fragment, useState } from "react";
import { formatDuration } from "@/lib/attendance/timer";

export type PendingWorkRow = {
  id: string;
  logDate: string;
  category: string | null;
  description: string | null;
  workStatus: string | null;
  priority: string;
  estimatedTimeMinutes: number | null;
};

export type PendingWorkGroup = {
  employeeId: string;
  employeeName: string;
  pendingCount: number;
  inProgressCount: number;
  rows: PendingWorkRow[];
};

const PRIORITY_BADGE: Record<string, string> = {
  Urgent: "bg-red-100 text-red-700",
  High: "bg-orange-100 text-orange-700",
  Medium: "bg-amber-100 text-amber-700",
  Low: "bg-slate-100 text-slate-500",
};

export function PendingWorkPanel({ groups }: { groups: PendingWorkGroup[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(employeeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  if (groups.length === 0) {
    return <p className="text-xs text-slate-400">No pending or in-progress work for this team right now.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-slate-400">
            <th className="py-1 pr-3">Employee</th>
            <th className="px-2">Pending</th>
            <th className="px-2">In Progress</th>
            <th className="px-2">Total</th>
            <th className="px-2"></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = expanded.has(g.employeeId);
            const total = g.pendingCount + g.inProgressCount;
            return (
              <Fragment key={g.employeeId}>
                <tr className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 font-medium text-slate-800">{g.employeeName}</td>
                  <td className="px-2 text-amber-700">{g.pendingCount}</td>
                  <td className="px-2 text-sky-700">{g.inProgressCount}</td>
                  <td className="px-2 font-semibold text-slate-700">{total}</td>
                  <td className="px-2">
                    <button
                      type="button"
                      onClick={() => toggle(g.employeeId)}
                      className="text-amber-700 hover:underline"
                    >
                      {isOpen ? "Hide ▲" : "Show ▼"}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t border-slate-50 bg-slate-50/60">
                    <td colSpan={5} className="px-3 py-2">
                      <div className="space-y-1.5">
                        {g.rows.map((r) => (
                          <div key={r.id} className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-800">{r.logDate}</span>
                              <span className="text-slate-400">[{r.category ?? "—"}]</span>
                              <span className={`rounded-full px-2 py-0.5 font-medium ${r.workStatus === "In Progress" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>
                                {r.workStatus ?? "—"}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 font-medium ${PRIORITY_BADGE[r.priority] ?? "bg-slate-100 text-slate-500"}`}>
                                {r.priority}
                              </span>
                              {r.estimatedTimeMinutes ? (
                                <span className="text-slate-400">Est {formatDuration(r.estimatedTimeMinutes * 60)}</span>
                              ) : null}
                            </div>
                            {r.description && <p className="mt-0.5 text-slate-600">{r.description}</p>}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
