-- 2026-08-12 (round 11): "jo section abhi desbord par ban to gaye lekin
-- unki programing nahi hui unke liye kya socha hai ek baar apne hisab se
-- sabhi section ko build karo" — building out the 8 dashboard tiles that
-- already existed in capability-info.ts/role_capabilities but had no
-- page.tsx yet. Most of these (Exchange Rates, Company & Item Admin, CSV
-- Upload, Statement Entry, CRM/P&L Overview) run entirely on tables that
-- already existed (exchange_rates, companies/item_categories/sizes,
-- bank_statement_lines/etsy_ledger_lines/ebay_transaction_lines,
-- sale_profit_ledger + its 2 views) — no new schema needed for those. Only
-- 2 genuinely new pieces are added here:
--
--   1. Bill Payment (bill_payment capability) — bill_pass_register already
--      had a plain `total_paid` column (a running total with no audit
--      trail of individual payments). This adds a proper payments ledger
--      table so "record a payment" has somewhere real to write, and
--      total_paid gets recomputed from it (by the app, on each insert —
--      see src/app/dashboard/bill-payment/actions.ts) rather than typed by
--      hand.
--
--   2. Approvals L1/L2 (approve_level1/approve_level2 capabilities) — the
--      old Apps Script system never had this at all (confirmed via
--      claude/hr-attendance-crm-notes.md and a schema search — no
--      status/lock column existed anywhere), so this is a NEW workflow
--      designed for this round, not a port of anything. Kept deliberately
--      minimal: a bill starts 'Pending', L1 approve -> 'Approved L1', L2
--      approve (only reachable from 'Approved L1') -> 'Approved L2', and
--      either level can 'Reject' with a reason. This is a judgment call
--      per the user's own "apne hisab se... phir dekh ke modify kar
--      dunga" instruction — flagged clearly in the delivery notes so it's
--      easy to point out if the real business process is different.
-- =============================================================================

CREATE TYPE bill_approval_status AS ENUM ('Pending', 'Approved L1', 'Approved L2', 'Rejected');

ALTER TABLE bill_pass_register
  ADD COLUMN approval_status  bill_approval_status NOT NULL DEFAULT 'Pending',
  ADD COLUMN approved_l1_by   uuid REFERENCES employees(id),
  ADD COLUMN approved_l1_at   timestamptz,
  ADD COLUMN approved_l2_by   uuid REFERENCES employees(id),
  ADD COLUMN approved_l2_at   timestamptz,
  ADD COLUMN rejected_by      uuid REFERENCES employees(id),
  ADD COLUMN rejected_at      timestamptz,
  ADD COLUMN rejection_reason text;

CREATE INDEX idx_bill_pass_approval_status ON bill_pass_register(approval_status);

COMMENT ON COLUMN bill_pass_register.approval_status IS
  'New 2026-08-12 (round 11) 2-level approval workflow — see this migration''s header comment. '
  'Pending -> (L1 approves) -> Approved L1 -> (L2 approves) -> Approved L2. Either level may Reject instead.';

CREATE TABLE bill_pass_register_payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_pass_register_id    uuid NOT NULL REFERENCES bill_pass_register(id) ON DELETE CASCADE,
  amount                     numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_date                  date NOT NULL,
  payment_mode                     text,     -- NEFT / RTGS / Cheque / Cash / UPI — free text, no fixed list given
  reference_no                        text,  -- cheque no. / UTR / transaction ref
  remark                                 text,
  entered_by                                uuid REFERENCES employees(id),
  entered_on                                   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bpr_payments_bill ON bill_pass_register_payments(bill_pass_register_id);

COMMENT ON TABLE bill_pass_register_payments IS
  'New 2026-08-12 (round 11) payment ledger backing the "Bill Payment" dashboard tile. '
  'bill_pass_register.total_paid is recomputed as SUM(amount) for the bill on every insert '
  '(see src/app/dashboard/bill-payment/actions.ts) rather than edited directly, so it stays '
  'consistent with the audit trail here.';
