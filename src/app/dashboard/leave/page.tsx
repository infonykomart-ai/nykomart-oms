import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { computeLeaveBalance } from "@/lib/attendance/leave-balance";
import { LeaveRequestForm } from "./leave-request-form";
import { LeaveLifecycleActions } from "./leave-lifecycle-actions";
import { fetchLeaveApprovers, fetchLeaveEvents, fetchLeaveRequests, LEAVE_AUDIT_MIGRATION_HINT } from "./leave-queries";
import { LeaveApproverQueue } from "./leave-approver-queue";

// 2026-08-12 (round 8): "LEAVE REQUESST BHEJ DU APPLIATION KE SATH TO VO MD
// KE PASS APPROVAL KE LIYE CHLI JAYE" — every employee's own Leave screen:
// apply with a from/to date range + application text, and see the
// approval status of everything they've sent. Reads via the service-role
// client (see actions.ts's own comment — leave_requests/
// leave_coverage_assignments are brand-new tables, same RLS-vs-service-
// role lesson bitten repeatedly this project).
export default async function LeavePage() {
  const employee = await requireCapability("leave_management");
  const supabase = createServiceRoleClient();
  const today = todayIST();
  const leaveYear = Number(today.slice(0, 4));
  const yearStart = `${leaveYear}-01-01`;
  const yearEnd = `${leaveYear}-12-31`;

  // 2026-10-19 — read through the migration-tolerant helper, so a database
  // without the 2026-10-17 audit columns still lists every request instead of
  // rendering the empty state (see ./leave-queries.ts).
  const [
    { rows: myRequests, audit: auditColumns, error: requestsError, approver: approverColumn },
    { data: myCoverage },
    { data: leaveTypesRaw },
    { data: myProfile },
    // 2026-10-19 — approvers to offer on the Apply form, plus (if THIS login
    // is a designated approver) the requests routed to them and still
    // Pending, so they can decide without holding leave_admin.
    { approvers: approverOptions, available: approversAvailable, error: approversError },
  ] = await Promise.all([
    fetchLeaveRequests(supabase, { employeeId: employee.id, limit: 50 }),
    // "MERE PASS ... ACCESS HAI" — the flip side: any store THIS login is
    // currently covering for someone else, active right now.
    supabase
      .from("leave_coverage_assignments")
      .select("id, store_id, from_date, to_date, remark")
      .eq("covering_employee_id", employee.id)
      .lte("from_date", today)
      .gte("to_date", today),
    // 2026-09-11 (Payroll Phase 2): real leave types, if this company has
    // set any up — an empty list here means no leave-type dropdown shows
    // on the form above (leave-request-form.tsx) and no balance panel
    // below, so a company that never configures leave types sees no change
    // at all from this round.
    supabase
      .from("leave_types")
      .select("id, name, code, paid, annual_accrual_days, accrual_frequency")
      .eq("company_id", employee.currentCompanyId)
      .eq("active", true)
      .order("name"),
    supabase.from("employees").select("date_of_joining").eq("id", employee.id).single(),
    fetchLeaveApprovers(supabase, employee.currentCompanyId),
  ]);

  const leaveTypes = leaveTypesRaw ?? [];
  const isApprover = approverOptions.some((a) => a.employee_id === employee.id);
  // 2026-10-20 — approver ROUTING needs both halves of the 2026-10-19
  // migration: the assignments table AND leave_requests.approver_employee_id.
  // Half-applied migrations are real (the CREATE TABLE and the ALTER TABLE
  // are separate statements), so gate on both — offering a dropdown whose
  // value can't be stored would be worse than hiding it.
  const approverRoutingAvailable = approversAvailable && approverColumn;

  // Requests THIS login is designated to approve (not their own) — Pending
  // first. Reuses the same tolerant fetch, filtered to Pending server-side.
  let pendingForApprover: Awaited<ReturnType<typeof fetchLeaveRequests>>["rows"] = [];
  if (isApprover) {
    const { rows } = await fetchLeaveRequests(supabase, { companyId: employee.currentCompanyId, limit: 100 });
    pendingForApprover = rows.filter(
      (r) => r.status === "Pending" && r.employee_id !== employee.id && r.approver_employee_id === employee.id
    );
  }
  let myBalances: { id: string; name: string; code: string | null; paid: boolean; balance: number }[] = [];
  if (leaveTypes.length > 0) {
    const typeIds = leaveTypes.map((t) => t.id);
    const [{ data: adjustmentsRaw }, { data: usedRowsRaw }] = await Promise.all([
      supabase
        .from("leave_balance_adjustments")
        .select("leave_type_id, adjustment_days")
        .eq("employee_id", employee.id)
        .eq("leave_year", leaveYear)
        .in("leave_type_id", typeIds),
      supabase
        .from("attendance")
        .select("leave_type_id")
        .eq("employee_id", employee.id)
        .eq("status", "Leave")
        .eq("leave_unpaid", false)
        .in("leave_type_id", typeIds)
        .gte("attendance_date", yearStart)
        .lte("attendance_date", yearEnd),
    ]);
    const adjustmentByType = new Map<string, number>();
    for (const a of adjustmentsRaw ?? []) {
      adjustmentByType.set(a.leave_type_id, (adjustmentByType.get(a.leave_type_id) ?? 0) + Number(a.adjustment_days));
    }
    const usedByType = new Map<string, number>();
    for (const r of usedRowsRaw ?? []) {
      if (!r.leave_type_id) continue;
      usedByType.set(r.leave_type_id, (usedByType.get(r.leave_type_id) ?? 0) + 1);
    }
    myBalances = leaveTypes.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      paid: t.paid,
      balance: t.paid
        ? computeLeaveBalance({
            leaveType: { annual_accrual_days: Number(t.annual_accrual_days), accrual_frequency: t.accrual_frequency as "Monthly" | "Upfront" },
            leaveYear,
            asOfDateStr: today,
            joinDate: myProfile?.date_of_joining ?? null,
            adjustmentDaysTotal: adjustmentByType.get(t.id) ?? 0,
            usedDays: usedByType.get(t.id) ?? 0,
          })
        : 0,
    }));
  }

  const requestIds = (myRequests ?? []).map((r) => r.id);

  // 2026-10-17 — audit trail: who decided/cancelled (names) + the full
  // per-request event timeline (Applied/Approved/Cancelled/Half Day/...).
  const actorIds = Array.from(
    new Set((myRequests ?? []).flatMap((r) => [r.decided_by_employee_id]).filter((v): v is string => Boolean(v)))
  );
  const [{ rows: eventsRaw, available: eventsAvailable }, { data: actors }] = await Promise.all([
    fetchLeaveEvents(supabase, requestIds),
    actorIds.length > 0 ? supabase.from("employees").select("id, name").in("id", actorIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const actorName = new Map((actors ?? []).map((e) => [e.id, e.name]));
  const eventsByRequest = new Map<string, { id: string; event_type: string; actor_name: string | null; event_at: string; details: string | null }[]>();
  for (const ev of eventsRaw ?? []) {
    const list = eventsByRequest.get(ev.leave_request_id) ?? [];
    list.push({
      id: ev.id,
      event_type: ev.event_type,
      actor_name: ev.actor_employee_id ? actorName.get(ev.actor_employee_id) ?? null : null,
      event_at: ev.event_at,
      details: ev.details,
    });
    eventsByRequest.set(ev.leave_request_id, list);
  }
  const coverageStoreIds = (myCoverage ?? []).map((c) => c.store_id);
  const allStoreIds = Array.from(new Set(coverageStoreIds));

  const [{ data: coverageForMine }, { data: stores }] = await Promise.all([
    // Approved requests of mine that already have coverage assigned — so I
    // can see who's covering my absence.
    requestIds.length > 0
      ? supabase
          .from("leave_coverage_assignments")
          .select("id, leave_request_id, covering_employee_id, store_id, from_date, to_date")
          .in("leave_request_id", requestIds)
      : Promise.resolve({ data: [] as { id: string; leave_request_id: string; covering_employee_id: string; store_id: string; from_date: string; to_date: string }[] }),
    allStoreIds.length > 0
      ? supabase.from("stores").select("id, name").in("id", allStoreIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const coveringEmployeeIds = Array.from(new Set((coverageForMine ?? []).map((c) => c.covering_employee_id)));
  const { data: coveringEmployees } =
    coveringEmployeeIds.length > 0
      ? await supabase.from("employees").select("id, name").in("id", coveringEmployeeIds)
      : { data: [] as { id: string; name: string }[] };

  const storeName = new Map((stores ?? []).map((s) => [s.id, s.name]));
  const employeeName = new Map((coveringEmployees ?? []).map((e) => [e.id, e.name]));
  const coverageByRequest = new Map<string, typeof coverageForMine>();
  for (const c of coverageForMine ?? []) {
    const list = coverageByRequest.get(c.leave_request_id) ?? [];
    list.push(c);
    coverageByRequest.set(c.leave_request_id, list);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🏖️ Leave</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-6">
          <LeaveRequestForm
            today={today}
            leaveTypes={leaveTypes.map((t) => ({ id: t.id, name: t.name, code: t.code, paid: t.paid }))}
            // Only offer approvers other than yourself — you can't approve
            // your own leave.
            approvers={
              approverRoutingAvailable
                ? approverOptions
                    .filter((a) => a.employee_id !== employee.id)
                    .map((a) => ({ employee_id: a.employee_id, name: a.name }))
                : []
            }
          />
          {/* 2026-10-20 — two DIFFERENT problems used to share one message.
              "available: false" means the table really is absent (migration
              not run, or PostgREST hasn't reloaded its schema cache yet); an
              error with the table present is a read failure and must not
              tell anyone to re-run SQL that is already applied. */}
          {!approverRoutingAvailable && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Approver selection is off because this database doesn&apos;t have the 2026-10-19 leave-approver migration yet —
              applications go to MD/Admin. Run db/2026-10-19-leave-approvers.sql in the Supabase SQL Editor (it ends with
              a PostgREST schema-cache reload) — if you have already run it, run it once more or execute{" "}
              <code className="rounded bg-amber-100 px-1">NOTIFY pgrst, &apos;reload schema&apos;;</code> by itself.
            </p>
          )}
          {approversAvailable && approversError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              The approver list couldn&apos;t be loaded ({approversError}). The migration is applied — this is a read error,
              not a missing table. Applications still work and go to MD/Admin.
            </p>
          )}

          {myBalances.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-2 text-sm font-semibold text-slate-700">📊 My Leave Balance — {leaveYear}</p>
              <ul className="space-y-1.5 text-sm">
                {myBalances.map((b) => (
                  <li key={b.id} className="flex items-center justify-between">
                    <span className="text-slate-600">
                      {b.name}
                      {b.code ? ` (${b.code})` : ""}
                    </span>
                    {b.paid ? (
                      <span className={`font-semibold ${b.balance > 0 ? "text-green-700" : "text-red-600"}`}>{b.balance} days</span>
                    ) : (
                      <span className="text-xs text-slate-400">Unpaid — no balance</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-400">
                Current published accrual convention (not a verified copy of this company&apos;s actual leave policy) —
                see the note on the Leave Approvals page.
              </p>
            </div>
          )}

          {allStoreIds.length > 0 && (
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
              <p className="mb-2 text-sm font-semibold text-teal-800">🔓 Active Coverage Access</p>
              <p className="mb-2 text-xs text-teal-700">You currently have temporary access to:</p>
              <ul className="space-y-1 text-sm text-teal-900">
                {(myCoverage ?? []).map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{storeName.get(c.store_id) ?? "—"}</span>
                    <span className="text-xs text-teal-600"> (until {c.to_date})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {isApprover && <LeaveApproverQueue requests={pendingForApprover} />}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">My Leave Requests</h2>
            {/* 2026-10-19 — "leave request nahi dikh rahi": when the audit
                columns/table are missing this now SAYS so instead of quietly
                rendering an empty list over data that exists. */}
            {requestsError && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                Could not load your leave requests: {requestsError}
              </p>
            )}
            {!requestsError && !(auditColumns && eventsAvailable) && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{LEAVE_AUDIT_MIGRATION_HINT}</p>
            )}
            <div className="space-y-3">
              {(myRequests ?? []).map((r) => {
                const coverage = coverageByRequest.get(r.id) ?? [];
                const events = eventsByRequest.get(r.id) ?? [];
                return (
                  <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {r.from_date} → {r.to_date}
                          {/* 2026-10-20 — back-dated application: this leave is
                              for days that have already passed, so the
                              employee (and anyone reading the list) can see it
                              was entered after the fact. */}
                          {r.from_date < today && (
                            <span
                              className="ml-1.5 rounded bg-fuchsia-50 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700"
                              title="Back-dated application"
                            >
                              ⏪ Back-dated
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">{r.reason}</p>
                        {/* 2026-10-17 — "usme date & time nahi aata with
                            location": exactly that, on every request. */}
                        <p className="mt-1 text-[11px] text-slate-400">
                          Applied {formatIST(r.requested_at)}
                          {r.applied_lat !== null && r.applied_lng !== null && (
                            <>
                              {" · "}
                              <a
                                href={`https://www.google.com/maps?q=${r.applied_lat},${r.applied_lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-600 hover:underline"
                              >
                                📍 {r.applied_lat.toFixed(4)}, {r.applied_lng.toFixed(4)}
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    {/* 2026-10-17 — "leave approve kisne ki hai kis time
                        par ki hai". */}
                    {/* 2026-10-19 — the WHEN is what was asked for ("kisne
                        approve kiya or kitne baje kiya"), so it shows on every
                        decided request: if the decider can no longer be
                        resolved the time still prints and the name falls back
                        to "MD/Admin", instead of hiding the whole line. */}
                    {r.status === "Approved" && r.decided_at && (
                      <p className="mt-2 text-xs text-green-700">
                        ✓ Approved by {r.decided_by_employee_id ? actorName.get(r.decided_by_employee_id) ?? "MD/Admin" : "MD/Admin"} on {formatIST(r.decided_at)}
                      </p>
                    )}
                    {r.status === "Rejected" && r.decided_at && (
                      <p className="mt-2 text-xs text-red-700">
                        ✕ Rejected by {r.decided_by_employee_id ? actorName.get(r.decided_by_employee_id) ?? "MD/Admin" : "MD/Admin"} on {formatIST(r.decided_at)}
                      </p>
                    )}
                    {r.status === "Rejected" && r.decision_remark && (
                      <p className="mt-1 text-xs text-red-700">MD/Admin remark: {r.decision_remark}</p>
                    )}
                    {r.status === "Cancelled" && r.cancelled_at && (
                      <p className="mt-2 text-xs text-slate-500">
                        🗑 Cancelled on {formatIST(r.cancelled_at)}
                        {r.cancelled_remark ? ` — ${r.cancelled_remark}` : ""}
                      </p>
                    )}
                    {coverage.length > 0 && (
                      <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
                        <p className="font-medium text-slate-500">Coverage while you&apos;re away:</p>
                        {coverage.map((c) => (
                          <p key={c.id}>
                            {employeeName.get(c.covering_employee_id) ?? "—"} → {storeName.get(c.store_id) ?? "—"} ({c.from_date} to {c.to_date})
                          </p>
                        ))}
                      </div>
                    )}
                    {/* 2026-10-17 — "cancel karvayega ya phir modify
                        karvayega" — cancel for any not-yet-cancelled
                        request; modify only shows for Approved ones inside
                        the component itself. */}
                    <LeaveLifecycleActions
                      requestId={r.id}
                      status={r.status}
                      fromDate={r.from_date}
                      toDate={r.to_date}
                      today={today}
                    />
                    {events.length > 1 && (
                      <div className="mt-2 border-t border-slate-100 pt-2">
                        <p className="mb-1 text-[11px] font-medium text-slate-400">History</p>
                        <ul className="space-y-0.5 text-[11px] text-slate-500">
                          {events.map((ev) => (
                            <li key={ev.id}>
                              <span className="font-medium text-slate-600">{ev.event_type}</span>
                              {ev.actor_name ? ` by ${ev.actor_name}` : ""} · {formatIST(ev.event_at)}
                              {ev.details ? ` — ${ev.details}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
              {(myRequests ?? []).length === 0 && (
                <p className="py-6 text-center text-sm text-slate-400">No leave requests yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "Approved"
      ? "bg-green-50 text-green-700"
      : status === "Rejected"
        ? "bg-red-50 text-red-700"
        : status === "Cancelled"
          ? "bg-slate-100 text-slate-500"
          : "bg-amber-50 text-amber-700";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

/** Full "17 Oct 2026, 09:42" IST rendering for audit timestamps — the
 * half of "date & time" that was missing everywhere before this round. */
function formatIST(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
