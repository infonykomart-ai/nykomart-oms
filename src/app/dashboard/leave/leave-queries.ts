// 2026-10-19 — "pichhli leave jo approve ki hai vo nahi dikh rahi or na hi
// pending me padi ... leave request nahi dikh rahi".
//
// Root cause class this file exists to remove forever: the 2026-10-17 audit
// round (db/2026-10-17-leave-audit-and-lifecycle.sql) added
// applied_lat/applied_lng/... to leave_requests and a whole
// leave_request_events table, and every leave SCREEN then selected those
// columns unconditionally. On a database where that one-time migration has
// not been run, PostgREST answers "column does not exist" — Supabase returns
// `data: null` — and the page silently renders its EMPTY state: no pending
// request, no approved request, just "No leave requests yet." The data was
// never missing; one SELECT was.
//
// This module makes the audit columns/tables OPTIONAL at read time: try the
// full row, and on a missing-column/missing-table error retry with the base
// columns the workflow has always had, reporting which one was used. The
// screens then render every request either way, and only the audit extras
// (applied-at location, approver, timeline) go missing — with a banner that
// names the exact SQL file to run to get them back.
//
// Read side only. Writes keep going through the real actions, which carry
// their own equivalent fallback (see submitLeaveRequest in ./actions.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/**
 * Columns every leave_requests row has had since 2026-08-12 — the floor that
 * a database which has run NONE of the later migrations still has. Nothing
 * optional may be added here: this is the last fallback, so a column in this
 * list that the database lacks would break the fallback itself.
 */
export const LEAVE_BASE_COLUMNS =
  "id, employee_id, from_date, to_date, reason, status, requested_at, decision_remark, leave_type_id, decided_by_employee_id, decided_at";

/** Column added by db/2026-10-19-leave-approvers.sql.
 *  Deliberately NOT part of LEAVE_BASE_COLUMNS — see the note above. */
export const LEAVE_APPROVER_COLUMN = "approver_employee_id";

/** Columns added by db/2026-10-17-leave-audit-and-lifecycle.sql. */
export const LEAVE_AUDIT_COLUMNS =
  "applied_lat, applied_lng, applied_accuracy_m, cancelled_by_employee_id, cancelled_at, cancelled_remark";

/**
 * True when the error is "this database hasn't got that column/table" —
 * i.e. the 2026-10-17 audit migration hasn't been applied. Postgres reports
 * 42703/42P01; PostgREST's schema cache reports PGRST204/PGRST205 and words
 * it "Could not find the 'x' column ... in the schema cache". Anything else
 * (permissions, network) is a REAL failure and must surface, never be
 * silently swallowed.
 */
export function isMissingSchemaPiece(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("schema cache") || msg.includes("does not exist");
}

export type LeaveRequestRow = {
  id: string;
  employee_id: string;
  from_date: string;
  to_date: string;
  reason: string;
  status: string;
  requested_at: string;
  decision_remark: string | null;
  leave_type_id: string | null;
  decided_by_employee_id: string | null;
  decided_at: string | null;
  /** null when the audit columns aren't in this database (see file header). */
  applied_lat: number | null;
  applied_lng: number | null;
  applied_accuracy_m: number | null;
  cancelled_by_employee_id: string | null;
  cancelled_at: string | null;
  cancelled_remark: string | null;
  /** Designated approver (2026-10-19); null = unassigned / MD. */
  approver_employee_id: string | null;
};

function normalize(row: Record<string, unknown>): LeaveRequestRow {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: String(row.id),
    employee_id: String(row.employee_id),
    from_date: String(row.from_date),
    to_date: String(row.to_date),
    reason: String(row.reason ?? ""),
    status: String(row.status),
    requested_at: String(row.requested_at),
    decision_remark: str(row.decision_remark),
    leave_type_id: str(row.leave_type_id),
    decided_by_employee_id: str(row.decided_by_employee_id),
    decided_at: str(row.decided_at),
    applied_lat: num(row.applied_lat),
    applied_lng: num(row.applied_lng),
    applied_accuracy_m: num(row.applied_accuracy_m),
    cancelled_by_employee_id: str(row.cancelled_by_employee_id),
    cancelled_at: str(row.cancelled_at),
    cancelled_remark: str(row.cancelled_remark),
    approver_employee_id: str(row.approver_employee_id),
  };
}

