-- Order Hold / Cancel / Refund + auto Credit Note (pending item 2 — see
-- claude/order-lifecycle-inventory-tracking-adspend-requests-2026-08-08.md).
-- Design confirmed with the user 2026-08-08:
--   1. Hold = order fully blocked from further action (cannot be invoiced/
--      dispatched) until taken off Hold.
--   2. Refund amount is case-by-case (no fixed rule) — always a manual
--      amount + date entry, never auto-calculated.
--   3. Not-yet-dispatched cancel/refund gets its own small Refund entry
--      screen (not just a status marker).
--   4. Dispatched-and-invoiced cancel/refund additionally auto-generates a
--      Credit Note for the refunded amount (existing credit_notes table).
--
-- ============================================================================
-- RUN THIS FILE AS TWO SEPARATE QUERIES IN THE SUPABASE SQL EDITOR.
-- Postgres does not allow a brand-new enum value to be used in the same
-- transaction that added it, and the SQL Editor runs one pasted block as
-- one transaction — so Query 1 MUST be run and finish on its own before
-- Query 2 is pasted/run.
-- ============================================================================

-- ── QUERY 1 — run this alone first ──────────────────────────────────────
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Hold';


-- ── QUERY 2 — run this after Query 1 has completed ──────────────────────
-- One row per refund entered against a cancelled order. QTY/order data
-- itself is never duplicated here — this only tracks the refund event.
-- credit_note_id is set only for the dispatched-and-invoiced path (Query 2
-- also below is application logic, not a DB trigger, since "already
-- invoiced" needs the same order lookup the app already does elsewhere).
CREATE TABLE order_refunds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES orders(id),
  refund_amount         numeric(14,2) NOT NULL CHECK (refund_amount >= 0),
  refund_currency       varchar(3) NOT NULL REFERENCES currencies(code),
  refund_date           date NOT NULL,
  reason                text,
  credit_note_id        uuid REFERENCES credit_notes(id),
  entry_by_employee_id  uuid NOT NULL REFERENCES employees(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_refunds_order ON order_refunds(order_id);

COMMENT ON TABLE order_refunds IS
  'Manual refund entries against cancelled orders. Amount/date are always '
  'typed in (no fixed refund-percentage rule) — see the header comment in '
  '2026-08-08-order-hold-cancel-refund.sql for the full design.';

-- Confirm:
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'order_status'::regtype ORDER BY enumsortorder;
