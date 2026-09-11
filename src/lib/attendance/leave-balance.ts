// src/lib/attendance/leave-balance.ts
//
// 2026-09-11 — Phase 2 of the Payroll & HR build: real per-employee leave
// balances for the leave_types configured in
// db/2026-09-11-leave-types-and-balances.sql. Pure functions only (no DB
// access here) — same split as payroll.ts, so this is reused identically by
// the employee Leave page (today's balance), the MD/Admin Leave Approvals
// page (every employee's balance), and decideLeaveRequest's approve-time
// allocation (leave/actions.ts).
//
// Accrual convention (current published/common default, NOT a verified
// copy of this company's actual leave policy — same honest-caveat pattern
// as src/lib/attendance/statutory.ts, flagged in the UI too):
//   - 'Upfront' leave types (e.g. Earned/Privilege Leave): the full
//     annual_accrual_days becomes available the moment the employee is
//     active in that leave year (their date_of_joining, if it falls later
//     than Jan 1 of that year).
//   - 'Monthly' leave types (e.g. Casual/Sick Leave): annual_accrual_days
//     ÷ 12 becomes available at the START of each calendar month the
//     employee is active for, so joining any day in a month grants that
//     whole month's share immediately (a simple, common convention — some
//     companies instead require the full month to elapse first; easy to
//     change here if this company's real written policy differs).
//   - Balance = accrued-to-date + SUM(leave_balance_adjustments) − already-
//     used PAID days of that type this leave year. Never a stored/synced
//     counter — always live-derived from real rows, same "durable ledger,
//     not a mutable counter" philosophy as employee_advances.

export type LeaveTypeAccrual = {
  annual_accrual_days: number;
  accrual_frequency: "Monthly" | "Upfront";
};

function monthsElapsedInclusive(fromDateStr: string, toDateStr: string): number {
  const [fy, fm] = fromDateStr.split("-").map(Number);
  const [ty, tm] = toDateStr.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Days accrued for one leave type, for one employee, as of a given date —
 * a pure function of the leave type's own rule, the leave year, the
 * employee's join date (if it falls inside that year), and the "as of"
 * date. Does not know about adjustments or already-used days — see
 * computeLeaveBalance for the full picture.
 */
export function computeAccruedToDate({
  leaveType,
  leaveYear,
  asOfDateStr,
  joinDate,
}: {
  leaveType: LeaveTypeAccrual;
  leaveYear: number;
  asOfDateStr: string; // "YYYY-MM-DD"
  joinDate?: string | null; // employee's date_of_joining — undefined/null = already active before this leave year
}): number {
  const yearStart = `${leaveYear}-01-01`;
  const yearEnd = `${leaveYear}-12-31`;
  const effectiveStart = joinDate && joinDate > yearStart ? joinDate : yearStart;
  if (asOfDateStr < effectiveStart) return 0; // not active yet this leave year
  const cappedAsOf = asOfDateStr > yearEnd ? yearEnd : asOfDateStr;

  if (leaveType.accrual_frequency === "Upfront") {
    return leaveType.annual_accrual_days;
  }

  // 'Monthly' — 1/12th per elapsed calendar month, counting the starting
  // month immediately (see convention note above), capped at the full
  // annual figure (12 months).
  const months = Math.max(0, Math.min(12, monthsElapsedInclusive(effectiveStart, cappedAsOf)));
  const perMonth = leaveType.annual_accrual_days / 12;
  return Math.round(perMonth * months * 10) / 10;
}

export type LeaveBalanceInput = {
  leaveType: LeaveTypeAccrual;
  leaveYear: number;
  asOfDateStr: string;
  joinDate?: string | null;
  adjustmentDaysTotal: number; // SUM(leave_balance_adjustments.adjustment_days) for (employee, leaveType, leaveYear)
  usedDays: number; // already-approved+paid "Leave" days of this type, this leave year (from attendance)
};

/** Live balance for one (employee, leave type, leave year) — see the accrual convention note above. */
export function computeLeaveBalance({ leaveType, leaveYear, asOfDateStr, joinDate, adjustmentDaysTotal, usedDays }: LeaveBalanceInput): number {
  const accrued = computeAccruedToDate({ leaveType, leaveYear, asOfDateStr, joinDate });
  return Math.round((accrued + adjustmentDaysTotal - usedDays) * 10) / 10;
}

export type LeaveDayAllocation = { date: string; unpaid: boolean };

/**
 * Decides, ONCE (at approval time — never recomputed later, so an
 * already-run payslip never silently changes if the leave type's rules
 * change afterward), which days of an approved leave request are paid
 * (drawn from the real balance) vs unpaid (deducted in payroll regardless
 * of the flat monthly allowance) — walking the request's dates in
 * chronological order against the balance available immediately BEFORE
 * this request, day by day (so a request that starts mid-month can still
 * pick up next month's accrual partway through it).
 *
 * `dates` must already be pre-filtered to exclude Holiday/Week-Off days
 * (those never touch the balance at all — see decideLeaveRequest) and must
 * all fall within the SAME leaveYear (split by calendar year before
 * calling this, for a request that crosses a Dec 31 → Jan 1 boundary).
 */
export function allocateLeaveDays({
  dates,
  leaveType,
  leaveYear,
  joinDate,
  adjustmentDaysTotal,
  usedDaysBeforeThisRequest,
}: {
  dates: string[]; // ascending, all within leaveYear
  leaveType: LeaveTypeAccrual & { paid: boolean };
  leaveYear: number;
  joinDate?: string | null;
  adjustmentDaysTotal: number;
  usedDaysBeforeThisRequest: number;
}): LeaveDayAllocation[] {
  if (!leaveType.paid) {
    // An unpaid-by-design leave type (e.g. Leave Without Pay) — every day
    // is unpaid regardless of balance, and none of it draws the balance
    // down (there's nothing meaningful to draw down against).
    return dates.map((date) => ({ date, unpaid: true }));
  }
  let consumed = usedDaysBeforeThisRequest;
  const result: LeaveDayAllocation[] = [];
  for (const date of dates) {
    const accrued = computeAccruedToDate({ leaveType, leaveYear, asOfDateStr: date, joinDate });
    const available = accrued + adjustmentDaysTotal - consumed;
    const unpaid = available < 1;
    result.push({ date, unpaid });
    if (!unpaid) consumed += 1;
  }
  return result;
}
