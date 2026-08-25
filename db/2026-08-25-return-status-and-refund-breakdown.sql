-- Return status + refund breakdown calculator (2026-08-25)
-- Triggered by the user's clarification on the refund flow: an order that
-- was already invoiced/dispatched/delivered, and which the buyer then
-- returns post-delivery for a customer-satisfaction refund, is NOT a
-- cancellation — "order to dispatch kar diya cancel thodi hua hai" — so it
-- should end up with order.status = 'Returned', not 'Cancelled', while
-- still generating a Credit Note exactly like the existing Cancel+Refund
-- path does. The order_status enum already HAS a 'Returned' value (added
-- earlier, already used by courier-webhook RTO handling and the Orders/
-- Reports/CRM status filters) — this file does not touch the enum, only
-- order_refunds.
--
-- Also adds the optional refund-amount breakdown the user asked for: a
-- 10–100% dropdown against the order's value, plus separate Shipping Cost
-- and Duty & Taxes amounts, auto-summed into the refund total — while
-- `refund_amount` stays the single authoritative, always-manually-editable
-- total ("case-by-case decide karna padta hai" is unchanged; this is a
-- convenience calculator, not a rigid formula).
--
-- Also adds refund_amount_inr/refund_amount_usd — app-computed at save
-- time via the same official/live exchange-rate logic every order value
-- already uses (computeCurrencyConversion) — so a refund can be netted
-- against INR-denominated revenue regardless of what currency it was
-- entered in. Used by pl_dashboard_by_company_view, pl_dashboard_by_
-- month_view, and the Sale & Profit report to net a refunded order's
-- revenue against its refund(s) instead of only excluding fully-Cancelled
-- orders (2026-08-25, user confirmed: "ha kar do isko bhi").
--
-- Safe to run more than once (IF NOT EXISTS on every column).
-- ============================================================================

ALTER TABLE order_refunds
  ADD COLUMN IF NOT EXISTS refund_basis_percent      numeric(5,2),
  ADD COLUMN IF NOT EXISTS order_value_refund_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_refund_amount    numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duty_refund_amount        numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_amount_inr         numeric(14,2),
  ADD COLUMN IF NOT EXISTS refund_amount_usd         numeric(14,2);

COMMENT ON COLUMN order_refunds.refund_basis_percent IS
  'NULL = fully manual refund_amount entry (calculator not used). Otherwise the % of the order''s order_value_original picked from the 10-100% dropdown.';
COMMENT ON COLUMN order_refunds.order_value_refund_amount IS
  'The order-value portion of the refund, as computed by refund_basis_percent x order_value_original (0 if the calculator was not used for this row).';
COMMENT ON COLUMN order_refunds.shipping_refund_amount IS
  'Shipping cost included in this refund, if any (manually entered — orders does not store a per-order shipping cost).';
COMMENT ON COLUMN order_refunds.duty_refund_amount IS
  'Duty & taxes included in this refund, if any (manually entered — orders does not store a per-order duty/tax amount).';
COMMENT ON COLUMN order_refunds.refund_amount_inr IS
  'refund_amount converted to INR via computeCurrencyConversion() at save time. NULL only if conversion was genuinely unavailable (no Exchange Rate Master entry and live-rate fallback failed) — same convention as orders.order_value_inr.';
COMMENT ON COLUMN order_refunds.refund_amount_usd IS
  'refund_amount converted to USD via computeCurrencyConversion() at save time. Same nullability convention as refund_amount_inr.';

-- Existing rows (pre-2026-08-25) will have NULL refund_amount_inr/usd —
-- they predate this feature and are not backfilled here (no reliable
-- historical exchange rate lookup for old refund_date values is assumed
-- safe to run automatically). They simply won't be netted against revenue
-- until backfilled by hand if that history matters.

-- Confirm:
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'order_refunds'
ORDER BY ordinal_position;
