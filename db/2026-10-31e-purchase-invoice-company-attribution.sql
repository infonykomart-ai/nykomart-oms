-- 2026-10-31e — ONE VENDOR INVOICE = ONE DOCUMENT = ONE COMPANY (data repair)
--
-- WHY
--   A Purchase/Printing bill is stored as ONE bill_pass_register row per item/PO
--   (see src/lib/bill-grouping.ts), and before the Finance hand-off
--   (2026-10-29) each row's company came from the item's own ORDER. So ONE
--   vendor invoice entered on, say, 4 Nyko orders + 2 Rugara orders was posted
--   as two part-amounts in two companies' ledgers — neither showing the real
--   bill, and no payment ever tying out against it. User: "bill me 4 order nyko
--   ke hai to 4 ka total nyko me dikha raha, baki rugara me or bill register hua
--   nyko me. total jud ke aana chahiye nyko ke ledger me."
--
-- WHAT THIS DOES (single transaction, idempotent — safe to re-run)
--   For every Purchase/Printing invoice (same party + vendor invoice no. +
--   invoice date) whose ledger rows currently sit in more than one company, the
--   WHOLE invoice is moved to the company it is registered in:
--     1. if every item row of the invoice points at the same
--        purchase_bills.company_id, that company wins (it is the one the bill
--        was posted to / registered in);
--     2. otherwise (legacy rows with no or disagreeing stamps) the company
--        holding the largest share of the invoice wins — the company that
--        actually books it; a tie goes to the company whose row was posted
--        first.
--   Then purchase_bills.company_id is stamped to match, so the bill's own A4
--   sheet, the Document Entry list and the ledger all name the same company.
--
--   Only company_id changes. Amounts, dates, payments, notes, adjustments and
--   audit history are untouched — the rows themselves never move, so every
--   payment / debit note / credit note that points at a row keeps pointing at
--   it.
--
-- WHAT IT DOES NOT TOUCH
--   • Courier / Duty / office-expense rows: one row per document already, so
--     each already belongs to the one company it was posted to.
--   • Merged duplicates (merged_into_bill_id set — kept for audit only).
--   • Rows with no party or no vendor invoice number (they can never be
--     proven to be the same document).
--
-- PREVIEW FIRST (optional, read-only):
--   SELECT b.party_id, b.vendor_invoice_no, b.invoice_date,
--          array_agg(DISTINCT b.company_id) AS companies
--     FROM bill_pass_register b
--    WHERE b.source = 'purchase_bill'
--    GROUP BY 1,2,3
--   HAVING count(DISTINCT b.company_id) > 1;

BEGIN;

-- Every Purchase/Printing ledger row with its invoice identity and the company
-- its own document (purchase_bills row) is registered in.
CREATE TEMP TABLE _pb_invoice_rows ON COMMIT DROP AS
SELECT b.id  AS bpr_id,
       b.party_id,
       b.company_id AS row_company,
       b.total_amt,
       b.created_at,
       lower(btrim(b.vendor_invoice_no)) AS inv,
       COALESCE(b.invoice_date, b.invoice_recv_date, date '1900-01-01') AS inv_date,
       pb.id AS pb_id,
       pb.company_id AS doc_company
  FROM bill_pass_register b
  LEFT JOIN purchase_bills pb ON pb.id = b.source_id
 WHERE b.source = 'purchase_bill'
   AND b.merged_into_bill_id IS NULL
   AND b.party_id IS NOT NULL
   AND btrim(COALESCE(b.vendor_invoice_no, '')) <> '';

-- Rule 1 — the invoice's own company, when every item row agrees on it.
CREATE TEMP TABLE _pb_doc_company ON COMMIT DROP AS
SELECT party_id, inv, inv_date,
       min(doc_company::text)::uuid AS doc_company
  FROM _pb_invoice_rows
 GROUP BY party_id, inv, inv_date
HAVING count(DISTINCT doc_company) = 1
   AND count(doc_company) > 0;

-- Rule 2 — otherwise the biggest share. Rule 1 always wins when available
-- (COALESCE + "doc answer first" in the ORDER BY).
CREATE TEMP TABLE _pb_owner ON COMMIT DROP AS
WITH share AS (
  SELECT party_id, inv, inv_date, row_company,
         sum(abs(total_amt)) AS amount,
         min(created_at)     AS first_at
    FROM _pb_invoice_rows
   GROUP BY party_id, inv, inv_date, row_company
)
SELECT DISTINCT ON (s.party_id, s.inv, s.inv_date)
       s.party_id, s.inv, s.inv_date,
       COALESCE(d.doc_company, s.row_company) AS owner_company
  FROM share s
  LEFT JOIN _pb_doc_company d USING (party_id, inv, inv_date)
 ORDER BY s.party_id, s.inv, s.inv_date,
          (d.doc_company IS NOT NULL) DESC,
          s.amount DESC,
          s.first_at ASC;

-- The ledger rows follow the invoice.
UPDATE bill_pass_register b
   SET company_id = o.owner_company
  FROM _pb_invoice_rows r
  JOIN _pb_owner o
    ON o.party_id = r.party_id
   AND o.inv      = r.inv
   AND o.inv_date = r.inv_date
 WHERE b.id = r.bpr_id
   AND b.company_id <> o.owner_company;

-- ...and so does the bill document itself (A4 sheet / Document Entry list).
UPDATE purchase_bills pb
   SET company_id = o.owner_company
  FROM _pb_invoice_rows r
  JOIN _pb_owner o
    ON o.party_id = r.party_id
   AND o.inv      = r.inv
   AND o.inv_date = r.inv_date
 WHERE pb.id = r.pb_id
   AND pb.company_id IS DISTINCT FROM o.owner_company;

COMMIT;
