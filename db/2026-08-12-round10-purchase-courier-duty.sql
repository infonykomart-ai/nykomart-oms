-- 2026-08-12 (round 10): Document Entry expansion —
--   1) Debit Note / Purchase Bill party dropdown findability (courier vs
--      vendor parties) — party_type/invoice_type backfill for the 7
--      courier parties (bank details were added 2026-08-12 earlier this
--      same day but invoice_type/party_type were never set on them).
--   2) Purchase Bill multi-PO select: "JIS JIS PO RF RG NO KO SELECT KARE
--      UNKE LIYE JO PARTY INVOICE DALE VO SABHI ME UPDATE HO JAYE" — one
--      vendor invoice now legitimately covers MANY orders (one
--      purchase_bills row per order, all sharing the same vendor +
--      invoice_no). The old UNIQUE (vendor_party_id, vendor_invoice_no)
--      forbade that outright (a second order under the same invoice would
--      hit "vendor already has a bill with that invoice number") — widen
--      it to also key on order_id, which is what actually determines
--      whether a specific line is a duplicate now.
--   3) Courier Bill (freight_bills) / Duty & Tax Bill (duty_tax_bills):
--      "AWB TRACKING NO SELECT KARNE KA OPTION HO... CREDIT NOTE YA DEBIT
--      NOTE... TRACKING NUMBER KE AGAINST ME AAYEGA" — per-AWB credit/debit
--      note fields (in addition to the existing whole-bill-level ones from
--      the earlier 2026-08-12 round, for when a single AWB gets its own
--      note rather than the whole invoice). Also a manual
--      dimensional_weight_kg column on the freight assignment (present on
--      the user's real Freight Bill Excel, not derivable from anything on
--      file) and manual disbursement-fee / courier-duty-charge-adjustment
--      / total-payable fields on duty_tax_bills (present on the user's
--      real Duty Tax Bill Excel bottom summary block; kept manual/editable
--      rather than a generated formula — same reasoning as this table's
--      existing gst_18pct_amt column: real bills don't always reconcile to
--      a clean formula, so these are entered off the physical document,
--      not computed).
-- =============================================================================

-- ---- 1) Courier party findability ----------------------------------------
-- Same 7 ILIKE patterns as db/2026-08-12-courier-party-bank-details.sql
-- (already proven to match all 7 seeded courier parties by name) — reused
-- here rather than guessing new patterns.
UPDATE parties
SET invoice_type = 'FREIGHT INVOICE', party_type = 'Courier'
WHERE name ILIKE '%UPS%'
   OR name ILIKE '%fedex%' OR name ILIKE '%fed ex%'
   OR name ILIKE '%aramex%'
   OR name ILIKE '%west%express%' OR name ILIKE '%westexpress%'
   OR name ILIKE '%ship%rocket%'
   OR name ILIKE '%on%point%' OR name ILIKE '%onpoint%'
   OR name ILIKE '%delhivery%';

-- ---- 2) Purchase Bill: allow one vendor invoice across many orders -------
ALTER TABLE purchase_bills DROP CONSTRAINT IF EXISTS purchase_bills_vendor_party_id_vendor_invoice_no_key;
ALTER TABLE purchase_bills
  ADD CONSTRAINT purchase_bills_vendor_invoice_order_key UNIQUE (vendor_party_id, vendor_invoice_no, order_id);

-- ---- 3) Freight / Duty AWB assignments: dimensional weight + per-AWB notes
ALTER TABLE freight_bill_awb_assignments ADD COLUMN IF NOT EXISTS dimensional_weight_kg numeric(10,3);
ALTER TABLE freight_bill_awb_assignments ADD COLUMN IF NOT EXISTS credit_note_no text;
ALTER TABLE freight_bill_awb_assignments ADD COLUMN IF NOT EXISTS credit_note_date date;
ALTER TABLE freight_bill_awb_assignments ADD COLUMN IF NOT EXISTS credit_note_amt numeric(14,2);
ALTER TABLE freight_bill_awb_assignments ADD COLUMN IF NOT EXISTS debit_note_no text;
ALTER TABLE freight_bill_awb_assignments ADD COLUMN IF NOT EXISTS debit_note_date date;
ALTER TABLE freight_bill_awb_assignments ADD COLUMN IF NOT EXISTS debit_note_amt numeric(14,2);

ALTER TABLE duty_bill_awb_assignments ADD COLUMN IF NOT EXISTS credit_note_no text;
ALTER TABLE duty_bill_awb_assignments ADD COLUMN IF NOT EXISTS credit_note_date date;
ALTER TABLE duty_bill_awb_assignments ADD COLUMN IF NOT EXISTS credit_note_amt numeric(14,2);
ALTER TABLE duty_bill_awb_assignments ADD COLUMN IF NOT EXISTS debit_note_no text;
ALTER TABLE duty_bill_awb_assignments ADD COLUMN IF NOT EXISTS debit_note_date date;
ALTER TABLE duty_bill_awb_assignments ADD COLUMN IF NOT EXISTS debit_note_amt numeric(14,2);

-- ---- 4) Duty & Tax Bill: manual bottom-summary fields from the real bill -
ALTER TABLE duty_tax_bills ADD COLUMN IF NOT EXISTS disbursement_fee numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE duty_tax_bills ADD COLUMN IF NOT EXISTS courier_duty_charges_adj numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE duty_tax_bills ADD COLUMN IF NOT EXISTS total_payable_amt numeric(14,2);
COMMENT ON COLUMN duty_tax_bills.total_payable_amt IS
  'Manual — off the physical bill''s own bottom-line "TOTAL PAYABLE AMT" (does not always equal a clean sum of the other fields on the real documents seen 2026-08-12); left NULL until entered.';

-- ---- 5) Bill Pass Register linkage for Courier/Duty bills -----------------
-- freight_bills/duty_tax_bills deliberately have no company_id (one invoice
-- can span shipments across multiple companies) — see schema.sql's own note
-- on bill_pass_register having no FK to these tables. Rather than guess a
-- per-company split algorithm, "Send to Bill Pass Register" is an explicit
-- one-click action (src/app/dashboard/documents/actions.ts) where an admin
-- picks the company and reviews the amount before it posts.
--
-- UNIQUE, not a plain index: sendFreightBillToFinance/sendDutyBillToFinance
-- (and the purchase_bills/salary_payment/employee_advance auto-mirrors)
-- each do a check-then-insert to avoid double-posting, but that alone has a
-- race window (two submits landing between the check and the insert). This
-- constraint is the real backstop — a second insert for the same
-- (source, source_id) fails at the DB level, and the app catches that and
-- shows "already sent" instead of a raw error.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_pass_register_source
  ON bill_pass_register(source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;
