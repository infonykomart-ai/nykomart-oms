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
-- invoice type, invoice date) twice — that's always a double entry.
--
-- 2026-09-13 (fix 1) — invoice_date IS part of the key: small vendors
-- restart their invoice numbering every month ("82" in January and "82"
-- in February are two DIFFERENT real documents from the same party).
--
-- 2026-09-13 (fix 2) — company_id IS part of the key: this business's
-- standard workflow is ONE vendor invoice posted to SEVERAL companies
-- (a purchase of 20 orders split 10/5/5 across Nyko Mart/Rugara/CASA ARRA
-- lands as one bill per company, same party, same vendor invoice no. —
-- that's the exact split the ledger's cross-company merge exists for).
-- The dateless, company-less attempts both failed on live data (party
-- 4c3405b2, vendor invoice "82", Purchase). The true double-entry signal
-- is: same COMPANY + party + number + type + date. Partial index keeps
-- every auto-mirrored/salary path untouched.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_pass_manual_no_duplicates
  ON bill_pass_register (company_id, party_id, lower(btrim(vendor_invoice_no)), invoice_type, coalesce(invoice_date, date '1900-01-01'))
  WHERE source IS NULL AND vendor_invoice_no IS NOT NULL AND btrim(vendor_invoice_no) <> '' AND party_id IS NOT NULL;
