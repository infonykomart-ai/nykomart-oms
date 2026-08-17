-- 2026-08-17: "SABHI PARTY KE LADGER BHI NAHI BANE ABHI TAK MERE HISAB SE"
-- (as far as I know, party ledgers haven't been built for all parties yet).
--
-- Investigation: purchase_bills already links to parties via vendor_party_id
-- (NOT NULL) and auto-posts to bill_pass_register with party_id set, so a
-- Purchase Bill can always be traced back to its vendor. Courier Bills
-- (freight_bills) and Duty & Tax Bills (duty_tax_bills) had NO party/vendor
-- column at all — only an invoice_no. When one of those bills is "Sent to
-- Bill Pass Register", the app set party_type = 'Courier' but party_id
-- stayed NULL, so those bills could never surface under any specific
-- party's ledger no matter what. This migration adds the missing column;
-- the app code (freight-bill-section.tsx / duty-bill-section.tsx /
-- actions.ts) has already been updated to show a "Vendor / Courier Party"
-- dropdown on the New Courier Bill / New Duty & Tax Bill forms and to carry
-- that party through to bill_pass_register.party_id when sent to Finance.
--
-- Nullable and additive — safe to run with existing data. The 30 freight_
-- bills + 38 duty_tax_bills rows already in production (created before this
-- column existed) will have vendor_party_id = NULL; they simply won't show
-- up in any Party Ledger until you open each one in Document Entry →
-- Courier Bill / Duty & Tax Bill and pick its vendor from the new dropdown
-- (no bulk/automatic way to backfill this safely — the source data doesn't
-- record which courier issued which of those specific invoices).
--
-- Also: no courier company (DHL, Delhivery, Aramex, FedEx, etc.) currently
-- exists as a row in Party Master (`parties`) at all — checked live, all 17
-- existing parties are purchase/job-work vendors. Add couriers via
-- Party Master (/dashboard/parties) — a party_type of "Courier" (or an
-- invoice_type of "FREIGHT INVOICE"/"DUTY TAX") is what makes them show up
-- grouped under "🚚 Courier" in the new dropdown instead of the flat list.

ALTER TABLE freight_bills
  ADD COLUMN IF NOT EXISTS vendor_party_id uuid REFERENCES parties(id);

ALTER TABLE duty_tax_bills
  ADD COLUMN IF NOT EXISTS vendor_party_id uuid REFERENCES parties(id);

CREATE INDEX IF NOT EXISTS idx_freight_bills_vendor_party ON freight_bills(vendor_party_id);
CREATE INDEX IF NOT EXISTS idx_duty_tax_bills_vendor_party ON duty_tax_bills(vendor_party_id);

-- Verify after running:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name IN ('freight_bills','duty_tax_bills') AND column_name = 'vendor_party_id';
-- Expected: 2 rows.
