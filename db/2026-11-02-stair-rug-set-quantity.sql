-- 2026-11-02 — Stair Rug: set-based quantity + per-piece dimensions
-- =====================================================================
--
-- Cotton / Jute / Tufted orders stay plain piece counts; nothing in this file
-- touches `orders.qty`, and no existing row is rewritten. A Stair Rug is sold
-- in SETS ("1 set = 12 PCS"), so the order form now also asks for:
--
--   Number of Sets × Pieces Per Set = Total Pieces
--
-- and Total Pieces is still what goes into the EXISTING `qty` column — that is
-- the deliberate design: every downstream consumer (invoices, purchase bills,
-- courier/duty bills, stock lookups, reports, margin, the packing WhatsApp
-- caption's own QTY line for non-stair products) keeps reading `qty` exactly
-- as before, and a stair order's piece count is simply the product.
--
-- These five columns exist only so the set facts survive a save and can be
-- shown/edited again (Order page, Orders hub edit form, WhatsApp caption):
--
--   sets_count        how many sets the buyer ordered
--   pieces_per_set    how many PCS in one set (any positive whole number —
--                     NOT limited to the form's suggestion list)
--   dimension_length  per-piece length, in dimension_unit
--   dimension_width   per-piece width,  in dimension_unit
--   dimension_unit    FT / INCH / CM
--
-- NULL means "not a stair order, or saved before this file was run". Area is
-- never stored: it is derived from these dimensions × qty at display time, so
-- no stale square-footage can ever disagree with the order.
--
-- Safe to run more than once (add-if-not-exists + guarded constraints); safe
-- to run while the app is live (columns are nullable, no defaults, no rewrite,
-- no backfill). Until it is run, order entry/editing still works — the new
-- fields are simply not stored (see src/lib/db/missing-column.ts).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS sets_count       integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pieces_per_set   integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dimension_length numeric(12,4);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dimension_width  numeric(12,4);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dimension_unit   text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_sets_count_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_sets_count_check
      CHECK (sets_count IS NULL OR sets_count >= 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_pieces_per_set_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_pieces_per_set_check
      CHECK (pieces_per_set IS NULL OR pieces_per_set >= 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_dimension_unit_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_dimension_unit_check
      CHECK (dimension_unit IS NULL OR dimension_unit IN ('FT', 'INCH', 'CM'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_dimension_length_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_dimension_length_check
      CHECK (dimension_length IS NULL OR dimension_length > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_dimension_width_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_dimension_width_check
      CHECK (dimension_width IS NULL OR dimension_width > 0);
  END IF;
END $$;

COMMENT ON COLUMN orders.sets_count IS
  'Stair Rug only: number of sets ordered. NULL for Cotton/Jute/Tufted and for rows saved before 2026-11-02.';
COMMENT ON COLUMN orders.pieces_per_set IS
  'Stair Rug only: pieces in one set (any whole number >= 1, no upper limit).';
COMMENT ON COLUMN orders.dimension_length IS
  'Stair Rug only: per-piece length in dimension_unit. Area is derived, never stored.';
COMMENT ON COLUMN orders.dimension_width IS
  'Stair Rug only: per-piece width in dimension_unit. Area is derived, never stored.';
COMMENT ON COLUMN orders.dimension_unit IS
  'Stair Rug only: FT | INCH | CM. See src/lib/orders/stair-rug.ts for conversions.';

NOTIFY pgrst, 'reload schema';
