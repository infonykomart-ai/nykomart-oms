-- 2026-08-29 (evening, follow-up round) — "Received Chalan" + two optional
-- print-reference fields on the existing Material OUT Chalan.
--
-- Context: user asked for a "Delivery Chalan" (company -> party) and
-- "Received Chalan" (party -> company) pair. Investigation found Delivery
-- Chalan already exists, live since 2026-08-17, as material_out_chalans
-- ("Material OUT Chalan", db/2026-08-17-material-out-and-shipment-handover-
-- chalans.sql) — no new table needed there, just: (a) two optional fields
-- to match the physical chalan pad the user shared as a design reference
-- (Through / No. of Packages), and (b) an app-layer validation change
-- (require at least one Order/PO on the chalan — see documents/actions.ts's
-- sibling code change) which needs no schema change.
--
-- Received Chalan is genuinely new — Stock In only had a free-text
-- chalan_no (see stock_in's own column comment), no auto-numbering, no
-- multi-item header grouping, and (deliberately) is NOT wired to actually
-- insert stock_in rows: unlike Material OUT Chalan (which IS the real
-- stock_out ledger entry, mirrored via stock_out.chalan_id), Purchase Bill
-- and Stock In are two entirely separate, unlinked systems in this app
-- (confirmed via schema — no FK between them). Auto-generating a Received
-- Chalan from a Purchase Bill save must not silently create phantom
-- stock_in rows the user never entered themselves (real double-counting
-- risk for anyone who also does a manual Stock In for the same delivery).
-- So received_chalans is a paperwork/proof-of-receipt document, same
-- design philosophy as journal_vouchers (2026-08-29 evening, earlier round)
-- — best-effort, non-blocking, snapshot-based — NOT a ledger mutation.
--
-- Auto-generation groups a multi-item Purchase Bill's split
-- bill_pass_register rows back into ONE Received Chalan per real vendor
-- invoice (same grouping key as src/lib/bill-grouping.ts's groupBills() and
-- documents/actions.ts's createJournalVoucherForBill, learned the hard way
-- on the Journal Voucher round the same evening — see BRAIN.md §19's
-- follow-up-fix section) — one received_chalan_items row per sibling item,
-- so the printed chalan shows a real per-item breakdown instead of a single
-- summed line.
--
-- Same auto-numbering machinery as every other document type
-- (reserve_next_number/format_document_no, db/schema.sql section 3) — new
-- scope code DOC_RC (format NM/RC/26-27/0001), doesn't collide with
-- DOC_CH/DOC_MOC/DOC_SHC/DOC_DN/DOC_CN/DOC_II/DOC_JV.
--
-- Dry-run tested against local scratch Postgres: idempotent (re-run prints
-- NOTICE ... skipping on every object), plus a functional smoke test inside
-- BEGIN;...ROLLBACK; confirming the trigger assigns NM/RC/26-27/0001,
-- 0002 correctly for two unlinked manual chalans.

BEGIN;

-- =============================================================================
-- Material OUT Chalan — two optional print-reference fields only, matching
-- the physical chalan pad (no change to its existing stock-ledger behavior).
-- =============================================================================
ALTER TABLE material_out_chalans ADD COLUMN IF NOT EXISTS through text;
ALTER TABLE material_out_chalans ADD COLUMN IF NOT EXISTS no_of_packages integer;
COMMENT ON COLUMN material_out_chalans.through IS
  'Optional — transport/courier the goods are going through, printed on the chalan. Matches the physical NYKO MART chalan pad''s "Through" field. Purely informational, never required.';
COMMENT ON COLUMN material_out_chalans.no_of_packages IS
  'Optional — number of packages/bundles, printed on the chalan. Matches the physical pad''s "No. of Packages" field. Purely informational, never required.';

-- =============================================================================
-- RECEIVED CHALAN — header + line items. Paperwork/proof-of-receipt
-- document only (see header comment) — does NOT touch stock_in.
-- =============================================================================
CREATE TABLE IF NOT EXISTS received_chalans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  party_id            uuid NOT NULL REFERENCES parties(id),   -- who the material came FROM
  chalan_no             text UNIQUE,     -- auto-assigned, format NM/RC/26-27/0001
  chalan_date             date NOT NULL,
  order_id                  uuid REFERENCES orders(id),   -- optional — "bina PO ke maal aa sakta hai"
  through                     text,      -- optional, matches physical pad
  no_of_packages                integer,  -- optional, matches physical pad
  -- Discriminator pattern (same as bill_pass_register.source, §4 of
  -- BRAIN.md) — NULL/'manual' = entered by hand (e.g. job-work return from
  -- printing/washing); 'purchase_bill' = auto-generated the instant a
  -- Purchase Bill is saved. source_id points at the REPRESENTATIVE
  -- bill_pass_register row of the invoice group when source='purchase_bill'
  -- (same "first sibling by id" convention as journal_vouchers.
  -- bill_pass_register_id) — deliberately no FK constraint on source_id
  -- since its target table depends on source, mirrored from the same
  -- reasoning already used elsewhere for polymorphic references in this
  -- schema.
  source                       text CHECK (source IS NULL OR source IN ('manual', 'purchase_bill')),
  source_id                      uuid,
  remark                            text,
  created_at                          timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION trg_received_chalans_doc_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text; v_num int;
BEGIN
  SELECT short_code INTO v_code FROM companies WHERE id = NEW.company_id;
  v_num := reserve_next_number(NEW.company_id, 'DOC_RC', true, NEW.chalan_date);
  NEW.chalan_no := format_document_no(v_code, 'RC', fy_label(NEW.chalan_date), v_num);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS received_chalans_before_insert ON received_chalans;
CREATE TRIGGER received_chalans_before_insert BEFORE INSERT ON received_chalans
  FOR EACH ROW WHEN (NEW.chalan_no IS NULL) EXECUTE FUNCTION trg_received_chalans_doc_no();
CREATE INDEX IF NOT EXISTS idx_received_chalans_company ON received_chalans(company_id);
CREATE INDEX IF NOT EXISTS idx_received_chalans_party ON received_chalans(party_id);
-- Idempotency guard for the auto-generation path only — a manual chalan
-- (source_id NULL) is never deduped, only "one Received Chalan per
-- source_id" (mirrors journal_vouchers' partial unique index on
-- bill_pass_register_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_received_chalans_source_id
  ON received_chalans(source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS received_chalan_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chalan_id      uuid NOT NULL REFERENCES received_chalans(id) ON DELETE CASCADE,
  description     text NOT NULL,
  qty               numeric(14,2) NOT NULL,
  qty_unit            text NOT NULL DEFAULT 'FT'
                          CHECK (qty_unit IN ('FT', 'MTR', 'INCH', 'YARD', 'CM', 'PCS')),
  rate                  numeric(14,2),
  remark                  text,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_received_chalan_items_chalan ON received_chalan_items(chalan_id);

COMMIT;

-- Verify (should show the new/altered objects):
SELECT 'received_chalans' AS table_name, count(*) FROM received_chalans
UNION ALL
SELECT 'received_chalan_items', count(*) FROM received_chalan_items;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'material_out_chalans' AND column_name IN ('through', 'no_of_packages');
