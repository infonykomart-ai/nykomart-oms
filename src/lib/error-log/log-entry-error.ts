// Entry Error Log — 2026-09-08. See db/2026-09-08-error-log.sql for the
// full design. A lightweight, always-non-blocking log of "something went
// wrong with this entry" — form validation failures, failed courier
// bookings, and manual flags raised by staff — surfaced on the
// /dashboard/error-log tab (error_log_view capability, Admin/MD by
// default). Call this right where the real action already decided it
// failed/was flagged — never let logging itself block or change the
// response the caller was already about to return, same principle as
// logAudit() (src/lib/audit/log-audit.ts) and notifyCompanion()
// (src/lib/companion/notify.ts) — this codebase's established pattern of
// layering a non-blocking side-effect log onto an event that already
// happened.
import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

// 2026-09-19 (audit fix, item C5) — added 'system': a background/automatic
// process failed on its own (no form submission, no API call, no employee
// action to attribute it to) — e.g. tasks/actions.ts's daily-time-log sync
// or auto-created daily_work_logs row failing silently. Previously these
// were only console.error'd, invisible to anyone but someone reading server
// logs; now they land here like every other "something went wrong" case.
export type EntryErrorSource = "validation" | "courier_api" | "manual" | "system";

export type LogEntryErrorParams = {
  companyId?: string | null;
  source: EntryErrorSource;
  /** The error message / reason, shown as-is on the Error Tab. */
  reason: string;
  /** e.g. "order" — what kind of thing this error is about. */
  referenceType?: string | null;
  /** e.g. an order's id — not a real FK, the target row may not exist yet. */
  referenceId?: string | null;
  /** e.g. an order's ref_no — keeps the log readable without a join. */
  referenceLabel?: string | null;
  raisedByEmployeeId?: string | null;
  raisedByName: string;
};

export async function logEntryError(supabase: ServiceClient, params: LogEntryErrorParams): Promise<void> {
  try {
    await supabase.from("entry_errors").insert({
      company_id: params.companyId ?? null,
      source: params.source,
      reason: params.reason,
      reference_type: params.referenceType ?? null,
      reference_id: params.referenceId ?? null,
      reference_label: params.referenceLabel ?? null,
      raised_by_employee_id: params.raisedByEmployeeId ?? null,
      raised_by_name: params.raisedByName,
    });
  } catch {
    // Never let a logging failure break the real validation response/
    // booking error it's describing.
  }
}
