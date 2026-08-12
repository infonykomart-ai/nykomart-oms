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

  if (!fromDate || !toDate) return { error: "From and To dates are both required.", success: false };
  if (toDate < fromDate) return { error: "To date cannot be before From date.", success: false };
  if (!reason) return { error: "Please write a short application/reason for the leave.", success: false };
  if (dateRange(fromDate, toDate).length > MAX_LEAVE_DAYS) {
    return { error: `That's more than ${MAX_LEAVE_DAYS} days in one request — please double-check the dates.`, success: false };
  }

  const { error } = await supabase.from("leave_requests").insert({
    employee_id: employee.id,
    company_id: employee.currentCompanyId,
    from_date: fromDate,
    to_date: toDate,
    reason,
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
    .select("id, employee_id, company_id, from_date, to_date, status")
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

    for (const date of dateRange(leave.from_date, leave.to_date)) {
      if (holidayDates.has(date)) continue;
      if (weeklyOffDays.includes(istDayOfWeek(date))) continue;

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
      if (existing) {
        await supabase
          .from("attendance")
          .update({ status: "Leave" as never, remark: "Approved leave request", entered_by_employee_id: admin.id })
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
