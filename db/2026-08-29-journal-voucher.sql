-- 2026-08-29 (evening) — Journal Voucher (JV)
--
-- User request (Hindi, verbatim): "ek genral voutcher banega jo bhi bills
-- honge unke liye kisi me debit note lagana padega to vo bhi adjustment
-- hoyega credit note bhi adjustment hoyega uska bhi apna serial hoyega
-- sath me jiska jiske sath JV/GRN katega uske sath link hoyega" — a JV
-- should exist for every bill, with its own serial number, linked to
-- whichever bill it belongs to; any Debit/Credit Note adjustment against
-- that bill should show up on it.
--
-- Follow-up clarification (AskUserQuestion): JV auto-generates the moment
-- a bill lands in bill_pass_register (Purchase Bill's automatic mirror,
-- Courier/Duty Bill's "Send to Bill Pass Register" button) — applies to
-- Purchase Bill, Courier Bill, Duty & Tax Bill, and general/manually-typed
-- bill_pass_register rows (source IS NULL), NOT Salary/Advance rows (no
-- vendor/invoice concept to fit the paper JV template). "Prepared By /
-- Check By / Approved By" are blank print labels only, no approval-status
-- workflow.
--
-- Second follow-up: "JV no automatic ke sath sath manual option bhi hona
-- chahiye" — besides auto-generation, a manual "New Journal Voucher" entry
-- form is also needed (own Document Entry tab, like Debit Note/Credit
-- Note), optionally linked to an existing Bill Pass Register entry via the
-- same PartyBillPicker UI Debit Note already uses, or left unlinked
-- entirely as a free-standing JV.
--
-- Design: because a JV can now exist WITHOUT a bill_pass_register row
-- (the manual/unlinked case), bill_pass_register_id is nullable and
-- Vendor/Invoice No./Invoice Date/Debit Amount get their own columns here
-- (snapshotted at creation) rather than being purely a live join as
-- originally planned. When bill_pass_register_id IS set, the report page
-- still prefers the LIVE bill_pass_register.to_be_pay for Passed Amount
-- (which already nets out any linked Debit/Credit Note via
-- credit_note_amt/adj_amt — see that column's own comment) over the stored
-- passed_amount column, so a linked JV never goes stale if a note is
-- raised against the bill after the JV was created. The stored
-- passed_amount is what a manual/unlinked JV relies on directly (typed by
-- the user, no bill to join against).
--
-- Idempotent — safe to run twice.

CREATE TABLE IF NOT EXISTS journal_vouchers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  jv_no                   text UNIQUE,           -- assigned by trigger below, same pattern as debit_notes.debit_note_no
  jv_date                 date NOT NULL DEFAULT CURRENT_DATE,
  -- Optional link — NULL for a manually-created, free-standing JV. When
  -- set, this is the authoritative bill; a partial unique index (below)
  -- still guarantees at most one JV per bill_pass_register row, whichever
  -- path created it (auto-generate-on-send, or manual entry picking an
  -- existing bill via PartyBillPicker).
  bill_pass_register_id   uuid REFERENCES bill_pass_register(id) ON DELETE SET NULL,
  party_id                uuid REFERENCES parties(id),   -- Vendor
  vendor_invoice_no        text,
  invoice_date              date,
  debit_amount               numeric(14,2) NOT NULL DEFAULT 0,
  -- Manual/fallback Passed Amount — when bill_pass_register_id is set, the
  -- report page shows the LIVE bill_pass_register.to_be_pay instead (see
  -- comment above); this column is what a manual/unlinked JV actually uses.
  passed_amount               numeric(14,2),
  item_details                  text,
  qty                             numeric(12,2),
  qty_unit                          text,
  qlty                                text,   -- Quality — free text, no other table has this concept
  particulars                          text,
  remark                                 text,
  created_by_employee_id                  uuid REFERENCES employees(id),   -- set for manual entries, NULL for auto-generated
  created_at                                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_vouchers_company ON journal_vouchers(company_id);
CREATE INDEX IF NOT EXISTS idx_journal_vouchers_party ON journal_vouchers(party_id);
-- Partial unique — enforces "at most one JV per bill" without blocking the
-- many JVs that have no bill_pass_register_id at all (manual/unlinked).
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_vouchers_bill_unique
  ON journal_vouchers(bill_pass_register_id) WHERE bill_pass_register_id IS NOT NULL;

COMMENT ON TABLE journal_vouchers IS
  'Auto-generated (on Purchase/Courier/Duty bill -> Bill Pass Register) or manually entered. Vendor/Invoice/Debit Amount are snapshotted; Passed Amount is read live from bill_pass_register.to_be_pay when linked, else uses the stored column.';
COMMENT ON COLUMN journal_vouchers.qlty IS 'Quality — free text, no other table has this concept; always manually entered.';

-- Auto-numbering trigger, same shape as trg_debit_notes_doc_no() —
-- reserve_next_number/format_document_no/fy_label are already defined
-- and shared across every doc type; this just adds journal_vouchers as one
-- more caller with its own 'DOC_JV' scope and 'JV' doc-type code.
CREATE OR REPLACE FUNCTION trg_journal_vouchers_doc_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text; v_num int;
BEGIN
  SELECT short_code INTO v_code FROM companies WHERE id = NEW.company_id;
  v_num := reserve_next_number(NEW.company_id, 'DOC_JV', true, NEW.jv_date);
  NEW.jv_no := format_document_no(v_code, 'JV', fy_label(NEW.jv_date), v_num);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS journal_vouchers_before_insert ON journal_vouchers;
CREATE TRIGGER journal_vouchers_before_insert BEFORE INSERT ON journal_vouchers
  FOR EACH ROW WHEN (NEW.jv_no IS NULL) EXECUTE FUNCTION trg_journal_vouchers_doc_no();
