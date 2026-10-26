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
import { requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { addDaysToDateStr, istDayOfWeek, nowISOInstant, todayIST } from "@/lib/attendance/ist-date";
import { allocateLeaveDays } from "@/lib/attendance/leave-balance";
import { validateDateFields } from "@/lib/fy-date";
import { isMissingSchemaPiece } from "./leave-queries";

export type LeaveActionState = { error: string | null; success: boolean; message?: string };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// 2026-10-17 (leave audit + lifecycle): every real lifecycle transition
// writes an append-only row here — "kisne kab kya kiya" that survives any
// number of later modifications. Best-effort by design (same philosophy as
// everything else in this module): a failed audit insert never blocks the
// actual operation, it only logs.
async function logLeaveEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  leaveRequestId: string,
  eventType: "Applied" | "Approved" | "Rejected" | "Cancelled" | "Half Day" | "Shortened",
  actorEmployeeId: string,
  details: string | null
): Promise<void> {
  const { error } = await supabase.from("leave_request_events").insert({
    leave_request_id: leaveRequestId,
    event_type: eventType,
    actor_employee_id: actorEmployeeId,
    details,
  });
  if (error) console.error("[leave/actions] logLeaveEvent failed", error.message);
}

/**
 * 2026-10-17 — the auto-marked "Approved leave request" attendance rows
 * for a request's date range (CANCELLED / SHORTENED cleanup). Deletes ONLY
 * rows this module itself wrote (remark = 'Approved leave request') that
 * are still status 'Leave' — a day the employee actually punched (kept as
 * Present by decideLeaveRequest's own guard) or an admin-entered row is
 * never touched.
 */
async function removeAutoMarkedLeaveDays(
  supabase: ReturnType<typeof createServiceRoleClient>,
  employeeId: string,
  fromDate: string,
  toDate: string
): Promise<void> {
  if (toDate < fromDate) return;
  // Prefix match + both statuses on purpose: a day converted by
  // markLeaveHalfDay keeps a DIFFERENT remark ("Approved leave — half
  // day…"), and a full cancel must undo that conversion too — otherwise
  // a cancelled leave would still leave a 0.5-day deduction behind.
  await supabase
    .from("attendance")
    .delete()
    .eq("employee_id", employeeId)
    .in("status", ["Leave", "Half Day"])
    .like("remark", "Approved leave%")
    .gte("attendance_date", fromDate)
    .lte("attendance_date", toDate);
}

/**
 * Caller may act on a leave request only if it is their OWN request, or
 * they hold leave_admin in one of the request's company. Used by the
 * 2026-10-17 cancel/modify actions, which are available to both sides
 * ("vo apni leave approve ko cancel karvayega ya phir modify karvayega").
 */
