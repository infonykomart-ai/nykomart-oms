-- 2026-11-22 — Address engine (Phase 2 of the master upgrade).
--
-- Two additive columns on orders, both nullable, no defaults to backfill and
-- nothing renamed or dropped. Existing rows are untouched and every existing
-- screen keeps working without them.
--
-- 1. buyer_address_raw — the address exactly as the employee pasted it,
--    BEFORE the splitter touched it. This is the promise that an automatic
--    split can never destroy information: whatever the parser did or did not
--    work out, the original text is still there to look at and re-split.
--    NULL for orders entered before this column existed (their
--    buyer_name_address / buyer_address1 still hold what was typed).
--
-- 2. address_status — how much the app knows about the address:
--      'Parsed'       every part this business's rules require for that
--                     country (street, city, state where the country uses
--                     one, a postcode that fits that country's format) is
--                     present. Rules only — no third-party service involved.
--      'Verified'     a real address-validation provider confirmed it (see
--                     src/lib/address/verify.ts). Nothing in this app sets
--                     this yet: it becomes possible when
--                     GOOGLE_ADDRESS_VALIDATION_API_KEY is configured.
--      'Needs Review' something required is missing or had to be guessed;
--                     the order form shows this next to the address fields.
--    NULL = never checked (every existing row, and any write that happens
--    before this file is run).
--
-- Recompute: the status is derived server-side on every order create/edit
-- (never trusted from the browser), so an order picks up a correct status the
-- next time it is saved. No batch backfill here on purpose — rewriting 100+ k
-- rows with a guess is exactly what this phase is trying to stop. A batch
-- re-check belongs to the all-page audit phase, where it can be reviewed.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS orders_address_status_idx;
--   ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_address_status_check;
--   ALTER TABLE orders DROP COLUMN IF EXISTS address_status;
--   ALTER TABLE orders DROP COLUMN IF EXISTS buyer_address_raw;
-- (Both columns are new and nothing else references them, so the drop is
-- safe; the data in them is regenerable from the address fields.)

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS buyer_address_raw text,
  ADD COLUMN IF NOT EXISTS address_status text;

-- Guard the three known values. Separate DROP+ADD because Postgres has no
-- "ADD CONSTRAINT IF NOT EXISTS"; re-running this file therefore stays safe.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_address_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_address_status_check
  CHECK (address_status IS NULL OR address_status IN ('Parsed', 'Verified', 'Needs Review'));

-- "Which addresses still need a look?" on the orders list is the obvious
-- next query; partial index keeps it cheap and ignores the NULL majority.
CREATE INDEX IF NOT EXISTS orders_address_status_idx
  ON orders (company_id, address_status)
  WHERE address_status IS NOT NULL;

COMMENT ON COLUMN orders.buyer_address_raw IS
  'Address text exactly as pasted, before src/lib/address split it. Never overwritten by the splitter.';
COMMENT ON COLUMN orders.address_status IS
  'Parsed | Verified | Needs Review — recomputed server-side from the structured address fields on save.';
