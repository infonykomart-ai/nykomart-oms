-- 2026-08-13 (part 4) — new marketplace, ground-up build. Verified
-- against 2 real "Transactions" report exports (amazon.co.uk/GBP,
-- amazon.com/USD, same seller ARTS OF JAIPUR / NYKO MART). See
-- db/schema.sql's comment on amazon_transactions for the full detail —
-- order-ID matching, fee sign convention, and the real per-marketplace
-- date-format landmine (DD/MM/YYYY for UK, M/D/YYYY for US).

CREATE TABLE IF NOT EXISTS amazon_transactions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL REFERENCES companies(id),
  txn_date                     date,
  transaction_status             text,
  transaction_type                 text,
  order_id                           text,
  product_details                      text,
  total_product_charges                  numeric(14,2),
  total_promotional_rebates                numeric(14,2),
  amazon_fees                                numeric(14,2),
  other                                         numeric(14,2),
  total_amount                                   numeric(14,2),
  currency                                         varchar(3) NOT NULL,
  created_at                                         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amazon_txn_company_date ON amazon_transactions(company_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_amazon_txn_order_id ON amazon_transactions(order_id) WHERE order_id != '---';
