-- Invoice value breakdown (item cost / insurance / freight) + fuller
-- customs-invoice detail fields — 2026-08-10.
--
-- User's ask (verified against a real sample invoice, NL1712627.pdf,
-- COST=41.58 / INSURANCE=0.75 / FREIGHT=96.27 / TOTAL=138.60 — every
-- number below was reverse-engineered against that exact sample and
-- matches to the cent):
--
--   Amazon orders  -> declared invoice value = 60% of the order's real
--                     value (orders.order_value_usd).
--   Etsy/Website/eBay orders -> declared invoice value = 60% too — this
--                     was originally spec'd as 80%, then corrected
--                     2026-08-10 ("Etsy/Website/eBay → 60% kar do") to
--                     match Amazon. See src/lib/invoices/value-
--                     breakdown.ts's valuePercentForStore() — the single
--                     source of truth for this percentage.
--
-- That declared value (called `invoice_value_usd` below, "V") is then
-- broken into 3 customs line items that always sum EXACTLY to V:
--   item_cost_total = 30% of V
--   insurance_total = a flat USD 0.75 (not a % — confirmed exact match
--                     against the sample regardless of V)
--   freight_total   = V - item_cost_total - insurance_total (the
--                     BALANCING remainder — the user described this as
--                     "69.25%", which is what that remainder typically
--                     works out to as a % of V for their usual order
--                     sizes, but it is NOT an independent 69.25%
--                     multiplier: computing it that way would leave the
--                     3 line items NOT summing to V, which a real customs
--                     invoice can't tolerate. Confirmed against the
--                     sample: 0.30*138.60=41.58 exact match; freight =
--                     138.60-41.58-0.75=96.27 exact match; 69.25% would
--                     have given 95.98, NOT the real sample's 96.27).
--
-- CSB-IV ("csv-4 me manual rakho value kitni rakhnai hai" — keep CSB-IV's
-- value manual): these 3 new totals + value_percent stay NULL/blank by
-- default for a CSB-IV invoice — no auto-calculation happens, the
-- generate form leaves them as plain editable number inputs the preparer
-- fills in by hand, same structural columns, no automatic marketplace-%
-- logic. Only CSB-V gets the automatic 60%/80% + 30%/flat-0.75/remainder
-- computation at generation time (src/app/dashboard/invoices/actions.ts).
--
-- Applies identically across all 3 companies (Nyko Mart / Rugara / CASA
-- ARRA) — "sabhi company me yahi fanda rahega" — the logic lives in one
-- shared function, not duplicated per company.
ALTER TABLE sales_invoices
  ADD COLUMN value_percent    numeric(5,2),   -- currently always 60.00 for CSB-V (marketplace-based, see value-breakdown.ts); NULL for CSB-IV (manual)
  ADD COLUMN invoice_value_usd numeric(14,2), -- "V" / "Total" — the declared invoice value in USD (see header comment)
  ADD COLUMN item_cost_total  numeric(14,2),
  ADD COLUMN insurance_total  numeric(14,2),
  ADD COLUMN freight_total    numeric(14,2);

COMMENT ON COLUMN sales_invoices.value_percent IS
  'Currently always 60.00 for CSB-V (auto-computed at generation time — see src/lib/invoices/value-breakdown.ts''s '
  'valuePercentForStore() for the single source of truth) — NULL for CSB-IV, where value entry stays fully manual '
  'per the user''s 2026-08-10 instruction.';
COMMENT ON COLUMN sales_invoices.invoice_value_usd IS
  'The declared invoice total in USD ("V") — for CSB-V this is order_value_usd (summed across the invoice''s '
  'orders) * value_percent/100; for CSB-IV it is typed in by hand. item_cost_total + insurance_total + '
  'freight_total must always sum to exactly this value (freight is the balancing figure, not an independent %).';

-- Taxable value in INR (the sample's "TAXABLE VALUE IN [INR]" package-table
-- field) = invoice_value_usd converted to INR via the SAME official-rate/
-- live-estimate chain as orders' own order_value_inr (see
-- src/lib/orders/currency.ts's computeCurrencyConversion(), reused as-is
-- with currency="USD" rather than a new conversion function) — confirmed
-- against the sample: 138.60 USD * ~94.30 INR/USD = 13069.98, an exact
-- match to the sample's printed taxable value.
ALTER TABLE sales_invoices
  ADD COLUMN taxable_value_inr numeric(14,2);

-- "Invoice Declared Value: USD One Hundred Thirty Eight Dollars and Sixty
-- Cents Only" — auto-generated (src/lib/invoices/number-to-words.ts) from
-- invoice_value_usd at generation time, stored editable afterward like
-- every other generated-then-editable invoice field in this table.
ALTER TABLE sales_invoices
  ADD COLUMN declared_value_words text;

-- Fuller customs-invoice detail fields — the sample (NL1712627.pdf) shows
-- several fields the invoice view didn't have yet: AWB/tracking no.,
-- vessel/flight + port of discharge, marks & nos./container no. + package
-- count, a buyer email/phone (sourced from dispatch_invoices when
-- available, since orders itself has no email/phone field — only
-- buyer_name_address as one free-text blob), an optional second
-- "Other Than Consignee" block, and — "agar uk & europe ki shipment hai
-- or agar usme IOSS, VAT, EORI no vagera aaya hua hai according to
-- destination country guideline" — VAT Number and EORI Number alongside
-- the existing ioss_number column, same "typed in at invoice time, only
-- when applicable, always editable" pattern (real per-account VAT/EORI
-- registration numbers aren't something this app can derive — they're
-- entered by whoever generates the invoice, same as IOSS already is).
ALTER TABLE sales_invoices
  ADD COLUMN awb_no              text,
  ADD COLUMN vessel_flight_no    text,
  ADD COLUMN port_of_discharge   text,
  ADD COLUMN marks_and_nos       text,
  ADD COLUMN no_of_packages      integer,
  ADD COLUMN buyer_email         text,
  ADD COLUMN buyer_phone         text,
  ADD COLUMN other_than_consignee text,
  ADD COLUMN vat_number          text,
  ADD COLUMN eori_number         text;
