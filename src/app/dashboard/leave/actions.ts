"use server";

// 2026-08-12 (round 8): "LEAVE REQUESST BHEJ DU APPLIATION KE SATH TO VO MD
// KE PASS APPROVAL KE LIYE CHLI JAYE. MERI LEAVE JESE APPROVE HO JAYE TO MD
// ADMIN KO YE POWER HO KI MERI ABSENCE ME WORK KON KAREGA USKO ASSING KARNE
// PAR AUTO MATIC ROLE ME ACTIN HO JAYE ... AMAZON KE STORE KE LIYE MUJHE JO
// ACCES MILNE CHAHIYE MD ADMIN KE APPROVE KARTE HI HO JAYE."
//
// Three real, durable events, all new this round (see
// db/2026-08-12-leave-requests-coverage.sql for the full schema design):
//   - submitLeaveRequest: an employee applies for a date range, with an
//     application/reason text, status starts Pending.
//   - decideLeaveRequest: MD/Admin approves or rejects. On Approve, this
//     ALSO auto-marks the employee's Attendance as "Leave" for every
//     working day in the range (skipping days that are already a Holiday
//     or that employee's Week Off — an explicit attendance row always
//     wins over the derived Holiday/Week-Off guess in categorizeMonth, so
//     writing "Leave" over what would have been a free Holiday/Week-Off
//     day would wrongly start eating into the Leave allowance) — this is
//     the literal "attendance & leave ek dusre se connect ho" wiring: an
//     approved leave now shows up correctly on the Salary payroll
//     preview/Attendance Admin screens without anyone re-typing it there.
//   - assignCoverage / removeCoverage: once Approved, MD/Admin can assign
//     another employee to cover a specific store for some/all of the
//     approved range. That row is itself the access grant — see
//     getAuthedEmployee() in src/lib/auth/require-capability.ts, which
//     computes "does this login have an active coverage assignment right
//     now" fresh on every request, so access starts the instant this is
//     saved and ends automatically after to_date.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { addDaysToDateStr, istDayOfWeek } from "@/lib/attendance/ist-date";
import { allocateLeaveDays } from "@/lib/attendance/leave-balance";

export type LeaveActionState = { error: string | null; success: boolean; message?: string };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** All "YYYY-MM-DD" dates from fromDate to toDate inclusive. Bounded to a sane range (see submitLeaveRequest). */
function dateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let d = fromDate;
  while (d <= toDate) {
    dates.push(d);
    d = addDaysToDateStr(d, 1);
  }
  return dates;
}

const MAX_LEAVE_DAYS = 90; // sanity bound — a single request spanning more than this is almost certainly a typo'd date

