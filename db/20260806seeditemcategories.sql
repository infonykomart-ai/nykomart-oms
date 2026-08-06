-- Item Category dropdown is empty right now — that table was never seeded
-- with real data (only Order Entry got built so far; the "Company & Items"
-- admin screen where you'd normally add these yourself isn't built yet).
--
-- These 4 are real values pulled from your own MASTER_STOCK_SHEET2026.xlsx
-- (the "Product Name" column across JK/HT/APL current-stock sheets) so the
-- dropdown isn't empty anymore and you can save a real order today. This is
-- almost certainly NOT your full category list — reply with whatever else
-- is missing and I'll add it the same way (takes 30 seconds, no app
-- redeploy needed).

INSERT INTO item_categories (name) VALUES
  ('Top'),
  ('Top-bottom Set'),
  ('Kurtis'),
  ('Dangree')
ON CONFLICT (name) DO NOTHING;

-- Confirm:
SELECT name FROM item_categories ORDER BY name;
