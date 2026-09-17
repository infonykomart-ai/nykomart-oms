-- 2026-09-17 — Bank & Card Reconciliation module (db/2026-09-17-bank-recon.sql).
--
-- User's ask, verbatim: "bank recolantions ke liye jese jo account add
-- hoyega bank ka agar uske alava bhi koi dusra account ho jisme pese aate
-- ho to kese hoyega us bank statement upload karne ka option ho or vo auto
-- metic ye cler kar de ki itna paisa is store se aaya or itna is store se"
-- + "agar koi payment utr se refance no se invoce no se party name se
-- match kar rahi hia to vo bhi mark ho jaye or link ho jaye lekin purane
-- payment ko distrub nahi kare" + "sath me ese hi ek se jyada credit card
-- bhi add karne ka option ho" + "statement kesa bhi ho auto adjust kare
-- collom vagera sabhi" + "har mahine statement dalae ya daily duplicate
-- entry nhi hoye".
--
-- Three tables + one capability, all idempotent (IF NOT EXISTS / guarded):
--
-- 1. bank_recon_accounts — the REGISTRY of bank accounts AND credit cards.
--    Any number per company. account_type = 'bank' | 'card'.
--    company_share_pct splits a joint/personal account across companies.
-- 2. bank_statement_lines — EXTENDED (not replaced): the existing PNB
--    import table gains recon_account_id (which account a line belongs
--    to — NULL = the old CSV-upload flow's lines, unchanged), recon
--    status/link columns, and the dedupe fingerprint + batch id. The old
--    csv-upload importer keeps writing exactly as before (all new columns
--    are nullable / defaulted), so nothing already in production changes
--    shape.
-- 3. bank_recon_links — one verified/matched link row per statement line.
--    THE INVARIANT (user's explicit rule): matching NEVER modifies any
--    existing system row — no bill_pass_register, no payment, no expense.
--    Links live entirely inside this module, so they can be undone with
--    zero risk to the books.
-- 4. bank_statement_columns — per-account LEARNED column mapping (file
--    header -> recon field) so the second upload of the same bank parses
--    silently, whatever its column naming.
-- 5. Capability 'bank_recon' granted to Finance, Admin and MD (Finance
--    already holds csv_upload + bill_payment, so it can run the whole
--    flow without a permissions change; the tile is deliberately its own
--    capability — real balances/card outstanding are more sensitive than
--    bill_payment alone).
--
-- Dedupe design ("duplicate entry nhi hoye" vs "same day, same amount,
-- two REAL payments"): import_fingerprint = UTR/ref-no when present,
-- else (account, date, ±amount, 8-char narration stem). Two same-day
-- same-amount payments to the same vendor have DIFFERENT UTRs in their
-- narrations, so both import; re-uploading the same file fingerprint-
-- matches every row and imports nothing.
--
-- Run this whole file once in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Account registry (bank + card, any number)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_recon_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  account_type      text NOT NULL DEFAULT 'bank' CHECK (account_type IN ('bank', 'card')),
  account_name      text NOT NULL,
  bank_name         text,
  account_number    text,
  card_label        text,
  statement_kind    text NOT NULL DEFAULT 'upload',  -- reserved for future direct feeds; 'upload' today
  -- joint/personal account split: 60 = 60% of every amount counts for this
  -- company. NULL = 100% (the normal case — one account per company).
  company_share_pct numeric(5,2) CHECK (company_share_pct IS NULL OR (company_share_pct > 0 AND company_share_pct <= 100)),
  opening_balance   numeric(14,2),
  active            boolean NOT NULL DEFAULT true,
  notes             text,
  created_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_recon_accounts_company
  ON bank_recon_accounts(company_id) WHERE active;

-- ---------------------------------------------------------------------------
-- 2. Extend the existing statement table (old CSV-upload flow untouched)
-- ---------------------------------------------------------------------------
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS recon_account_id uuid REFERENCES bank_recon_accounts(id);
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS recon_status text NOT NULL DEFAULT 'unmatched';
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS linked_party_id uuid REFERENCES parties(id);
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS linked_store_id uuid REFERENCES stores(id);
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS linked_bill_id uuid;         -- bill_pass_register.id (no FK on purpose: links must survive bill merges, which re-point/zero bill rows)
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS linked_order_id uuid REFERENCES orders(id);
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS linked_reference text;       -- human-readable "what this matched to"
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS linked_by_employee_id uuid REFERENCES employees(id);
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS match_method text;           -- utr | order_no | invoice_no | party_name | amount_month | verified
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS import_fingerprint text;     -- dedupe key (see file header)
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS imported_batch_id uuid;      -- groups one upload

-- Legacy rows imported via the old CSV-upload flow are historical PNB
-- statements: leave them out of the recon screens (they have no account)
-- but count them as linked so they never look "pending".
UPDATE bank_statement_lines
SET recon_status = 'linked'
WHERE recon_account_id IS NULL AND recon_status = 'unmatched';

CREATE INDEX IF NOT EXISTS idx_bank_stmt_account_status
  ON bank_statement_lines(recon_account_id, recon_status);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_fingerprint
  ON bank_statement_lines(import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Link table — audit-only; touches nothing outside this module
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_recon_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_line_id uuid NOT NULL REFERENCES bank_statement_lines(id) ON DELETE CASCADE,
  target_type       text NOT NULL CHECK (target_type IN ('bill_payment', 'salary_payment', 'card_expense', 'order_sale', 'expense', 'unmatched')),
  target_id         text NOT NULL,          -- uuid of the target, or 'party:<uuid>' for party-only links
  target_label      text NOT NULL,          -- what the UI showed ("Purchase 82 — AG Computer (payment ref HDFC123...)")
  target_company_id uuid,
  matched_amount    numeric(14,2),
  match_method      text NOT NULL DEFAULT 'verified',
  match_score       numeric(5,1),
  verified_by_employee_id uuid REFERENCES employees(id),  -- NULL = auto-linked by the match run
  verified_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_recon_links_line
  ON bank_recon_links(statement_line_id);
CREATE INDEX IF NOT EXISTS idx_bank_recon_links_target
  ON bank_recon_links(target_type, target_id);

-- ---------------------------------------------------------------------------
-- 4. Learned column mapping per account ("statement kesa bhi ho auto
--    adjust kare collom vagera sabhi")
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_statement_columns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES bank_recon_accounts(id) ON DELETE CASCADE,
  file_header text NOT NULL,   -- the bank's own header text, as-is
  maps_to     text NOT NULL CHECK (maps_to IN ('txn_date','description','ref_no','withdrawal','deposit','balance','cheque_no')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Postgres does not allow an expression inside a table-level UNIQUE
-- constraint (that was the 42601 "syntax error at or near (" the first run
-- hit) — expression uniqueness must be a separate CREATE UNIQUE INDEX.
-- Case-insensitive so "Txn Date" and "TXN DATE" from the same bank map to
-- one learned row, not two.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_columns_header
  ON bank_statement_columns(account_id, lower(file_header));

-- ---------------------------------------------------------------------------
-- 5. Capability + role grants (data change, not a redeploy — see roles/
--    role_capabilities in db/schema.sql)
-- ---------------------------------------------------------------------------
INSERT INTO capabilities (code, description)
VALUES ('bank_recon', 'Bank & Card Reconciliation — multi bank/card accounts, statement upload with auto column mapping, UTR/order/party matching and card outstanding — Admin/MD/Finance')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'bank_recon' FROM roles r
WHERE r.name IN ('Finance', 'Admin', 'MD')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. RLS policy (project convention, db/2026-08-08-enable-rls.sql): every
--    table carries exactly one blanket policy for authenticated. Saves go
--    through the service-role client anyway, but WITHOUT this any page
--    read through the anon-key browser client silently returns nothing —
--    the exact bug hit with courier_shipper_profiles the same day (see
--    db/2026-09-17-rls-policy-followup.sql).
-- ---------------------------------------------------------------------------
ALTER TABLE bank_recon_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_recon_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON bank_recon_accounts;
CREATE POLICY allow_authenticated_all ON bank_recon_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON bank_recon_links;
CREATE POLICY allow_authenticated_all ON bank_recon_links FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON bank_statement_columns;
CREATE POLICY allow_authenticated_all ON bank_statement_columns FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON bank_statement_lines;
CREATE POLICY allow_authenticated_all ON bank_statement_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Sanity checks — run after the file; expected values in comments.
-- ---------------------------------------------------------------------------
SELECT count(*) AS recon_accounts_table_exists FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('bank_recon_accounts', 'bank_recon_links', 'bank_statement_columns');
-- expected: 3

SELECT column_name FROM information_schema.columns
WHERE table_name = 'bank_statement_lines' AND column_name IN ('recon_account_id', 'recon_status', 'import_fingerprint')
ORDER BY column_name;
-- expected: 3 rows (import_fingerprint, recon_account_id, recon_status)

SELECT capability_code FROM role_capabilities rc
JOIN roles r ON r.id = rc.role_id
WHERE rc.capability_code = 'bank_recon' ORDER BY r.name;
-- expected: Admin, Finance, MD
