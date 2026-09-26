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
import { Pill, PRIORITY_TONE, tableWrapClass, tableClass, theadRowClass, thClass, tbodyRowClass, tdClass, emptyRowClass } from "./dashboard-ui";

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

  return (
    <div className={tableWrapClass}>
      <table className={tableClass}>
        <thead>
          <tr className={theadRowClass}>
            <th className={thClass}>Employee</th>
            <th className={thClass}>Pending</th>
            <th className={thClass}>In Progress</th>
            <th className={thClass}>Total</th>
            <th className={thClass}></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = expanded.has(g.employeeId);
            const total = g.pendingCount + g.inProgressCount;
            return (
              <Fragment key={g.employeeId}>
                <tr className={tbodyRowClass}>
                  <td className={`${tdClass} font-medium text-slate-800`}>{g.employeeName}</td>
                  <td className={tdClass}><Pill tone="amber">{g.pendingCount}</Pill></td>
                  <td className={tdClass}><Pill tone="sky">{g.inProgressCount}</Pill></td>
                  <td className={`${tdClass} font-semibold text-slate-700`}>{total}</td>
                  <td className={tdClass}>
                    <button
                      type="button"
                      onClick={() => toggle(g.employeeId)}
                      className="font-medium text-amber-700 hover:underline"
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
                          <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-800">{r.logDate}</span>
                              <span className="text-slate-400">[{r.category ?? "—"}]</span>
                              <Pill tone={r.workStatus === "In Progress" ? "sky" : "amber"}>{r.workStatus ?? "—"}</Pill>
                              <Pill tone={PRIORITY_TONE[r.priority] ?? "slate"}>{r.priority}</Pill>
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
          {groups.length === 0 && (
            <tr><td colSpan={5} className={emptyRowClass}>No pending or in-progress work for this team right now.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
