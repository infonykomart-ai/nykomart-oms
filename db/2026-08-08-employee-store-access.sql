-- Store-scoped Ad Spend visibility (2026-08-08 — "AD SPEND VALI JO ENTRY HAI
-- VO SIRF UTNI HI ENTRY DIKHNI CHAHIYE JIS BANDE KO JIS STORE PAR KAAM KAR
-- RAHA HAI, BAKI JISKO APN PERMISION DE USKO DIKHE COMPLEATE REPORT — ADMIN
-- MD FINANCE KO DIKHE JISME SABHI COMPANY STORE KA DATA DEKHA JA SAKE").
--
-- Design:
--   1. employee_store_access — which store(s) a login is actually assigned
--      to work on (separate from employee_company_access, which company a
--      login may switch into). No rows = no store assigned yet.
--   2. New capability ad_spend_report_all — bypasses the store scoping
--      entirely and sees every company/store's Ad Spend data, same as
--      today. Granted to the same roles that already have ad_spend_entry
--      (Finance, Higher Authority, MD, Admin) so nothing changes for them.
--   3. Anyone with ad_spend_entry but WITHOUT ad_spend_report_all now only
--      sees/enters their own assigned store(s) in both the Daily Entry tab
--      and the Report tab.
--
-- This file is safe to run as ONE single paste — nothing here uses a
-- brand-new enum value, so there's no transaction-ordering restriction like
-- the 2026-08-08-order-hold-cancel-refund.sql file had.

CREATE TABLE IF NOT EXISTS employee_store_access (
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, store_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_store_access_store ON employee_store_access(store_id);

INSERT INTO capabilities (code, description) VALUES
  ('ad_spend_report_all', 'View the complete Ad Spend report across ALL companies/stores (without this, ad_spend_entry is scoped to only the employee''s own assigned store(s) — see employee_store_access)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'ad_spend_report_all' FROM roles r
WHERE r.name IN ('Finance', 'Higher Authority', 'MD', 'Admin')
ON CONFLICT DO NOTHING;

-- Confirm:
SELECT code, description FROM capabilities WHERE code = 'ad_spend_report_all';
SELECT r.name AS role, rc.capability_code FROM role_capabilities rc JOIN roles r ON r.id = rc.role_id WHERE rc.capability_code = 'ad_spend_report_all' ORDER BY r.name;
