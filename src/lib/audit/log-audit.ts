// Audit log — 2026-08-24. See db/2026-08-24-audit-log.sql for the full
// design rationale. Call this AFTER the real write already succeeded —
// never let audit logging block or fail the action it's describing.
import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type AuditParams = {
  companyId?: string | null;
  employeeId: string;
  employeeName: string;
  /** e.g. 'order.status_changed', 'purchase_bill.deleted' */
  action: string;
  /** e.g. 'order', 'purchase_bill', 'freight_bill', 'internal_expense' */
  entityType: string;
  entityId?: string | null;
  /** ref_no / invoice_no / etc. — keeps the log readable without a join */
  entityLabel?: string | null;
  /** {field: {from, to}} for edits, or a short free-form note for deletes */
  changes?: Record<string, unknown> | null;
};

export async function logAudit(supabase: ServiceClient, params: AuditParams): Promise<void> {
  try {
    await supabase.from("audit_log").insert({
      company_id: params.companyId ?? null,
      employee_id: params.employeeId,
      employee_name: params.employeeName,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      entity_label: params.entityLabel ?? null,
      changes: (params.changes ?? null) as Json | null,
    });
  } catch {
    // Never let a logging failure break the real action — same "don't let
    // a side effect take down the primary write" principle already used
    // elsewhere in this codebase (e.g. WhatsApp notify staying a manual
    // share button rather than a hard dependency).
  }
}
