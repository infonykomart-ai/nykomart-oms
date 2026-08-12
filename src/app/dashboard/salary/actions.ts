"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { daysInMonth, todayIST } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories, computeDeduction } from "@/lib/attendance/payroll";

export type SimpleActionState = { error: string | null; success: boolean };

/**
 * Sets an employee's salary FROM a given date onward — inserts a new
 * versioned row rather than updating in place, so payroll for earlier
 * months (already run/reported) keeps using the salary that was actually
 * in effect then, not today's number. See src/lib/attendance/payroll.ts's
 * comment on the deduction convention this feeds into.
 */
export async function setEmployeeSalary(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const admin = await requireCapability("salary_admin");
  const employeeId = String(formData.get("employee_id") || "").trim();
  const monthlySalary = Number(formData.get("monthly_salary"));
  const allowedLeaves = Number(formData.get("allowed_leaves_per_month") || 1);
  const effectiveFrom = String(formData.get("effective_from") || "").trim();

  if (!employeeId) return { error: "Employee is required.", success: false };
  if (!monthlySalary || monthlySalary <= 0) return { error: "Monthly salary must be a positive number.", success: false };
  if (!effectiveFrom) return { error: "Effective From date is required.", success: false };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("employee_salary").insert({
    employee_id: employeeId,
    monthly_salary: monthlySalary,
    allowed_leaves_per_month: allowedLeaves,
    effective_from: effectiveFrom,
    entered_by_employee_id: admin.id,
  });
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/salary");
  return { error: null, success: true };
}

// =============================================================================
// 2026-08-12 (round 7): "attendance & attendance admin & sallery & advance
// ek dusre se attech honge, jitni sellery debit hoyegi account se to uska
// bhi konse section me jayegi finance ke" + "sellery advance vala bhi
// sahi se kaam nahi kar raha ... agar kisi ne advance liya hai to HR
// section se connect hokar yaha reflact hona chahiye". Two real, durable
// events (previously neither existed at all — see
// db/2026-08-12-finance-salary-advance.sql for the full design note):
//   - giveAdvance: money actually handed to an employee right now.
//   - submitSalaryPayment: salary actually paid for one employee/month,
//     recomputed fresh from Attendance server-side (never trusts a
//     client-submitted deduction figure), optionally recovering part of
//     an outstanding advance.
// BOTH auto-insert a mirror row into bill_pass_register the moment they
// run — that is the literal answer to "konse section me jayegi finance
// ke": the same ledger every vendor/courier bill already uses.
// =============================================================================

export type FinanceActionState = { error: string | null; success: boolean; message?: string };