function canActOnRequest(actor: AuthedEmployee, request: { employee_id: string; company_id: string }): boolean {
  if (request.employee_id === actor.id) return true;
  return actor.capabilities.includes("leave_admin") && actor.companyIds.includes(request.company_id);
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

  // 2026-10-20 — "kisi employee ki khud admin apsent application dale to vo
  // option bhi hona chahiye": MD/Admin can file the application FOR any
  // active employee of a company they have access to. The admin form posts
  // employee_id; when it is absent (or equals the caller) this is the
  // ordinary self-application path and nothing about it changes.
  const targetEmployeeIdRaw = str(formData, "employee_id");
  let targetEmployee = { id: employee.id, name: employee.name, companyId: employee.currentCompanyId };
  const filingForSomeoneElse = !!targetEmployeeIdRaw && targetEmployeeIdRaw !== employee.id;
  if (filingForSomeoneElse) {
    if (!employee.capabilities.includes("leave_admin")) {
      return { error: "Only MD/Admin can file a leave application for another employee.", success: false };
    }
    // Never trust the posted id (same "client dropdown isn't a security
    // boundary" rule as every other action): the target must be a real,
    // active employee of a company this login can actually act in.
    const { data: target } = await supabase
      .from("employees")
      .select("id, name, company_id, active")
      .eq("id", targetEmployeeIdRaw)
      .maybeSingle();
    if (!target || !target.active || !employee.companyIds.includes(target.company_id)) {
      return { error: "That employee isn't available for this company — refresh and try again.", success: false };
    }
    targetEmployee = { id: target.id, name: target.name, companyId: target.company_id };
  }
  // "Approve immediately" is offered only when an admin is filing on someone
  // else's behalf (an employee never approves their own application).
  const autoApprove = filingForSomeoneElse && str(formData, "auto_approve") === "on";

  const fromDate = str(formData, "from_date");
  const toDate = str(formData, "to_date");
  const reason = str(formData, "reason");
  // 2026-09-11 (Payroll Phase 2): optional — "" (the default "General /
  // Unspecified" option) keeps this request untyped, governed by the
  // original flat allowed_leaves_per_month pool exactly as before this
  // round. A company that hasn't set up any leave_types never sees this
  // field at all (see leave-request-form.tsx).
  const leaveTypeId = str(formData, "leave_type_id") || null;
  // 2026-10-19 — "jaruri nahi hai ki leave MD approve kare ... jisko leave
  // approval ke liye assign kiya jaye uska naam aaye selection option aaye".
  // Optional: which designated approver this application is being sent to.
  // Resolved against the DB below (never trusted from the client).
  const approverId = str(formData, "approver_employee_id") || null;
  // 2026-10-17 — application-time browser geolocation, best-effort exactly
  // like the punch buttons (GPS can never block a submission): the client
  // sends lat/lng only when the browser granted a fix; absent/garbage values
  // all normalize to NULL here.
  const appliedLatRaw = Number(formData.get("lat"));
  const appliedLngRaw = Number(formData.get("lng"));
  const appliedAccuracyRaw = Number(formData.get("accuracy_m"));
  const appliedLat = Number.isFinite(appliedLatRaw) && Math.abs(appliedLatRaw) <= 90 ? appliedLatRaw : null;
  const appliedLng = Number.isFinite(appliedLngRaw) && Math.abs(appliedLngRaw) <= 180 ? appliedLngRaw : null;
  const appliedAccuracyM =
    appliedLat !== null && appliedLng !== null && Number.isFinite(appliedAccuracyRaw) && appliedAccuracyRaw >= 0
      ? appliedAccuracyRaw
      : null;
  // 2026-10-20 — when MD/Admin files for an employee, the browser fix belongs
  // to the ADMIN's device, not the absent employee's, so it must never be
  // stored as the applicant's location. Self-applications keep it exactly as
  // before.
  const appliedLatToStore = filingForSomeoneElse ? null : appliedLat;
  const appliedLngToStore = filingForSomeoneElse ? null : appliedLng;
  const appliedAccuracyToStore = filingForSomeoneElse ? null : appliedAccuracyM;

  if (!fromDate || !toDate) return { error: "From and To dates are both required.", success: false };
  if (toDate < fromDate) return { error: "To date cannot be before From date.", success: false };
  if (!reason) return { error: "Please write a short application/reason for the leave.", success: false };
  if (dateRange(fromDate, toDate).length > MAX_LEAVE_DAYS) {
    return { error: `That's more than ${MAX_LEAVE_DAYS} days in one request — please double-check the dates.`, success: false };
  }
  // 2026-10-20 — back-dated applications are allowed on purpose ("agar back
  // date me daalni pade to uska bhi karna"), so this is NOT a "must not be in
  // the past" check — it is the same FY/real-calendar gate every other human
  // date entry in this app passes through (src/lib/fy-date.ts). Without it, a
  // typo'd year like 20026-10-01 would be saved and then auto-mark Attendance
  // in a month that does not exist. The window reaches 10 FYs back, i.e. it
  // never gets in the way of a genuine back-dated leave.
  const leaveDateError = validateDateFields([
    { value: fromDate, label: "From date" },
    { value: toDate, label: "To date" },
  ]);
  if (leaveDateError) return { error: leaveDateError, success: false };

  // A request whose From date is already behind us is a back-dated entry —
  // recorded in the audit trail (and echoed in the success message) so the
  // approver can see it was not applied for in advance.
  const isBackDated = fromDate < todayIST();

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
    if (!leaveType || leaveType.company_id !== targetEmployee.companyId || !leaveType.active) {
      return { error: "That leave type isn't available — refresh and try again.", success: false };
    }
  }

  // 2026-10-19 — resolve the chosen approver. Must be a REAL designated
  // approver for this company (or MD/Admin, who can always approve), never
  // an id the browser made up. An unknown/unassigned id is silently ignored
  // (falls back to "MD/Admin") rather than blocking the application: the
  // employee's primary goal is to submit, and the approver routing is
  // secondary.
  let approverToStamp: string | null = null;
  if (approverId) {
    const { data: approver } = await supabase
      .from("leave_approver_assignments")
      .select("employee_id")
      .eq("company_id", targetEmployee.companyId)
      .eq("employee_id", approverId)
      .maybeSingle();
    if (approver) approverToStamp = approver.employee_id;
  }

  // 2026-10-19 — the geo columns only exist once
  // db/2026-10-17-leave-audit-and-lifecycle.sql has been run. Applying for
  // leave must NOT depend on that: write the request itself first (the fields
  // the workflow has always had), then add the location when the database can
  // take it. "Leave request nahi dikh rahi" covered the read side; this is the
  // write side of the same missing-migration failure.
  const baseInsert = {
    // 2026-10-20 — the request belongs to the employee the leave is FOR, not
    // necessarily the login filing it (admin-on-behalf path above).
    employee_id: targetEmployee.id,
    company_id: targetEmployee.companyId,
    from_date: fromDate,
    to_date: toDate,
    reason,
    leave_type_id: leaveTypeId,
    approver_employee_id: approverToStamp,
  };
  let { data: created, error } = await supabase
    .from("leave_requests")
    .insert({ ...baseInsert, applied_lat: appliedLatToStore, applied_lng: appliedLngToStore, applied_accuracy_m: appliedAccuracyToStore })
    .select("id")
    .single();
  // Cascade: each step drops the newest optional column(s) on a
  // missing-migration error, oldest-first, so an application NEVER fails
  // just because a later migration hasn't run. Step 2 drops the geo columns
  // (2026-10-17), step 3 also drops approver_employee_id (2026-10-19).
  const withoutGeo = {
    employee_id: targetEmployee.id,
    company_id: targetEmployee.companyId,
    from_date: fromDate,
    to_date: toDate,
    reason,
    leave_type_id: leaveTypeId,
    approver_employee_id: approverToStamp,
  };
  const withoutGeoOrApprover = {
    employee_id: targetEmployee.id,
    company_id: targetEmployee.companyId,
    from_date: fromDate,
    to_date: toDate,
    reason,
    leave_type_id: leaveTypeId,
  };
  if (error && isMissingSchemaPiece(error)) {
    ({ data: created, error } = await supabase.from("leave_requests").insert(withoutGeo).select("id").single());
  }
  if (error && isMissingSchemaPiece(error)) {
    ({ data: created, error } = await supabase
      .from("leave_requests")
      .insert(withoutGeoOrApprover)
      .select("id")
      .single());
  }
  if (error || !created) return { error: error?.message ?? "Could not save the leave request.", success: false };

  // 2026-10-17 — "usme date & time nahi aata with location": requested_at
  // is the DB default now(), and the location fix (when granted) is echoed
  // back in the audit event so the trail reads human-legibly.
  await logLeaveEvent(
    supabase,
    created.id,
    "Applied",
    employee.id,
    [
      // 2026-10-20 — admin-on-behalf is a fact the approver timeline needs:
      // the request is the employee's, but it was not filed by him.
      filingForSomeoneElse ? `Filed by ${employee.name} (MD/Admin) for ${targetEmployee.name}` : null,
      // 2026-10-20 — the back-dated fact belongs in the trail: "kab apply
      // hui" (requested_at) alone cannot tell an approver that the leave
      // itself is for days already gone.
      isBackDated ? `Back-dated (${fromDate} is before today ${todayIST()})` : null,
      filingForSomeoneElse
        ? null
        : appliedLatToStore !== null && appliedLngToStore !== null
          ? `Location: ${appliedLatToStore.toFixed(5)}, ${appliedLngToStore.toFixed(5)}${appliedAccuracyToStore !== null ? ` (±${Math.round(appliedAccuracyToStore)}m)` : ""}`
          : "Location not shared",
    ]
      .filter(Boolean)
      .join(" · ")
  );

  // 2026-10-20 — optional "approve immediately" for the admin-on-behalf path
  // (an absent employee often reports on the phone, so the admin files AND
  // approves in one go). Reuses decideLeaveRequest so the Attendance marking,
  // audit trail and status CAS are exactly the same code, never a copy.
  if (autoApprove) {
    const approveFd = new FormData();
    approveFd.set("leave_request_id", created.id);
    approveFd.set("decision", "Approved");
    approveFd.set("decision_remark", `Filed and approved by ${employee.name} (MD/Admin) on behalf of ${targetEmployee.name}`);
    const decided = await decideLeaveRequest({ error: null, success: false }, approveFd);
    revalidatePath("/dashboard/leave");
    revalidatePath("/dashboard/leave/admin");
    if (decided.error) {
      return {
        error: null,
        success: true,
        message: `Application saved for ${targetEmployee.name}, but auto-approve failed: ${decided.error} Approve it from the list below.`,
      };
    }
    return {
      error: null,
      success: true,
      message: `Leave application filed for ${targetEmployee.name} and approved — Attendance for that range is marked 'Leave'.`,
    };
  }

  revalidatePath("/dashboard/leave");
  revalidatePath("/dashboard/leave/admin");
  return {
    error: null,
    success: true,
    message: filingForSomeoneElse
      ? `Leave application filed for ${targetEmployee.name} — approval is pending.`
      : isBackDated
        ? "Back-dated leave request sent for approval — Attendance for that range is marked 'Leave' as soon as it is approved."
        : "Leave request sent for approval.",
  };
}

