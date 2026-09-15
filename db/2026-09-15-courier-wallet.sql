-- 2026-09-15 — "kuch kuch courier me shipment bhejne se pehle wallet
-- recharge karna padta hai phir baad me adjust hota hai jab uska invoice
-- aata hai to iska kese karenge"
--
-- FedEx/UPS/Delhivery-style prepaid wallets: money goes INTO the courier's
-- wallet BEFORE shipments fly (recharge), the courier later raises freight
-- /duty invoices and deducts from the wallet, and any shortfall blocks new
-- bookings until the next recharge. The bill itself still lands in
-- bill_pass_register exactly as before — what's new is a per-(company,
-- party) wallet ledger that tracks:
--
--   recharge      money WE loaded into the wallet (bank → courier wallet)
--   consume       an invoice the wallet paid (bill_pass_register row paid
--                 from wallet balance)
--   refund        courier returned unused wallet money
--
-- balance = SUM(sign * amount) over the party's txns, computed in the app
-- (same no-generated-column-across-tables rule as bill_pass_register.
-- total_paid). direction: 'in' adds, 'out' subtracts.
--
-- wallet_paid is a plain column on bill_pass_register (NOT a trigger) —
-- the wallet action sets it explicitly when it fully pays a bill, and the
-- bill's own balance_due math (total_amt - credit_note_amt - adj_amt -
-- total_paid) treats it exactly like any other payment. Wallet payments
-- DO NOT insert into bill_pass_register_payments: that table's rows mean
-- "bank money left our account on this date" and the Bill Payment UI
-- counts them as paid; a wallet consume never touched the bank.
--
-- company_id + party_id both required: wallets are per company × courier
-- (Nyko Mart's FedEx wallet and Rugara's FedEx wallet are separate money).

CREATE TABLE IF NOT EXISTS party_wallet_txns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  party_id       uuid NOT NULL REFERENCES parties(id),
  txn_type       text NOT NULL CHECK (txn_type IN ('recharge', 'consume', 'refund')),
  direction      text NOT NULL CHECK (direction IN ('in', 'out')),
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  txn_date       date NOT NULL,
  -- bank payment_mode/reference for recharges (NEFT/RTGS/UPI + UTR);
  -- bill link for consumes (the bill_pass_register row the wallet paid).
  payment_mode   text,
  reference_no   text,
  remark         text,
  bill_pass_register_id uuid REFERENCES bill_pass_register(id) ON DELETE SET NULL,
  entered_by     uuid REFERENCES employees(id),
  entered_on     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_party_wallet_company_party ON party_wallet_txns(company_id, party_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_party_wallet_bill ON party_wallet_txns(bill_pass_register_id) WHERE bill_pass_register_id IS NOT NULL;

-- A bill can be wallet-consumed at most once (the consume IS its payment).
CREATE UNIQUE INDEX IF NOT EXISTS uq_party_wallet_bill_consume
  ON party_wallet_txns(bill_pass_register_id)
  WHERE txn_type = 'consume' AND bill_pass_register_id IS NOT NULL;
