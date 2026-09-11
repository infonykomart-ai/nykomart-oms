import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PayslipView } from "./payslip-view";

// 2026-09-11 (Payroll Phase 1) — a real payslip for an already-paid
// salary_payments row. Reads ONLY the snapshotted amounts on that row
// (basic_amount/hra_amount/employee_pf_amount/etc. — see
// db/2026-09-11-payroll-ctc-structure-and-statutory-fields.sql) rather
// than re-deriving anything from the employee's CURRENT salary structure,
// so a payslip printed later never drifts from what was actually paid —
// same "the payment record is the immutable source of truth" reasoning
// salary_payments itself already documents for gross_salary/
// attendance_deduction_amount.
export default async function PayslipPage({
  params,
}: {
  params: Promise<{ employeeId: string; month: string }>;
}) {
  const authed = await requireCapability("salary_admin");
  const { employeeId, month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();
  const payMonth = `${month}-01`;

  const db = createServiceRoleClient();
  const [{ data: payment }, { data: employee }] = await Promise.all([
    db.from("salary_payments").select("*").eq("employee_id", employeeId).eq("pay_month", payMonth).maybeSingle(),
    db
      .from("employees")
      .select(
        "id, name, company_id, designation, employee_code, date_of_joining, pan_number, uan_number, pf_number, esi_number, bank_account_holder_name, bank_account_no, bank_ifsc, bank_name"
      )
      .eq("id", employeeId)
      .maybeSingle(),
  ]);

  if (!payment || !employee) notFound();
  // Same company-scoping guard every other admin action in this app
  // applies — a salary_admin scoped to one company shouldn't be able to
  // view a payslip by guessing another company's employee id in the URL.
  if (!authed.companyIds.includes(employee.company_id)) notFound();

  const [{ data: company }, { data: profile }] = await Promise.all([
    db.from("companies").select("id, name, logo_url").eq("id", employee.company_id).single(),
    db.from("company_profiles").select("address, phone, email").eq("company_id", employee.company_id).maybeSingle(),
  ]);

  return (
    <PayslipView
      payMonth={month}
      employee={{
        name: employee.name,
        designation: employee.designation,
        employeeCode: employee.employee_code,
        dateOfJoining: employee.date_of_joining,
        panNumber: employee.pan_number,
        uanNumber: employee.uan_number,
        pfNumber: employee.pf_number,
        esiNumber: employee.esi_number,
        bankAccountHolderName: employee.bank_account_holder_name,
        bankAccountNo: employee.bank_account_no,
        bankIfsc: employee.bank_ifsc,
        bankName: employee.bank_name,
      }}
      company={{
        name: company?.name ?? "",
        logoUrl: company?.logo_url ?? null,
        address: profile?.address ?? null,
        phone: profile?.phone ?? null,
        email: profile?.email ?? null,
      }}
      payment={{
        grossSalary: Number(payment.gross_salary),
        basicAmount: payment.basic_amount === null ? null : Number(payment.basic_amount),
        hraAmount: payment.hra_amount === null ? null : Number(payment.hra_amount),
        specialAllowanceAmount: payment.special_allowance_amount === null ? null : Number(payment.special_allowance_amount),
        attendanceDeductionAmount: Number(payment.attendance_deduction_amount),
        advanceDeductionAmount: Number(payment.advance_deduction_amount),
        employeePfAmount: Number(payment.employee_pf_amount),
        employerPfAmount: Number(payment.employer_pf_amount),
        employeeEsiAmount: Number(payment.employee_esi_amount),
        employerEsiAmount: Number(payment.employer_esi_amount),
        professionalTaxAmount: Number(payment.professional_tax_amount),
        netPaidAmount: Number(payment.net_paid_amount),
        paymentDate: payment.payment_date,
        remark: payment.remark,
      }}
    />
  );
}
