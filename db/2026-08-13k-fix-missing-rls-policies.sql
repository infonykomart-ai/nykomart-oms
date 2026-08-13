-- ROOT CAUSE of "Amazon fees matched" never showing (and 2 other tables
-- silently broken the same way) — found by checking pg_policies directly
-- in the Supabase SQL editor, not guessed.
--
-- amazon_transactions has Row Level Security ENABLED but ZERO policies
-- defined on it. With RLS on and no policy, Postgres denies ALL access
-- to every role except the table owner/superuser — so the app's own
-- "authenticated" role (what the deployed Next.js app actually queries
-- as) silently gets 0 rows back every time, no error, nothing in the
-- logs. Verified directly: a query joining orders to amazon_transactions
-- as the `postgres` role (this SQL editor) found a perfect match — same
-- company_id, byte-identical order_id — for a real order (PO-A02,
-- 112-0129230-0318611) that shows NO Amazon match at all on the live
-- Orders page. That gap is exactly what RLS-with-no-policy does.
--
-- etsy_ledger_lines and ebay_tax_invoice_lines both already have an
-- "allow_authenticated_all" policy (ALL / USING true / WITH CHECK true)
-- — that's why Etsy (and eBay, on the few orders it has data for)
-- already work. amazon_transactions never got the same policy when it
-- was created this round.
--
-- While checking, found 2 MORE tables in the same broken state (RLS on,
-- 0 policies) — same fix applies, same silent-empty-result symptom
-- wherever they're read from:
--   - bill_pass_register_payments
--   - ebay_monthly_financial_statement
--
-- Fix: add the exact same policy shape already used everywhere else in
-- this schema. Safe to run — this only grants read/write to your own
-- app's authenticated role, same access level every other statement-
-- family table already has; it does not touch or expose any data.

CREATE POLICY allow_authenticated_all ON amazon_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY allow_authenticated_all ON bill_pass_register_payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY allow_authenticated_all ON ebay_monthly_financial_statement
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Verify — should show all 3 with a real policy now (policy_count = 0 -> 1):
SELECT tablename, count(*) AS policy_count
FROM pg_policies
WHERE tablename IN ('amazon_transactions', 'bill_pass_register_payments', 'ebay_monthly_financial_statement')
GROUP BY tablename;
