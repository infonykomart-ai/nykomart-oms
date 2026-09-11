// Attendance day-categorization + payroll deduction math — pure functions,
// shared by /dashboard/attendance/admin (team monthly summary) and
// /dashboard/salary (payroll report). No day-by-day row is required to
// exist for Holiday/Week Off/Absent — those are DERIVED at report time by
// diffing the calendar against holidays/weekly_off_days/attendance rows,
// so nothing needs a nightly cron job to pre-populate "Absent" rows for
// every non-punched working day.
import { datesInMonth, istDayOfWeek } from "./ist-date";

export type DayCategory = "Holiday" | "Week Off" | "Present" | "Late" | "Half Day" | "Leave" | "Absent" | "Future";

export type DayResult = {
  date: string;
  category: DayCategory;
  // 2026-09-11 (Payroll Phase 2): only meaningful when category === "Leave".
  // leaveTypeId undefined/null = an untyped Leave day, governed by the
  // original flat allowed_leaves_per_month pool exactly as before this
  // round. leaveUnpaid is the paid/unpaid decision made ONCE at approval
  // time (see decideLeaveRequest in leave/actions.ts) — never recomputed
  // here, just carried through.
  leaveTypeId?: string | null;
  leaveUnpaid?: boolean;
};

export function categorizeMonth({
  year,
  month,
  weeklyOffDays,
  holidayDates,
  attendanceByDate,
  todayStr,
  joinDate,
}: {
  year: number;
  month: number; // 1-12
  weeklyOffDays: number[];
  holidayDates: Set<string>;
  attendanceByDate: Map<string, { status: string | null; leave_type_id?: string | null; leave_unpaid?: boolean | null }>;
  todayStr: string; // "YYYY-MM-DD" IST today — days after this are "Future", not Absent
  joinDate?: string | null; // date_of_joining — days before this are excluded entirely (not counted either way)
}): DayResult[] {
  const results: DayResult[] = [];
  for (const date of datesInMonth(year, month)) {
    if (joinDate && date < joinDate) continue;
    if (date > todayStr) {
      results.push({ date, category: "Future" });
      continue;
    }
    const row = attendanceByDate.get(date);
    if (row?.status) {
      // An explicit attendance row always wins over the derived weekly-off/
      // holiday guess — e.g. someone who actually punched in on their
      // weekly-off day is Present that day, not Week Off.
      const status = row.status as DayCategory;
      results.push({ date, category: status, leaveTypeId: row.leave_type_id ?? null, leaveUnpaid: row.leave_unpaid ?? false });
      continue;
    }
    if (holidayDates.has(date)) {
      results.push({ date, category: "Holiday" });
      continue;
    }
    if (weeklyOffDays.includes(istDayOfWeek(date))) {
      results.push({ date, category: "Week Off" });
      continue;
    }
    // A working day, in the past or today, with no attendance row at all.
    results.push({ date, category: "Absent" });
  }
  return results;
}

export function summarizeCategories(days: DayResult[]): Record<DayCategory, number> {
  const counts: Record<DayCategory, number> = {
    Holiday: 0,
    "Week Off": 0,
    Present: 0,
    Late: 0,
    "Half Day": 0,
    Leave: 0,
    Absent: 0,
    Future: 0,
  };
  for (const d of days) counts[d.category]++;
  return counts;
}

/**
 * 2026-09-11 (Payroll Phase 2): splits a month's Leave days into the three
 * buckets computeDeduction now cares about separately. Nothing calls this
 * unless it wants leave-type-aware deduction — the default computeDeduction
 * call (untypedLeaveDays omitted) treats every Leave day as untyped, the
 * exact pre-Phase-2 behavior.
 */
export type LeaveDetail = {
  untypedLeaveDays: number; // no leave_type_id — governed by the original flat allowed_leaves_per_month pool, unchanged
  unpaidTypedLeaveDays: number; // has a leave_type_id AND was decided unpaid at approval time — always deducted
  paidTypedLeaveDays: number; // has a leave_type_id AND was decided paid at approval time — free, already covered by that type's balance
};

export function summarizeLeaveDetail(days: DayResult[]): LeaveDetail {
  let untypedLeaveDays = 0;
  let unpaidTypedLeaveDays = 0;
  let paidTypedLeaveDays = 0;
  for (const d of days) {
    if (d.category !== "Leave") continue;
    if (!d.leaveTypeId) {
      untypedLeaveDays++;
    } else if (d.leaveUnpaid) {
      unpaidTypedLeaveDays++;
    } else {
      paidTypedLeaveDays++;
    }
  }
  return { untypedLeaveDays, unpaidTypedLeaveDays, paidTypedLeaveDays };
}

/**
 * Deduction convention (a common/standard Indian-payroll default, NOT a
 * verified copy of this company's actual written policy — flagged in the
 * UI too, and easy to change here if their real policy differs):
 *   - per-day rate = monthly_salary / calendar days in that month
 *   - every Absent day is deducted at that rate (unauthorized, no record)
 *   - UNTYPED Leave days beyond allowed_leaves_per_month are ALSO deducted
 *     at that rate (leave within the allowance is free); untyped Leave
 *     days within the allowance cost nothing. This is the original,
 *     unchanged behavior for any company that hasn't set up leave types.
 *   - TYPED Leave days (governed by a real leave_types balance — see
 *     src/lib/attendance/leave-balance.ts) never touch the flat monthly
 *     allowance at all: a day already decided PAID at approval time costs
 *     nothing here (it was already "spent" against that leave type's own
 *     balance), and a day decided UNPAID is always deducted, regardless of
 *     how much of the flat allowance is left.
 *   - Half Day counts as 0.5 of a deducted day, applied the same way as
 *     Absent (always counts, doesn't draw from any leave allowance)
 *   - Holiday, Week Off, Present, Late never cost anything (Late is a
 *     timing flag, not an absence)
 */
export function computeDeduction({
  monthlySalary,
  allowedLeavesPerMonth,
  daysInThisMonth,
  counts,
  untypedLeaveDays,
  unpaidTypedLeaveDays = 0,
}: {
  monthlySalary: number;
  allowedLeavesPerMonth: number;
  daysInThisMonth: number;
  counts: Record<DayCategory, number>;
  // Defaults to counts.Leave (every Leave day treated as untyped) so any
  // caller not yet updated for Phase 2 reproduces EXACTLY the pre-Phase-2
  // deduction figure — no behavior change unless a caller explicitly
  // passes leave-type-aware counts (see summarizeLeaveDetail above).
  untypedLeaveDays?: number;
  unpaidTypedLeaveDays?: number;
}) {
  const effectiveUntypedLeaveDays = untypedLeaveDays ?? counts.Leave;
  const perDayRate = monthlySalary / daysInThisMonth;
  const excessLeaveDays = Math.max(0, effectiveUntypedLeaveDays - allowedLeavesPerMonth);
  const deductedDays = counts.Absent + counts["Half Day"] * 0.5 + excessLeaveDays + unpaidTypedLeaveDays;
  const deductionAmount = Math.round(deductedDays * perDayRate * 100) / 100;
  const netPay = Math.round((monthlySalary - deductionAmount) * 100) / 100;
  return { perDayRate, deductedDays, deductionAmount, netPay };
}