export async function decideLeaveRequest(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  // 2026-10-19 — "jaruri nahi hai ki leave MD approve kare". This action used
  // to hard-require the leave_admin capability, which MD (Ajay Lohra / RD
  // Lohra) does NOT hold — so a request routed to MD could never be decided.
  // Now EITHER a leave_admin OR a designated leave approver for this company
  // may decide. leave_management is the floor every real login already has.
  const actor = await requireCapability("leave_management");
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
  if (!actor.companyIds.includes(leave.company_id)) return { error: "Leave request not found.", success: false };
  if (leave.status !== "Pending") return { error: "This leave request has already been decided.", success: false };

  // Authorization: leave_admin (MD/Admin) may decide any request of a company
  // they manage; anyone else must be a designated leave approver FOR THIS
  // request's company. Both checked against the request's own company_id, so a
  // login can never decide another company's leave.
  const isAdmin = actor.capabilities.includes("leave_admin");
  let isApprover = false;
  if (!isAdmin) {
    const { data: assignment } = await supabase
      .from("leave_approver_assignments")
      .select("id")
      .eq("company_id", leave.company_id)
      .eq("employee_id", actor.id)
      .maybeSingle();
    isApprover = Boolean(assignment);
  }
  if (!isAdmin && !isApprover) {
    return { error: "Only MD/Admin or a leave approver assigned to this company can decide leave requests.", success: false };
  }

  // Compare-and-swap on status, not just a check-then-act read above — two
  // near-simultaneous decisions (double-click, or two admins) could both
  // read status="Pending" before either writes. Scoping the UPDATE itself
  // to WHERE status = 'Pending' makes only the first one actually land;
  // .select() + checking the returned row count tells us whether we won.
  const { data: updated, error: updateError } = await supabase
    .from("leave_requests")
    .update({
      status: decision as never,
      decided_by_employee_id: actor.id,
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

  // 2026-10-17 — "approve hone ke baad ye bhi aana chahiye ki leave approve
  // kisne ki hai kis time par ki hai": decided_by/decided_at were already
  // stored above; the audit event mirrors the same fact into the timeline.
  await logLeaveEvent(supabase, leaveRequestId, decision as "Approved" | "Rejected", actor.id, decisionRemark);

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
            entered_by_employee_id: actor.id,
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
          entered_by_employee_id: actor.id,
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

// =============================================================================
// 2026-10-19 — leave approvers ("jaruri nahi hai ki leave MD approve kare ...
// jisko leave approval ke liye assign kiya jaye uska naam aaye selection
// option aaye"). Admin (leave_admin) designates any active employee as a
// leave approver for the selected company. That person then appears by name
// on the Apply form and can decide requests without holding leave_admin.
// =============================================================================

/** Designate an employee as a leave approver for `companyId`. */
export async function assignLeaveApprover(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const admin = await requireCapability("leave_admin");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const employeeId = str(formData, "employee_id");
  if (!companyId || !employeeId) return { error: "Employee is required.", success: false };
  if (!admin.companyIds.includes(companyId)) return { error: "Company not found.", success: false };

  // Same "client dropdown isn't a security boundary" lesson as everywhere:
  // the employee must be a real, active employee OF THIS company.
  const { data: emp } = await supabase
    .from("employees")
    .select("id, company_id, active, name")
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp || emp.company_id !== companyId || !emp.active) {
    return { error: "Employee not found (must be active in this company).", success: false };
  }

  const { error } = await supabase
    .from("leave_approver_assignments")
    .upsert(
      { company_id: companyId, employee_id: employeeId, assigned_by_employee_id: admin.id },
      { onConflict: "company_id,employee_id" }
    );
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/leave/admin");
  return { error: null, success: true, message: `${emp.name} can now approve leave.` };
}

/** Remove a designated leave approver for `companyId`. */
export async function removeLeaveApprover(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const admin = await requireCapability("leave_admin");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const employeeId = str(formData, "employee_id");
  if (!companyId || !employeeId) return { error: "Approver is required.", success: false };
  if (!admin.companyIds.includes(companyId)) return { error: "Company not found.", success: false };

  const { error } = await supabase
    .from("leave_approver_assignments")
    .delete()
    .eq("company_id", companyId)
    .eq("employee_id", employeeId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/leave/admin");
  return { error: null, success: true, message: "Approver removed." };
}

// =============================================================================
// 2026-10-17 (leave audit + lifecycle) — "agar koi leave lekr bhi office
// aajata hai to vo apni leave approve ko cancel karvayega ya phir modify
// karvayega ki full day ki jagah halfday ya jitne din ki application hai
// usme kitne din pahle aaya hai". Three actions, each usable by the
// request's OWN employee or by any leave_admin of its company (see
// canActOnRequest above), each writing an audit event, each cleaning up
// the auto-marked attendance rows it invalidates.
// =============================================================================

/**
 * Cancel a Pending (withdrawn before decision) or Approved (came to office
 * anyway) request. Rejected requests can't be cancelled — they're already
 * over. On an Approved one, the auto-marked "Approved leave request"
 * attendance days are deleted so the employee doesn't stay absent in
 * payroll, and any coverage assignments end with the leave they belonged
 * to (they were access grants FOR that absence).
 */
export async function cancelLeaveRequest(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const actor = await requireCapability("leave_management");
  const supabase = createServiceRoleClient();

  const leaveRequestId = str(formData, "leave_request_id");
  const remark = str(formData, "remark") || null;
  if (!leaveRequestId) return { error: "Leave request is required.", success: false };

  const { data: leave, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id, employee_id, company_id, from_date, to_date, status")
    .eq("id", leaveRequestId)
    .single();
  if (leaveError || !leave) return { error: "Leave request not found.", success: false };
  if (!canActOnRequest(actor, leave)) return { error: "Leave request not found.", success: false };
  if (leave.status !== "Pending" && leave.status !== "Approved") {
    return { error: "Only a pending or approved leave request can be cancelled.", success: false };
  }

  // Compare-and-swap on the status we actually read (same double-click /
  // two-admins race the decide action already guards against).
  const { data: updated, error: updateError } = await supabase
    .from("leave_requests")
    .update({
      status: "Cancelled" as never,
      cancelled_by_employee_id: actor.id,
      cancelled_at: nowISOInstant(),
      cancelled_remark: remark,
    })
    .eq("id", leaveRequestId)
    .eq("status", leave.status)
    .select("id");
  // 2026-10-19 — cancelling writes cancelled_by/cancelled_at/cancelled_remark,
  // which only exist once db/2026-10-17-leave-audit-and-lifecycle.sql has been
  // run. Say that plainly instead of showing the raw Postgres "column does not
  // exist" text (the rest of the screen still works either way — see
  // ./leave-queries.ts).
  if (updateError && isMissingSchemaPiece(updateError)) {
    return {
      error:
        "Cancelling needs the 2026-10-17 leave migration — run db/2026-10-17-leave-audit-and-lifecycle.sql in the Supabase SQL Editor, then try again.",
      success: false,
    };
  }
  if (updateError) return { error: updateError.message, success: false };
  if (!updated || updated.length === 0) {
    return { error: "This leave request just changed — refresh and check its current status.", success: false };
  }

  if (leave.status === "Approved") {
    // Only the auto-marked rows go; a real punch or an admin-entered row
    // (guard identical to decideLeaveRequest's) is never deleted.
    await removeAutoMarkedLeaveDays(supabase, leave.employee_id, leave.from_date, leave.to_date);
    // Coverage assignments were access grants FOR this absence — they end
    // with it (getAuthedEmployee() reads them live, so deleting them cuts
    // the granted store access immediately).
    await supabase.from("leave_coverage_assignments").delete().eq("leave_request_id", leaveRequestId);
  }

  await logLeaveEvent(supabase, leaveRequestId, "Cancelled", actor.id, remark);

  revalidatePath("/dashboard/leave");
  revalidatePath("/dashboard/leave/admin");
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/salary");
  return { error: null, success: true, message: "Leave request cancelled." };
}

/**
 * "full day ki jagah halfday" — flip ONE day of an approved leave from a
 * full Leave day to a Half Day. Payroll already counts Half Day as 0.5 of
 * a deducted day (see payroll.ts), so the salary side needs no change; the
 * day keeps its leave_type_id/leave_unpaid so the balance ledger stays
 * honest about which pool it came from.
 */
export async function markLeaveHalfDay(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const actor = await requireCapability("leave_management");
  const supabase = createServiceRoleClient();

  const leaveRequestId = str(formData, "leave_request_id");
  const date = str(formData, "date");
  const remark = str(formData, "remark") || null;
  if (!leaveRequestId || !date) return { error: "Leave request and date are both required.", success: false };

  const { data: leave, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id, employee_id, company_id, from_date, to_date, status")
    .eq("id", leaveRequestId)
    .single();
  if (leaveError || !leave) return { error: "Leave request not found.", success: false };
  if (!canActOnRequest(actor, leave)) return { error: "Leave request not found.", success: false };
  if (leave.status !== "Approved") return { error: "Only an approved leave can be converted to half day.", success: false };
  if (date < leave.from_date || date > leave.to_date) {
    return { error: `Date must fall inside the approved leave window (${leave.from_date} to ${leave.to_date}).`, success: false };
  }

  const { data: attendanceRow } = await supabase
    .from("attendance")
    .select("id, status")
    .eq("employee_id", leave.employee_id)
    .eq("attendance_date", date)
    .maybeSingle();
  // Only the auto-marked full Leave day can be converted — a missing row
  // (holiday/week-off) or a real punch (Present) has nothing to half here.
  if (!attendanceRow || attendanceRow.status !== "Leave") {
    return { error: "No full-day leave attendance found for that date — nothing to convert.", success: false };
  }

  const { error: updateError } = await supabase
    .from("attendance")
    .update({ status: "Half Day" as never, remark: remark ? `Approved leave — half day: ${remark}` : "Approved leave — half day (came to office)" })
    .eq("id", attendanceRow.id);
  if (updateError) return { error: updateError.message, success: false };

  await logLeaveEvent(supabase, leaveRequestId, "Half Day", actor.id, `${date}${remark ? ` — ${remark}` : ""}`);

  revalidatePath("/dashboard/leave");
  revalidatePath("/dashboard/leave/admin");
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/salary");
  return { error: null, success: true, message: `${date} converted to half day.` };
}

/**
 * "jitne din ki application hai usme kitne din pahle aaya hai" — shorten
 * an approved leave's end date (the employee returned early). Days after
 * the new end lose their auto-marked Leave attendance, and coverage
 * assignments sticking out past the new end are trimmed back so no access
 * grant outlives the leave it belonged to.
 */
export async function shortenLeaveRequest(_prev: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const actor = await requireCapability("leave_management");
  const supabase = createServiceRoleClient();

  const leaveRequestId = str(formData, "leave_request_id");
  const newToDate = str(formData, "new_to_date");
  const remark = str(formData, "remark") || null;
  if (!leaveRequestId || !newToDate) return { error: "Leave request and new end date are both required.", success: false };

  const { data: leave, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id, employee_id, company_id, from_date, to_date, status")
    .eq("id", leaveRequestId)
    .single();
  if (leaveError || !leave) return { error: "Leave request not found.", success: false };
  if (!canActOnRequest(actor, leave)) return { error: "Leave request not found.", success: false };
  if (leave.status !== "Approved") return { error: "Only an approved leave request can be shortened.", success: false };
  if (newToDate < leave.from_date || newToDate >= leave.to_date) {
    return { error: `New end date must be between ${leave.from_date} and the current end ${leave.to_date} (earlier).`, success: false };
  }

  const { error: updateError } = await supabase
    .from("leave_requests")
    .update({ to_date: newToDate })
    .eq("id", leaveRequestId)
    .eq("status", "Approved")
    .select("id");
  if (updateError) return { error: updateError.message, success: false };

  // Attendance for the chopped-off days (new end + 1 .. old end).
  await removeAutoMarkedLeaveDays(supabase, leave.employee_id, addDaysToDateStr(newToDate, 1), leave.to_date);
  // Coverage past the new end: fully-past-the-end rows go, straddling
  // ones are clamped to the new end.
  const { data: coverages } = await supabase
    .from("leave_coverage_assignments")
    .select("id, from_date, to_date")
    .eq("leave_request_id", leaveRequestId);
  for (const c of coverages ?? []) {
    if (c.from_date > newToDate) {
      await supabase.from("leave_coverage_assignments").delete().eq("id", c.id);
    } else if (c.to_date > newToDate) {
      await supabase.from("leave_coverage_assignments").update({ to_date: newToDate }).eq("id", c.id);
    }
  }

  await logLeaveEvent(supabase, leaveRequestId, "Shortened", actor.id, `${leave.to_date} → ${newToDate}${remark ? ` — ${remark}` : ""}`);

  revalidatePath("/dashboard/leave");
  revalidatePath("/dashboard/leave/admin");
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/salary");
  return { error: null, success: true, message: `Leave shortened — now ends ${newToDate}.` };
}
