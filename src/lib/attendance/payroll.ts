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
  // 2026-10-17 — true when this day is ALSO the company's weekly off (or a
  // declared holiday) in the calendar, even though an explicit attendance
  // row made it Present/Late/Half Day. That combination is exactly "employee
  // ne Sunday/holiday par kaam kiya" and is what earns the extra day's pay
  // (see computeMonthlyPayroll below). Only set on worked days — a plain
  // Week Off/Holiday day has no extra pay.
  onWeeklyOff?: boolean;
  onHoliday?: boolean;
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
      const worked = status === "Present" || status === "Late" || status === "Half Day";
      results.push({
        date,
        category: status,
        leaveTypeId: row.leave_type_id ?? null,
        leaveUnpaid: row.leave_unpaid ?? false,
        onWeeklyOff: worked && weeklyOffDays.includes(istDayOfWeek(date)),
        onHoliday: worked && holidayDates.has(date),
      });
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
 * 2026-10-17 — "Sunday or company ke decide leave ka pay milega agar us din
 * koi employee work karta hai or present hota hai to usko extra milega" +
 * "agar employee mahine me leave nahi leta hai to usko us din ka extra pay
 * milega": the two EARNINGS this payroll round adds on top of the base
 * monthly salary. Kept separate from computeDeduction so the same figures
 * feed the on-screen preview and the payment action (via
 * computeMonthlyPayroll below — one formula, never two).
 *
 *   extraDutyDays   = Present/Late on a weekly-off or holiday (full day) +
 *                     Half Day on one of those days (0.5). This is the
 *                     "Sunday extra kaam" case the user described.
 *   unusedPaidLeaveDays = allowed_leaves_per_month minus the month's Leave
 *                     days, never below zero. Taking NO leave therefore
 *                     encashes the paid leave (1 day by default) instead of
 *                     silently losing it.
 */
export function summarizeExtraPayDays(days: DayResult[]): {
  extraDutyDays: number;
  workedWeeklyOffDays: number;
  workedHolidayDays: number;
  leaveTakenDays: number;
} {
  let extraDutyDays = 0;
  let workedWeeklyOffDays = 0;
  let workedHolidayDays = 0;
  let leaveTakenDays = 0;
  for (const d of days) {
    // ANY leave (paid or unpaid) means the employee did take leave — the
    // encashment only applies to a month with zero leave days.
    if (d.category === "Leave") leaveTakenDays++;
    if (!d.onWeeklyOff && !d.onHoliday) continue;
    const weight = d.category === "Half Day" ? 0.5 : 1;
    if (d.onWeeklyOff) {
      extraDutyDays += weight;
      workedWeeklyOffDays += weight;
    }
    if (d.onHoliday) {
      // A day that is both a weekly off and a holiday is one day's work, not
      // two — the employee was physically there once.
      if (!d.onWeeklyOff) {
        extraDutyDays += weight;
        workedHolidayDays += weight;
      }
    }
  }
  return { extraDutyDays, workedWeeklyOffDays, workedHolidayDays, leaveTakenDays };
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
  extraDutyDays = 0,
  unusedPaidLeaveDays = 0,
  manualDeductionDays = 0,
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
  // 2026-10-17 earnings — see summarizeExtraPayDays. Defaults to 0 so the
  // attendance-admin summary keeps its original numbers unchanged.
  extraDutyDays?: number;
  unusedPaidLeaveDays?: number;
  // A manual half-day/full-day deduction the salary admin chooses for one
  // employee/month ("kisi ka deduction karna ho halfday full day").
  manualDeductionDays?: number;
}) {
  const effectiveUntypedLeaveDays = untypedLeaveDays ?? counts.Leave;
  // Per-day rate is the calendar-day rate (monthly ÷ days in month), which
  // is what the user's own worked example uses: ₹15,000 for Sep 2026 (30
  // days) = ₹500/day, one extra Sunday = +₹500, no leave taken = +₹500,
  // one half day = −₹250 → ₹15,750.
  const perDayRate = monthlySalary / daysInThisMonth;
  const excessLeaveDays = Math.max(0, effectiveUntypedLeaveDays - allowedLeavesPerMonth);
  const deductedDays =
    counts.Absent +
    counts["Half Day"] * 0.5 +
    excessLeaveDays +
    unpaidTypedLeaveDays +
    Math.max(0, manualDeductionDays);
  const deductionAmount = Math.round(deductedDays * perDayRate * 100) / 100;
  const extraDutyPay = Math.round(Math.max(0, extraDutyDays) * perDayRate * 100) / 100;
  const noLeaveBonusPay = Math.round(Math.max(0, unusedPaidLeaveDays) * perDayRate * 100) / 100;
  const grossPay = Math.round((monthlySalary + extraDutyPay + noLeaveBonusPay) * 100) / 100;
  const netPay = Math.round((grossPay - deductionAmount) * 100) / 100;
  return { perDayRate, deductedDays, deductionAmount, extraDutyPay, noLeaveBonusPay, grossPay, netPay };
}

/**
 * The complete month calculation shared by the Salary page preview and the
 * "Pay Salary" server action — base salary + Sunday/holiday extra duty pay +
 * unused-paid-leave encashment − attendance/manual deductions.
 */
export function computeMonthlyPayroll({
  monthlySalary,
  allowedLeavesPerMonth,
  daysInThisMonth,
  days,
  manualDeductionDays = 0,
}: {
  monthlySalary: number;
  allowedLeavesPerMonth: number;
  daysInThisMonth: number;
  days: DayResult[];
  manualDeductionDays?: number;
}) {
  const counts = summarizeCategories(days);
  const leaveDetail = summarizeLeaveDetail(days);
  const extras = summarizeExtraPayDays(days);
  // The no-leave encashment is a MONTH-END reward: it can only be decided
  // once every day of the month has happened. `Future` days remaining means
  // the month is still in progress, so the preview shows 0 (and the payment
  // action, which runs after the month, computes it for real).
  const monthComplete = counts.Future === 0;
  const unusedPaidLeaveDays = monthComplete
    ? Math.max(0, allowedLeavesPerMonth - extras.leaveTakenDays)
    : 0;
  const deduction = computeDeduction({
    monthlySalary,
    allowedLeavesPerMonth,
    daysInThisMonth,
    counts,
    untypedLeaveDays: leaveDetail.untypedLeaveDays,
    unpaidTypedLeaveDays: leaveDetail.unpaidTypedLeaveDays,
    extraDutyDays: extras.extraDutyDays,
    unusedPaidLeaveDays,
    manualDeductionDays,
  });
  return { counts, leaveDetail, extras, unusedPaidLeaveDays, monthComplete, ...deduction };
}
