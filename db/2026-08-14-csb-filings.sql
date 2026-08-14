-- 2026-08-14 — CSB-V (Courier Shipping Bill) customs filing register.
--
-- WHERE THIS CAME FROM: the user uploaded "NYKO_MART_Output.xlsx", an
-- OCR/PDF-extraction output of Indian customs CSB-V filing confirmations
-- (one row per filed shipping bill PDF). Its "Extracted Data" sheet has
-- columns A-M: File Name, CSB Number, Exchange Rate, Total Taxable Value,
-- Taxable Value Currency, FOB Value (In INR), Filing Date, EGM Number,
-- EGM Date, HAWB Number, Invoice Number, Invoice Date, Goods Description.
-- The user explicitly asked to IGNORE column A (File Name — just the
-- source PDF's filename, no business meaning) and column M (Goods
-- Description — not needed), keeping exactly columns B-L (11 fields).
--
-- DATA MODEL DECISION (made in this same conversation, 2026-08-14): asked
-- whether this should be new columns on `sales_invoices` or a new
-- standalone table — user chose a NEW STANDALONE TABLE, NOT linked via a
-- strict foreign key to sales_invoices/orders. `invoice_no` here is plain
-- free text, matching how this schema already handles similar standalone
-- document-header tables with no FK back into the order/invoice graph —
-- see `freight_bills` and `duty_tax_bills` (db/schema.sql, both store
-- their own `invoice_no text` with no FK). `shipping_bills` (schema.sql)
-- is a similar-shaped but unrelated table already in this schema (no UI
-- built against it yet) — this is a deliberate NEW table, not a reuse of
-- that one, per the user's explicit instruction in this conversation.
--
-- Two entry paths land here, both from the "Document Entry" module
-- (src/app/dashboard/documents/): a manual single-row entry form, and a
-- bulk xlsx upload accepting the same shape of file as
-- NYKO_MART_Output.xlsx (columns A/M ignored, matched by header text).
--
-- csb_number is the government filing reference — treated as the natural
-- unique key, same pattern as `shipping_bills.shipping_bill_no`.
--
-- NOTE: this file is NOT run by Claude — deliver it to the user, they run
-- it themselves in Supabase. Fold into db/schema.sql in a later session.

CREATE TABLE IF NOT EXISTS csb_filings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Column B: CSB Number, e.g. "CSBV_DEL_2026-2027_30_07_18608" — the
  -- government filing reference. Natural unique key.
  csb_number             text NOT NULL UNIQUE,

  -- Column C: Exchange Rate used to convert Total Taxable Value -> INR.
  exchange_rate          numeric(10,4),

  -- Column D/E: Total Taxable Value + its currency (almost always USD in
  -- the source data, but kept as free text since other currencies are
  -- plausible for other filings).
  total_taxable_value    numeric(14,2),
  taxable_value_currency text,

  -- Column F: FOB Value (In INR).
  fob_value_inr          numeric(14,2),

  -- Column G: Filing Date (the CSB filing date).
  filing_date            date,

  -- Column H/I: Export General Manifest number + date.
  egm_number             text,
  egm_date                date,

  -- Column J: House Airway Bill number.
  hawb_number             text,

  -- Column K/L: the seller's own invoice number/date this filing was
  -- against — free text, NOT a foreign key (see decision note above).
  invoice_no               text,
  invoice_date               date,

  -- Who entered this row by hand. Nullable — bulk-upload rows aren't tied
  -- to a specific employee's manual data-entry act, but the manual-entry
  -- form always sets this from the logged-in employee.
  entry_by_employee_id         uuid REFERENCES employees(id),

  created_at                     timestamptz NOT NULL DEFAULT now()
);

-- Both invoice_no and hawb_number are the fields this register gets
-- looked up/searched by (matching a filing back to a shipment/invoice).
CREATE INDEX IF NOT EXISTS idx_csb_filings_invoice_no ON csb_filings (invoice_no);
CREATE INDEX IF NOT EXISTS idx_csb_filings_hawb_number ON csb_filings (hawb_number);
