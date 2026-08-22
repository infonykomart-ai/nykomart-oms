-- =====================================================================
-- Backup Export (admin-only), 2026-08-22.
--
-- WHAT: one new capability gating a single admin page/button
-- (/dashboard/admin/backup) that downloads ONE Excel workbook containing
-- every order across ALL companies joined with its invoice-relevant
-- fields (sales_invoices — the generated CSB-V/CSB-IV export invoice, via
-- orders.invoice_id — and dispatch_invoices — the per-order "Dispatch &
-- Invoice" financial/shipment record, via dispatch_invoices.order_id).
-- One row per order.
--
-- WHY a new capability rather than reusing "reports" or "invoicing":
-- this deliberately bypasses the normal current-company scoping (every
-- other list/report in this app scopes to employee.currentCompanyId or
-- employee.companyIds — see requireCapability's own header comment) and
-- reads EVERY company's orders in one shot, so it needs its own explicit
-- grant rather than piggy-backing on a capability someone might already
-- have for a narrower reason. Same reasoning as ad_spend_report_all
-- being separate from ad_spend_entry.
--
-- NO NEW TABLE — this is a read-only export over existing data. The only
-- schema change is the capability + role grant below.
--
-- Idempotent (ON CONFLICT DO NOTHING) — same pattern as
-- db/2026-08-12-leave-requests-coverage.sql — safe to re-run.
-- =====================================================================

BEGIN;

INSERT INTO capabilities (code, description) VALUES
  ('data_export_admin', 'Export every order + its generated invoice fields (all companies) as one Excel workbook — the Backup Export page')
ON CONFLICT (code) DO NOTHING;

-- Admin/MD only, exactly like shipglobal_shipment and leave_admin above —
-- an all-companies raw data dump is sensitive enough to start narrow;
-- grant it to more roles via Admin > Roles & Permissions if that's ever
-- too tight.
INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'data_export_admin' FROM roles r WHERE r.name IN ('Admin', 'MD')
ON CONFLICT DO NOTHING;

COMMIT;
