-- 2026-11-03 — DISPUTED AWB (PAYMENT HOLD) TRACKING
-- =================================================
--
-- User: "Dispute tracking / 'Under Dispute' hold + ageing per AWB".
--
-- Jab courier kisi AWB ka charge galat lagata hai (weight galat, surcharge
-- galat, AWB do baar bill hui, rate-card se zyada) to us AWB par case chalta
-- hai — par us baat ko record karne ki jagah hi nahi thi, sirf free-text
-- `remark` tha. Ab har AWB (freight aur duty dono) par:
--
--   dispute_status      'none' | 'under_dispute' | 'resolved'
--   dispute_amount      kitna paisa roka hua hai (hold)
--   dispute_reason      kya galat hai
--   dispute_raised_on   case kab utha
--   dispute_resolved_on kab band hua
--   dispute_resolution  kaise band hua (CN diya / courier ne maan liya)
--
-- HOLD ka matlab: bill ka payable LEDGER me bilkul waisa hi rehta hai
-- (Finance posting untouched — wahi rule jo 2026-11-02 ke CN fix me hai).
-- Hold sirf payment ke waqt dikhta hai: Bill Payment default payable se
-- `dispute_amount` hata deta hai, aur Courier Match report disputed AWB ki
-- umar (kitne din se khula hai) + hold amount dikhati hai. Dispute resolve
-- karne par woh paisa wapas payable ban jata hai.
--
-- Koi backfill nahi: purani rows dispute_status = 'none'. File dobara
-- chalane par safe (ADD COLUMN IF NOT EXISTS + alag ADD CONSTRAINT).
--
-- Is file ke chalne se pehle app bhi chalta rahega: assignment queries `*`
-- use karti hain aur dispute save missing column par chup-chaap skip hota
-- hai (src/lib/db/missing-column.ts) — sirf dispute store nahi hoga.

ALTER TABLE freight_bill_awb_assignments
  ADD COLUMN IF NOT EXISTS dispute_status      text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS dispute_amount      numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_reason      text,
  ADD COLUMN IF NOT EXISTS dispute_raised_on   date,
  ADD COLUMN IF NOT EXISTS dispute_resolved_on date,
  ADD COLUMN IF NOT EXISTS dispute_resolution  text;

ALTER TABLE duty_bill_awb_assignments
  ADD COLUMN IF NOT EXISTS dispute_status      text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS dispute_amount      numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_reason      text,
  ADD COLUMN IF NOT EXISTS dispute_raised_on   date,
  ADD COLUMN IF NOT EXISTS dispute_resolved_on date,
  ADD COLUMN IF NOT EXISTS dispute_resolution  text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freight_awb_dispute_status_check') THEN
    ALTER TABLE freight_bill_awb_assignments
      ADD CONSTRAINT freight_awb_dispute_status_check
      CHECK (dispute_status IN ('none', 'under_dispute', 'resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duty_awb_dispute_status_check') THEN
    ALTER TABLE duty_bill_awb_assignments
      ADD CONSTRAINT duty_awb_dispute_status_check
      CHECK (dispute_status IN ('none', 'under_dispute', 'resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freight_awb_dispute_amount_check') THEN
    ALTER TABLE freight_bill_awb_assignments
      ADD CONSTRAINT freight_awb_dispute_amount_check CHECK (dispute_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duty_awb_dispute_amount_check') THEN
    ALTER TABLE duty_bill_awb_assignments
      ADD CONSTRAINT duty_awb_dispute_amount_check CHECK (dispute_amount >= 0);
  END IF;
END $$;

COMMENT ON COLUMN freight_bill_awb_assignments.dispute_status IS
  '2026-11-03 — case on this AWB''s charge: none / under_dispute (amount held back from payment) / resolved. Ledger payable is NOT changed by a dispute.';
COMMENT ON COLUMN freight_bill_awb_assignments.dispute_amount IS
  '2026-11-03 — rupees held back while dispute_status = ''under_dispute'' (Bill Payment pays balance − holds).';
COMMENT ON COLUMN duty_bill_awb_assignments.dispute_status IS
  '2026-11-03 — same dispute case tracking as freight_bill_awb_assignments.dispute_status.';
COMMENT ON COLUMN duty_bill_awb_assignments.dispute_amount IS
  '2026-11-03 — same payment hold as freight_bill_awb_assignments.dispute_amount.';

NOTIFY pgrst, 'reload schema';
