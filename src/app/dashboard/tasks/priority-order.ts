// 2026-10-09 — Task Assignment Priority & Carry-Forward ordering, shared by
// BOTH task surfaces (/dashboard/tasks and the Attendance page's My Tasks)
// so the two can never disagree:
//
//   1. "Jab log mujhe ek se zyada task assign karein to priority list
//      banaye assignment ke order me — pehle wala upar" — within each
//      group, earlier assigned (created_at) comes first.
//   2. "Agar aaj task start kiya aur complete nahi hua to wo agle working
//      day ki priority list me SABSE UPAR aaye, naye assign hue task se
//      pehle" — an incomplete task carried over from a previous IST day
//      outranks everything assigned today, and both outrank Done tasks
//      (which sink to the bottom so the list reads as a to-do queue).
//
// A task counts as "carried forward" when it isn't Done and was assigned
// before today's IST calendar date — tasks are not date-scoped rows (they
// persist until Done/cancelled), so "carry forward" here means "stays
// visible AND gets bumped to the top", not a copied row.
//
// Pure functions (no "use client"/server boundary) so the same sort runs
// during SSR and on every client re-render after Start/Pause/Done.
import { istDateFromInstant, todayIST } from "@/lib/attendance/ist-date";

export type PriorityTaskRow = { status: string; created_at: string };

/** Incomplete AND assigned before today (IST) → carried over from a previous day. */
export function isCarriedForwardTask(row: PriorityTaskRow, todayStr: string = todayIST()): boolean {
  return row.status !== "Done" && istDateFromInstant(row.created_at) < todayStr;
}

/**
 * Rank groups: 0 = carried-forward incomplete, 1 = not-yet-started-or-today's
 * incomplete, 2 = Done. Ties inside a group break by created_at ascending
 * (earliest assigned first — requirement 1).
 */
export function sortTasksByPriority<T extends PriorityTaskRow>(
  rows: T[],
  todayStr: string = todayIST()
): T[] {
  const rank = (r: T): number => (r.status === "Done" ? 2 : isCarriedForwardTask(r, todayStr) ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at));
}
