-- 2026-08-17 — "KACHA MAAL... GENERAL STOCK KE LIYE — KOI FIXED PO NAHI":
-- raw-material vendor purchases (e.g. Aaradhya Fabrics) are bought as
-- general stock, not for one specific PO/RF/RG order, so the Purchase Bill
-- form's order link goes back to optional (it had been made REQUIRED in
-- the 2026-08-08 round).
--
-- purchase_bills never had its own company_id column — it was always
-- derived from order_id -> orders.company_id, which only works when an
-- order is actually linked. This adds a real company_id column so an
-- orderless (general-stock) Purchase Bill still has an unambiguous company
-- for scoping, Finance-ledger mirroring, and reporting. Every EXISTING row
-- currently has an order_id (the link was required until today), so the
-- backfill below should assign every existing row's company_id from its
-- order and leave 0 rows null — the verification query at the bottom
-- confirms that before you move on.
--
-- Dry-run tested against a local scratch Postgres (schema.sql + seeded
-- companies/orders) before delivery: ALTER + backfill + a simulated
-- orderless insert all worked as expected.

BEGIN;

ALTER TABLE purchase_bills ADD COLUMN company_id uuid REFERENCES companies(id);

UPDATE purchase_bills pb
SET company_id = o.company_id
FROM orders o
WHERE pb.order_id = o.id AND pb.company_id IS NULL;

CREATE INDEX idx_purchase_bills_company ON purchase_bills(company_id);

COMMIT;

-- Verify: should return 0 rows. If it returns any, those Purchase Bills
-- have an order_id pointing at an order that no longer exists — the app
-- code will still work (new orderless bills always set company_id
-- directly), but these specific old rows would show as company-less until
-- fixed by hand.
SELECT id, vendor_invoice_no, order_id
FROM purchase_bills
WHERE company_id IS NULL;