/** Employee Advance — a real loan given right now, tracked until recovered. */
export async function giveAdvance(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const admin = await requireCapability("salary_admin");
  const supabase = createServiceRoleClient();

  const employeeId = String(formData.get("employee_id") || "").trim();
  const amount = Number(formData.get("amount"));
  const dateGiven = String(formData.get("date_given") || "").trim();
  const reason = String(formData.get("reason") || "").trim() || null;

  if (!employeeId) return { error: "Employee is required.", success: false };
  if (!amount || amount <= 0) return { error: "Amount must be a positive number.", success: false };
  if (!dateGiven) return { error: "Date is required.", success: false };

  // company_id is always derived from the employee row itself, never
  // trusted from the client — matches every other action in this app.
  const { data: emp, error: empError } = await supabase.from("employees").select("id, name, company_id").eq("id", employeeId).single();
  if (empError || !emp) return { error: "Employee not found.", success: false };
  // The employee dropdown only ever lists this admin's own-company team,
  // but that's a client-side restriction — a salary_admin scoped to one
  // company could otherwise target an employee at a different company by
  // posting an arbitrary employee_id directly to this action.
  if (!admin.companyIds.includes(emp.company_id)) return { error: "Employee not found.", success: false };

  const { data: advance, error } = await supabase
    .from("employee_advances")
    .insert({
      employee_id: employeeId,
      company_id: emp.company_id,
      amount,
      date_given: dateGiven,
      reason,
      given_by_employee_id: admin.id,
    })
    .select("id")
    .single();
  if (error || !advance) return { error: error?.message ?? "Failed to save advance.", success: false };

  // Auto-mirror into the Finance ledger — money left the company account
  // the moment this was given, paid in full immediately (an advance isn't
  // a "payable owed to someone else", it's already gone out).
  const { error: bprError } = await supabase.from("bill_pass_register").insert({
    company_id: emp.company_id,
    invoice_type: "Advance",
    invoice_date: dateGiven,
    invoice_recv_date: dateGiven,
    total_amt: amount,
    total_paid: amount,
    employee_id: employeeId,
    source: "employee_advance",
    source_id: advance.id,
    remark: `Advance — ${emp.name}${reason ? ` — ${reason}` : ""}`,
  });
  if (bprError) {
    // The advance itself is real and already saved — surface this as a
    // partial-success warning rather than losing the advance record.
    return { error: `Advance saved, but Finance ledger entry failed: ${bprError.message}`, success: true };
  }

  revalidatePath("/dashboard/salary");
  revalidatePath("/dashboard/admin/employees");
  return { error: null, success: true, message: `Advance of ₹${amount} recorded for ${emp.name}.` };
}

/**
 * Salary Payment — the ACTUAL "salary was paid" event, distinct from the
 * payroll table's live PREVIEW. Every number is recomputed here from
 * Attendance server-side (never trusts whatever the client's browser
 * happened to be showing), so it can never drift from what the
 * Attendance/Payroll screens themselves would compute for that month.
 */
