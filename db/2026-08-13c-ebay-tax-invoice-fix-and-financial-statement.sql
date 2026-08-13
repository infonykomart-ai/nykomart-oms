-- 2026-08-13 (part 3) — real eBay data batch (Dec 2025-Jul 2026, 8 months
-- each of "Tax invoice detail" CSV + the newer monthly "Financial
-- statement" PDF).

-- 1) New table for the "Financial statement" PDF — a different, simpler
-- monthly running-balance report from the existing ebay_financial_summary
-- table (built earlier from the richer "Financial Summary Report" PDF).
-- See db/schema.sql's comment on this table for the full verification
-- detail (running-balance chain + exact closing-funds formula match,
-- checked against 4+ of the 8 real months).
CREATE TABLE IF NOT EXISTS ebay_monthly_financial_statement (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL REFERENCES companies(id),
  statement_number              text,
  period_from                     date NOT NULL,
  period_to                         date NOT NULL,
  generated_date                      date,
  opening_funds                         numeric(14,2) NOT NULL DEFAULT 0,
  orders_total_minus_fees                 numeric(14,2) NOT NULL DEFAULT 0,
  claims                                    numeric(14,2) NOT NULL DEFAULT 0,
  refunds                                     numeric(14,2) NOT NULL DEFAULT 0,
  payment_disputes                              numeric(14,2) NOT NULL DEFAULT 0,
  shipping_labels                                 numeric(14,2) NOT NULL DEFAULT 0,
  other_fees                                        numeric(14,2) NOT NULL DEFAULT 0,
  adjustment                                          numeric(14,2) NOT NULL DEFAULT 0,
  purchases                                             numeric(14,2) NOT NULL DEFAULT 0,
  charges                                                 numeric(14,2) NOT NULL DEFAULT 0,
  payouts                                                   numeric(14,2) NOT NULL DEFAULT 0,
  closing_funds_stated                                        numeric(14,2) NOT NULL DEFAULT 0,
  closing_funds_computed numeric(14,2) GENERATED ALWAYS AS (
    opening_funds + orders_total_minus_fees + claims + refunds + payment_disputes
    + shipping_labels + other_fees + adjustment + purchases + charges + payouts
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_from, period_to)
);

-- 2) App-code fixes only, no further SQL needed for these — noted here
-- since found in the same real-data pass:
--   a) src/lib/statement-import/tables.ts's "ebay_tax_invoice" column
--      config had 2 header mismatches against the real "Tax invoice
--      detail" CSV export: "Txn Date" -> real header is "Date", and
--      "IGST %" -> real header is "IGST (%)". Both would have imported
--      as NULL for every row.
--   b) The generic CSV importer (src/app/dashboard/csv-upload/actions.ts)
--      assumed row 1 of the uploaded file is always the header row. The
--      real "Tax invoice detail" export has a 5-line metadata preamble
--      (Invoice date / seller ID / report name / marketplace entity /
--      time period) before the real header — every row would have failed
--      to import. Fixed generically (scores the first 40 rows against
--      the target table's configured headers, picks the best match) so
--      this also covers Bank Statement 2023's 16-line preamble and eBay
--      Transaction Report's ~10-line preamble noted in the original
--      2026-08-01 build notes (not re-verified against real data this
--      round, but the same generic fix applies to those too).
