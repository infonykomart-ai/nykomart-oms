"use client";

import { useActionState, useMemo, useState } from "react";
import { setEmployeeSalary, type SimpleActionState } from "./actions";
import { computeCtcBreakdown, DEFAULT_CTC_STRUCTURE, ESI_GROSS_WAGE_THRESHOLD } from "@/lib/attendance/statutory";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const smallLabelClass = "mb-0.5 block text-[11px] font-medium text-slate-500";

// 2026-09-11 — Payroll Phase 1: this form used to only ever take a flat
// "Monthly Salary" number. It now offers an OPTIONAL "CTC Structure" mode
// that auto-computes Basic/HRA/Special Allowance + Employer/Employee PF +
// ESI + Professional Tax from an annual CTC figure (see
// src/lib/attendance/statutory.ts). When CTC mode is on, the computed
// "Gross Monthly" is what actually gets saved into monthly_salary (via a
// hidden field) — every existing attendance-deduction/payroll query keeps
// working exactly as before; the extra CTC fields just ride along for
// submitSalaryPayment() to also work out statutory deductions at payment
// time. Flat mode (the checkbox off) behaves 100% identically to before
// this round.
export function SalaryForm({ employees, today }: { employees: { id: string; name: string }[]; today: string }) {
  const [state, formAction, pending] = useActionState(setEmployeeSalary, initialState);
  const [ctcMode, setCtcMode] = useState(false);

  const [ctcAnnual, setCtcAnnual] = useState(0);
  const [basicPct, setBasicPct] = useState<number>(DEFAULT_CTC_STRUCTURE.basicPercentOfCtc);
  const [hraPct, setHraPct] = useState<number>(DEFAULT_CTC_STRUCTURE.hraPercentOfBasic);
  const [employerPfPct, setEmployerPfPct] = useState<number>(DEFAULT_CTC_STRUCTURE.employerPfPercent);
  const [employeePfPct, setEmployeePfPct] = useState<number>(DEFAULT_CTC_STRUCTURE.employeePfPercent);
  const [pfCeiling, setPfCeiling] = useState<number>(DEFAULT_CTC_STRUCTURE.pfWageCeiling);
  const [esiApplicable, setEsiApplicable] = useState(false);
  const [esiEmployeePct, setEsiEmployeePct] = useState<number>(DEFAULT_CTC_STRUCTURE.esiEmployeePercent);
  const [esiEmployerPct, setEsiEmployerPct] = useState<number>(DEFAULT_CTC_STRUCTURE.esiEmployerPercent);
  const [ptAmount, setPtAmount] = useState(0);

  const breakdown = useMemo(
    () =>
      ctcMode
        ? computeCtcBreakdown({
            ctcAnnual,
            basicPercentOfCtc: basicPct,
            hraPercentOfBasic: hraPct,
            employerPfPercent: employerPfPct,
            employeePfPercent: employeePfPct,
            pfWageCeiling: pfCeiling,
            esiApplicable,
            esiEmployeePercent: esiEmployeePct,
            esiEmployerPercent: esiEmployerPct,
            professionalTaxAmount: ptAmount,
          })
        : null,
    [ctcMode, ctcAnnual, basicPct, hraPct, employerPfPct, employeePfPct, pfCeiling, esiApplicable, esiEmployeePct, esiEmployerPct, ptAmount]
  );

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && (
        <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">✓ Saved — applies from the Effective From date onward.</p>
      )}

      <input type="hidden" name="ctc_mode" value={ctcMode ? "true" : "false"} />
      {/* In CTC mode the visible "Monthly Salary" input is replaced by the auto-computed Gross Monthly, submitted via this hidden field. */}
      {ctcMode && <input type="hidden" name="monthly_salary" value={breakdown?.grossMonthly ?? 0} />}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        <select name="employee_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>Employee</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        {!ctcMode && <input type="number" name="monthly_salary" step="0.01" min="0" required placeholder="Monthly Salary" className={inputClass} />}
        {ctcMode && (
          <div className={`${inputClass} flex items-center bg-slate-50 text-slate-500`}>
            Gross: ₹{(breakdown?.grossMonthly ?? 0).toFixed(2)}
          </div>
        )}
        <input type="number" name="allowed_leaves_per_month" step="0.5" min="0" defaultValue={1} placeholder="Allowed Leave/mo" className={inputClass} />
        <input type="date" name="effective_from" required defaultValue={today} className={inputClass} />
        <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
          {pending ? "Saving..." : "Save Salary"}
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
        <input type="checkbox" checked={ctcMode} onChange={(e) => setCtcMode(e.target.checked)} className="h-4 w-4" />
        Use CTC Structure instead (auto-calculates Gross Salary + Employer/Employee PF + ESI + Professional Tax)
      </label>

      {ctcMode && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <p className="text-xs text-amber-800">
            ⚠️ These PF/ESI/PT rates are current published defaults, editable below — <strong>not verified against
            this company&apos;s actual PF/ESI registration</strong>. Confirm the percentages and PF wage ceiling with
            your CA/accountant before relying on this for a real filing. TDS (income tax) is not calculated here yet.
          </p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            <NumField label="CTC (Annual ₹)" name="ctc_annual" value={ctcAnnual} onChange={setCtcAnnual} />
            <NumField label="Basic % of CTC" name="basic_percent_of_ctc" value={basicPct} onChange={setBasicPct} />
            <NumField label="HRA % of Basic" name="hra_percent_of_basic" value={hraPct} onChange={setHraPct} />
            <NumField label="Employer PF %" name="employer_pf_percent" value={employerPfPct} onChange={setEmployerPfPct} />
            <NumField label="Employee PF %" name="employee_pf_percent" value={employeePfPct} onChange={setEmployeePfPct} />
            <NumField label="PF Wage Ceiling ₹" name="pf_wage_ceiling" value={pfCeiling} onChange={setPfCeiling} />
            <NumField label="Professional Tax ₹/mo" name="professional_tax_amount" value={ptAmount} onChange={setPtAmount} />
            <div>
              <label className={smallLabelClass}>State (for PT)</label>
              <input name="pt_state" placeholder="e.g. Maharashtra" className={inputClass} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              name="esi_applicable"
              value="true"
              checked={esiApplicable}
              onChange={(e) => setEsiApplicable(e.target.checked)}
              className="h-4 w-4"
            />
            ESI Applicable
            {breakdown && (
              <span className="text-slate-400">
                {breakdown.grossMonthly > 0 && breakdown.grossMonthly <= ESI_GROSS_WAGE_THRESHOLD
                  ? `(gross ₹${breakdown.grossMonthly.toFixed(0)} is under the ₹${ESI_GROSS_WAGE_THRESHOLD} threshold — usually applicable)`
                  : `(gross is above ₹${ESI_GROSS_WAGE_THRESHOLD} — usually not applicable)`}
              </span>
            )}
          </label>
          {esiApplicable && (
            <div className="grid grid-cols-2 gap-2 sm:w-1/2">
              <NumField label="ESI Employee %" name="esi_employee_percent" value={esiEmployeePct} onChange={setEsiEmployeePct} />
              <NumField label="ESI Employer %" name="esi_employer_percent" value={esiEmployerPct} onChange={setEsiEmployerPct} />
            </div>
          )}

          {breakdown && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-white p-3 text-xs sm:grid-cols-3 md:grid-cols-5">
              <Stat label="Basic" value={breakdown.basic} />
              <Stat label="HRA" value={breakdown.hra} />
              <Stat label="Special Allowance" value={breakdown.specialAllowance} />
              <Stat label="Gross Monthly (paid)" value={breakdown.grossMonthly} highlight />
              <Stat label="Employee PF" value={breakdown.employeePf} />
              <Stat label="Employer PF" value={breakdown.employerPf} />
              <Stat label="ESI Employee" value={breakdown.esiEmployee} />
              <Stat label="ESI Employer" value={breakdown.esiEmployer} />
              <Stat label="Professional Tax" value={breakdown.professionalTax} />
              <Stat label="Est. Net (before attendance)" value={breakdown.estimatedNetBeforeAttendance} highlight />
            </div>
          )}
        </div>
      )}
    </form>
  );
}

function NumField({ label, name, value, onChange }: { label: string; name: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className={smallLabelClass}>{label}</label>
      <input
        type="number"
        name={name}
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={inputClass}
      />
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={highlight ? "font-semibold text-green-700" : "text-slate-800"}>₹{value.toFixed(2)}</div>
    </div>
  );
}
