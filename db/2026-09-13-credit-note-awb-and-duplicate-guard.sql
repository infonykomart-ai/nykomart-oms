-- 2026-09-13 — "COURIOUR KA JO CREDIT NOTE HOTA HAI VO AWB KE AGAINST ME
-- AATA HAI TO AGAR EK CREDIT NOTE ME 1 SE JYADA AWB HUYE TO KYA UNKE
-- AGAINST ME ADJUST KARNE KA OPTION HAI"
--
-- The courier's own credit note is issued per AWB (quote 3k vs billed 5k,
-- case raised, CN arrives listing several AWBs). The adjustments table
-- (bill_pass_register_adjustments) ALREADY supports applying one CN to N
-- bills — one row per (bill, note) pair. What was missing is the DATA
-- LINK: which AWB(s) a note covers. awb_no on credit_notes records that
-- (free text — a courier CN often lists several AWBs on one document),
-- so the UI can offer "adjust against multiple AWB bills" and the
-- register/ledger can show exactly which shipments each note refunds.
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS awb_no text;
COMMENT ON COLUMN credit_notes.awb_no IS
  '2026-09-13: the AWB/tracking number(s) this credit note refunds — a courier CN frequently covers MORE THAN ONE AWB on one document (free text, comma/space separated). Multi-AWB adjustment against the matching bill_pass_register rows is driven from this.';

CREATE INDEX IF NOT EXISTS idx_credit_notes_awb_no ON credit_notes(awb_no) WHERE awb_no IS NOT NULL;

-- "KISI INVIOCE KI DO BAAR ENTRY NAHI AAYEGI DUPLICATE RESTICATION
-- JARURI HAI" — hard DB-level duplicate guard for manually-entered bills.
-- The same vendor invoice document from one party may legitimately split
-- across several of OUR rows ONLY when the app itself mirrors it
-- (source IS NOT NULL — e.g. purchase_bill mirror rows per PO, or a
-- courier/freight import keyed by source_id). Manually typed rows
-- (source IS NULL) must never contain the same (party, vendor invoice no,
-- invoice type) twice — that's always a double entry. Partial index keeps
-- every auto-mirrored/salary path untouched.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_pass_manual_no_duplicates
  ON bill_pass_register (party_id, lower(btrim(vendor_invoice_no)), invoice_type)
  WHERE source IS NULL AND vendor_invoice_no IS NOT NULL AND btrim(vendor_invoice_no) <> '' AND party_id IS NOT NULL;
