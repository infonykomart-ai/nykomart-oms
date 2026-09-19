-- 2026-09-19 (audit fix, Phase 4 / D) — 16 views are SECURITY DEFINER (Postgres's default
-- view behavior unless security_invoker is explicitly set), meaning they run with the VIEW
-- OWNER's privileges and bypass RLS entirely on their underlying tables, regardless of who
-- queries them. Supabase auto-grants SELECT on every public-schema view to `anon` and
-- `authenticated` by default. Combined, this means any authenticated employee could query any
-- of these views directly via the REST API (e.g. `/rest/v1/pl_dashboard_by_company_view`),
-- bypassing BOTH the RLS that would normally apply AND — since capability checks
-- (`requireCapability("reports")`, `requireCapability("crm_dashboard")`, etc.) are an
-- app-layer concept enforced only in the Next.js Server Component, not in Postgres — the
-- page's own access gate. Confirmed concretely: `pl_dashboard_by_company_view`'s own SQL
-- (db/schema.sql) has no company filter at all — it GROUPs BY every company_id present and
-- returns all of them; the app-side `.eq("company_id", ...)` / `.in("company_id", ...)` calls
-- in crm/page.tsx etc. are just convenience filtering, not a security boundary, since
-- SECURITY DEFINER bypasses the RLS that would otherwise enforce it.
--
-- Fix: revoke SELECT on these 16 views from `anon` and `authenticated` entirely. `service_role`
-- (used server-side only, never exposed to a browser) keeps full access via its usual
-- Supabase-managed bypass grants — untouched by this migration. Each page's own
-- requireCapability() gate remains the real access control, exactly as it already is for every
-- other privileged read in this app (see A1/B1 in Phase 1) — this migration just makes sure
-- that gate can no longer be bypassed by going straight to the DB.
--
-- Companion code change (same date): the 3 pages that queried one of these views using the
-- normal per-request session client (`createClient()`, which sends the logged-in employee's own
-- JWT and would now get a permission-denied error after this REVOKE) were switched to also use
-- `createServiceRoleClient()` for those specific queries — the same `finSupabase` pattern
-- crm/page.tsx and reports/sale-profit/page.tsx already used for this exact reason:
--   - src/app/dashboard/stock/page.tsx              → stock_current_view
--   - src/app/dashboard/reports/freight-duty/page.tsx → freight_reconciliation_view,
--                                                        duty_reconciliation_view
--   - src/app/dashboard/statements/page.tsx          → ebay_financial_summary_computed_view
-- No other page queries any of these 16 views with the session client (verified via a
-- repo-wide grep before writing this migration) — everything else already used
-- createServiceRoleClient() and needs no change.
--
-- Idempotent — safe to re-run (REVOKE ... IF EXISTS semantics: REVOKE on a grant that no
-- longer exists is a harmless no-op in Postgres, not an error).

REVOKE SELECT ON freight_awb_net_view                  FROM anon, authenticated;
REVOKE SELECT ON duty_awb_net_view                     FROM anon, authenticated;
REVOKE SELECT ON pl_dashboard_by_company_view          FROM anon, authenticated;
REVOKE SELECT ON pl_dashboard_by_month_view            FROM anon, authenticated;
REVOKE SELECT ON pl_dashboard_by_company_month_view    FROM anon, authenticated;
REVOKE SELECT ON net_revenue_view                      FROM anon, authenticated;
REVOKE SELECT ON freight_bill_variance_view            FROM anon, authenticated;
REVOKE SELECT ON freight_reconciliation_view           FROM anon, authenticated;
REVOKE SELECT ON duty_reconciliation_view              FROM anon, authenticated;
REVOKE SELECT ON stock_current_view                    FROM anon, authenticated;
REVOKE SELECT ON ebay_financial_summary_computed_view  FROM anon, authenticated;
REVOKE SELECT ON pl_dashboard_by_store_view            FROM anon, authenticated;
REVOKE SELECT ON data_quality_alerts_view              FROM anon, authenticated;
REVOKE SELECT ON employee_order_activity_view          FROM anon, authenticated;
REVOKE SELECT ON order_courier_duty_expense_view       FROM anon, authenticated;
REVOKE SELECT ON courier_cn_audit_view                 FROM anon, authenticated;