export async function submitSalaryPayment(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const admin = await requireCapability("salary_admin");
  const supabase = createServiceRoleClient();

  const employeeId = String(formData.get("employee_id") || "").trim();
  const payMonth = String(formData.get("pay_month") || "").trim(); // "YYYY-MM"
  const paymentDate = String(formData.get("payment_date") || "").trim();
  const advanceDeductionRequested = Number(formData.get("advance_deduction_amount") || 0);
  const remark = String(formData.get("remark") || "").trim() || null;

  if (!employeeId) return { error: "Employee is required.", success: false };
  if (!/^\d{4}-\d{2}$/.test(payMonth)) return { error: "Pay month is required.", success: false };
  if (!paymentDate) return { error: "Payment date is required.", success: false };

  const today = todayIST();
  const [year, month] = payMonth.split("-").map(Number);
  const monthStart = `${payMonth}-01`;
  // `${payMonth}-31` is an invalid Postgres date for 5 of 12 months (Apr/
  // Jun/Sep/Nov have 30 days, Feb has 28/29) — a query filtered .lte(...,
  // that invalid string) silently errors and Supabase just returns no
  // rows, which made the payroll recompute treat the whole month as
  // "no salary set" / "no attendance". Use the real last day of the month.
  const monthEnd = `${payMonth}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  const { data: emp, error: empError } = await supabase
    .from("employees")
    .select("id, name, company_id, date_of_joining")
    .eq("id", employeeId)
    .single();
  if (empError || !emp) return { error: "Employee not found.", success: false };
  // Same company-scoping gap as giveAdvance — the client-side dropdown
  // isn't a security boundary.
  if (!admin.companyIds.includes(emp.company_id)) return { error: "Employee not found.", success: false };

  const [{ data: company }, { data: salaryRows }, { data: attendanceRows }, { data: holidays }] = await Promise.all([
    supabase.from("companies").select("weekly_off_days").eq("id", emp.company_id).single(),
    supabase
      .from("employee_salary")
      .select("monthly_salary, allowed_leaves_per_month, effective_from")
      .eq("employee_id", employeeId)
      .lte("effective_from", monthEnd)
      .order("effective_from", { ascending: false })
      .limit(1),
    supabase.from("attendance").select("attendance_date, status").eq("employee_id", employeeId).gte("attendance_date", monthStart).lte("attendance_date", monthEnd),
    supabase.from("holidays").select("holiday_date").or(`company_id.eq.${emp.company_id},company_id.is.null`).gte("holiday_date", monthStart).lte("holiday_date", monthEnd),
  ]);

  const salary = salaryRows?.[0];
  if (!salary) return { error: "No salary set for this employee yet — set it above first.", success: false };

  const attendanceByDate = new Map((attendanceRows ?? []).map((r) => [r.attendance_date, { status: r.status }]));
  const holidayDates = new Set((holidays ?? []).map((h) => h.holiday_date));
  const days = categorizeMonth({
    year,
    month,
    weeklyOffDays: (company?.weekly_off_days as number[] | undefined) ?? [0],
    holidayDates,
    attendanceByDate,
    // A past pay-month should never treat any of its days as "Future", but
    // for the CURRENT in-progress month `todayStr` must be the real today
    // — the old `${payMonth}-31` here was always "end of month", meaning
    // "Pay Salary" clicked mid-month would recompute a deduction for days
    // that haven't happened yet, diverging from what the preview table
    // (page.tsx, which correctly uses today) had just shown the admin.
    todayStr: today,
    joinDate: emp.date_of_joining,
  });
  const summary = summarizeCategories(days);
  const deduction = computeDeduction({
    monthlySalary: Number(salary.monthly_salary),
    allowedLeavesPerMonth: Number(salary.allowed_leaves_per_month),
    daysInThisMonth: daysInMonth(year, month),
    counts: summary,
  });

  // Advance recovery — always against the SINGLE oldest still-outstanding
  // advance (simplest correct v1: a later payment keeps recovering the
  // same oldest advance until it's fully cleared, then automatically
  // moves to the next one). Clamped to what's actually outstanding.
  let advanceId: string | null = null;
  let advanceDeduction = 0;
  if (advanceDeductionRequested > 0) {
    const { data: oldestAdvance } = await supabase
      .from("employee_advances")
      .select("id, outstanding_amount")
      .eq("employee_id", employeeId)
      .gt("outstanding_amount", 0)
      .order("date_given", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oldestAdvance) {
      advanceId = oldestAdvance.id;
      advanceDeduction = Math.min(advanceDeductionRequested, Number(oldestAdvance.outstanding_amount));
    }
  }

  const { data: payment, error } = await supabase
    .from("salary_payments")
    .insert({
      employee_id: employeeId,
      company_id: emp.company_id,
      pay_month: monthStart,
      gross_salary: Number(salary.monthly_salary),
      attendance_deduction_amount: deduction.deductionAmount,
      advance_deduction_amount: advanceDeduction,
      advance_id: advanceId,
      payment_date: paymentDate,
      paid_by_employee_id: admin.id,
      remark,
    })
    .select("id, net_paid_amount")
    .single();

  if (error || !payment) {
    const msg = error?.code === "23505" ? `${emp.name}'s salary for ${payMonth} has already been paid.` : error?.message;
    return { error: msg ?? "Failed to save salary payment.", success: false };
  }

  // Recover part of the outstanding advance, if any was applied. Uses the
  // atomic recover_employee_advance() Postgres function (single-statement
  // `SET recovered_amount = recovered_amount + p_amount`) rather than a
  // read-then-write in JS — two concurrent salary payments for the same
  // employee (different pay_month, so not blocked by salary_payments' own
  // UNIQUE guard) could otherwise both read the same starting value and
  // one update would silently clobber the other's recovery.
  if (advanceId && advanceDeduction > 0) {
    const { error: recoverError } = await supabase.rpc("recover_employee_advance", {
      p_advance_id: advanceId,
      p_amount: advanceDeduction,
    });
    if (recoverError) {
      // The payment itself is already saved — surface this as a
      // partial-success warning rather than losing the payment record.
      return {
        error: `Salary paid, but advance recovery failed: ${recoverError.message}. Please adjust the advance manually.`,
        success: true,
      };
    }
  }

  // Auto-mirror into the Finance ledger — THIS is what answers "jitni
  // sellery debit hoyegi account se to uska bhi konse section me jayegi
  // finance ke": the same bill_pass_register every vendor/courier bill
  // already uses. Paid in full immediately (a salary payment IS the
  // payment, not a pending payable).
  const { error: bprError } = await supabase.from("bill_pass_register").insert({
    company_id: emp.company_id,
    invoice_type: "Salary",
    invoice_date: paymentDate,
    invoice_recv_date: paymentDate,
    total_amt: Number(payment.net_paid_amount ?? 0),
    total_paid: Number(payment.net_paid_amount ?? 0),
    employee_id: employeeId,
    source: "salary_payment",
    source_id: payment.id,
    remark: `Salary — ${emp.name} — ${payMonth}${remark ? ` — ${remark}` : ""}`,
  });
  if (bprError) {
    return { error: `Salary paid, but Finance ledger entry failed: ${bprError.message}`, success: true };
  }

  revalidatePath("/dashboard/salary");
  revalidatePath("/dashboard/admin/employees");
  return { error: null, success: true, message: `₹${Number(payment.net_paid_amount ?? 0)} paid to ${emp.name} for ${payMonth}.` };
}

