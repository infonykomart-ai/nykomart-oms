-- =====================================================================
-- orders.buyer_country — auto-derived country, 2026-08-22.
--
-- "JAB APNE SABHI ORDER ME KARIB KARIB RECIVER KA ADDRESH WIHT ZIP CODE
-- MOJUD HAI TO COUNTRY KYU NAHI AARI ISKA PERMANENT ILAJ KARO ORDER ME EK
-- JAGH DALTE HAI TO VAHA SE AUTOMETIC FATCH HO JAYE": the SKU x Country x
-- Size report's "Top Countries" table showed 645 orders as "(unknown)"
-- because it sourced country from dispatch_invoices.buyer_country — a
-- field only ever set manually at dispatch time, which most orders never
-- reach (or nobody fills in). This column is instead auto-derived, in
-- application code, from orders.buyer_name_address the moment it's typed
-- at order entry or edited — see src/lib/geo/parse-country.ts for the
-- extraction logic and its validation notes.
--
-- Plain (non-generated) column, written by app code in createOrderCore()
-- (new order + bulk upload, both funnel through it) and updateOrder() —
-- not a DB GENERATED column, since the parsing logic (alias tables,
-- postal-format fallbacks) is far more maintainable/testable in
-- TypeScript than as an IMMUTABLE PL/pgSQL function, and every write path
-- already funnels through those two functions.
--
-- Distinct from:
--  - destination_country (orders) — the separate MANUAL UK/EU-only VAT/
--    EORI/IOSS customs-declaration field, untouched by this change.
--  - dispatch_invoices.buyer_country — still set independently at
--    dispatch time; NOT overwritten or removed by this migration.
--
-- NULL = not yet backfilled/computed. '' (empty string) = computed, but
-- the address didn't resolve to a known country (parser deliberately
-- never guesses) — distinguished from NULL so the one-time backfill
-- (Admin > Backup Export > "Backfill Buyer Country") doesn't re-attempt
-- the same unresolved rows forever. Idempotent — safe to re-run.
-- =====================================================================

alter table orders add column if not exists buyer_country text;

comment on column orders.buyer_country is
  'Auto-derived from buyer_name_address at order entry/edit time (see src/lib/geo/parse-country.ts) — NOT a manually-typed field. NULL = not yet computed; empty string = computed, no confident match. Reports should read this instead of dispatch_invoices.buyer_country (dispatch-time only). destination_country stays separate — the manual UK/EU customs-declaration field.';

create index if not exists idx_orders_buyer_country on orders(buyer_country);
