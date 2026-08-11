// Attendance day-categorization + payroll deduction math — pure functions,
// shared by /dashboard/attendance/admin (team monthly summary) and
// /dashboard/salary (payroll report). No day-by-day row is required to
// exist for Holiday/Week Off/Absent — those are DERIVED at report time by
// diffing the calendar against holidays/weekly_off_days/attendance rows,
// so nothing needs a nightly cron job to pre-populate "Absent" rows for
// every non-punched working day.
import { datesInMonth, istDayOfWeek } from "./ist-date";

export type DayCategory = "Holiday" | "Week Off" | "Present" | "Late" | "Half Day" | "Leave" | "Absent" | "Future";

export type DayResult = { date: string; category: DayCategory };

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
  attendanceByDate: Map<string, { status: string | null }>;
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
      results.push({ date, category: status });
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
 * Deduction convention (a common/standard Indian-payroll default, NOT a
 * verified copy of this company's actual written policy — flagged in the
 * UI too, and easy to change here if their real policy differs):
 *   - per-day rate = monthly_salary / calendar days in that month
 *   - every Absent day is deducted at that rate (unauthorized, no record)
 *   - Leave days beyond allowed_leaves_per_month are ALSO deducted at that
 *     rate (leave within the allowance is free); Leave days within the
 *     allowance cost nothing
 *   - Half Day counts as 0.5 of a deducted day, applied the same way as
 *     Absent (always counts, doesn't draw from the leave allowance)
 *   - Holiday, Week Off, Present, Late never cost anything (Late is a
 *     timing flag, not an absence)
 */
export function computeDeduction({
  monthlySalary,
  allowedLeavesPerMonth,
  daysInThisMonth,
  counts,
}: {
  monthlySalary: number;
  allowedLeavesPerMonth: number;
  daysInThisMonth: number;
  counts: Record<DayCategory, number>;
}) {
  const perDayRate = monthlySalary / daysInThisMonth;
  const excessLeaveDays = Math.max(0, counts.Leave - allowedLeavesPerMonth);
  const deductedDays = counts.Absent + counts["Half Day"] * 0.5 + excessLeaveDays;
  const deductionAmount = Math.round(deductedDays * perDayRate * 100) / 100;
  const netPay = Math.round((monthlySalary - deductionAmount) * 100) / 100;
  return { perDayRate, deductedDays, deductionAmount, netPay };
}