export async function submitLeaveRequest(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const employee = await requireCapability("leave_management");
  const supabase = createServiceRoleClient();

  const fromDate = str(formData, "from_date");
  const toDate = str(formData, "to_date");
  const reason = str(formData, "reason");
  // 2026-09-11 (Payroll Phase 2): optional — "" (the default "General /
  // Unspecified" option) keeps this request untyped, governed by the
  // original flat allowed_leaves_per_month pool exactly as before this
  // round. A company that hasn't set up any leave_types never sees this
  // field at all (see leave-request-form.tsx).
  const leaveTypeId = str(formData, "leave_type_id") || null;

  if (!fromDate || !toDate) return { error: "From and To dates are both required.", success: false };
  if (toDate < fromDate) return { error: "To date cannot be before From date.", success: false };
  if (!reason) return { error: "Please write a short application/reason for the leave.", success: false };
  if (dateRange(fromDate, toDate).length > MAX_LEAVE_DAYS) {
    return { error: `That's more than ${MAX_LEAVE_DAYS} days in one request — please double-check the dates.`, success: false };
  }

  if (leaveTypeId) {
    // Never trust a leave_type_id posted from the client at face value — it
    // must be a real, active leave type belonging to this employee's own
    // company (same "client dropdown isn't a security boundary" lesson as
    // every other action in this app).
    const { data: leaveType } = await supabase
      .from("leave_types")
      .select("id, company_id, active")
      .eq("id", leaveTypeId)
      .maybeSingle();
    if (!leaveType || leaveType.company_id !== employee.currentCompanyId || !leaveType.active) {
      return { error: "That leave type isn't available — refresh and try again.", success: false };
    }
  }

  const { error } = await supabase.from("leave_requests").insert({
    employee_id: employee.id,
    company_id: employee.currentCompanyId,
    from_date: fromDate,
    to_date: toDate,
    reason,
    leave_type_id: leaveTypeId,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/leave");
  revalidatePath("/dashboard/leave/admin");
  return { error: null, success: true, message: "Leave request sent for approval." };
}

export async function decideLeaveRequest(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const admin = await requireCapability("leave_admin");
  const supabase = createServiceRoleClient();

  const leaveRequestId = str(formData, "leave_request_id");
  const decision = str(formData, "decision"); // "Approved" | "Rejected"
  const decisionRemark = str(formData, "decision_remark") || null;

  if (!leaveRequestId) return { error: "Leave request is required.", success: false };
  if (decision !== "Approved" && decision !== "Rejected") return { error: "Invalid decision.", success: false };

  const { data: leave, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id, employee_id, company_id, from_date, to_date, status, leave_type_id")
    .eq("id", leaveRequestId)
    .single();
  if (leaveError || !leave) return { error: "Leave request not found.", success: false };
  if (!admin.companyIds.includes(leave.company_id)) return { error: "Leave request not found.", success: false };
  if (leave.status !== "Pending") return { error: "This leave request has already been decided.", success: false };

  // Compare-and-swap on status, not just a check-then-act read above — two
  // near-simultaneous decisions (double-click, or two admins) could both
  // read status="Pending" before either writes. Scoping the UPDATE itself
  // to WHERE status = 'Pending' makes only the first one actually land;
  // .select() + checking the returned row count tells us whether we won.
  const { data: updated, error: updateError } = await supabase
    .from("leave_requests")
    .update({
      status: decision as never,
      decided_by_employee_id: admin.id,
      decided_at: new Date().toISOString(),
      decision_remark: decisionRemark,
    })
    .eq("id", leaveRequestId)
    .eq("status", "Pending")
    .select("id");
  if (updateError) return { error: updateError.message, success: false };
  if (!updated || updated.length === 0) {
    return { error: "This leave request was just decided by someone else — refresh and check its current status.", success: false };
  }

  if (decision === "Approved") {
    // Auto-mark Attendance as "Leave" for every working day in the range —
    // skip days that would otherwise be a free Holiday/Week Off, since an
    // explicit attendance row always outranks the derived guess in
    // categorizeMonth (src/lib/attendance/payroll.ts) and would wrongly
    // start eating into the employee's Leave allowance on what should have
    // been a free day.
    const [{ data: company }, { data: holidays }] = await Promise.all([
      supabase.from("companies").select("weekly_off_days").eq("id", leave.company_id).single(),
      supabase
        .from("holidays")
        .select("holiday_date")
        .or(`company_id.eq.${leave.company_id},company_id.is.null`)
        .gte("holiday_date", leave.from_date)
        .lte("holiday_date", leave.to_date),
    ]);
    const weeklyOffDays = (company?.weekly_off_days as number[] | undefined) ?? [0];
    const holidayDates = new Set((holidays ?? []).map((h) => h.holiday_date));

    const qualifyingDates = dateRange(leave.from_date, leave.to_date).filter(
      (date) => !holidayDates.has(date) && !weeklyOffDays.includes(istDayOfWeek(date))
    );

    // 2026-09-11 (Payroll Phase 2): when this request is against a real
    // leave type, decide PAID vs UNPAID for every qualifying day ONCE,
    // right here, by walking the days chronologically against that leave
    // type's real balance (src/lib/attendance/leave-balance.ts) — never
    // recomputed later, so an already-run payslip never silently changes.
    // An untyped request (leaveTypeId === null) keeps EXACTLY the original
    // behavior: no leave_type_id/leave_unpaid written, governed entirely
    // by the flat allowed_leaves_per_month pool at payroll time.
    const unpaidByDate = new Map<string, boolean>();
    if (leave.leave_type_id) {
      const [{ data: leaveType }, { data: emp }] = await Promise.all([
        supabase
          .from("leave_types")
          .select("id, paid, annual_accrual_days, accrual_frequency")
          .eq("id", leave.leave_type_id)
          .single(),
        supabase.from("employees").select("date_of_joining").eq("id", leave.employee_id).single(),
      ]);
      if (leaveType) {
        // A request can cross a Dec 31 → Jan 1 boundary — each calendar
        // year has its own accrual/adjustments/used-days, so group the
        // qualifying days by leave year and allocate each group separately,
        // in chronological order (years ascending, days already ascending
        // within each from dateRange's own order).
        const byYear = new Map<number, string[]>();
        for (const date of qualifyingDates) {
          const y = Number(date.slice(0, 4));
          const list = byYear.get(y) ?? [];
          list.push(date);
          byYear.set(y, list);
        }
        for (const [leaveYear, yearDates] of Array.from(byYear.entries()).sort((a, b) => a[0] - b[0])) {
          const yearStart = `${leaveYear}-01-01`;
          const yearEnd = `${leaveYear}-12-31`;
          const [{ data: adjustments }, { count: usedCount }] = await Promise.all([
            supabase
              .from("leave_balance_adjustments")
              .select("adjustment_days")
              .eq("employee_id", leave.employee_id)
              .eq("leave_type_id", leave.leave_type_id)
              .eq("leave_year", leaveYear),
            supabase
              .from("attendance")
              .select("id", { count: "exact", head: true })
              .eq("employee_id", leave.employee_id)
              .eq("leave_type_id", leave.leave_type_id)
              .eq("status", "Leave")
              .eq("leave_unpaid", false)
              .gte("attendance_date", yearStart)
              .lte("attendance_date", yearEnd),
          ]);
          const adjustmentDaysTotal = (adjustments ?? []).reduce((sum, a) => sum + Number(a.adjustment_days), 0);
          const allocation = allocateLeaveDays({
            dates: yearDates,
            leaveType: {
              paid: leaveType.paid,
              annual_accrual_days: Number(leaveType.annual_accrual_days),
              accrual_frequency: leaveType.accrual_frequency as "Monthly" | "Upfront",
            },
            leaveYear,
            joinDate: emp?.date_of_joining ?? null,
            adjustmentDaysTotal,
            usedDaysBeforeThisRequest: usedCount ?? 0,
          });
          for (const a of allocation) unpaidByDate.set(a.date, a.unpaid);
        }
      }
    }

    for (const date of qualifyingDates) {
      const { data: existing } = await supabase
        .from("attendance")
        .select("id, status")
        .eq("employee_id", leave.employee_id)
        .eq("attendance_date", date)
        .maybeSingle();
      // A real attendance row already there — e.g. the employee punched in
      // and was marked Present before the admin got around to approving a
      // same-day/already-in-progress leave request — must never be
      // silently clobbered by this auto-write. Only overwrite a day that's
      // currently empty, Absent, or already Leave (a harmless re-write).
      if (existing?.status && !["Absent", "Leave"].includes(existing.status)) continue;
      const leaveTypeId = leave.leave_type_id ?? null;
      const leaveUnpaid = leaveTypeId ? (unpaidByDate.get(date) ?? true) : false;
      if (existing) {
        await supabase
          .from("attendance")
          .update({
            status: "Leave" as never,
            remark: "Approved leave request",
            entered_by_employee_id: admin.id,
            leave_type_id: leaveTypeId,
            leave_unpaid: leaveUnpaid,
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("attendance").insert({
          employee_id: leave.employee_id,
          company_id: leave.company_id,
          attendance_date: date,
          status: "Leave" as never,
          source: "Manual Entry",
          remark: "Approved leave request",
          entered_by_employee_id: admin.id,
          leave_type_id: leaveTypeId,
          leave_unpaid: leaveUnpaid,
        });
      }
    }
    revalidatePath("/dashboard/attendance/admin");
    revalidatePath("/dashboard/salary");
  }

  revalidatePath("/dashboard/leave");
  revalidatePath("/dashboard/leave/admin");
  return { error: null, success: true, message: `Leave request ${decision.toLowerCase()}.` };
}

export async function assignCoverage(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const admin = await requireCapability("leave_admin");
  const supabase = createServiceRoleClient();

  const leaveRequestId = str(formData, "leave_request_id");
  const coveringEmployeeId = str(formData, "covering_employee_id");
  const storeId = str(formData, "store_id");
  const fromDate = str(formData, "from_date");
  const toDate = str(formData, "to_date");
  const remark = str(formData, "remark") || null;

  if (!leaveRequestId || !coveringEmployeeId || !storeId) {
    return { error: "Covering employee and store are both required.", success: false };
  }
  if (!fromDate || !toDate) return { error: "From and To dates are both required.", success: false };
  if (toDate < fromDate) return { error: "To date cannot be before From date.", success: false };

  const { data: leave, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id, company_id, from_date, to_date, status")
    .eq("id", leaveRequestId)
    .single();
  if (leaveError || !leave) return { error: "Leave request not found.", success: false };
  if (!admin.companyIds.includes(leave.company_id)) return { error: "Leave request not found.", success: false };
  if (leave.status !== "Approved") return { error: "Only an approved leave request can have coverage assigned.", success: false };
  // Coverage can't grant access for longer than the leave itself was
  // approved for — clamp the window to what MD actually signed off on.
  if (fromDate < leave.from_date || toDate > leave.to_date) {
    return { error: `Coverage dates must fall within the approved leave window (${leave.from_date} to ${leave.to_date}).`, success: false };
  }

  const [{ data: coveringEmp }, { data: store }] = await Promise.all([
    supabase.from("employees").select("id, company_id").eq("id", coveringEmployeeId).single(),
    supabase.from("stores").select("id, company_id").eq("id", storeId).single(),
  ]);
  if (!coveringEmp || !admin.companyIds.includes(coveringEmp.company_id)) {
    return { error: "Covering employee not found.", success: false };
  }
  if (!store || !admin.companyIds.includes(store.company_id)) {
    return { error: "Store not found.", success: false };
  }
  // Each side was only checked against the ADMIN's own companyIds above —
  // for an admin who manages multiple companies, that alone wouldn't stop
  // a crafted submission from granting access to a store in a DIFFERENT
  // company than the one this leave request is actually for. The store
  // being covered must belong to the same company as the leave itself.
  if (store.company_id !== leave.company_id) {
    return { error: "That store doesn't belong to this leave request's company.", success: false };
  }

  const { error } = await supabase.from("leave_coverage_assignments").insert({
    leave_request_id: leaveRequestId,
    covering_employee_id: coveringEmployeeId,
    store_id: storeId,
    from_date: fromDate,
    to_date: toDate,
    assigned_by_employee_id: admin.id,
    remark,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/leave/admin");
  return { error: null, success: true, message: "Coverage assigned — store access is active for the assigned dates." };
}

// =============================================================================
// 2026-09-11 (Payroll Phase 2): "leave types" — real, admin-configurable
// leave categories (Casual/Sick/Earned/...) with per-type accrual, on top
// of the existing request/approval workflow above. Gated by the SAME
// leave_admin capability as decideLeaveRequest — no new capability was
// needed. See db/2026-09-11-leave-types-and-balances.sql for the schema
// design and src/lib/attendance/leave-balance.ts for the accrual math.
// =============================================================================

/** Create or update a leave type. Pass `id` (hidden field) to update; omit it to create a new one. */
export async function manageLeaveType(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const admin = await requireCapability("leave_admin");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id") || null;
  const name = str(formData, "name");
  const code = str(formData, "code") || null;
  const paid = str(formData, "paid") !== "false"; // checkbox — default paid
  const annualAccrualDays = Number(formData.get("annual_accrual_days") || 0);
  const accrualFrequency = str(formData, "accrual_frequency") || "Monthly";
  const carryForwardCapRaw = str(formData, "carry_forward_cap");
  const carryForwardCap = carryForwardCapRaw ? Number(carryForwardCapRaw) : null;
  const active = str(formData, "active") !== "false";

  if (!name) return { error: "Leave type name is required.", success: false };
  if (annualAccrualDays < 0) return { error: "Annual accrual days can't be negative.", success: false };
  if (accrualFrequency !== "Monthly" && accrualFrequency !== "Upfront") {
    return { error: "Accrual frequency must be Monthly or Upfront.", success: false };
  }

  if (id) {
    // Confirm this leave type actually belongs to one of the admin's own
    // companies before allowing an update — same company-scoping guard as
    // every other write in this app.
    const { data: existing } = await supabase.from("leave_types").select("id, company_id").eq("id", id).maybeSingle();
    if (!existing || !admin.companyIds.includes(existing.company_id)) return { error: "Leave type not found.", success: false };
    const { error } = await supabase
      .from("leave_types")
      .update({
        name,
        code,
        paid,
        annual_accrual_days: annualAccrualDays,
        accrual_frequency: accrualFrequency as never,
        carry_forward_cap: carryForwardCap,
        active,
      })
      .eq("id", id);
    if (error) return { error: error.message, success: false };
  } else {
    const { error } = await supabase.from("leave_types").insert({
      company_id: admin.currentCompanyId,
      name,
      code,
      paid,
      annual_accrual_days: annualAccrualDays,
      accrual_frequency: accrualFrequency as never,
      carry_forward_cap: carryForwardCap,
      active,
    });
    if (error) {
      const msg = error.code === "23505" ? `A leave type named "${name}" already exists for this company.` : error.message;
      return { error: msg, success: false };
    }
  }

  revalidatePath("/dashboard/leave");
  revalidatePath("/dashboard/leave/admin");
  return { error: null, success: true, message: `Leave type "${name}" saved.` };
}

/**
 * Manual balance correction — opening/carry-forward balances migrated from
 * before this system existed, one-off extra grants, or fixing a mistake.
 * A durable ledger row, never a mutable counter (same philosophy as
 * employee_advances) — see leave-balance.ts's own comment on how these sum
 * into the live balance.
 */
export async function adjustLeaveBalance(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const admin = await requireCapability("leave_admin");
  const supabase = createServiceRoleClient();

  const employeeId = str(formData, "employee_id");
  const leaveTypeId = str(formData, "leave_type_id");
  const leaveYear = Number(formData.get("leave_year") || 0);
  const adjustmentDays = Number(formData.get("adjustment_days"));
  const reason = str(formData, "reason") || null;

  if (!employeeId || !leaveTypeId) return { error: "Employee and leave type are both required.", success: false };
  if (!leaveYear || !Number.isInteger(leaveYear)) return { error: "Leave year is required.", success: false };
  if (!adjustmentDays || Number.isNaN(adjustmentDays)) return { error: "Adjustment (days) must be a non-zero number.", success: false };

  const [{ data: emp }, { data: leaveType }] = await Promise.all([
    supabase.from("employees").select("id, company_id").eq("id", employeeId).single(),
    supabase.from("leave_types").select("id, company_id").eq("id", leaveTypeId).single(),
  ]);
  if (!emp || !admin.companyIds.includes(emp.company_id)) return { error: "Employee not found.", success: false };
  if (!leaveType || !admin.companyIds.includes(leaveType.company_id)) return { error: "Leave type not found.", success: false };
  if (leaveType.company_id !== emp.company_id) return { error: "That leave type doesn't belong to this employee's company.", success: false };

  const { error } = await supabase.from("leave_balance_adjustments").insert({
    employee_id: employeeId,
    leave_type_id: leaveTypeId,
    leave_year: leaveYear,
    adjustment_days: adjustmentDays,
    reason,
    entered_by_employee_id: admin.id,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/leave/admin");
  return { error: null, success: true, message: `Balance adjustment of ${adjustmentDays > 0 ? "+" : ""}${adjustmentDays} days saved.` };
}

export async function removeCoverage(coverageId: string): Promise<LeaveActionState> {
  const admin = await requireCapability("leave_admin");
  const supabase = createServiceRoleClient();

  // Plain queries rather than an embedded join (`leave_requests(company_id)`)
  // — same convention as require-capability.ts: the hand-rolled Database
  // type doesn't emit full Relationships metadata for every join shape.
  const { data: coverage, error: coverageError } = await supabase
    .from("leave_coverage_assignments")
    .select("id, leave_request_id")
    .eq("id", coverageId)
    .maybeSingle();
  if (coverageError || !coverage) return { error: "Coverage assignment not found.", success: false };

  const { data: leave } = await supabase.from("leave_requests").select("company_id").eq("id", coverage.leave_request_id).single();
  if (!leave || !admin.companyIds.includes(leave.company_id)) return { error: "Coverage assignment not found.", success: false };

  const { error } = await supabase.from("leave_coverage_assignments").delete().eq("id", coverageId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/leave/admin");
  return { error: null, success: true };
}
