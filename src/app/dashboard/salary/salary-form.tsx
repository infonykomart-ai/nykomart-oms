"use client";

import { useActionState, useMemo, useState } from "react";
import { setEmployeeSalary, type SimpleActionState } from "./actions";
import { computeCtcBreakdown, DEFAULT_CTC_STRUCTURE, ESI_GROSS_WAGE_THRESHOLD } from "@/lib/attendance/statutory";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const smallLabelClass = "mb-0.5 block text-[11px] font-medium text-slate-500";

/**
 * The salary structure ALREADY decided for an employee (their newest
 * employee_salary row — see salary/page.tsx) — exactly the fields
 * setEmployeeSalary writes, so the form can prefill every one of them.
 */
export type CurrentSalary = {
  monthly_salary: number;
  allowed_leaves_per_month: number;
  effective_from: string;
  ctc_annual: number | null;
  basic_percent_of_ctc: number;
  hra_percent_of_basic: number;
  employer_pf_percent: number;
  employee_pf_percent: number;
  pf_wage_ceiling: number;
  esi_applicable: boolean;
  esi_employee_percent: number;
  esi_employer_percent: number;
  professional_tax_amount: number;
};

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
//
// 2026-10-03 — "employee ki salary decide karne or feed karne ka ek proper
// form nahi hai": upgraded from a blind dropdown + empty number to a real
// decide/feed form. Every field is now CONTROLLED and picking an employee
// PREFILLS their current structure (flat or CTC) with a live "currently
// decided" banner above the form — so an admin edits what's actually there
// instead of retyping from memory, and can see at a glance whether this
// person has a salary decided at all. Saving still inserts a NEW versioned
// row effective from the chosen date (setEmployeeSalary) — history is
// never rewritten.
export function SalaryForm({
  employees,
  today,
  current,
}: {
  employees: { id: string; name: string }[];
  today: string;
  current: Record<string, CurrentSalary>;
}) {
  const [state, formAction, pending] = useActionState(setEmployeeSalary, initialState);
  const [ctcMode, setCtcMode] = useState(false);

  const [employeeId, setEmployeeId] = useState("");
  const [monthlySalary, setMonthlySalary] = useState<number>(0);
  const [allowedLeaves, setAllowedLeaves] = useState<number>(1);
  const [effectiveFrom, setEffectiveFrom] = useState<string>(today);

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

  const selected = employeeId ? current[employeeId] : undefined;
  const selectedName = employees.find((e) => e.id === employeeId)?.name ?? "";

  // Event-handler setState (never in an effect) — selecting an employee
  // loads that person's real decided salary into every field at once.
  function pickEmployee(id: string) {
    setEmployeeId(id);
    const cur = current[id];
    // New decision always starts from today; the old row keeps its own
    // effective_from (salary history stays versioned, see actions.ts).
    setEffectiveFrom(today);
    if (!cur) {
      // Never had a salary decided — start from clean defaults.
      setMonthlySalary(0);
      setAllowedLeaves(1);
      setCtcMode(false);
      setCtcAnnual(0);
      setEsiApplicable(false);
      setPtAmount(0);
      setBasicPct(DEFAULT_CTC_STRUCTURE.basicPercentOfCtc);
      setHraPct(DEFAULT_CTC_STRUCTURE.hraPercentOfBasic);
      setEmployerPfPct(DEFAULT_CTC_STRUCTURE.employerPfPercent);
      setEmployeePfPct(DEFAULT_CTC_STRUCTURE.employeePfPercent);
      setPfCeiling(DEFAULT_CTC_STRUCTURE.pfWageCeiling);
      setEsiEmployeePct(DEFAULT_CTC_STRUCTURE.esiEmployeePercent);
      setEsiEmployerPct(DEFAULT_CTC_STRUCTURE.esiEmployerPercent);
      return;
    }
    setMonthlySalary(cur.monthly_salary);
    setAllowedLeaves(cur.allowed_leaves_per_month);
    setCtcMode(cur.ctc_annual !== null);
    setCtcAnnual(cur.ctc_annual ?? 0);
    setBasicPct(cur.basic_percent_of_ctc);
    setHraPct(cur.hra_percent_of_basic);
    setEmployerPfPct(cur.employer_pf_percent);
    setEmployeePfPct(cur.employee_pf_percent);
    setPfCeiling(cur.pf_wage_ceiling);
    setEsiApplicable(cur.esi_applicable);
    setEsiEmployeePct(cur.esi_employee_percent);
    setEsiEmployerPct(cur.esi_employer_percent);
    setPtAmount(cur.professional_tax_amount);
  }

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
        <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">
          ✓ Saved for {selectedName || "employee"} — applies from {effectiveFrom} onward (earlier months keep their old salary).
        </p>
      )}

      <input type="hidden" name="ctc_mode" value={ctcMode ? "true" : "false"} />
      {/* In CTC mode the visible "Monthly Salary" input is replaced by the auto-computed Gross Monthly, submitted via this hidden field. */}
      {ctcMode && <input type="hidden" name="monthly_salary" value={breakdown?.grossMonthly ?? 0} />}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        <select
          name="employee_id"
          required
          value={employeeId}
          onChange={(e) => pickEmployee(e.target.value)}
          className={inputClass}
        >
          <option value="" disabled>
            Employee…
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {current[e.id]
                ? ` — ₹${current[e.id].monthly_salary.toLocaleString("en-IN")}/mo`
                : " (no salary set)"}
            </option>
          ))}
        </select>
        {!ctcMode && (
          <input
            type="number"
            name="monthly_salary"
            step="0.01"
            min="0"
            required
            placeholder="Monthly Salary"
            value={monthlySalary || ""}
            onChange={(e) => setMonthlySalary(Number(e.target.value) || 0)}
            className={inputClass}
          />
        )}
        {ctcMode && (
          <div className={`${inputClass} flex items-center bg-slate-50 text-slate-500`}>
            Gross: ₹{(breakdown?.grossMonthly ?? 0).toFixed(2)}
          </div>
        )}
        <input
          type="number"
          name="allowed_leaves_per_month"
          step="0.5"
          min="0"
          value={allowedLeaves}
          onChange={(e) => setAllowedLeaves(Number(e.target.value) || 0)}
          placeholder="Allowed Leave/mo"
          className={inputClass}
        />
        <input
          type="date"
          name="effective_from"
          required
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save Salary"}
        </button>
      </div>

      {/* Live "what's decided right now" banner for the selected employee. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {!employeeId ? (
          <span>Select an employee above to see their current salary and edit it.</span>
        ) : selected ? (
          <span>
            <strong>{selectedName}</strong> — currently ₹{selected.monthly_salary.toLocaleString("en-IN")}/month
            {selected.ctc_annual !== null && (
              <>
                {" "}
                (CTC ₹{selected.ctc_annual.toLocaleString("en-IN")}/yr, Basic {selected.basic_percent_of_ctc}% of CTC,
                Employee PF {selected.employee_pf_percent}%, ESI {selected.esi_applicable ? "applicable" : "not applicable"})
              </>
            )}
            , {selected.allowed_leaves_per_month} paid leave/mo, effective from{" "}
            <strong>{selected.effective_from}</strong>. Saving above creates a new version effective{" "}
            <strong>{effectiveFrom}</strong> — earlier payroll never changes.
          </span>
        ) : (
          <span>
            <strong>{selectedName}</strong> — ⚠️ no salary decided yet. Enter the monthly salary (or switch to CTC
            Structure below) and Save to decide it.
          </span>
        )}
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
