-- 2026-09-13 — "BHAI 2 PARKAR KE CREDIT NOTE HONGE" (user, verbatim):
--
--   1. BUYER REFUND — a credit note WE raise against an ORDER, refunding
--      the BUYER (marketplace returns/claims). Ours, no bill involved.
--   2. SUPPLIER — a credit note AGAINST A BILL we owe: either from the
--      PURCHASE party (we raise it — shortage/rate diff) or the COURIER
--      company (they issue it — e.g. quoted 3k USA freight, billed 5k,
--      case raised, courier sends CN of 2k + 18% GST). Lands on the
--      party's freight/purchase bill in bill_pass_register.
--
-- Plus the GST-rate reality the user described for the supplier kind:
--   - Rugs/cotton cloth purchases → 5% GST (the existing 2.5% cgst+sgst
--     individual rate; total 5%)
--   - Kurti > Rs.1000/pc purchases → 12% (NEW individual rate 6)
--   - Office expenses / everything else (incl. ALL courier freight
--     credit notes — "ammount + 18 GST lagta hai") → 18% (existing 9)
--
-- cn_kind is a discriminator so the register/UI can badge which of the
-- two kinds a note is, and so GST defaults can follow the kind. It is
-- deliberately NULLable: existing rows predate the concept and stay
-- valid ("legacy / not set") rather than being force-classified.
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS cn_kind text
  CHECK (cn_kind IN ('buyer_refund', 'supplier'));

-- Widen the CHECK to include the 12%-total slab (individual 6%). The old
-- constraint is unnamed across restores, so drop ALL existing
-- gst_rate_pct constraints on this table then re-add — idempotent.
ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_gst_rate_pct_check;
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'credit_notes'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%gst_rate_pct%'
  LOOP
    EXECUTE format('ALTER TABLE credit_notes DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_gst_rate_pct_check
  CHECK (gst_rate_pct IN (2.5, 3, 4, 6, 9));

-- Supplier CNs are nearly always identified by the issuing party's own
-- number (courier CNs arrive on paper/email); buyer_refund CNs are ours.
CREATE INDEX IF NOT EXISTS idx_credit_notes_kind ON credit_notes(cn_kind) WHERE cn_kind IS NOT NULL;