export type LeaveRequestFilter = {
  /** The employee's own requests (employee screen). */
  employeeId?: string;
  /** Every request of one company (admin screen). */
  companyId?: string;
  limit?: number;
};

async function selectRequests(
  supabase: Client,
  columns: string,
  filter: LeaveRequestFilter
): Promise<{ data: unknown[] | null; error: { code?: string; message?: string } | null }> {
  let q = supabase.from("leave_requests").select(columns);
  if (filter.employeeId) q = q.eq("employee_id", filter.employeeId);
  if (filter.companyId) q = q.eq("company_id", filter.companyId);
  const { data, error } = await q.order("requested_at", { ascending: false }).limit(filter.limit ?? 100);
  return { data: (data as unknown[]) ?? null, error };
}

/**
 * All matching leave_requests, newest first — with the audit columns when the
 * database has them, without them (and `audit: false`) when it doesn't.
 * `error` is set only for a REAL failure, so a caller can tell "nothing to
 * show" apart from "the query itself broke".
 */
export async function fetchLeaveRequests(
  supabase: Client,
  filter: LeaveRequestFilter
): Promise<{ rows: LeaveRequestRow[]; audit: boolean; approver: boolean; error: string | null }> {
  const map = (data: unknown[] | null) => (data ?? []).map((r) => normalize(r as Record<string, unknown>));

  // Three tiers, newest migration first, so ANY combination of applied
  // migrations still lists every request:
  //   1. base + approver (2026-10-19) + audit (2026-10-17)
  //   2. base + approver                  — audit columns missing
  //   3. base                             — neither optional set
  // 2026-10-20 — tier 2 exists because approver_employee_id used to sit in
  // LEAVE_BASE_COLUMNS, which quietly made the last fallback fail with the
  // very same "column does not exist" it was supposed to survive.
  const full = await selectRequests(
    supabase,
    `${LEAVE_BASE_COLUMNS}, ${LEAVE_APPROVER_COLUMN}, ${LEAVE_AUDIT_COLUMNS}`,
    filter
  );
  if (!full.error) return { rows: map(full.data), audit: true, approver: true, error: null };
  if (!isMissingSchemaPiece(full.error)) {
    return { rows: [], audit: true, approver: true, error: full.error.message ?? "Could not load leave requests." };
  }

  const withApprover = await selectRequests(supabase, `${LEAVE_BASE_COLUMNS}, ${LEAVE_APPROVER_COLUMN}`, filter);
  if (!withApprover.error) return { rows: map(withApprover.data), audit: false, approver: true, error: null };
  if (!isMissingSchemaPiece(withApprover.error)) {
    return { rows: [], audit: false, approver: true, error: withApprover.error.message ?? "Could not load leave requests." };
  }

  const base = await selectRequests(supabase, LEAVE_BASE_COLUMNS, filter);
  if (base.error) return { rows: [], audit: false, approver: false, error: base.error.message ?? "Could not load leave requests." };
  return { rows: map(base.data), audit: false, approver: false, error: null };
}

export type LeaveEventRow = {
  id: string;
  leave_request_id: string;
  event_type: string;
  actor_employee_id: string | null;
  event_at: string;
  details: string | null;
};

/** Per-request audit timeline — empty (and flagged) when the table is absent. */
export async function fetchLeaveEvents(
  supabase: Client,
  requestIds: string[]
): Promise<{ rows: LeaveEventRow[]; available: boolean }> {
  if (requestIds.length === 0) return { rows: [], available: true };
  const { data, error } = await supabase
    .from("leave_request_events")
    .select("id, leave_request_id, event_type, actor_employee_id, event_at, details")
    .in("leave_request_id", requestIds)
    .order("event_at", { ascending: true });
  if (!error) return { rows: (data ?? []).map((r) => ({ ...r })), available: true };
  if (!isMissingSchemaPiece(error)) console.error("[leave] leave_request_events read failed", error.message);
  return { rows: [], available: false };
}

