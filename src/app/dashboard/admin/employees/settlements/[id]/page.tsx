import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { computeCtcBreakdown } from "@/lib/attendance/statutory";
import { computeLeaveBalance } from "@/lib/attendance/leave-balance";
import { computeYearsOfService, estimateGratuity, computeNoticeShortfallDays, estimatePerDayRate } from "@/lib/attendance/settlement";
import { SettlementDetailView, type LineItemRow, type LeaveBalanceReference } from "./settlement-detail-view";

// 2026-09-11 (Payroll Phase 4 — final phase) — one Full & Final settlement:
// every reference number (notice shortfall, leave balances, gratuity
// estimate, outstanding advances) computed fresh here server-side, plus
// the real line items and status actions. See src/lib/attendance/
// settlement.ts for the reference math and its own honest caveats.
export default async function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireCapability("employee_admin");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const { id } = await params;

  const { data: settlement } = await finSupabase
    .from("employee_settlements")
    .select(
      "id, employee_id, company_id, separation_type, resignation_date, last_working_day, reason, notice_period_required_days, notice_period_served_days, status, initiated_at, finalized_at, payment_date, remark"
    )
    .eq("id", id)
    .maybeSingle();
  if (!settlement || !admin.companyIds.includes(settlement.company_id)) notFound();

  const [
    { data: employee },
    { data: companyProfile },
    { data: lineItemsRaw },
    { data: salaryRows },
    { data: leaveTypesRaw },
    { data: advancesRaw },
  ] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, designation, employee_code, date_of_joining, pan_number, bank_account_holder_name, bank_account_no, bank_ifsc, bank_name")
      .eq("id", settlement.employee_id)
      .single(),
    supabase.from("companies").select("name").eq("id", settlement.company_id).single(),
    finSupabase
      .from("employee_settlement_line_items")
      .select("id, kind, category, description, amount, created_at")
      .eq("settlement_id", id)
      .order("created_at"),
    finSupabase
      .from("employee_salary")
      .select(
        "monthly_salary, ctc_annual, basic_percent_of_ctc, hra_percent_of_basic, employer_pf_percent, employee_pf_percent, pf_wage_ceiling, esi_applicable, esi_employee_percent, esi_employer_percent, professional_tax_amount"
      )
      .eq("employee_id", settlement.employee_id)
      .lte("effective_from", settlement.last_working_day)
      .order("effective_from", { ascending: false })
      .limit(1),
    finSupabase
      .from("leave_types")
      .select("id, name, code, paid, annual_accrual_days, accrual_frequency")
      .eq("company_id", settlement.company_id)
      .eq("active", true)
      .eq("paid", true)
      .order("name"),
    finSupabase.from("employee_advances").select("outstanding_amount").eq("employee_id", settlement.employee_id).gt("outstanding_amount", 0),
  ]);

  if (!employee) notFound();

  const salary = salaryRows?.[0];
  const monthlySalary = salary ? Number(salary.monthly_salary) : 0;
  const basicForGratuity = salary?.ctc_annual
    ? computeCtcBreakdown({
        ctcAnnual: Number(salary.ctc_annual),
        basicPercentOfCtc: Number(salary.basic_percent_of_ctc),
        hraPercentOfBasic: Number(salary.hra_percent_of_basic),
        employerPfPercent: Number(salary.employer_pf_percent),
        employeePfPercent: Number(salary.employee_pf_percent),
        pfWageCeiling: Number(salary.pf_wage_ceiling),
        esiApplicable: salary.esi_applicable,
        esiEmployeePercent: Number(salary.esi_employee_percent),
        esiEmployerPercent: Number(salary.esi_employer_percent),
        professionalTaxAmount: Number(salary.professional_tax_amount),
      }).basic
    : monthlySalary;

  const yearsOfService = employee.date_of_joining ? computeYearsOfService(employee.date_of_joining, settlement.last_working_day) : 0;
  const gratuity = estimateGratuity({ monthlyBasicOrSalary: basicForGratuity, yearsOfService });
  const noticeShortfallDays = computeNoticeShortfallDays(settlement.notice_period_required_days, settlement.notice_period_served_days);
  const perDayRate = estimatePerDayRate(monthlySalary);
  const noticePayReference = Math.round(noticeShortfallDays * perDayRate * 100) / 100;

  // Leave balance reference — every PAID leave type, valued as of the last
  // working day, using the SAME live accrual math as the employee's own
  // "My Leave Balance" panel and the Team Leave Balances table (Phase 2).
  const leaveYear = Number(settlement.last_working_day.slice(0, 4));
  const yearStart = `${leaveYear}-01-01`;
  const yearEnd = `${leaveYear}-12-31`;
  const leaveTypes = leaveTypesRaw ?? [];
  let leaveBalances: LeaveBalanceReference[] = [];
  if (leaveTypes.length > 0) {
    const typeIds = leaveTypes.map((t) => t.id);
    const [{ data: adjustmentsRaw }, { data: usedRowsRaw }] = await Promise.all([
      finSupabase
        .from("leave_balance_adjustments")
        .select("leave_type_id, adjustment_days")
        .eq("employee_id", settlement.employee_id)
        .eq("leave_year", leaveYear)
        .in("leave_type_id", typeIds),
      finSupabase
        .from("attendance")
        .select("leave_type_id")
        .eq("employee_id", settlement.employee_id)
        .eq("status", "Leave")
        .eq("leave_unpaid", false)
        .in("leave_type_id", typeIds)
        .gte("attendance_date", yearStart)
        .lte("attendance_date", yearEnd),
    ]);
    const adjustmentByType = new Map<string, number>();
    for (const a of adjustmentsRaw ?? []) adjustmentByType.set(a.leave_type_id, (adjustmentByType.get(a.leave_type_id) ?? 0) + Number(a.adjustment_days));
    const usedByType = new Map<string, number>();
    for (const r of usedRowsRaw ?? []) {
      if (!r.leave_type_id) continue;
      usedByType.set(r.leave_type_id, (usedByType.get(r.leave_type_id) ?? 0) + 1);
    }
    leaveBalances = leaveTypes.map((t) => ({
      id: t.id,
      name: t.code ? `${t.name} (${t.code})` : t.name,
      balance: computeLeaveBalance({
        leaveType: { annual_accrual_days: Number(t.annual_accrual_days), accrual_frequency: t.accrual_frequency as "Monthly" | "Upfront" },
        leaveYear,
        asOfDateStr: settlement.last_working_day,
        joinDate: employee.date_of_joining,
        adjustmentDaysTotal: adjustmentByType.get(t.id) ?? 0,
        usedDays: usedByType.get(t.id) ?? 0,
      }),
      referenceAmount: 0, // filled in below once perDayRate is known
    }));
    leaveBalances = leaveBalances.map((b) => ({ ...b, referenceAmount: Math.round(Math.max(0, b.balance) * perDayRate * 100) / 100 }));
  }

  const outstandingAdvanceTotal = (advancesRaw ?? []).reduce((sum, a) => sum + Number(a.outstanding_amount), 0);

  const lineItems: LineItemRow[] = (lineItemsRaw ?? []).map((l) => ({
    id: l.id,
    kind: l.kind,
    category: l.category,
    description: l.description,
    amount: Number(l.amount),
    created_at: l.created_at,
  }));

  return (
    <SettlementDetailView
      settlement={{
        id: settlement.id,
        separationType: settlement.separation_type,
        resignationDate: settlement.resignation_date,
        lastWorkingDay: settlement.last_working_day,
        reason: settlement.reason,
        noticeRequiredDays: settlement.notice_period_required_days,
        noticeServedDays: settlement.notice_period_served_days,
        status: settlement.status,
        initiatedAt: settlement.initiated_at,
        finalizedAt: settlement.finalized_at,
        paymentDate: settlement.payment_date,
        remark: settlement.remark,
      }}
      employee={{
        name: employee.name,
        designation: employee.designation,
        employeeCode: employee.employee_code,
        dateOfJoining: employee.date_of_joining,
        panNumber: employee.pan_number,
        bankAccountHolderName: employee.bank_account_holder_name,
        bankAccountNo: employee.bank_account_no,
        bankIfsc: employee.bank_ifsc,
        bankName: employee.bank_name,
      }}
      companyName={companyProfile?.name ?? "—"}
      reference={{
        monthlySalary,
        basicForGratuity,
        yearsOfService,
        gratuityEligible: gratuity.eligible,
        gratuityCompletedYears: gratuity.completedYears,
        gratuityEstimate: gratuity.estimate,
        noticeShortfallDays,
        perDayRate,
        noticePayReference,
        outstandingAdvanceTotal,
        leaveBalances,
      }}
      lineItems={lineItems}
    />
  );
}
