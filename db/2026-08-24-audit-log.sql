-- =====================================================================
-- Audit log, 2026-08-24.
--
-- WHY: requested after comparing against an open-source OMS (OpenOMS) that
-- has one — "who changed what, when" was previously unanswerable in this
-- app. Several employees can edit orders/bills; deletions and status
-- changes are the highest-value things to know about after the fact.
--
-- WHAT: one append-only table + a small server-side helper
-- (src/lib/audit/log-audit.ts) called AFTER a real write succeeds, from a
-- deliberately small starting set of high-value actions (order Hold/
-- Cancel, Purchase/Courier/Duty Bill delete, Office Expense delete, Order
-- Shipment delete) — see claude/audit-log-and-automation-2026-08-24.md for
-- the exact list. NOT wired into all ~140 server actions yet; more can be
-- added incrementally the same way (call logAudit() after the write).
--
-- Denormalizes employee_name (not just employee_id) so the log stays
-- readable even if an employee is later deactivated/deleted. changes is a
-- free-form jsonb blob — callers put whatever's useful there ({field:
-- {from, to}} for edits, or just a short description for deletes).
--
-- RLS: same pattern as order_shipments (db/2026-08-20-order-shipments-and-
-- packages.sql) — allow_authenticated_all, real access control is the
-- audit_log_view capability checked in app code via requireCapability(),
-- not a per-row RLS predicate (this app's established pattern; almost all
-- reads/writes go through the service-role client).
--
-- Idempotent (ON CONFLICT DO NOTHING / IF NOT EXISTS) — safe to re-run.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid REFERENCES companies(id),   -- nullable: not every audited action is company-scoped
  employee_id   uuid REFERENCES employees(id),
  employee_name text NOT NULL,                   -- denormalized — stays readable if the employee is later removed
  action        text NOT NULL,                   -- e.g. 'order.status_changed', 'purchase_bill.deleted'
  entity_type   text NOT NULL,                    -- 'order', 'purchase_bill', 'freight_bill', 'duty_tax_bill', 'internal_expense', 'order_shipment', ...
  entity_id     uuid,
  entity_label  text,                             -- ref_no / invoice_no / etc. — for a readable log without joining back
  changes       jsonb,                            -- {field: {from, to}} or a short free-form note
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_company_date ON audit_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity        ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_employee      ON audit_log(employee_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON audit_log;
CREATE POLICY allow_authenticated_all ON audit_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO capabilities (code, description) VALUES
  ('audit_log_view', 'View the audit log — who changed/deleted what, and when')
ON CONFLICT (code) DO NOTHING;

-- MD/Admin only to start, same narrow-then-expand approach as
-- data_export_admin — grant to more roles via Admin > Roles & Permissions
-- if that's ever too tight.
INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'audit_log_view' FROM roles r WHERE r.name IN ('Admin', 'MD')
ON CONFLICT DO NOTHING;

COMMIT;