/**
 * Manual Bill Pass Register entry — for a plain vendor bill that isn't
 * one of Document Entry's own shapes (Purchase/Courier/Duty already have
 * their own forms at /dashboard/documents and are NOT meant to be
 * re-entered here too) — this is the general-purpose fallback the old
 * "NYKO MART Master Bill Pass File" format itself allowed for anything
 * else (Printing/Washing/Disbursement FEE/Service/JOB WORK).
 */
export async function addBillPassEntry(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const admin = await requireCapability("salary_admin");
  const supabase = createServiceRoleClient();

  const companyId = String(formData.get("company_id") || "").trim();
  const partyId = String(formData.get("party_id") || "").trim() || null;
  const invoiceType = String(formData.get("invoice_type") || "").trim() || null;
  const invoiceNo = String(formData.get("invoice_no") || "").trim() || null;
  const vendorInvoiceNo = String(formData.get("vendor_invoice_no") || "").trim() || null;
  const invoiceDate = String(formData.get("invoice_date") || "").trim() || null;
  const invoiceRecvDate = String(formData.get("invoice_recv_date") || "").trim() || null;
  const totalAmt = Number(formData.get("total_amt") || 0);
  const creditNoteAmt = Number(formData.get("credit_note_amt") || 0);
  const totalPaid = Number(formData.get("total_paid") || 0);
  const remark = String(formData.get("remark") || "").trim() || null;

  if (!companyId) return { error: "Company is required.", success: false };
  // company_id comes straight from a hidden form field (FinanceLedger sets
  // it to the page's selected company) — without this check, any
  // salary_admin holder could post an arbitrary company_id and insert a
  // fabricated ledger row into a company they have no access to at all.
  if (!admin.companyIds.includes(companyId)) return { error: "You don't have access to that company.", success: false };
  if (!totalAmt || totalAmt <= 0) return { error: "Total Amt must be a positive number.", success: false };

  const { error } = await supabase.from("bill_pass_register").insert({
    company_id: companyId,
    party_id: partyId,
    invoice_type: invoiceType as never,
    invoice_no: invoiceNo,
    vendor_invoice_no: vendorInvoiceNo,
    invoice_date: invoiceDate,
    invoice_recv_date: invoiceRecvDate,
    total_amt: totalAmt,
    credit_note_amt: creditNoteAmt,
    total_paid: totalPaid,
    remark,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/salary");
  return { error: null, success: true, message: "Bill Pass Register entry saved." };
}
