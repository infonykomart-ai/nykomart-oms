-- Credit Notes: vendor's own CN number + GST rate — 2026-09-13.
-- "credit note add to kar diya lekin usme credit note no ka option nahi
-- hai usme gst kitni hai" — the Bill Payment → 🧾 Credit Notes → New
-- credit note form could only store OUR auto-generated cn_no and the
-- amount; a real party-issued credit note also carries the PARTY's own
-- CN number (printed on their document) and a GST rate. Both now stored
-- on the credit_notes document itself:
--   vendor_cn_no   — the party's own number, free text (no format
--                    enforcement: every vendor has their own scheme).
--   gst_rate_pct   — NULL = no GST / not applicable (courier/duty credit
--                    notes often aren't GST-bearing). Values mirror
--                    purchase_bills.gst_rate_pct's CHECK (2.5/3/4/9 —
--                    the CGST/SGST individual rate; IGST passes the same
--                    rate and gst_type on purchase_bills distinguishes
--                    it, but a credit note's GST display only needs the
--                    rate itself).
-- Idempotent; safe to re-run.

ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS vendor_cn_no text;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS gst_rate_pct numeric(4,2) CHECK (gst_rate_pct IN (2.5, 3, 4, 9));

COMMENT ON COLUMN credit_notes.vendor_cn_no IS 'The issuing party''s own credit-note number as printed on their document (they have their own numbering scheme; our cn_no stays the internal auto-generated one).';
COMMENT ON COLUMN credit_notes.gst_rate_pct IS 'GST rate applied on this credit note (CGST/SGST individual rate, same enum as purchase_bills.gst_rate_pct). NULL = no GST / not applicable.';

-- The register and Bill-Payment panels list/search notes by the vendor's
-- number often more than ours.
CREATE INDEX IF NOT EXISTS idx_credit_notes_vendor_cn_no ON credit_notes(vendor_cn_no) WHERE vendor_cn_no IS NOT NULL;

-- Confirm:
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'credit_notes' AND column_name IN ('vendor_cn_no', 'gst_rate_pct');
