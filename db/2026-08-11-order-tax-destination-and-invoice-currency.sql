-- Order-level VAT/EORI/IOSS/Destination Country + invoice currency-follow —
-- 2026-08-11.
--
-- Part 1: orders gets 4 new fields, replacing the old single generic
-- `tax_id` (kept, just no longer written by the new order-entry/edit
-- forms) so Invoice generation can auto-pull the RIGHT number instead of
-- guessing which one a blob of text meant. destination_country moves here
-- too, since buyer_name_address is one free-text field and can't be
-- reliably parsed for a country — see the "destination country bhi buyer
-- addresh me hoti hai fill kyu karva rahe... jab kaha hai sabhi ek dusre
-- ke sath map hojaye" ask. All usually blank at order entry (only
-- applicable for UK/EU shipments; destination_country always applies).
ALTER TABLE orders
  ADD COLUMN vat_number text,
  ADD COLUMN eori_number text,
  ADD COLUMN ioss_number text,
  ADD COLUMN destination_country text;

COMMENT ON COLUMN orders.vat_number IS 'Buyer VAT registration number, if applicable (UK/EU). Auto-pulled onto the invoice at generation time, still editable there.';
COMMENT ON COLUMN orders.eori_number IS 'Buyer EORI number, if applicable (UK/EU). Auto-pulled onto the invoice at generation time, still editable there.';
COMMENT ON COLUMN orders.ioss_number IS 'IOSS scheme number, if applicable (EU). Auto-pulled onto the invoice at generation time, still editable there.';
COMMENT ON COLUMN orders.destination_country IS 'Buyer''s destination country, entered once at order entry. Auto-pulled onto the invoice at generation time (also drives EU-PID detection there), still editable afterward.';

-- Part 2: sales_invoices gets invoice_currency — CSB-V invoices now follow
-- the order's own order_currency instead of being forced to USD (2026-08-11
-- user choice: "Use the order's original currency"). See
-- src/lib/invoices/value-breakdown.ts and actions.ts's generateInvoiceCore
-- for the full logic. NULL on any invoice generated before this migration
-- (those stay exactly as they always rendered — USD for CSB-V, the order's
-- own currency for CSB-IV, unchanged).
ALTER TABLE sales_invoices
  ADD COLUMN invoice_currency text;

COMMENT ON COLUMN sales_invoices.invoice_currency IS 'Currency invoice_value_usd/item_cost_total/insurance_total/freight_total are actually denominated in (despite the "_usd" column-name suffix, kept for compatibility). NULL = legacy invoice generated before 2026-08-11, infer as before (USD for CSB-V).';
