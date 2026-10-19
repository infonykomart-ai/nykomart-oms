"use client";

// 2026-10-19 — "sallery set karne ka stracture sahi nahi hai isko alag se
// bano sahi se": the Decide & Feed form used to be a single 5-column strip
// squeezed into the Salary page (Monthly Salary / Allowed Leave / Date all
// unlabelled next to each other, the whole CTC block revealed underneath),
// so it was impossible to see what you were setting. This is the same
// decision, on its own screen, in labelled sections:
//
//   1. Employee & Effective Date   — who, from when, how many paid leaves
//   2. Pay Mode                    — Flat monthly  OR  CTC structure
//   3. CTC Split (CTC mode)        — Basic % of CTC, HRA % of basic
//   4. Statutory (CTC mode)        — PF %/ceiling, ESI %, Professional Tax
//   5. Live Breakdown              — what the chosen figures actually pay
//
// Saving goes through the SAME server action the old strip used
// (setEmployeeSalary) — a new effective date inserts a new version, an
// existing date corrects that version in place. Nothing about payroll math
// changed here; only how the numbers are entered and shown.
import { useActionState, useMemo, useState } from "react";
import { A4Dialog } from "@/components/a4-dialog";
import { computeCtcBreakdown, DEFAULT_CTC_STRUCTURE, ESI_GROSS_WAGE_THRESHOLD } from "@/lib/attendance/statutory";
import { setEmployeeSalary, type SimpleActionState } from "../actions";

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

export type StructureEmployee = {
  id: string;
  name: string;
  employee_code: string | null;
  current: CurrentSalary | null;
  versions: number;
};

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function SalaryStructureEditor({
  employees,
  today,
  selectedEmployeeId,
}: {
  employees: StructureEmployee[];
  today: string;
  selectedEmployeeId: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openEmployee = employees.find((e) => e.id === openId) ?? null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-400">
              <th className="py-1 pr-3">Employee</th>
              <th className="px-2">Code</th>
              <th className="px-2">Mode</th>
              <th className="px-2">Monthly Salary</th>
              <th className="px-2">CTC (Annual)</th>
              <th className="px-2">Paid Leave/mo</th>
              <th className="px-2">Effective From</th>
              <th className="px-2">Versions</th>
              <th className="px-2 text-right">Structure</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr
                key={e.id}
                className={`border-t border-slate-100 ${selectedEmployeeId === e.id ? "bg-amber-50/60" : ""}`}
              >
                <td className="py-1.5 pr-3 font-medium text-slate-800">{e.name}</td>
                <td className="px-2 text-slate-500">{e.employee_code ?? "—"}</td>
                <td className="px-2">
                  {e.current ? (
                    e.current.ctc_annual !== null ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">CTC</span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Flat</span>
                    )
                  ) : (
                    <span className="text-amber-700">Not decided</span>
                  )}
                </td>
                <td className="px-2 text-slate-800">
                  {e.current ? `₹${e.current.monthly_salary.toLocaleString("en-IN")}` : "—"}
                </td>
                <td className="px-2 text-slate-500">
                  {e.current?.ctc_annual != null ? `₹${e.current.ctc_annual.toLocaleString("en-IN")}` : "—"}
                </td>
                <td className="px-2">{e.current ? e.current.allowed_leaves_per_month : "—"}</td>
                <td className="px-2 text-slate-500">{e.current?.effective_from ?? "—"}</td>
                <td className="px-2 text-slate-500">{e.versions}</td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => setOpenId(e.id)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {e.current ? "Edit / Revise" : "Decide Salary"}
                  </button>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={9} className="py-3 text-center text-slate-400">
                  No active employees in this company.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openEmployee && (
        <A4Dialog
          open
          onClose={() => setOpenId(null)}
          title={`Salary Structure — ${openEmployee.name}`}
          subtitle={
            openEmployee.current
              ? `Currently ₹${openEmployee.current.monthly_salary.toLocaleString("en-IN")}/month effective ${openEmployee.current.effective_from}. Saving a NEW effective date adds a version; the same date corrects the existing one.`
              : "No salary decided yet — fill this in and save to decide it."
          }
        >
          <StructureForm employee={openEmployee} today={today} onDone={() => setOpenId(null)} />
        </A4Dialog>
      )}
    </div>
  );
}