/** The one-line notice both leave screens show while the audit migration is outstanding. */
export const LEAVE_AUDIT_MIGRATION_HINT =
  "This database hasn't got the 2026-10-17 leave audit columns yet (applied time/location, cancelled-by, event history) — every request below still shows, but those extra details are off. Run db/2026-10-17-leave-audit-and-lifecycle.sql in the Supabase SQL Editor to switch them on.";

// =============================================================================
// 2026-10-19 — leave approvers ("jaruri nahi hai ki leave MD approve kare ...
// jisko leave approval ke liye assign kiya jaye uska naam aaye selection
// option aaye").
// =============================================================================

export type LeaveApprover = {
  employee_id: string;
  name: string;
  assigned_at: string;
};

/**
 * The designated leave approvers for a company, newest assignment first.
 *
 * Reads only the base columns of leave_approver_assignments (the migration
 * that creates it is brand-new), so this does NOT go through the audit-column
 * fallback the request/event reads use. `available: false` means the TABLE is
 * genuinely absent (the migration hasn't run / PostgREST's schema cache hasn't
 * reloaded) — the Apply form then shows no approver dropdown and falls back
 * to MD, exactly the pre-2026-10-19 behavior. A real read failure keeps
 * `available: true` and reports the message, so the UI never tells an admin to
 * "run the migration" for a problem the migration can't fix.
 *
 * 2026-10-20 — "3 baar chala diya lekin abhi bhi nahi ho ra". The old version
 * embedded the approver's name with `employees(name)`. This table has TWO
 * foreign keys into employees (employee_id is the approver, and
 * assigned_by_employee_id is the admin who assigned them), so PostgREST can't
 * tell which one that embed means and answers 300/PGRST201 — "Could not embed
 * because more than one relationship was found for 'leave_approver_assignments'
 * and 'employees'". That is NOT a missing-schema error, so the screens fell
 * through to "this database doesn't have the migration yet" on a database
 * where the migration HAD been applied. Names are now resolved by a separate,
 * unambiguous query against employees by id, and the error kinds are kept
 * apart: missing table vs a real failure.
 */
export async function fetchLeaveApprovers(
  supabase: Client,
  companyId: string
): Promise<{ approvers: LeaveApprover[]; available: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("leave_approver_assignments")
    .select("employee_id, assigned_at")
    .eq("company_id", companyId)
    .order("assigned_at", { ascending: false });

  if (error) {
    // Genuinely absent (migration not run, or PostgREST hasn't reloaded its
    // schema cache yet — the migration file now ends with a
    // NOTIFY pgrst, 'reload schema' for exactly that case).
    if (isMissingSchemaPiece(error)) return { approvers: [], available: false, error: null };
    console.error("[leave] fetchLeaveApprovers failed", error.message);
    return { approvers: [], available: true, error: error.message };
  }

  const rows = (data ?? []) as { employee_id: string; assigned_at: string }[];
  if (rows.length === 0) return { approvers: [], available: true, error: null };

  // Name lookup in its own query — no embed, so no FK ambiguity. A name that
  // can't be resolved (someone since deactivated) still lists their row as
  // "(unknown)" rather than dropping it, so counts always match.
  const { data: people, error: peopleError } = await supabase
    .from("employees")
    .select("id, name")
    .in("id", rows.map((r) => r.employee_id));
  if (peopleError) console.error("[leave] fetchLeaveApprovers names failed", peopleError.message);
  const nameById = new Map((people ?? []).map((p) => [p.id, p.name]));

  return {
    approvers: rows.map((r) => ({
      employee_id: r.employee_id,
      name: nameById.get(r.employee_id) ?? "(unknown)",
      assigned_at: r.assigned_at,
    })),
    available: true,
    error: null,
  };
}

/**
 * Whether THIS login is a designated leave approver for the company — used to
 * gate the "Awaiting your decision" queue on the employee's Leave page. False
 * when the migration hasn't run (no approvers can exist yet).
 */
export async function isLeaveApprover(supabase: Client, companyId: string, employeeId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("leave_approver_assignments")
    .select("id")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error) {
    if (!isMissingSchemaPiece(error)) console.error("[leave] isLeaveApprover failed", error.message);
    return false;
  }
  return Boolean(data);
}
