-- 2026-09-19 (audit fix, item B2) — sales_invoices.master_invoice_no had NO
-- uniqueness guard at all, unlike invoice_no (which already has a real
-- UNIQUE (company_id, invoice_no) constraint). The manual-invoice-numbering
-- path (src/app/dashboard/invoices/actions.ts, params.manualMasterInvoiceNo)
-- skips reserve_next_number() entirely and had nothing stopping two
-- invoices from silently sharing the same master invoice number — a real
-- customs/export-document integrity risk (FedEx's Department Reference No.
-- and other paperwork keys off this number).
--
-- Confirmed live (2026-09-19) before writing this: zero existing duplicate
-- (company_id, master_invoice_no) pairs, so this constraint can be added
-- directly with no backfill/cleanup step needed.
ALTER TABLE sales_invoices
  ADD CONSTRAINT sales_invoices_company_id_master_invoice_no_key UNIQUE (company_id, master_invoice_no);
