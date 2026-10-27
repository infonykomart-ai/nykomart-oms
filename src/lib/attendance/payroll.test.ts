import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDeduction,
  computeMonthlyPayroll,
  summarizeCategories,
  summarizeLeaveDetail,
  summarizeExtraPayDays,
  type DayResult,
} from "./payroll";

const NO_DAYS = {
  Holiday: 0,
  "Week Off": 0,
  Present: 0,
  Late: 0,
  "Half Day": 0,
  Leave: 0,
  Absent: 0,
  Future: 0,
} as const;

const day = (over: Partial<DayResult> & { date: string; category: DayResult["category"] }): DayResult => over;

// ---------------------------------------------------------------------------
// computeDeduction — per-day rate, leave allowance, extra duty, round-off
// ---------------------------------------------------------------------------

test("the documented worked example: 15000 / 30 days / 1 Sunday / 1 half day = 15750", () => {
  const out = computeDeduction({
    monthlySalary: 15000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    counts: { ...NO_DAYS, Present: 29, "Half Day": 1 },
    extraDutyDays: 1,
    unusedPaidLeaveDays: 1,
  });
  assert.equal(out.perDayRate, 500);
  assert.equal(out.deductedDays, 0.5);
  assert.equal(out.deductionAmount, 250); // one half day
  assert.equal(out.extraDutyPay, 500); // the extra Sunday
  assert.equal(out.noLeaveBonusPay, 500); // no leave taken
  assert.equal(out.grossPay, 16000);
  assert.equal(out.netPay, 15750);
});

test("leave inside the monthly allowance is free, beyond it is deducted", () => {
  const base = {
    monthlySalary: 30000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 31,
  };

  const within = computeDeduction({
    ...base,
    counts: { ...NO_DAYS, Present: 30, Leave: 1 },
  });
  assert.equal(within.deductedDays, 0);
  assert.equal(within.netPay, 30000);

  const beyond = computeDeduction({
    ...base,
    counts: { ...NO_DAYS, Present: 28, Leave: 3 },
  });
  assert.equal(beyond.deductedDays, 2); // 3 leave − 1 allowed
  assert.equal(beyond.deductionAmount, 1935.48); // 2 × (30000/31)
  assert.equal(beyond.netPay, 28064.52);
});

test("unpaid typed leave is always deducted, even inside the flat allowance", () => {
  const out = computeDeduction({
    monthlySalary: 30000,
    allowedLeavesPerMonth: 10,
    daysInThisMonth: 30,
    counts: { ...NO_DAYS, Present: 28 },
    untypedLeaveDays: 0,
    unpaidTypedLeaveDays: 2,
  });
  assert.equal(out.deductedDays, 2);
  assert.equal(out.deductionAmount, 2000);
  assert.equal(out.netPay, 28000);
});

test("paid typed leave costs nothing", () => {
  const out = computeDeduction({
    monthlySalary: 30000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    counts: { ...NO_DAYS, Present: 29, Leave: 1 },
    untypedLeaveDays: 0,
    unpaidTypedLeaveDays: 0,
  });
  assert.equal(out.deductedDays, 0);
  assert.equal(out.netPay, 30000);
});

test("Holiday, Week Off, Present and Late never cost anything", () => {
  const out = computeDeduction({
    monthlySalary: 30000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    counts: { ...NO_DAYS, Holiday: 4, "Week Off": 4, Present: 20, Late: 2 },
  });
  assert.equal(out.deductedDays, 0);
  assert.equal(out.deductionAmount, 0);
  assert.equal(out.netPay, 30000);
});

test("Half Day counts as 0.5 and manual deductions are never negative", () => {
  const twoHalves = computeDeduction({
    monthlySalary: 30000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    counts: { ...NO_DAYS, Present: 28, "Half Day": 2 },
  });
  assert.equal(twoHalves.deductedDays, 1);

  const negativeManual = computeDeduction({
    monthlySalary: 30000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    counts: { ...NO_DAYS, Present: 30 },
    manualDeductionDays: -3,
  });
  assert.equal(negativeManual.deductedDays, 0);
  assert.equal(negativeManual.netPay, 30000);
});

test("manual deduction days are applied at the per-day rate", () => {
  const out = computeDeduction({
    monthlySalary: 30000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    counts: { ...NO_DAYS, Present: 29 },
    manualDeductionDays: 1,
  });
  assert.equal(out.deductionAmount, 1000);
  assert.equal(out.netPay, 29000);
});

// ---------------------------------------------------------------------------
// summarizers
// ---------------------------------------------------------------------------

