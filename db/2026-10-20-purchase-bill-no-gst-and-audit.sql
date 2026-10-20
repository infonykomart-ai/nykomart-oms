-- 2026-10-20 — Purchase Bill: "No GST" must really mean no GST, plus an
-- audit trail (entry date/time + last-updated date/time) on purchase_bills.
--
-- ── 1. THE BUG ─────────────────────────────────────────────────────────────
-- purchase_bills.g_total_plus_gst (db/schema.sql) has always added a flat
-- 5% whenever gst_rate_pct IS NULL. That default was written BEFORE the
-- per-bill GST picker existed (db/2026-08-17-purchase-bills-gst.sql) — back
-- then every bill was a flat 5% rugs/cloth job-work bill, so NULL only ever
-- meant "the old default".
--
-- But the picker (src/components/gst-select.tsx) offers "No GST" as its
-- default/first option, and that option submits NULL. So a bill the user
-- deliberately saved as "No GST" still came out 5% higher everywhere the
-- stored money is read (Bill Payment, Party Ledger, P&L, Purchase Bill
-- report), while the Document Entry list and the A4 sheet — which show
-- total_amount + round-off when no rate is picked — showed the true figure.
--
-- Reported case: invoice 170 / SHARDA INTERNATIONAL RUGS, six items
--   2970 (No GST) + 720 (No GST) + 3000 + 1200 + 1200 + 1200
--   entry-side total (with GST on the four rated lines) = 10620.00
--   posted to Finance / Party Ledger              = 10804.50
--   difference = 184.50 = exactly 5% of 2970 + 5% of 720.
--
--
-- ── 2. THE FIX ─────────────────────────────────────────────────────────────
-- g_total_plus_gst cannot be altered in place (PostgreSQL generated columns
-- have no ALTER ... EXPRESSION, and dropping/re-adding it would CASCADE-drop
-- every P&L/report view that sums it). So instead the *input* is fixed: an
-- explicit "No GST" now saves gst_rate_pct = 0, which makes the existing
-- CASE expression multiply by 0 and leaves g_total_plus_gst = total_amount +
-- round_off_amt, exactly what the entry screens have always shown.
--
-- 0 joins 2.5 / 3 / 4 / 9 in the CHECK constraint; NULL keeps its documented
-- legacy meaning (a pre-2026-08-17 bill that never had a GST choice).

ALTER TABLE purchase_bills
  DROP CONSTRAINT IF EXISTS purchase_bills_gst_rate_pct_check;

ALTER TABLE purchase_bills
  ADD CONSTRAINT purchase_bills_gst_rate_pct_check
  CHECK (gst_rate_pct IN (0, 2.5, 3, 4, 9));

COMMENT ON COLUMN purchase_bills.gst_rate_pct IS
  'Per-bill CGST/SGST INDIVIDUAL rate (total GST = 2x this). 0 = No GST (explicitly chosen in the GST picker). NULL = legacy pre-2026-08-17 bill with no GST choice recorded (g_total_plus_gst then still applies the historical flat 5%).';


-- ── 3. REPAIR BILLS ALREADY SAVED AS "No GST" ──────────────────────────────
-- The GST picker shipped 2026-08-17. Any purchase bill created on/after that
-- date with gst_rate_pct NULL was saved by that picker sitting on "No GST"
-- (its default) — not the legacy flat-5% default — so those are the rows that
-- are currently overstated by 5%. Setting them to 0 recomputes
-- g_total_plus_gst (generated column) to total_amount + round_off_amt.
--
-- Bills created BEFORE 2026-08-17 are deliberately left alone: NULL there is
-- the historical 5% default the P&L and every past payment were based on.
UPDATE purchase_bills
   SET gst_rate_pct = 0
 WHERE gst_rate_pct IS NULL
   AND created_at >= '2026-08-17';


-- ── 4. RE-SYNC THE MIRRORED FINANCE ROWS ───────────────────────────────────
-- bill_pass_register.total_amt is a COPY of purchase_bills.g_total_plus_gst,
-- taken when the bill was saved (savePurchaseBillCore) or last edited
-- (updatePurchaseBill). Section 3 just changed the source of truth, so every
-- mirror row has to be brought back in line or Bill Payment / Party Ledger
-- would keep showing the old inflated figure forever.
--
-- balance_due / to_be_pay are GENERATED columns on bill_pass_register
-- (total_amt - credit_note_amt - adj_amt - total_paid), so they recalculate
-- on their own. Recorded payments and CN/DN adjustments are NOT touched —
-- if a bill was paid off at the inflated figure it will simply show a small
-- negative balance due (an overpayment), which is the truthful result.
UPDATE bill_pass_register bpr
   SET total_amt = pb.g_total_plus_gst
  FROM purchase_bills pb
 WHERE bpr.source = 'purchase_bill'
   AND bpr.source_id = pb.id
   AND bpr.total_amt IS DISTINCT FROM pb.g_total_plus_gst;


-- ── 5. AUDIT TRAIL: WHEN WAS THIS ITEM ENTERED / LAST CHANGED ──────────────
-- "kab entry ki gyi date & time ke sath agar update hui ho baad me to vo bhi
-- show hona chahiye admin ko" — created_at already existed; updated_at did
-- not. A trigger (rather than every call site remembering to set it) keeps it
-- honest for edits made from the app AND any hand-run SQL fix.
-- Only-on-first-run: add the column AND backfill it in one guarded block.
-- The backfill must not repeat on a later re-run (it would wipe real edit
-- history back to created_at), and it runs before the trigger below exists
-- (the trigger would stamp now() on this very statement, which is exactly the
-- lie we're avoiding).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'purchase_bills'
       AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE purchase_bills ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    -- A bill nobody has touched since it was entered has never been
    -- "modified", so "updated" must equal "created", not the migration time.
    UPDATE purchase_bills SET updated_at = created_at;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION set_purchase_bills_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_bills_updated_at ON purchase_bills;
CREATE TRIGGER trg_purchase_bills_updated_at
  BEFORE UPDATE ON purchase_bills
  FOR EACH ROW
  EXECUTE FUNCTION set_purchase_bills_updated_at();
