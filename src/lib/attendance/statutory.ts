// Statutory payroll math — CTC (Cost-to-Company) breakdown into Basic/HRA/
// Special Allowance, plus Employer/Employee Provident Fund (EPF), Employee
// State Insurance (ESI), and Professional Tax (PT).
//
// 2026-09-11 — Phase 1 of the "build the enterprise Payroll & HR blueprint
// into the real OMS" round (see claude/payroll-hr-architecture-design-
// 2026-09-11.md for the full synthesized design this is scaled down from,
// and claude/hr-payroll-build-roadmap-2026-09-11.md for what's in this
// phase vs. later ones).
//
// ⚠️ IMPORTANT — NOT VERIFIED AGAINST A REAL PAYROLL RUN OR YOUR CA'S
// ACTUAL FIGURES. Every rate below is a current, commonly-used PUBLISHED
// default (EPFO 12%/12% employer/employee on PF-wage capped at the
// government wage ceiling; ESI 3.25%/0.75% employer/employee while
// applicable). These change on government notification dates, and this
// file does NOT auto-update — it's a calculator with editable rates, not a
// compliance filing system. CONFIRM every percentage, the PF wage ceiling,
// and the ESI applicability threshold with your CA/accountant before using
// this for a real payroll run or statutory filing. Professional Tax is
// entered manually per employee (not auto-derived) because PT slabs vary
// by state and sometimes by income band within a state — too specific to
// safely guess here.
//
// TDS (Income Tax deduction at source) is deliberately NOT computed here —
// it depends on the employee's declared investments/regime choice and full
// annual projection, which needs its own dedicated flow (a later round).
// Leave the TDS line as a manual entry on the payslip until that's built.

export type CtcStructureInput = {
  ctcAnnual: number;
  basicPercentOfCtc: number; // typically 40-50%
  hraPercentOfBasic: number; // typically 40% (non-metro) or 50% (metro)
  employerPfPercent: number; // typically 12%
  employeePfPercent: number; // typically 12%
  pfWageCeiling: number; // EPFO statutory wage ceiling — editable, confirm current figure with your CA
  esiApplicable: boolean;
  esiEmployeePercent: number; // typically 0.75%
  esiEmployerPercent: number; // typically 3.25%
  professionalTaxAmount: number; // manual monthly figure — state-specific slab, not auto-derived
};

export type CtcBreakdown = {
  monthlyCtc: number;
  basic: number;
  hra: number;
  specialAllowance: number;
  employerPf: number;
  employeePf: number;
  /** Basic + HRA + Special Allowance — what's actually paid out before attendance/statutory deductions. */
  grossMonthly: number;
  esiEmployee: number;
  esiEmployer: number;
  professionalTax: number;
  /** Employee PF + Employee ESI + Professional Tax — the statutory amount withheld from the employee (excludes attendance LOP and advance recovery, which are applied separately). */
  totalEmployeeStatutoryDeductions: number;
  /** Gross Monthly minus statutory deductions only — NOT the final take-home, since attendance LOP and advance recovery are computed and applied separately (see src/lib/attendance/payroll.ts). */
  estimatedNetBeforeAttendance: number;
  /** Employer PF + Employer ESI — cost to the company, never deducted from the employee. Shown on the payslip for transparency, not subtracted from net pay. */
  totalEmployerContributions: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeCtcBreakdown(input: CtcStructureInput): CtcBreakdown {
  const monthlyCtc = round2(input.ctcAnnual / 12);
  const basic = round2(monthlyCtc * (input.basicPercentOfCtc / 100));
  const hra = round2(basic * (input.hraPercentOfBasic / 100));
  const pfWage = Math.min(basic, input.pfWageCeiling);
  const employerPf = round2(pfWage * (input.employerPfPercent / 100));
  const employeePf = round2(pfWage * (input.employeePfPercent / 100));
  // Balancing figure — never negative even if Basic+HRA+EmployerPF happens
  // to exceed the monthly CTC due to unusual percentages typed in.
  const specialAllowance = Math.max(0, round2(monthlyCtc - basic - hra - employerPf));
  const grossMonthly = round2(basic + hra + specialAllowance);
  const esiEmployee = input.esiApplicable ? round2(grossMonthly * (input.esiEmployeePercent / 100)) : 0;
  const esiEmployer = input.esiApplicable ? round2(grossMonthly * (input.esiEmployerPercent / 100)) : 0;
  const professionalTax = round2(input.professionalTaxAmount || 0);
  const totalEmployeeStatutoryDeductions = round2(employeePf + esiEmployee + professionalTax);
  const estimatedNetBeforeAttendance = round2(grossMonthly - totalEmployeeStatutoryDeductions);
  const totalEmployerContributions = round2(employerPf + esiEmployer);
  return {
    monthlyCtc,
    basic,
    hra,
    specialAllowance,
    employerPf,
    employeePf,
    grossMonthly,
    esiEmployee,
    esiEmployer,
    professionalTax,
    totalEmployeeStatutoryDeductions,
    estimatedNetBeforeAttendance,
    totalEmployerContributions,
  };
}

// Current published ESI wage threshold (gross ≤ ₹21,000/month) — offered
// as a suggestion only in the UI; the admin can still tick ESI Applicable
// either way. Does NOT model the "stays covered till the contribution
// period ends even if a raise pushes gross above the threshold mid-cycle"
// nuance real ESI rules have — flagged here as a deliberate simplification.
export const ESI_GROSS_WAGE_THRESHOLD = 21000;

export const DEFAULT_CTC_STRUCTURE = {
  basicPercentOfCtc: 50,
  hraPercentOfBasic: 50,
  employerPfPercent: 12,
  employeePfPercent: 12,
  pfWageCeiling: 15000,
  esiEmployeePercent: 0.75,
  esiEmployerPercent: 3.25,
} as const;
