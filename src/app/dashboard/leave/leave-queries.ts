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

/** Columns every leave_requests row has had since 2026-08-12. */
export const LEAVE_BASE_COLUMNS =
  "id, employee_id, from_date, to_date, reason, status, requested_at, decision_remark, leave_type_id, decided_by_employee_id, decided_at";

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
): Promise<{ rows: LeaveRequestRow[]; audit: boolean; error: string | null }> {
  const full = await selectRequests(supabase, `${LEAVE_BASE_COLUMNS}, ${LEAVE_AUDIT_COLUMNS}`, filter);
  if (!full.error) {
    return { rows: (full.data ?? []).map((r) => normalize(r as Record<string, unknown>)), audit: true, error: null };
  }
  if (!isMissingSchemaPiece(full.error)) {
    return { rows: [], audit: true, error: full.error.message ?? "Could not load leave requests." };
  }
  const base = await selectRequests(supabase, LEAVE_BASE_COLUMNS, filter);
  if (base.error) return { rows: [], audit: false, error: base.error.message ?? "Could not load leave requests." };
  return { rows: (base.data ?? []).map((r) => normalize(r as Record<string, unknown>)), audit: false, error: null };
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