test("summarizeCategories tallies every day category", () => {
  const counts = summarizeCategories([
    day({ date: "2026-09-01", category: "Present" }),
    day({ date: "2026-09-02", category: "Present" }),
    day({ date: "2026-09-06", category: "Week Off" }),
    day({ date: "2026-09-07", category: "Leave" }),
    day({ date: "2026-09-08", category: "Half Day" }),
  ]);
  assert.equal(counts.Present, 2);
  assert.equal(counts["Week Off"], 1);
  assert.equal(counts.Leave, 1);
  assert.equal(counts["Half Day"], 1);
  assert.equal(counts.Absent, 0);
  assert.equal(counts.Future, 0);
});

test("summarizeLeaveDetail splits leave into untyped / unpaid-typed / paid-typed", () => {
  const detail = summarizeLeaveDetail([
    day({ date: "2026-09-03", category: "Leave" }),
    day({ date: "2026-09-04", category: "Leave", leaveTypeId: "casual", leaveUnpaid: true }),
    day({ date: "2026-09-05", category: "Leave", leaveTypeId: "sick", leaveUnpaid: false }),
    day({ date: "2026-09-06", category: "Present" }),
  ]);
  assert.deepEqual(detail, { untypedLeaveDays: 1, unpaidTypedLeaveDays: 1, paidTypedLeaveDays: 1 });
});

test("working a weekly off or a holiday earns extra duty pay", () => {
  const extras = summarizeExtraPayDays([
    day({ date: "2026-09-06", category: "Present", onWeeklyOff: true }),
    day({ date: "2026-09-15", category: "Half Day", onHoliday: true }),
    // both flags on one day = one day's work, not two
    day({ date: "2026-08-15", category: "Present", onWeeklyOff: true, onHoliday: true }),
    day({ date: "2026-09-07", category: "Leave" }),
    day({ date: "2026-09-08", category: "Week Off" }),
  ]);
  assert.equal(extras.extraDutyDays, 2.5); // 1 + 0.5 + 1
  assert.equal(extras.workedWeeklyOffDays, 2);
  assert.equal(extras.workedHolidayDays, 0.5);
  assert.equal(extras.leaveTakenDays, 1);
});

// ---------------------------------------------------------------------------
// computeMonthlyPayroll — ties the pieces together
// ---------------------------------------------------------------------------

const september = (over: Partial<DayResult> = {}): DayResult[] => {
  const days: DayResult[] = [];
  for (let i = 1; i <= 30; i++) days.push(day({ date: `2026-09-${String(i).padStart(2, "0")}`, category: "Present", ...over }));
  return days;
};

test("a clean month with leave inside the allowance pays the full salary", () => {
  const days = september();
  days[5] = day({ date: "2026-09-06", category: "Week Off" });
  days[14] = day({ date: "2026-09-15", category: "Holiday" });
  days[20] = day({ date: "2026-09-21", category: "Leave" });

  const out = computeMonthlyPayroll({
    monthlySalary: 15000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    days,
  });
  assert.equal(out.monthComplete, true);
  assert.equal(out.unusedPaidLeaveDays, 0); // the 1 allowed day was taken
  assert.equal(out.deductionAmount, 0);
  assert.equal(out.netPay, 15000);
});

test("an unworked Sunday plus no leave lifts the net pay above base", () => {
  const days = september();
  days[6] = day({ date: "2026-09-07", category: "Week Off" });
  days[10] = day({ date: "2026-09-11", category: "Present", onWeeklyOff: true });

  const out = computeMonthlyPayroll({
    monthlySalary: 15000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    days,
  });
  assert.equal(out.extras.extraDutyDays, 1);
  assert.equal(out.extraDutyPay, 500);
  assert.equal(out.unusedPaidLeaveDays, 1);
  assert.equal(out.noLeaveBonusPay, 500);
  assert.equal(out.netPay, 16000);
});

test("an incomplete month never encashes unused leave", () => {
  const days: DayResult[] = [];
  for (let i = 1; i <= 30; i++) {
    days.push(day({ date: `2026-09-${String(i).padStart(2, "0")}`, category: i <= 20 ? "Present" : "Future" }));
  }
  const out = computeMonthlyPayroll({
    monthlySalary: 15000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    days,
  });
  assert.equal(out.monthComplete, false);
  assert.equal(out.unusedPaidLeaveDays, 0);
  assert.equal(out.netPay, 15000);
});

test("absences and half days reduce the net pay", () => {
  const days = september();
  days[2] = day({ date: "2026-09-03", category: "Absent" });
  days[3] = day({ date: "2026-09-04", category: "Half Day" });
  days[4] = day({ date: "2026-09-05", category: "Leave" });
  days[5] = day({ date: "2026-09-06", category: "Leave" });

  const out = computeMonthlyPayroll({
    monthlySalary: 15000,
    allowedLeavesPerMonth: 1,
    daysInThisMonth: 30,
    days,
  });
  // 1 absent + 1 half (0.5) + 1 excess leave = 2.5 days × 500
  assert.equal(out.deductedDays, 2.5);
  assert.equal(out.deductionAmount, 1250);
  assert.equal(out.netPay, 13750);
});