function StructureForm({
  employee,
  today,
  onDone,
}: {
  employee: StructureEmployee;
  today: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(setEmployeeSalary, initialState);
  const cur = employee.current;

  const [ctcMode, setCtcMode] = useState(cur ? cur.ctc_annual !== null : false);
  const [monthlySalary, setMonthlySalary] = useState(cur?.monthly_salary ?? 0);
  const [allowedLeaves, setAllowedLeaves] = useState(cur?.allowed_leaves_per_month ?? 1);
  const [effectiveFrom, setEffectiveFrom] = useState(cur?.effective_from ?? today);

  const [ctcAnnual, setCtcAnnual] = useState(cur?.ctc_annual ?? 0);
  const [basicPct, setBasicPct] = useState(cur?.basic_percent_of_ctc ?? DEFAULT_CTC_STRUCTURE.basicPercentOfCtc);
  const [hraPct, setHraPct] = useState(cur?.hra_percent_of_basic ?? DEFAULT_CTC_STRUCTURE.hraPercentOfBasic);
  const [employerPfPct, setEmployerPfPct] = useState(cur?.employer_pf_percent ?? DEFAULT_CTC_STRUCTURE.employerPfPercent);
  const [employeePfPct, setEmployeePfPct] = useState(cur?.employee_pf_percent ?? DEFAULT_CTC_STRUCTURE.employeePfPercent);
  const [pfCeiling, setPfCeiling] = useState(cur?.pf_wage_ceiling ?? DEFAULT_CTC_STRUCTURE.pfWageCeiling);
  const [esiApplicable, setEsiApplicable] = useState(cur?.esi_applicable ?? false);
  const [esiEmployeePct, setEsiEmployeePct] = useState(cur?.esi_employee_percent ?? DEFAULT_CTC_STRUCTURE.esiEmployeePercent);
  const [esiEmployerPct, setEsiEmployerPct] = useState(cur?.esi_employer_percent ?? DEFAULT_CTC_STRUCTURE.esiEmployerPercent);
  const [ptAmount, setPtAmount] = useState(cur?.professional_tax_amount ?? 0);

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

  const payableMonthly = ctcMode ? (breakdown?.grossMonthly ?? 0) : monthlySalary;
  const days = daysInEffectiveMonth(effectiveFrom);
  const perDayRate = days > 0 ? payableMonthly / days : 0;

  if (state.success) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          ✓ Salary structure saved for {employee.name} — effective from {effectiveFrom}. Earlier months keep the salary
          they were paid on.
        </p>
        <button type="button" onClick={onDone} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white">
          Close
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="employee_id" value={employee.id} />
      <input type="hidden" name="ctc_mode" value={ctcMode ? "true" : "false"} />
      {ctcMode && <input type="hidden" name="monthly_salary" value={breakdown?.grossMonthly ?? 0} />}

      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      {/* ── 1. Employee & effective date ────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">1 · Employee &amp; Effective Date</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Employee</label>
            <div className={`${inputClass} bg-slate-50 text-slate-600`}>
              {employee.name}
              {employee.employee_code ? ` (${employee.employee_code})` : ""}
            </div>
          </div>
          <div>
            <label className={labelClass}>Salary Effective From *</label>
            <input
              type="date"
              name="effective_from"
              required
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Use the person&apos;s date of joining for their first salary. For a raise, today&apos;s (or next
              month&apos;s) date — earlier months keep the old figure.
            </p>
          </div>
          <div>
            <label className={labelClass}>Paid Leaves Allowed / Month</label>
            <input
              type="number"
              name="allowed_leaves_per_month"
              step="0.5"
              min="0"
              value={allowedLeaves}
              onChange={(e) => setAllowedLeaves(Number(e.target.value) || 0)}
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-slate-400">Leave beyond this many days in a month is deducted.</p>
          </div>
        </div>
      </section>

      {/* ── 2. Pay mode ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">2 · Pay Mode</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCtcMode(false)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              !ctcMode ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            Flat Monthly Salary
          </button>
          <button
            type="button"
            onClick={() => setCtcMode(true)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              ctcMode ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            CTC Structure (PF / ESI / PT)
          </button>
        </div>

        {!ctcMode ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Monthly Salary (₹) *</label>
              <input
                type="number"
                name="monthly_salary"
                step="0.01"
                min="0"
                required
                value={monthlySalary || ""}
                onChange={(e) => setMonthlySalary(Number(e.target.value) || 0)}
                className={inputClass}
              />
            </div>
            <p className="self-end text-[11px] text-slate-500">
              No PF/ESI/Professional Tax is computed for a flat salary — the figure above is what payroll divides by the
              month&apos;s days.
            </p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Annual CTC (₹) *</label>
              <input
                type="number"
                name="ctc_annual"
                step="0.01"
                min="0"
                value={ctcAnnual || ""}
                onChange={(e) => setCtcAnnual(Number(e.target.value) || 0)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Gross Monthly Salary (auto)</label>
              <div className={`${inputClass} bg-slate-50 font-semibold text-green-700`}>
                ₹{(breakdown?.grossMonthly ?? 0).toFixed(2)}
              </div>
            </div>
          </div>
        )}
      </section>

      {ctcMode && (
        <>
          {/* ── 3. CTC split ──────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">3 · Earnings Split</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <NumField label="Basic % of CTC" name="basic_percent_of_ctc" value={basicPct} onChange={setBasicPct} />
              <NumField label="HRA % of Basic" name="hra_percent_of_basic" value={hraPct} onChange={setHraPct} />
              <div>
                <label className={labelClass}>Special Allowance (balance, auto)</label>
                <div className={`${inputClass} bg-slate-50 text-slate-600`}>₹{(breakdown?.specialAllowance ?? 0).toFixed(2)}</div>
              </div>
            </div>
          </section>

          {/* ── 4. Statutory ──────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">4 · Statutory — PF / ESI / Professional Tax</h3>
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              ⚠️ These are current published defaults, editable — <strong>not verified against this company&apos;s PF/ESI
              registration</strong>. Confirm percentages and the PF wage ceiling with your CA/accountant before filing.
              TDS (income tax) is not calculated here.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <NumField label="Employer PF %" name="employer_pf_percent" value={employerPfPct} onChange={setEmployerPfPct} />
              <NumField label="Employee PF %" name="employee_pf_percent" value={employeePfPct} onChange={setEmployeePfPct} />
              <NumField label="PF Wage Ceiling (₹)" name="pf_wage_ceiling" value={pfCeiling} onChange={setPfCeiling} />
              <NumField label="Professional Tax (₹/month)" name="professional_tax_amount" value={ptAmount} onChange={setPtAmount} />
              <div>
                <label className={labelClass}>State (for PT)</label>
                <input name="pt_state" placeholder="e.g. Maharashtra" className={inputClass} />
              </div>
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-600">
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
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <NumField label="ESI Employee %" name="esi_employee_percent" value={esiEmployeePct} onChange={setEsiEmployeePct} />
                <NumField label="ESI Employer %" name="esi_employer_percent" value={esiEmployerPct} onChange={setEsiEmployerPct} />
              </div>
            )}
          </section>
        </>
      )}

      {/* ── 5. Live breakdown ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">5 · What This Pays</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Stat label="Payable Monthly" value={payableMonthly} highlight />
          <Stat label={`Per Day (${days} days in effective month)`} value={perDayRate} />
          <Stat label="One extra Sunday/holiday worked" value={perDayRate} />
          <Stat label={`No-leave bonus (${allowedLeaves} paid leave/mo)`} value={perDayRate * allowedLeaves} />
          {breakdown && (
            <>
              <Stat label="Basic" value={breakdown.basic} />
              <Stat label="HRA" value={breakdown.hra} />
              <Stat label="Special Allowance" value={breakdown.specialAllowance} />
              <Stat label="Employee PF" value={breakdown.employeePf} />
              <Stat label="Employer PF" value={breakdown.employerPf} />
              <Stat label="ESI Employee" value={breakdown.esiEmployee} />
              <Stat label="ESI Employer" value={breakdown.esiEmployer} />
              <Stat label="Professional Tax" value={breakdown.professionalTax} />
              <Stat label="Est. Net (before attendance)" value={breakdown.estimatedNetBeforeAttendance} highlight />
            </>
          )}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Deductions for absent days, half days and leave beyond the allowance are applied by payroll from this payable
          figure — see the Payroll table on the Salary page.
        </p>
      </section>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save Structure"}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">
          Cancel
        </button>
      </div>
    </form>
  );
}

function daysInEffectiveMonth(effectiveFrom: string): number {
  const d = new Date(effectiveFrom);
  if (Number.isNaN(d.getTime())) return 30;
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function NumField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
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
