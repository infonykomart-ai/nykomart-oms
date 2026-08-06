-- =============================================================================
-- ORDER MANAGEMENT SYSTEM — PostgreSQL schema (Supabase)
-- Nyko Mart / Rugara / CASA ARRA
--
-- Rewritten from the Google Sheets / Apps Script system defined in
-- build.py (32 sheet layouts) and gscript/Code.gs (business logic). This is
-- a NORMALIZED relational design, not a 1:1 sheet-to-table dump — see the
-- mapping table below and webapp/db/SCHEMA_NOTES.md for the full reasoning,
-- open questions and sheet-by-sheet notes.
--
-- ---------------------------------------------------------------------------
-- KEY DESIGN DECISIONS
-- ---------------------------------------------------------------------------
-- 1. PRIMARY KEYS: UUID (gen_random_uuid()) on every transactional/entity
--    table. Reasoning: this becomes a Supabase-backed app exposed over
--    PostgREST/Supabase client to a browser — UUIDs avoid leaking row counts
--    / sequential IDs to the client, work naturally with Supabase Auth (auth
--    user ids are UUIDs, see employees.auth_user_id), and need no central
--    sequence coordination if the app ever writes offline-first or from an
--    edge function. Exception: a handful of pure static lookup tables whose
--    natural key already IS a stable short code — `currencies` (ISO code)
--    and `capabilities` (short string code) — use that code as primary key
--    instead of adding a redundant surrogate UUID.
--
-- 2. company_id FOREIGN KEYS: every per-company table carries a `company_id
--    uuid REFERENCES companies(id)` column instead of a repeated text
--    column ("Nyko Mart" / "Rugara" / "CASA ARRA"). The old system's
--    "All_Orders_Master" + 3 near-identical per-company order tabs collapse
--    into ONE `orders` table with a `company_id` FK (see #3).
--
-- 3. ORDERS: the old system wrote every order TWICE — once to
--    All_Orders_Master and once to the matching company tab (Nyko Mart /
--    Rugara / CASA ARRA), kept in sync by matching ENTRY TIMESTAMP. That
--    duplication was a Google Sheets limitation (Apps Script has no live
--    cross-sheet FILTER), not a real business need. Here there is ONE
--    `orders` table with `company_id`; "give me Nyko Mart's orders" is just
--    `WHERE company_id = ...`, and "give me every order" needs no separate
--    table at all.
--
-- 4. FORMULA-DRIVEN SHEETS become, per case:
--      (a) a GENERATED ALWAYS AS ... STORED column, when the arithmetic
--          only references OTHER COLUMNS IN THE SAME ROW (e.g. Freight
--          Bill's TOTAL AMT = FREIGHT AMT + FUEL AMT + OTHER CHARGES).
--          NOTE: PostgreSQL generated columns cannot reference another
--          generated column, so multi-step same-row formulas are written
--          with the full expression inlined at each step (documented
--          per-column below).
--      (b) a SQL VIEW, when the arithmetic pulls from OTHER TABLES (e.g.
--          Freight Reconciliation's INDEX/MATCH-by-AWB lookups into
--          Dispatch & Invoice, or Net Revenue's cross-sheet SUM). Nothing
--          is stored twice; the view recomputes live, same as the sheet did.
--      (c) application code, when the rule is genuinely conditional /
--          stateful and not expressible as a pure per-row or per-query
--          formula (buyer-batch tagging, duplicate-order detection,
--          document-number *reservation timing*). These are documented as
--          comments on the relevant table, not implemented in SQL — see
--          "BUSINESS RULES ENFORCED IN APPLICATION CODE" below.
--
-- 5. DOCUMENT NUMBERING (e.g. "NM/CN/26-27/0006", "PO-0001-1/2"): the
--    running-sequence PART of this genuinely CAN be done cleanly in
--    PostgreSQL (see section 2, `sequence_counters` + `reserve_next_number()`
--    + BEFORE INSERT triggers on Debit Note / Credit Note / Washing Data /
--    Internal Invoice / HR Letters) using an atomic INSERT ... ON CONFLICT
--    DO UPDATE ... RETURNING, which is race-safe under concurrent inserts
--    without an explicit advisory lock. Order PO/RF/RG numbers use the SAME
--    counter table and function, but are NOT trigger-generated, because
--    *whether* to reserve a fresh number at all is conditional business
--    logic (duplicate-dispatched-order reuse, manual override) that must
--    run in the application before the row is written — see comments on
--    `orders.ref_no` below.
--
-- 6. ENUM TYPES are used for the sheet's FIXED dropdown lists that had no
--    "add a new value" admin function in Code.gs (Status, Shipment Status,
--    Address Type, Duty & Tax Mode, Delivered/NOT Delivered, Bank Status,
--    Payment Type, Invoice Type, Refund Type, Attendance Status/Source,
--    Letter Type). Lists that WERE runtime-extensible in the old system
--    (addCompany_, addItemCategory_, addSize_, addParty) became real master
--    tables instead (`companies`, `item_categories`, `sizes`, `parties`,
--    `skus`), each with the obvious CRUD replacing the old "append to a
--    hidden Lists column" trick.
--
-- 7. "SIZES" is a special case: the source SIZES_LIST has ~280 real-world
--    values with inconsistent case/typos ("5X5 ft" vs "5X5 FT") that were
--    never cleaned up, plus a "CUSTOME SIZE" catch-all. Orders keep BOTH a
--    nullable `size_id` FK (for new entries picked from the clean `sizes`
--    master list) and a raw `size_label` text column (always populated,
--    preserving whatever was actually typed/imported) — see
--    SCHEMA_NOTES.md open question #4.
--
-- =============================================================================
-- BUSINESS RULES ENFORCED IN APPLICATION CODE, NOT SQL
-- (documented here + repeated as a comment at point of use)
-- =============================================================================
-- • BUYER-BATCH SUFFIX ("-1/2, -2/2"): when the same buyer (matched by
--   contact_no digits-only, falling back to buyer_name_address trimmed/
--   lowercased, when contact_no is blank) places more than one order on the
--   same order_date within one company, every one of that buyer's orders
--   that day gets its ref_no suffixed "-position/total" (oldest first),
--   recomputed from scratch on every new/edited order in the batch. A lone
--   order that day keeps its bare ref_no. See orders.ref_no comment.
-- • DUPLICATE-DISPATCHED-ORDER REUSE: before reserving a new PO/RF/RG
--   number, the app checks whether this is really the SAME marketplace
--   order (same buyer-match-key + same marketplace order_no) as an existing
--   order in the SAME company that has ALREADY been dispatched. If so, the
--   new row reuses that existing order's base ref_no instead of getting a
--   fresh number or being pulled into a batch-suffix group.
-- • DOCUMENT-NUMBER RESERVATION TIMING (orders only): a PO/RF/RG number is
--   reserved (via reserve_next_number(), see below) ONLY at the moment an
--   order is actually saved — never when the entry form merely displays a
--   suggested next number — so a person who opens the form and abandons it
--   does not burn/skip a number. Debit Note / Credit Note / Washing Data /
--   Internal Invoice / HR Letters don't have this "preview vs reserve"
--   distinction in the UI, so those use a straightforward BEFORE INSERT
--   trigger instead (see section 2).
-- • CURRENCY CONVERSION: order_value_usd / order_value_inr / exchange_rate
--   are computed by the application at insert/update time (official rate
--   on file as of the order's own date, falling back to a live market
--   estimate, never a silent guess) and then stored — they are NOT SQL
--   GENERATED columns, because the source of truth (exchange_rates) lives
--   in another table and Postgres generated columns cannot reference other
--   tables. exchange_rate_source always records which path was used.
-- =============================================================================


-- =============================================================================
-- SECTION 0 — EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive unique names (parties, item categories, sizes, skus)


-- =============================================================================
-- SECTION 1 — ENUM TYPES  (old Sheet: "Lists" tab dropdown columns that have
-- no runtime "add new value" admin function in Code.gs)
-- =============================================================================
CREATE TYPE order_status AS ENUM
  ('Pending', 'Confirmed', 'In Production', 'Dispatched', 'Delivered', 'Cancelled', 'Returned');

CREATE TYPE shipment_status AS ENUM
  ('Order Placed', 'In Production', 'Ready to Ship', 'Shipped', 'In Transit', 'Delivered', 'Returned', 'Cancelled');

CREATE TYPE address_type AS ENUM ('Residential', 'Commercial');

-- 2026-08-04: user confirmed what the old "WEBSITE/DISPATCH" free-text order
-- column actually meant (open question #5 in SCHEMA_NOTES.md, now resolved)
-- — it records which kind of photo is attached to the order: the single
-- photo taken at dispatch time, vs. the product's website/portal listing
-- photo. A real enum now, not free text.
CREATE TYPE order_photo_type AS ENUM ('Dispatch', 'Website');

CREATE TYPE duty_tax_mode AS ENUM ('CSB-IV', 'CSB-V');

CREATE TYPE delivered_status AS ENUM ('Delivered', 'NOT Delivered');

CREATE TYPE bank_status AS ENUM ('Pending', 'Realized', 'Partially Realized');

CREATE TYPE payment_type AS ENUM ('ADVANCE', 'AGAINST BILL', 'CASH', 'NO BILL', 'SALARY');

CREATE TYPE invoice_type AS ENUM
  ('DUTY TAX', 'Purchase', 'FREIGHT INVOICE', 'Printing', 'Washing', 'Disbursement FEE', 'Service', 'JOB WORK');

CREATE TYPE refund_type AS ENUM ('PARTIAL REFUND', 'FULL REFUND', 'A TO Z CLAIM', 'NO REFUND', 'CUSTOM TAX');

-- Not in the old system — needed because Dispatch & Refund / FBA Refund /
-- No Dispatch & Refund (3 near-identical sheets) are unified into one
-- `refunds` table (see section 14); this discriminates which of the 3 a
-- given row came from (FBA Refund has no ITEM ID; No Dispatch & Refund adds
-- a REASON field — both nullable on the unified table).
CREATE TYPE refund_source AS ENUM ('DISPATCH', 'FBA', 'NO_DISPATCH');

CREATE TYPE attendance_status AS ENUM ('Present', 'Absent', 'Week Off', 'Half Day', 'Leave', 'Late');

CREATE TYPE attendance_source AS ENUM ('Web Punch', 'TeamOffice Import', 'Manual Entry');

CREATE TYPE letter_type AS ENUM (
  'Joining Letter', 'Offer Letter', 'Promotion Letter', 'Increment Letter',
  'Experience Letter', 'Relieving Letter', 'Warning Letter', 'Salary Slip',
  'Custom / Other Letter'
);


-- =============================================================================
-- SECTION 2 — CORE REFERENCE DATA: companies, stores, currencies, roles/capabilities, employees
-- =============================================================================

-- Old sheets: Company_Registry (hidden) + Company_Stores (hidden) + the
-- legacy COMPANY_STORE_MAP/REF_SHORT_PREFIX fallback in Code.gs.
CREATE TABLE companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,             -- "Nyko Mart" / "Rugara" / "CASA ARRA" / any admin-added company
  short_code    text NOT NULL UNIQUE,             -- "NM" / "RUG" / "CA" — used in document numbers (NM/CN/26-27/0006)
  ref_prefix    text NOT NULL UNIQUE,             -- "PO" / "RG" / "RF" — used in order ref numbers (PO-0001)
  active        boolean NOT NULL DEFAULT true,    -- old Company_Registry.ACTIVE ("No" = hidden from login flow)
  logo_url      text,                              -- new (2026-08-04, webapp rewrite) — dashboard header branding, no old-system equivalent
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE companies IS
  'Old sheets: Company_Registry + Company_Stores headers. addCompany_() in Code.gs is now a plain INSERT '
  '(no more runtime append-to-hidden-column trick, no more per-workbook 500-row dropdown-range headroom).';

-- Old sheet: Company_Profiles — one row per company, the invoicing/bank
-- block. Kept as its own 1:1 table (not columns on `companies`) since it's
-- logically a distinct "for invoice generation" concern and may later need
-- versioning (bank details changing over time) that `companies` shouldn't
-- carry.
CREATE TABLE company_profiles (
  company_id    uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  address       text,
  phone         text,
  whatsapp      text,
  email         text,
  iec           text,          -- Importer-Exporter Code
  gstin         text,
  bank_name     text,
  account_no    text,
  ifsc_code     text,
  ad_code       text,          -- Authorised Dealer code (customs)
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Old sheets: Lists!B/C/D ("Nyko Mart Stores" / "Rugara Stores" / "CASA
-- ARRA Stores") + Lists!A ("All Stores"), later replaced by Company_Stores.
-- "Jaipur Arts (Website)" is a Nyko Mart store, not a separate company —
-- that's just a row here with company_id = Nyko Mart's id.
CREATE TABLE stores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, name)
);
CREATE INDEX idx_stores_company ON stores(company_id);

-- Old sheet: Lists!V ("Currencies"). Natural-key PK (ISO-ish code) rather
-- than a surrogate UUID — see design decision #1: this is a pure static
-- lookup whose code IS the identity, and is referenced directly by
-- exchange_rates and orders without needing a join to get the code back.
CREATE TABLE currencies (
  code          varchar(3) PRIMARY KEY,   -- 'USD', 'EUR', 'INR', ...
  name          text NOT NULL
);

-- Old: ROLES_LIST (Lists!L) as a flat array + ROLE_CAPABILITIES hardcoded
-- object in Code.gs. Normalized into 3 tables per the task's explicit ask.
CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE   -- 'Order Entry', 'Logistics', 'Finance', 'MD', 'Admin', ...
);

CREATE TABLE capabilities (
  code          text PRIMARY KEY,      -- 'order_entry', 'csv_upload', 'doc_entry', 'crm_dashboard', ...
  description   text
);

CREATE TABLE role_capabilities (
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  capability_code text NOT NULL REFERENCES capabilities(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, capability_code)
);
COMMENT ON TABLE role_capabilities IS
  'Replaces the hardcoded ROLE_CAPABILITIES object in Code.gs. capabilitiesForRole_()/hasCapability_() '
  'become: SELECT capability_code FROM role_capabilities WHERE role_id = ...';

-- Old sheet: Employees. verifyCredentials_()/requireCapability_() in
-- Code.gs re-check name+password+role server-side on every privileged call
-- — that pattern (never trust a client-claimed role) should carry over to
-- the web app's own auth/session layer, just backed by this table (and,
-- ideally, Supabase Auth — see auth_user_id below) instead of a plaintext
-- PASSWORD column. SECURITY: the old system stored PASSWORD as plain text
-- in a spreadsheet cell (explicitly flagged in its own comments as "not
-- enterprise-grade"). Do NOT carry that forward — see SCHEMA_NOTES.md open
-- question #1.
CREATE TABLE employees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  auth_user_id    uuid UNIQUE,           -- FK to Supabase auth.users(id) once real auth is wired up; nullable during migration
  name            text NOT NULL,
  role_id         uuid NOT NULL REFERENCES roles(id),
  active          boolean NOT NULL DEFAULT true,
  password_hash   text,                  -- bcrypt/argon2 hash — NEVER plaintext (unlike the old PASSWORD column)
  employee_code   text,                  -- ties to the TeamOffice biometric export's "Empcode" column
  designation     text,
  date_of_joining date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)              -- matches old verifyCredentials_()'s (company, name) lookup key
);
CREATE INDEX idx_employees_company ON employees(company_id);
CREATE UNIQUE INDEX idx_employees_code ON employees(employee_code) WHERE employee_code IS NOT NULL;

-- 2026-08-05: user confirmed real staff routinely work across all 3
-- companies from ONE login (not one login per company, which is what a bare
-- employees.company_id would imply). employees.company_id stays as the
-- employee's HOME/default company (still required — used as the default
-- selection and for things like entry_by_employee_id lineage); this table
-- is the actual "which companies can this login act as" grant list, checked
-- by the web app's company-switcher (see src/lib/auth/require-capability.ts)
-- instead of hard-coding company_id from the session alone.
CREATE TABLE employee_company_access (
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, company_id)
);
COMMENT ON TABLE employee_company_access IS
  'Which companies a login may switch into and act as, in addition to their home employees.company_id. '
  'A row here for (employee, their own home company) is redundant but harmless — the app always treats '
  'the home company as accessible regardless of what is in this table.';


-- =============================================================================
-- SECTION 3 — DOCUMENT / REFERENCE-NUMBER SEQUENCING INFRASTRUCTURE
-- Old sheet: Counters (hidden). Old logic: getNextRefNo()/reserveNextRefNo_()
-- (order PO/RF/RG numbers, no FY reset) and doc_number_formula() (Debit
-- Note/Credit Note/Washing Data/Internal Invoice, resets every Indian FY)
-- and getNextLetterRefNo_() (HR letters, no FY reset, composite counter key).
-- All three now share ONE counters table + ONE atomic reservation function.
-- =============================================================================

CREATE TABLE sequence_counters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  scope         text NOT NULL,     -- 'ORDER_REF' | 'DOC_CH' | 'DOC_DN' | 'DOC_CN' | 'DOC_II' | 'LETTER_JL' | 'LETTER_PL' | ...
  fy_label      text NOT NULL DEFAULT '',   -- '' = no financial-year reset (order refs, letters); '26-27' etc. when it does
  last_number   integer NOT NULL DEFAULT 0,
  UNIQUE (company_id, scope, fy_label)
);
COMMENT ON COLUMN sequence_counters.fy_label IS
  'Empty string (not NULL) is the deliberate "no FY" sentinel — a UNIQUE constraint on a nullable column '
  'treats every NULL as distinct in Postgres, which would silently break the one-row-per-company-per-scope '
  'invariant this counter depends on.';

-- Indian financial year label from a date, e.g. 2026-07-15 -> '26-27',
-- 2026-04-01 -> '26-27', 2026-03-31 -> '25-26'. Mirrors fy_formula() in
-- build.py exactly (April = start of FY). Computed from the ROW'S OWN date
-- (never CURRENT_DATE/now()), same reasoning as the original: a document
-- generated today must never silently relabel itself once the FY turns over.
CREATE OR REPLACE FUNCTION fy_label(p_date date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_date - (CASE WHEN EXTRACT(MONTH FROM p_date) < 4 THEN interval '1 year' ELSE interval '0 year' END), 'YY')
         || '-' ||
         to_char(p_date + (CASE WHEN EXTRACT(MONTH FROM p_date) < 4 THEN interval '0 year' ELSE interval '1 year' END), 'YY');
$$;

-- Atomic reserve-and-increment: race-safe under concurrent callers via
-- INSERT ... ON CONFLICT DO UPDATE (Postgres resolves this with a row-level
-- lock internally — no explicit advisory lock needed, matching the safety
-- guarantee the old system got from Apps Script's LockService).
-- p_use_fy = false -> scope never resets (order ref numbers, letter numbers).
-- p_use_fy = true  -> scope resets every Indian FY, keyed by p_as_of_date
--                     (Debit Note / Credit Note / Washing Data / Internal
--                     Invoice — always the DOCUMENT's own date, never today).
CREATE OR REPLACE FUNCTION reserve_next_number(
  p_company_id uuid, p_scope text, p_use_fy boolean, p_as_of_date date DEFAULT CURRENT_DATE
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_fy text := CASE WHEN p_use_fy THEN fy_label(p_as_of_date) ELSE '' END;
  v_num integer;
BEGIN
  INSERT INTO sequence_counters (company_id, scope, fy_label, last_number)
  VALUES (p_company_id, p_scope, v_fy, 1)
  ON CONFLICT (company_id, scope, fy_label)
  DO UPDATE SET last_number = sequence_counters.last_number + 1
  RETURNING last_number INTO v_num;
  RETURN v_num;
END;
$$;

-- Order ref number formatting: "PO-0001" (prefix + '-' + 4-digit, no FY).
-- Application calls: SELECT format_order_ref_no(ref_prefix, reserve_next_number(company_id, 'ORDER_REF', false))
-- FROM companies WHERE id = ... — see orders.ref_no comment for WHY this is
-- an explicit app-layer call rather than a trigger/DEFAULT.
CREATE OR REPLACE FUNCTION format_order_ref_no(p_prefix text, p_num integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT p_prefix || '-' || lpad(p_num::text, 4, '0'); $$;

-- Document number formatting: "NM/CN/26-27/0006" (company short_code / doc
-- type code / FY / 4-digit sequence). Used by the BEFORE INSERT triggers
-- below (section 10) on debit_notes/credit_notes/washing_entries/internal_invoices.
CREATE OR REPLACE FUNCTION format_document_no(p_company_short_code text, p_doc_type text, p_fy text, p_num integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT p_company_short_code || '/' || p_doc_type || '/' || p_fy || '/' || lpad(p_num::text, 4, '0'); $$;

-- Generic BEFORE INSERT trigger function: reserves + formats a document
-- number for any table with (company_id, <date column>, document_no)
-- shaped like the 4 document sheets below. TG_ARGV[0] = date column name,
-- TG_ARGV[1] = doc type code, TG_ARGV[2] = target column name.
CREATE OR REPLACE FUNCTION trg_assign_document_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_short_code text;
  v_num integer;
  v_fy text;
  v_doc_date date;
BEGIN
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO v_doc_date USING NEW;
  SELECT short_code INTO v_short_code FROM companies WHERE id = NEW.company_id;
  v_fy := fy_label(COALESCE(v_doc_date, CURRENT_DATE));
  v_num := reserve_next_number(NEW.company_id, 'DOC_' || TG_ARGV[1], true, COALESCE(v_doc_date, CURRENT_DATE));
  EXECUTE format('SELECT format_document_no($1, $2, $3, $4)') INTO NEW
    USING v_short_code, TG_ARGV[1], v_fy, v_num; -- placeholder; real per-table triggers set the field directly (see below)
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION trg_assign_document_no() IS
  'Illustrative generic version — in practice each of the 4 document tables below defines its own small '
  'BEFORE INSERT trigger function (trg_debit_notes_doc_no etc.) that sets its own named column directly, '
  'since dynamic column assignment via EXECUTE on a ROW variable is awkward/fragile in plpgsql. Kept here '
  'to show the shared reserve_next_number()/format_document_no() building blocks; the real per-table '
  'triggers are defined next to each table in section 10.';


-- =============================================================================
-- SECTION 4 — CATALOG MASTERS: item categories, sizes, SKUs, parties (vendors), exchange rates
-- =============================================================================

-- Old: Lists!F ("Item Categories"), extended at runtime by addItemCategory_().
-- 2026-08-06: hsn_code added — the CSB-V/CSB-IV invoice's item table needs a
-- per-category HSN code (see real sample invoices NL1702627.pdf/ERG122627.pdf/
-- ERG092627.pdf) printed against every line item. Nullable because we only
-- have confirmed codes for 3 of 9 real categories so far; invoice generation
-- must not silently print a blank/wrong HSN — validate it's set before
-- allowing an invoice to be created for that category.
CREATE TABLE item_categories (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      citext NOT NULL UNIQUE,
  hsn_code  text
);

-- Old: Lists!T ("Sizes", ~280 messy real-world values), extended at runtime
-- by addSize_(). See top-of-file design decision #7 — orders keeps both a
-- FK here AND a raw text fallback because the source data doesn't cleanly
-- match this list 1:1.
CREATE TABLE sizes (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label   citext NOT NULL UNIQUE
);

-- Old sheet: SKU_Master (CATEGORY, SKU CODE, NOTES).
CREATE TABLE skus (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_category_id  uuid REFERENCES item_categories(id),
  sku_code          citext NOT NULL UNIQUE,
  notes             text
);

-- Old sheet: Party Master (vendors/couriers/service providers). Also the
-- source of the Stock module's "SOURCE" dropdown (JK/HT/APL/AK Enterprises/
-- Shivam are rows here with type = 'Stock Source / Raw Material Unit') —
-- see section 11. citext + a unique index gives us addParty()'s
-- case-insensitive dedup rule ("RUKSAR BANO" vs "M/s RUKSAR BANO" was
-- flagged manually in the source data, not auto-merged — that stays a
-- migration-time human judgment call, not something the DB can decide).
CREATE TABLE parties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          citext NOT NULL UNIQUE,
  party_type    text,             -- old "TYPE" column — free text (e.g. "Courier /international shipping")
  payment_type  payment_type,
  invoice_type  invoice_type,
  address       text,
  contact_no    text,
  email         text,
  gst           text,
  remark        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Old sheet: Exchange Rate Master. One row per currency per rate change —
-- computeCurrencyConversion_() in Code.gs looks up whichever row is most
-- recent ON OR BEFORE the order's own date, never "the latest", so a
-- historical order keeps the rate in effect when it was placed even after
-- newer rates are added. get_official_rate_as_of() below is the SQL
-- equivalent of that lookup (the app still owns the "official rate ->
-- live-market-estimate -> unavailable" fallback CHAIN, since the live-rate
-- fetch is an external HTTP call the DB can't make — see business rules
-- note at the top on currency conversion).
CREATE TABLE exchange_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code       varchar(3) NOT NULL REFERENCES currencies(code),
  effective_from      date NOT NULL,
  rate_to_inr         numeric(14,6) NOT NULL CHECK (rate_to_inr > 0),
  notification_no     text,       -- CBIC / ICEGATE notification reference
  remark              text,
  entered_by          uuid REFERENCES employees(id),
  entered_on          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (currency_code, effective_from)
);
CREATE INDEX idx_exchange_rates_lookup ON exchange_rates (currency_code, effective_from DESC);

CREATE OR REPLACE FUNCTION get_official_rate_as_of(p_currency_code varchar(3), p_as_of date)
RETURNS TABLE (rate_to_inr numeric, effective_from date)
LANGUAGE sql STABLE AS $$
  SELECT er.rate_to_inr, er.effective_from
  FROM exchange_rates er
  WHERE er.currency_code = p_currency_code AND er.effective_from <= p_as_of
  ORDER BY er.effective_from DESC
  LIMIT 1;
$$;


-- =============================================================================
-- SECTION 5 — ORDERS  (old: All_Orders_Master + Nyko Mart + Rugara + CASA ARRA — collapsed into ONE table)
-- =============================================================================

CREATE TABLE orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies(id),
  store_id                 uuid NOT NULL REFERENCES stores(id),

  -- Old "SN NO." (a per-tab "=ROW()-1" auto-number) is dropped entirely —
  -- it was a presentational row counter, not real data; `id` + created_at
  -- ordering replaces it.

  remark                   text,
  order_date               date NOT NULL,

  -- PO NO. / RF NO. / RG NO. — company-specific label (see companies.ref_prefix),
  -- base number reserved via reserve_next_number(company_id,'ORDER_REF',false)
  -- + format_order_ref_no(), NOT a DB default/trigger — see "BUSINESS RULES
  -- ENFORCED IN APPLICATION CODE" at top: whether to reserve a fresh number,
  -- reuse a dispatched duplicate's number, or accept a manually-typed number
  -- is conditional logic that must run BEFORE the insert. The "-position/total"
  -- buyer-batch suffix (e.g. "-1/2") is appended/rewritten by application code
  -- across potentially several sibling rows after a save — also not SQL.
  ref_no                   text NOT NULL,
  -- Generated (same-row, deterministic) helper so the app/queries can find
  -- "every row in this buyer's batch" without re-implementing the regex
  -- client-side. Purely an index aid — NOT unique (siblings in a batch
  -- legitimately share this value with different suffixes).
  ref_no_base              text GENERATED ALWAYS AS (regexp_replace(ref_no, '-\d+/\d+$', '')) STORED,

  po_date                  date,
  delivery_date            date,
  marketplace_order_no     text,      -- old "ORDER NO." — the portal's own order id
  status                   order_status NOT NULL DEFAULT 'Pending',
  dispatch_date            date,

  photo_url                text,      -- old =IMAGE(url) formula; raw URL only, thumbnailing is a UI concern now

  sku_id                   uuid REFERENCES skus(id),
  sku_label                text,      -- raw fallback (see design decision #7's sibling reasoning for SKU)
  size_id                  uuid REFERENCES sizes(id),
  size_label               text,      -- raw fallback — always populated; see design decision #7
  qty                      integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  item_category_id         uuid NOT NULL REFERENCES item_categories(id),

  vendor_party_id          uuid REFERENCES parties(id),   -- old "VENDOR" — backend-only, filled in after order entry
  vendor_date               date,
  received_date            date,
  estimated_dispatch_date  date,
  late_order               boolean NOT NULL DEFAULT false,   -- backend-only, defaults false ("NO") at entry

  buyer_name_address       text,      -- old "BUYER NAME & ADDRESS" — single free-text field in the source; see
                                       -- SCHEMA_NOTES.md open question #3 on why this wasn't split further
  contact_no               text,
  email_id                 text,
  tax_id                   text,      -- VAT / IOSS / Tax ID

  address_type             address_type NOT NULL DEFAULT 'Residential',
  photo_type               order_photo_type,  -- old "WEBSITE/DISPATCH" — Dispatch photo vs. Website listing photo (2026-08-04, confirmed by user)
  colour                   text,

  entry_by_employee_id     uuid NOT NULL REFERENCES employees(id),  -- old "CHECK BY / ORDER ENTRY BY" free-typed name;
                                                                     -- the web app always knows this from the logged-in session
  advance_tracking         text,      -- backend-only, filled in later by whoever manages dispatch/tracking
  final_tracking            text,
  shipment_status           shipment_status NOT NULL DEFAULT 'Order Placed',
  tassel_fringes            boolean,

  entry_timestamp           timestamptz NOT NULL DEFAULT now(),

  -- Multi-currency (2026-08-01 round). order_value_usd/order_value_inr/
  -- exchange_rate_source are APPLICATION-COMPUTED (see business rules note
  -- at top) via the same official-rate/live-estimate/unavailable chain as
  -- computeCurrencyConversion_() — recomputed on every insert AND every
  -- edit (using the order's own unchangeable order_date), never trusted
  -- from a client-supplied number.
  order_currency            varchar(3) NOT NULL DEFAULT 'USD' REFERENCES currencies(code),
  order_value_original      numeric(14,2) NOT NULL DEFAULT 0,   -- exactly what was typed, in order_currency
  order_value_usd           numeric(14,2),                      -- app-computed; NULL only if truly unavailable
  order_value_inr           numeric(14,2),                      -- app-computed; NULL only if truly unavailable
  exchange_rate_source      text,                                -- audit trail, e.g. "Official rate as of 1 April, 2026"

  created_at                timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, ref_no)
);

CREATE INDEX idx_orders_company        ON orders(company_id);
CREATE INDEX idx_orders_store          ON orders(store_id);
CREATE INDEX idx_orders_order_date     ON orders(order_date);
CREATE INDEX idx_orders_status         ON orders(status);
CREATE INDEX idx_orders_ref_no_base    ON orders(company_id, ref_no_base);
CREATE INDEX idx_orders_marketplace_no ON orders(marketplace_order_no);
-- Buyer-batch / duplicate-order matching (application logic, see top of
-- file) is keyed on contact_no (digits-only) or buyer_name_address — index
-- both so that app-side lookup stays fast as order volume grows.
CREATE INDEX idx_orders_contact_no     ON orders(company_id, contact_no);
CREATE INDEX idx_orders_entry_timestamp ON orders(entry_timestamp);

COMMENT ON COLUMN orders.ref_no IS
  'PO/RF/RG number, possibly with a "-position/total" buyer-batch suffix (e.g. "PO-0001-1/2"). Base number '
  'reservation and batch-suffix tagging are APPLICATION LOGIC (see top-of-file BUSINESS RULES comment), not '
  'a DB default/trigger, because both are conditional on live lookups (duplicate-dispatched-order reuse '
  'check; buyer-batch membership) that must happen before/around the INSERT, not purely from it.';


-- =============================================================================
-- SECTION 6 — DISPATCH & INVOICE  (old sheet: "Dispatch & Invoice", one shared tab across companies)
-- =============================================================================
-- One row per order/shipment (matches the source sheet's true grain — see
-- SCHEMA_NOTES.md for why this was NOT split into an "invoice header" +
-- "line items" pair despite INVOICE NO. repeating across a buyer's batch:
-- shipment-level fields like AWB/courier/weight also vary per row within a
-- batch in the source, so hoisting them to a shared header would assume an
-- invariant the source data doesn't actually guarantee).
CREATE TABLE dispatch_invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                    uuid NOT NULL UNIQUE REFERENCES orders(id),

  invoice_no                  text,        -- shared across every order in one buyer's invoice batch — NOT unique
  invoice_date                date,
  sq_feet                     numeric(10,2),

  org_sale_amt_usd             numeric(14,2),
  org_sale_amt_inr             numeric(14,2),
  invoice_amt_usd              numeric(14,2),
  invoice_amt_inr              numeric(14,2),
  hsn_no                       text,

  buyer_name                   text,
  buyer_mail                   text,
  buyer_contact                 text,
  buyer_country                 text,

  courier_name                  text,
  awb_no                         text,
  duty_tax_mode                  duty_tax_mode,
  shipping_weight_kg              numeric(10,3),

  courier_shipping_charge          numeric(14,2),
  our_freight_amt                   numeric(14,2),
  demand_surcharge_other_charge      numeric(14,2),
  base_rate                          numeric(14,2),
  discount                           numeric(14,2),
  fuel_amt                           numeric(14,2),
  gst_18pct                          numeric(14,2),
  total_amt                          numeric(14,2),   -- manual in the source (no formula found for this column)
  courier_shipping_charge_without_gst numeric(14,2),
  gst_18pct_amt                       numeric(14,2),

  length_cm                           numeric(10,2),
  width_cm                            numeric(10,2),
  height_cm                           numeric(10,2),
  volumetric_weight                   numeric(10,3),

  delivered_status                    delivered_status,
  delivered_date                      date,
  gsr_eligible                        boolean,
  last_update_date                    date,
  remark                              text,
  case_handler_employee_id            uuid REFERENCES employees(id),

  created_at                          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispatch_invoices_invoice_no ON dispatch_invoices(invoice_no);
CREATE INDEX idx_dispatch_invoices_awb        ON dispatch_invoices(awb_no);
CREATE INDEX idx_dispatch_invoices_order      ON dispatch_invoices(order_id);


-- =============================================================================
-- SECTION 7 — VENDOR-SIDE BILLS: Freight Bill / Duty & Tax Bill / Shipping Bills / Purchase Bill
-- =============================================================================

-- Old sheet: Freight Bill (one row per courier freight invoice; usually
-- covers many AWBs — see freight_bill_awb_assignments in section 8).
CREATE TABLE freight_bills (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_date          date,
  invoice_no            text NOT NULL UNIQUE,
  bill_weight_kg        numeric(10,3),
  freight_amt           numeric(14,2) NOT NULL DEFAULT 0,
  fuel_amt              numeric(14,2) NOT NULL DEFAULT 0,
  other_charges         numeric(14,2) NOT NULL DEFAULT 0,
  -- TOTAL AMT = FREIGHT + FUEL + OTHER (same-row arithmetic -> generated column)
  total_amt             numeric(14,2) GENERATED ALWAYS AS (freight_amt + fuel_amt + other_charges) STORED,
  -- GST 18% AMT = TOTAL AMT * 0.18 — cannot reference the `total_amt` generated
  -- column above (Postgres forbids generated-column-referencing-generated-column),
  -- so the TOTAL AMT expression is inlined again here.
  gst_18pct_amt          numeric(14,2) GENERATED ALWAYS AS ((freight_amt + fuel_amt + other_charges) * 0.18) STORED,
  -- GROSS TOTAL AMT = TOTAL + GST — inlined for the same reason.
  gross_total_amt         numeric(14,2) GENERATED ALWAYS AS ((freight_amt + fuel_amt + other_charges) * 1.18) STORED,
  created_at               timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN freight_bills.gross_total_amt IS
  'The old sheet''s "DIFRANCE AMOUNT" (this Gross Total minus the SUM of Gross Shipping Amt across every AWB '
  'assigned to this invoice) is NOT reproduced as a column here — it is a cross-table comparison, so it is '
  'the freight_bill_variance_view in section 8 instead.';

-- Old sheet: Duty & Tax Bill (one row per courier duty/tax invoice). GST
-- here applies only to the courier's own disbursement/service fee (not the
-- full duty amount) and that fee isn't its own column in the source, so
-- GST stays a manual entry — matches the original's own documented finding.
CREATE TABLE duty_tax_bills (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_date       date,
  invoice_no          text NOT NULL UNIQUE,
  duty_tax_amt_usd     numeric(14,2),
  duty_tax_amt_inr      numeric(14,2) NOT NULL DEFAULT 0,
  gst_18pct_amt          numeric(14,2) NOT NULL DEFAULT 0,   -- manual; see comment above
  gross_total_amt         numeric(14,2) GENERATED ALWAYS AS (duty_tax_amt_inr + gst_18pct_amt) STORED,
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- Old sheet: Shipping Bills — customs export shipping-bill register. Every
-- value comes straight off government/bank documents; no safe formula
-- exists without one of FOB/USD/rate already being known, so it stays a
-- pure entry log (matches the source exactly).
CREATE TABLE shipping_bills (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipping_bill_date         date,
  shipping_bill_no             text NOT NULL UNIQUE,
  amount_inr_fob                 numeric(14,2),
  amount_usd                      numeric(14,2),
  exchange_rate_inr                numeric(14,6),
  egm_number                        text,
  egm_date                          date,
  bank_status                        bank_status,
  created_at                          timestamptz NOT NULL DEFAULT now()
);

-- Old sheet: Purchase Bill — raw-material/vendor purchases (2026-08-04:
-- user confirmed this is the bill entry for goods received from a vendor
-- party). "WORK1" -> renamed work_description: the job/work this purchase
-- was for (e.g. printing, washing, dyeing) — kept as free text since the
-- exact structured vocabulary wasn't pinned down, but its general purpose
-- is now confirmed rather than a total unknown (SCHEMA_NOTES.md #6).
-- "G. TOTAL + GST" assumes a flat 5% GST (2.5% CGST + 2.5% SGST) — same
-- assumption the source made, flagged there as adjustable if a different
-- HSN/GST slab applies.
CREATE TABLE purchase_bills (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_party_id         uuid NOT NULL REFERENCES parties(id),
  vendor_invoice_no        text NOT NULL,
  vendor_invoice_date       date,
  qty                        integer NOT NULL DEFAULT 1,
  sq_feet                     numeric(10,2) NOT NULL DEFAULT 0,
  work_description             text,        -- "WORK1" in the source — general purpose confirmed 2026-08-04, see SCHEMA_NOTES.md #6
  unit_rate                     numeric(14,2) NOT NULL DEFAULT 0,
  order_id                       uuid REFERENCES orders(id),   -- optional make-to-order reference (added 2026-08 round)
  -- TOTAL SQ FEET = QTY * SQ FEET, then TOTAL AMOUNT = TOTAL SQ FEET * UNIT
  -- RATE — inlined fully (qty * sq_feet * unit_rate) since a generated
  -- column can't reference another generated column.
  total_sq_feet                   numeric(14,2) GENERATED ALWAYS AS (qty * sq_feet) STORED,
  total_amount                     numeric(14,2) GENERATED ALWAYS AS (qty * sq_feet * unit_rate) STORED,
  g_total_plus_gst                  numeric(14,2) GENERATED ALWAYS AS (qty * sq_feet * unit_rate * 1.05) STORED,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_party_id, vendor_invoice_no)
);
CREATE INDEX idx_purchase_bills_order ON purchase_bills(order_id);


-- =============================================================================
-- SECTION 8 — FREIGHT & DUTY RECONCILIATION
-- Old sheets: "Freight Reconciliation" / "Duty Reconciliation". The task
-- description calls these out as "formula-driven -> should become a view,
-- not a stored table" — MOSTLY true (everything the old sheet pulled via
-- INDEX/MATCH off Dispatch & Invoice is reproduced below as a VIEW,
-- section 9), BUT each sheet also had 1-2 genuinely-manual columns that are
-- NOT derivable from anything else: which courier invoice a given AWB's
-- charges were actually billed under (a real many-to-one fact a human
-- enters when the bill arrives — the bill itself doesn't list its AWBs),
-- the audited "Bill Weight" off the physical bill, and a "Difference AMT"
-- the original author explicitly could NOT reverse-engineer a formula for
-- from the given worked example. Those stay real stored data in small
-- "assignment" tables here; everything else is the view in section 9.
-- =============================================================================

CREATE TABLE freight_bill_awb_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freight_bill_id   uuid NOT NULL REFERENCES freight_bills(id),
  order_id           uuid NOT NULL REFERENCES orders(id),   -- via dispatch_invoices.order_id (1 row = 1 AWB = 1 order)
  bill_weight_kg       numeric(10,3),    -- off the physical courier bill — not derivable from anything on file
  difference_amt         numeric(14,2), -- MANUAL — see comment on freight_bills.gross_total_amt / original author's note
  remark                  text,
  UNIQUE (order_id)   -- one AWB (= one order/shipment) is billed under exactly one freight invoice
);
CREATE INDEX idx_freight_awb_assign_bill ON freight_bill_awb_assignments(freight_bill_id);

CREATE TABLE duty_bill_awb_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_tax_bill_id   uuid NOT NULL REFERENCES duty_tax_bills(id),
  order_id            uuid NOT NULL REFERENCES orders(id),
  duty_tax_amt_usd      numeric(14,2),
  duty_tax_amt_inr        numeric(14,2),
  other_charge              numeric(14,2),
  gst_18pct                  numeric(14,2),
  remark                      text,
  UNIQUE (order_id)
);
CREATE INDEX idx_duty_awb_assign_bill ON duty_bill_awb_assignments(duty_tax_bill_id);

-- The recomputed/looked-up part of the old Freight Reconciliation sheet
-- (everything that was an INDEX/MATCH-by-AWB formula pulling from Dispatch
-- & Invoice) — a straight VIEW joining the manual assignment table above to
-- dispatch_invoices/orders. Column-for-column mapping verified against the
-- old sheet's own di_lookup() calls in build.py (e.g. its "M" GST 18% AMT.
-- lookup is Dispatch & Invoice's SECOND gst column — courier_shipping_
-- charge_without_gst's paired amount — not the first "GST 18%" used inside
-- TOTAL AMT; both are modeled as separate columns on dispatch_invoices).
CREATE VIEW freight_reconciliation_view AS
SELECT
  a.id                    AS assignment_id,
  a.freight_bill_id,
  fb.invoice_no            AS freight_invoice_no,
  a.order_id,
  o.ref_no                  AS po_no,
  di.invoice_no,
  ic.name                    AS item_type,
  COALESCE(o.size_label, s.label) AS sizes,
  di.awb_no,
  di.buyer_country,
  di.org_sale_amt_inr,
  di.our_freight_amt         AS our_shipping_amt,
  di.demand_surcharge_other_charge AS other_charges,
  di.total_amt                AS total_shipping_amt,
  di.gst_18pct_amt             AS gst_18pct,   -- Dispatch & Invoice's 2nd GST column — see comment above
  (COALESCE(di.total_amt,0) + COALESCE(di.gst_18pct_amt,0)) AS gross_shipping_amt,
  di.shipping_weight_kg         AS our_weight,
  a.bill_weight_kg,
  di.volumetric_weight           AS dimensional_weight,
  a.difference_amt,               -- MANUAL, see comment on freight_bill_awb_assignments
  CASE WHEN COALESCE(di.org_sale_amt_inr, 0) = 0 THEN NULL
       ELSE (COALESCE(di.total_amt,0) + COALESCE(di.gst_18pct_amt,0)) / di.org_sale_amt_inr END AS shipping_pct,
  a.remark
FROM freight_bill_awb_assignments a
JOIN freight_bills fb        ON fb.id = a.freight_bill_id
JOIN orders o                 ON o.id = a.order_id
LEFT JOIN dispatch_invoices di ON di.order_id = a.order_id
LEFT JOIN item_categories ic    ON ic.id = o.item_category_id
LEFT JOIN sizes s                ON s.id = o.size_id;

-- Old Freight Bill sheet's "DIFRANCE AMOUNT" (courier's own Gross Total for
-- this invoice minus the SUM of Gross Shipping Amt across every AWB
-- assigned to it) — cross-table, so a view rather than a column on
-- freight_bills (referenced from that table's gross_total_amt comment).
CREATE VIEW freight_bill_variance_view AS
SELECT
  fb.id AS freight_bill_id, fb.invoice_no, fb.gross_total_amt,
  COALESCE(SUM(v.gross_shipping_amt), 0) AS summed_gross_shipping_amt,
  fb.gross_total_amt - COALESCE(SUM(v.gross_shipping_amt), 0) AS difrance_amount
FROM freight_bills fb
LEFT JOIN freight_reconciliation_view v ON v.freight_bill_id = fb.id
GROUP BY fb.id, fb.invoice_no, fb.gross_total_amt;

-- Old Duty Reconciliation sheet — same idea, additionally pulling its
-- "SHIPPING AMT" from freight_reconciliation_view.gross_shipping_amt
-- (matched by order_id) exactly as the source pulled it from Freight
-- Reconciliation!N via AWB match, "so it stays consistent with that sheet
-- rather than being recomputed" (original comment, still true here).
CREATE VIEW duty_reconciliation_view AS
SELECT
  a.id                    AS assignment_id,
  a.duty_tax_bill_id,
  dtb.invoice_no            AS duty_invoice_no,
  a.order_id,
  o.ref_no                    AS po_no,
  di.invoice_no,
  ic.name                      AS item_type,
  COALESCE(o.size_label, s.label) AS sizes,
  di.awb_no,
  di.buyer_country,
  di.org_sale_amt_inr,
  frv.gross_shipping_amt         AS shipping_amt,
  a.duty_tax_amt_usd,
  a.duty_tax_amt_inr,
  a.other_charge,
  a.gst_18pct,
  (COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) AS duty_gross_amt,
  (COALESCE(frv.gross_shipping_amt,0) + COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) AS shipping_and_duty,
  CASE WHEN COALESCE(di.org_sale_amt_inr,0) = 0 THEN NULL
       ELSE (COALESCE(frv.gross_shipping_amt,0) + COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) / di.org_sale_amt_inr
  END AS shipping_and_duty_pct,
  CASE WHEN COALESCE(di.org_sale_amt_inr,0) = 0 THEN NULL ELSE frv.gross_shipping_amt / di.org_sale_amt_inr END AS shipping_pct,
  CASE WHEN COALESCE(di.org_sale_amt_inr,0) = 0 THEN NULL
       ELSE (COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) / di.org_sale_amt_inr
  END AS duty_pct,
  a.remark
FROM duty_bill_awb_assignments a
JOIN duty_tax_bills dtb        ON dtb.id = a.duty_tax_bill_id
JOIN orders o                   ON o.id = a.order_id
LEFT JOIN dispatch_invoices di   ON di.order_id = a.order_id
LEFT JOIN item_categories ic      ON ic.id = o.item_category_id
LEFT JOIN sizes s                  ON s.id = o.size_id
LEFT JOIN freight_reconciliation_view frv ON frv.order_id = a.order_id;


-- =============================================================================
-- SECTION 9 — DOCUMENTS: Washing Data / Debit Note / Credit Note / Internal Invoice
-- All 4 use the shared reserve_next_number()/format_document_no() machinery
-- from section 3, each via its own tiny BEFORE INSERT trigger (document
-- number is a per-company-per-FY running sequence, exactly like the old
-- doc_number_formula()).
-- =============================================================================

CREATE TABLE washing_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id),
  party_id                 uuid NOT NULL REFERENCES parties(id),
  chalan_no                 text UNIQUE,     -- auto-assigned, format NM/CH/26-27/0001
  chalan_date                 date NOT NULL,
  order_id                     uuid REFERENCES orders(id),   -- optional PO/RF/RG reference
  sku_id                         uuid REFERENCES skus(id),
  item_size                       text,
  pcs                               integer,
  sq_mtr_ft                         numeric(10,2),
  rate                               numeric(14,2),
  amount                              numeric(14,2) GENERATED ALWAYS AS (sq_mtr_ft * rate) STORED,   -- AMOUNT = SQ/MTR/FT * RATE
  debit_charges                       numeric(14,2),
  store_id                              uuid REFERENCES stores(id),
  created_at                             timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION trg_washing_entries_doc_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text; v_num int;
BEGIN
  SELECT short_code INTO v_code FROM companies WHERE id = NEW.company_id;
  v_num := reserve_next_number(NEW.company_id, 'DOC_CH', true, NEW.chalan_date);
  NEW.chalan_no := format_document_no(v_code, 'CH', fy_label(NEW.chalan_date), v_num);
  RETURN NEW;
END; $$;
CREATE TRIGGER washing_entries_before_insert BEFORE INSERT ON washing_entries
  FOR EACH ROW WHEN (NEW.chalan_no IS NULL) EXECUTE FUNCTION trg_washing_entries_doc_no();

CREATE TABLE debit_notes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  debit_note_no             text UNIQUE,     -- auto-assigned, format NM/DN/26-27/0001
  debit_note_date             date NOT NULL,
  against_invoice_bill_no       text,
  party_id                       uuid NOT NULL REFERENCES parties(id),
  order_id                         uuid REFERENCES orders(id),   -- old "PO No."
  particulars                       text,
  bill_no                             text,
  bill_date                           date,
  sq_ft                                 numeric(10,2),
  qty                                     integer,
  rate                                     numeric(14,2),
  po_amount                                 numeric(14,2) GENERATED ALWAYS AS (sq_ft * rate) STORED,  -- PO Amount = Sq.Ft * Rate
  debit_amount                               numeric(14,2) NOT NULL DEFAULT 0,   -- independent of PO Amount (matches source)
  -- Old "Taxable" column was a pure alias of Debit Amount (Taxable = Debit
  -- Amount, no other use) — dropped as redundant; CGST/SGST/Total below
  -- reference debit_amount directly instead.
  cgst_2_5pct                                 numeric(14,2) GENERATED ALWAYS AS (debit_amount * 0.025) STORED,
  sgst_2_5pct                                  numeric(14,2) GENERATED ALWAYS AS (debit_amount * 0.025) STORED,
  total_amount                                  numeric(14,2) GENERATED ALWAYS AS (debit_amount * 1.05) STORED,
  remark                                          text,
  created_at                                       timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION trg_debit_notes_doc_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text; v_num int;
BEGIN
  SELECT short_code INTO v_code FROM companies WHERE id = NEW.company_id;
  v_num := reserve_next_number(NEW.company_id, 'DOC_DN', true, NEW.debit_note_date);
  NEW.debit_note_no := format_document_no(v_code, 'DN', fy_label(NEW.debit_note_date), v_num);
  RETURN NEW;
END; $$;
CREATE TRIGGER debit_notes_before_insert BEFORE INSERT ON debit_notes
  FOR EACH ROW WHEN (NEW.debit_note_no IS NULL) EXECUTE FUNCTION trg_debit_notes_doc_no();

-- Old sheet: Credit Note — refund against a dispatched/invoiced order. No
-- formulas in the source besides the CN No. itself (all amount fields are
-- plain manual/form entry).
CREATE TABLE credit_notes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id),
  store_id                    uuid REFERENCES stores(id),        -- old "PORTAL"
  cn_no                         text UNIQUE,     -- auto-assigned, format NM/CN/26-27/0001
  credit_note_date                date NOT NULL,
  order_id                          uuid REFERENCES orders(id),   -- old "ORDER ID" (marketplace order no. or PO — see SCHEMA_NOTES #7)
  item_id                             text,       -- marketplace line-item id, when applicable
  buyer_name                            text,
  refund_date                             date,
  item_name                                 text,
  item_price                                 numeric(14,2),
  invoice_no                                   text,
  invoice_value_usd                              numeric(14,2),
  invoice_value_inr                               numeric(14,2),
  refund_amount                                     numeric(14,2) NOT NULL DEFAULT 0,
  refund_amt_usd                                      numeric(14,2),
  refund_amt_inr                                        numeric(14,2),
  credit_note_status                                      text,     -- old "CREDIT NOTE" column (free text status)
  checked_by_employee_id                                    uuid REFERENCES employees(id),
  refund_type                                                 refund_type,
  debit_note_id                                                 uuid REFERENCES debit_notes(id),
  created_by_employee_id                                          uuid REFERENCES employees(id),
  remark                                                            text,
  created_at                                                          timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION trg_credit_notes_doc_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text; v_num int;
BEGIN
  SELECT short_code INTO v_code FROM companies WHERE id = NEW.company_id;
  v_num := reserve_next_number(NEW.company_id, 'DOC_CN', true, NEW.credit_note_date);
  NEW.cn_no := format_document_no(v_code, 'CN', fy_label(NEW.credit_note_date), v_num);
  RETURN NEW;
END; $$;
CREATE TRIGGER credit_notes_before_insert BEFORE INSERT ON credit_notes
  FOR EACH ROW WHEN (NEW.cn_no IS NULL) EXECUTE FUNCTION trg_credit_notes_doc_no();

-- Old sheet: Internal Invoice — one company billing another for goods/
-- services moved between them. from_company <> to_company enforced by CHECK.
CREATE TABLE internal_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),   -- "From Company" — the invoicing sequence owner
  from_company_id           uuid NOT NULL REFERENCES companies(id),
  to_company_id               uuid NOT NULL REFERENCES companies(id),
  invoice_no                    text UNIQUE,     -- auto-assigned, format NM/II/26-27/0001
  invoice_date                    date NOT NULL,
  description                       text NOT NULL,
  qty                                 numeric(10,2) NOT NULL,
  rate                                 numeric(14,2) NOT NULL,
  amount                                 numeric(14,2) GENERATED ALWAYS AS (qty * rate) STORED,
  gst_18pct                                numeric(14,2) GENERATED ALWAYS AS (qty * rate * 0.18) STORED,
  total_amount                               numeric(14,2) GENERATED ALWAYS AS (qty * rate * 1.18) STORED,
  prepared_by_employee_id                      uuid REFERENCES employees(id),
  remark                                         text,
  created_at                                       timestamptz NOT NULL DEFAULT now(),
  CHECK (from_company_id <> to_company_id)
);
CREATE OR REPLACE FUNCTION trg_internal_invoices_doc_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text; v_num int;
BEGIN
  SELECT short_code INTO v_code FROM companies WHERE id = NEW.from_company_id;
  v_num := reserve_next_number(NEW.from_company_id, 'DOC_II', true, NEW.invoice_date);
  NEW.invoice_no := format_document_no(v_code, 'II', fy_label(NEW.invoice_date), v_num);
  NEW.company_id := NEW.from_company_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER internal_invoices_before_insert BEFORE INSERT ON internal_invoices
  FOR EACH ROW WHEN (NEW.invoice_no IS NULL) EXECUTE FUNCTION trg_internal_invoices_doc_no();


-- =============================================================================
-- SECTION 10 — STOCK MODULE  (old sheets: Stock Master / Stock In / Stock Out)
-- "CURRENT STOCK" was a live SUMIFS(Stock In) - SUMIFS(Stock Out) formula —
-- per the task's explicit instruction, this becomes a VIEW, not a stored/
-- synced column, so it can never drift from the in/out ledger.
-- SOURCE (JK/HT/APL/AK Enterprises/Shivam) is a `parties` row, not a free
-- string — see parties table comment.
-- =============================================================================

-- Catalog: which SKU+SOURCE combinations exist at all (old Stock Master's
-- non-formula columns). A SKU+SOURCE with 0 net movement still shows here
-- with 0 stock via the view's LEFT JOINs.
CREATE TABLE stock_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_party_id    uuid NOT NULL REFERENCES parties(id),
  sku_code             text NOT NULL,     -- raw-material code — a separate code space from finished-goods `skus`,
                                           -- see SCHEMA_NOTES.md open question #8
  product_name           text,
  UNIQUE (source_party_id, sku_code)
);

CREATE TABLE stock_in (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_party_id       uuid NOT NULL REFERENCES parties(id),
  sku_code                text NOT NULL,
  product_name              text,
  -- CHALAN NO. is NOT NULL-enforced at the application layer for live
  -- entry ("no stock movement without a chalan" is the user's own hard
  -- rule, enforced in saveStockIn()) but deliberately left NULLABLE here
  -- because bulk CSV backfill of historical stock predates that rule in
  -- the old system too — see CSV_UPLOAD_SHEETS comment in Code.gs.
  chalan_no                  text,
  in_date                      date,
  quantity_in                    numeric(14,2) NOT NULL,
  rate_per_qty                     numeric(14,2),
  total_amt                          numeric(14,2) GENERATED ALWAYS AS (quantity_in * COALESCE(rate_per_qty,0)) STORED,
  gst_5pct                             numeric(14,2) GENERATED ALWAYS AS (quantity_in * COALESCE(rate_per_qty,0) * 0.05) STORED,
  to_be_paid                             numeric(14,2) GENERATED ALWAYS AS (quantity_in * COALESCE(rate_per_qty,0) * 1.05) STORED,
  party_chalan_no                          text,
  our_chalan_no                              text,
  bill_no                                      text,
  bill_date                                      date,
  paid_date                                        date,
  remark                                             text,
  created_at                                           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_in_source_sku ON stock_in(source_party_id, sku_code);

CREATE TABLE stock_out (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_party_id       uuid NOT NULL REFERENCES parties(id),
  sku_code                text NOT NULL,
  product_name              text,
  chalan_no                  text,     -- see stock_in.chalan_no comment
  out_date                     date,
  quantity_out                   numeric(14,2) NOT NULL,
  remark                           text,
  created_at                         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_out_source_sku ON stock_out(source_party_id, sku_code);

CREATE VIEW stock_current_view AS
SELECT
  si.id                AS stock_item_id,
  si.source_party_id,
  si.sku_code,
  si.product_name,
  COALESCE(SUM(i.quantity_in), 0) - COALESCE(SUM(o.quantity_out), 0) AS current_stock
FROM stock_items si
LEFT JOIN stock_in  i ON i.source_party_id = si.source_party_id AND i.sku_code = si.sku_code
LEFT JOIN stock_out o ON o.source_party_id = si.source_party_id AND o.sku_code = si.sku_code
GROUP BY si.id, si.source_party_id, si.sku_code, si.product_name;
COMMENT ON VIEW stock_current_view IS
  'Old Stock Master!CURRENT STOCK (SUMIFS(Stock In) - SUMIFS(Stock Out), matched on SOURCE+SKU). Computed '
  'live on every query — never stored — so it can never drift from the in/out ledger.';


-- =============================================================================
-- SECTION 11 — BILL PASS REGISTER  (old sheet: unified vendor bill-pass ledger)
-- =============================================================================
CREATE TABLE bill_pass_register (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies(id),
  invoice_no                 text,
  vendor_invoice_no            text,     -- "VND. INVOICE NO." — the vendor's own bill number
  invoice_type                   invoice_type,
  credit_note_id                    uuid REFERENCES credit_notes(id),
  invoice_date                        date,
  invoice_recv_date                     date,
  credit_note_date                        date,
  total_amt                                 numeric(14,2) NOT NULL DEFAULT 0,
  credit_note_amt                             numeric(14,2) NOT NULL DEFAULT 0,
  -- TO BE PAY = TOTAL AMT - CREDIT NOTE AMT; BALANCE DUE = TO BE PAY - TOTAL
  -- PAID (inlined, since a generated column can't reference another one);
  -- DUE DATE = INVOICE RECV. DATE + 7 (net-7 terms, matching the source data).
  to_be_pay                                     numeric(14,2) GENERATED ALWAYS AS (total_amt - credit_note_amt) STORED,
  total_paid                                      numeric(14,2) NOT NULL DEFAULT 0,   -- plain imported value (source's own formula was a broken cross-file IMPORTRANGE)
  balance_due                                       numeric(14,2) GENERATED ALWAYS AS (total_amt - credit_note_amt - total_paid) STORED,
  due_date                                            date GENERATED ALWAYS AS (invoice_recv_date + 7) STORED,
  party_id                                              uuid REFERENCES parties(id),
  party_type                                              text,
  shipping_pct                                              numeric(6,4),
  duty_tax_pct                                                numeric(6,4),
  prepared_by_employee_id                                       uuid REFERENCES employees(id),
  passed_by_employee_id                                           uuid REFERENCES employees(id),
  payment_by_employee_id                                            uuid REFERENCES employees(id),
  remark                                                              text,
  created_at                                                            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bill_pass_company ON bill_pass_register(company_id);
CREATE INDEX idx_bill_pass_party   ON bill_pass_register(party_id);
COMMENT ON TABLE bill_pass_register IS
  'Old sheets: "RUG ARA-ALL BILLS" / "NYKO MART-ALL BILLS" master bill-pass ledgers, unified into one table '
  'with company_id replacing "one workbook per company". Deliberately NOT strictly FK''d to freight_bills / '
  'duty_tax_bills / purchase_bills — the source data doesn''t establish that mapping, so forcing it now risks '
  'guessing; this stays its own standalone payable ledger (see SCHEMA_NOTES.md open question #9).';


-- =============================================================================
-- SECTION 12 — SALE & PROFIT LEDGER + P&L DASHBOARD
-- Old sheet: Sale & Profit Ledger (historical, CSV-imported, bypasses the
-- live order form on purpose — see CSV_UPLOAD_SHEETS comment in Code.gs).
-- Old sheet: P&L Dashboard — 100% live formulas over the ledger -> becomes
-- 2 VIEWs (company-wise, month-wise), per the task's explicit instruction.
-- =============================================================================
CREATE TABLE sale_profit_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  store_id                  uuid REFERENCES stores(id),
  order_id                    uuid REFERENCES orders(id),   -- best-effort match; historical rows may predate `orders`
  po_rf_rg_no                   text,     -- kept as text too — historical rows aren't guaranteed to resolve to order_id
  marketplace_order_no            text,
  order_date                        date,
  invoice_no                          text,
  invoice_date                          date,
  item_category_id                        uuid REFERENCES item_categories(id),
  sizes                                     text,
  qty                                         integer,
  buyer_name                                    text,
  buyer_country                                   text,
  sale_value_usd                                    numeric(14,2),
  total_value_inr                                     numeric(14,2) NOT NULL DEFAULT 0,
  total_expenses_inr                                    numeric(14,2) NOT NULL DEFAULT 0,
  -- NET TOTAL VALUE / PORTAL EXPENSES (25%) / NET EARN / PROFIT % all
  -- inlined off total_value_inr/total_expenses_inr (can't chain generated
  -- columns) — same 25%-portal-expense assumption as the old Net Revenue
  -- sheet; NULLIF guards the division the same way the old sheet's
  -- IF(...=0,"",...) did.
  net_total_value                                         numeric(14,2) GENERATED ALWAYS AS (total_value_inr - total_expenses_inr) STORED,
  portal_expenses_25pct                                     numeric(14,2) GENERATED ALWAYS AS (total_value_inr * 0.25) STORED,
  net_earn                                                    numeric(14,2) GENERATED ALWAYS AS ((total_value_inr - total_expenses_inr) - (total_value_inr * 0.25)) STORED,
  profit_pct                                                    numeric(8,6) GENERATED ALWAYS AS (
                                                                   ((total_value_inr - total_expenses_inr) - (total_value_inr * 0.25))
                                                                   / NULLIF(total_value_inr, 0)
                                                                 ) STORED,
  delivery_status                                                 delivered_status,
  created_at                                                        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_ledger_company ON sale_profit_ledger(company_id);
CREATE INDEX idx_sale_ledger_invoice_date ON sale_profit_ledger(invoice_date);

CREATE VIEW pl_dashboard_by_company_view AS
SELECT
  c.id AS company_id, c.name AS company_name,
  SUM(l.total_value_inr)     AS total_sale_value_inr,
  SUM(l.total_expenses_inr)  AS total_expenses_inr,
  SUM(l.net_total_value)     AS net_total_value,
  SUM(l.portal_expenses_25pct) AS portal_expenses_25pct,
  SUM(l.net_earn)            AS net_earn,
  (SUM(l.net_earn) / NULLIF(SUM(l.total_value_inr), 0)) AS profit_pct
FROM companies c
LEFT JOIN sale_profit_ledger l ON l.company_id = c.id
GROUP BY c.id, c.name;

CREATE VIEW pl_dashboard_by_month_view AS
SELECT
  date_trunc('month', l.invoice_date)::date AS month,
  SUM(l.total_value_inr)     AS total_sale_value_inr,
  SUM(l.total_expenses_inr)  AS total_expenses_inr,
  SUM(l.net_earn)            AS net_earn,
  (SUM(l.net_earn) / NULLIF(SUM(l.total_value_inr), 0)) AS profit_pct
FROM sale_profit_ledger l
WHERE l.invoice_date IS NOT NULL
GROUP BY date_trunc('month', l.invoice_date)
ORDER BY month DESC;
COMMENT ON VIEW pl_dashboard_by_month_view IS
  'Old P&L Dashboard''s month-wise block (previously hardcoded to a trailing 24 months via SUMPRODUCT over '
  'YEAR()/MONTH()) — a view naturally covers all history; LIMIT 24 in the application query if only a '
  'trailing window should be shown.';


-- =============================================================================
-- SECTION 13 — REFUNDS  (old sheets: Dispatch & Refund / FBA Refund / No Dispatch & Refund — unified)
-- The 3 old sheets were the same shape with 2 small variations (FBA Refund
-- has no ITEM ID; No Dispatch & Refund adds a REASON) — normalized into
-- one table with a `source` discriminator instead of 3 near-duplicate
-- tables, per the task's instruction not to treat near-identical sheets as
-- separate flat tables where normalization is the better call.
-- =============================================================================
CREATE TABLE refunds (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                 refund_source NOT NULL,
  pass_by_employee_id      uuid REFERENCES employees(id),   -- old "PASS BY RD SIR"
  marketplace_order_no       text,
  item_id                      text,     -- NULL for source = 'FBA' (old FBA Refund sheet had no ITEM ID column)
  buyer_name                     text,
  store_id                         uuid REFERENCES stores(id),   -- old "PORTALS"
  invoice_no                         text,
  status                               order_status,
  order_amt_usd                          numeric(14,2),
  refund_amt_usd                           numeric(14,2),
  refund_amt_pct                             numeric(8,6) GENERATED ALWAYS AS (refund_amt_usd / NULLIF(order_amt_usd, 0)) STORED,
  refund_type                                  refund_type,
  refund_date                                    date,
  credit_note_id                                   uuid REFERENCES credit_notes(id),
  reason                                             text,     -- only populated for source = 'NO_DISPATCH'
  remark                                               text,
  created_at                                             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refunds_source ON refunds(source);
CREATE INDEX idx_refunds_store  ON refunds(store_id);


-- =============================================================================
-- SECTION 14 — PORTAL PAYMENT RECONCILIATION
-- Old sheet header preserved the source export's own column names,
-- including its typos/odd punctuation, specifically so a portal's raw CSV
-- export could be re-uploaded with zero relabeling. That reasoning was a
-- Google-Sheets-CSV-import convenience, not a data-modeling one — this
-- table uses clean snake_case columns; the IMPORT LAYER (application code,
-- not this schema) is what should keep the "match the real export headers"
-- flexibility, e.g. a per-source column-mapping config.
-- =============================================================================
CREATE TABLE portal_payment_reconciliation (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                    uuid REFERENCES stores(id),
  marketplace_order_id           text,
  master_invoice_no                text,
  invoice_no                         text,
  invoice_amount_inr                   numeric(14,2),
  total_ord_amount_usd                   numeric(14,2),
  invoice_date                             date,
  payment_receive_refund_date                date,
  total_inr                                    numeric(14,2) NOT NULL DEFAULT 0,
  sales_tax_paid_by_buyer                        numeric(14,2) NOT NULL DEFAULT 0,
  processing_fee                                   numeric(14,2) NOT NULL DEFAULT 0,
  transaction_fee                                    numeric(14,2) NOT NULL DEFAULT 0,
  regulatory_operating_fee                             numeric(14,2) NOT NULL DEFAULT 0,
  tds                                                    numeric(14,2) NOT NULL DEFAULT 0,
  tcs                                                      numeric(14,2) NOT NULL DEFAULT 0,
  -- Total Exp. (INR) = SUM(6 fee columns); Remaining Amount (INR) = Total
  -- (INR) + Total Exp. (INR) — both verified against ~860 real order rows
  -- in the source before being trusted as live formulas; inlined here since
  -- remaining_amount_inr can't reference the total_exp_inr generated column.
  total_exp_inr                                              numeric(14,2) GENERATED ALWAYS AS (
                                                                sales_tax_paid_by_buyer + processing_fee + transaction_fee
                                                                + regulatory_operating_fee + tds + tcs
                                                              ) STORED,
  remaining_amount_inr                                         numeric(14,2) GENERATED ALWAYS AS (
                                                                total_inr + sales_tax_paid_by_buyer + processing_fee
                                                                + transaction_fee + regulatory_operating_fee + tds + tcs
                                                              ) STORED,
  -- Everything from here down (Opening Balance .. Closing Balance, the
  -- per-payout-batch section) is MANUAL/CSV-imported, not a formula — the
  -- source author tried a "Closing = Opening + Remaining + fees - Payout"
  -- hypothesis and it only matched ~80% of real rows (inconsistent with
  -- the rest of the real data, likely due to manual corrections mixed into
  -- the original), so it was deliberately left non-derived rather than
  -- risk a confidently-wrong number ~1 in 5 times. Same here.
  total_remaining_amt_date                                       date,
  total_remaining_amt                                              numeric(14,2),
  opening_balance                                                    numeric(14,2),
  listing_fees                                                         numeric(14,2),
  etsy_ads_fees                                                          numeric(14,2),
  offsite_ads_fees                                                         numeric(14,2),
  colorado_retail_delivery_fee_and_other                                     numeric(14,2),
  buyer_refunds                                                                numeric(14,2),
  etsy_subscription_plan_fees                                                    numeric(14,2),
  adjusted_invoice_no                                                              text,
  payout_from_portal                                                                 numeric(14,2),
  closing_balance                                                                      numeric(14,2),
  bank_match_sr_no                                                                       text,
  received_amt_in_bank_inr                                                                 numeric(14,2),
  received_amt_in_bank_date                                                                  date,
  bank_transaction_id                                                                          text,
  created_at                                                                                     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_portal_pmt_store ON portal_payment_reconciliation(store_id);


-- =============================================================================
-- SECTION 15 — STATEMENT-FAMILY CSV-IMPORT TABLES
-- Old sheets: Bank Statement, Etsy Ledger, eBay Transaction Report, eBay
-- Freight Invoice, eBay Shipment & Customs Report, eBay Prepaid Wallet
-- Ledger, eBay Tax Invoice Detail, Etsy Monthly Tax Invoice, eBay Financial
-- Summary Report. All are import targets for real portal/bank exports —
-- column names below are snake_cased but 1:1 with the source export
-- columns (see claude/statement-import-notes.md for the verification each
-- one went through). company_id is ADDED here (the old sheets had no such
-- column since only one PNB account / one eBay+Etsy seller account existed
-- at build time) — see SCHEMA_NOTES.md open question #10.
-- =============================================================================

CREATE TABLE bank_statement_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  txn_no                text,
  txn_date                date,
  description               text,
  branch_name                 text,
  cheque_no                     text,
  dr_amount                       numeric(14,2),
  cr_amount                         numeric(14,2),
  balance                             numeric(14,2),
  kims_remarks                         text,    -- 2023/2024 export column name
  status                                 text,  -- 2025 export's renamed equivalent of KIMS Remarks
  created_at                               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bank_stmt_company_date ON bank_statement_lines(company_id, txn_date);

CREATE TABLE etsy_ledger_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  txn_date            date,
  type                  text,
  title                   text,
  info                      text,
  currency                    varchar(3),
  amount                        numeric(14,2),
  fees_and_taxes                  numeric(14,2),
  net                               numeric(14,2),
  tax_details                        text,
  created_at                           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etsy_ledger_company_date ON etsy_ledger_lines(company_id, txn_date);

CREATE TABLE ebay_transaction_lines (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                       uuid NOT NULL REFERENCES companies(id),
  transaction_creation_date          date,
  type                                  text,
  order_number                           text,
  legacy_order_id                          text,
  buyer_username                             text,
  buyer_name                                   text,
  ship_to_city                                   text,
  ship_to_province_region_state                    text,
  ship_to_zip                                        text,
  ship_to_country                                      text,
  net_amount                                             numeric(14,2),
  payout_currency                                          varchar(3),
  payout_date                                                date,
  payout_id                                                    text,
  payout_method                                                  text,
  payout_status                                                    text,
  reason_for_hold                                                    text,
  item_id                                                              text,
  transaction_id                                                         text,
  item_title                                                               text,
  custom_label                                                               text,
  quantity                                                                     integer,
  item_subtotal                                                                  numeric(14,2),
  shipping_and_handling                                                          numeric(14,2),
  seller_collected_tax                                                           numeric(14,2),
  ebay_collected_tax                                                             numeric(14,2),
  seller_specified_vat_rate                                                      numeric(8,4),   -- absent in 2 of the 3 real export variants; imports NULL for those
  final_value_fee_fixed                                                          numeric(14,2),
  final_value_fee_variable                                                       numeric(14,2),
  regulatory_operating_fee                                                       numeric(14,2),
  very_high_inad_fee                                                             numeric(14,2),   -- "Very high 'item not as described' fee"
  below_standard_performance_fee                                                 numeric(14,2),
  international_fee                                                              numeric(14,2),
  charity_donation                                                               numeric(14,2),
  deposit_processing_fee                                                         numeric(14,2),
  gross_transaction_amount                                                       numeric(14,2),
  transaction_currency                                                           varchar(3),
  exchange_rate                                                                  numeric(14,6),
  reference_id                                                                   text,
  description                                                                    text,
  created_at                                                                     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ebay_txn_company_date ON ebay_transaction_lines(company_id, transaction_creation_date);
CREATE INDEX idx_ebay_txn_order_number ON ebay_transaction_lines(order_number);

CREATE TABLE ebay_freight_invoice_lines (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                        uuid NOT NULL REFERENCES companies(id),
  awb_no                               text,
  ship_date                              date,
  ebay_invoice_date                        date,
  seller_id                                  text,
  logistic_service_provider                    text,
  service_type                                   text,
  ebay_item_no_or_dispute_id                       text,
  declared_weight                                    numeric(10,3),
  chargeable_weight                                    numeric(10,3),
  destination                                            text,
  freight_amount                                           numeric(14,2) NOT NULL DEFAULT 0,
  emergency_surcharge                                        numeric(14,2) NOT NULL DEFAULT 0,
  oda                                                          numeric(14,2) NOT NULL DEFAULT 0,
  opa                                                            numeric(14,2) NOT NULL DEFAULT 0,
  ip_surcharge                                                     numeric(14,2) NOT NULL DEFAULT 0,
  declared_value_insurance                                           numeric(14,2) NOT NULL DEFAULT 0,
  address_correction                                                   numeric(14,2) NOT NULL DEFAULT 0,
  oversize_piece                                                         numeric(14,2) NOT NULL DEFAULT 0,
  overweight_piece                                                         numeric(14,2) NOT NULL DEFAULT 0,
  additional_handling_charges                                                numeric(14,2) NOT NULL DEFAULT 0,
  restricted_destination_charges                                               numeric(14,2) NOT NULL DEFAULT 0,
  elevated_risk_charges                                                          numeric(14,2) NOT NULL DEFAULT 0,
  shipment_preparation                                                             numeric(14,2) NOT NULL DEFAULT 0,
  duty_enablement_fees                                                               numeric(14,2) NOT NULL DEFAULT 0,
  duty_charges                                                                         numeric(14,2) NOT NULL DEFAULT 0,
  other_destination_charges                                                              numeric(14,2) NOT NULL DEFAULT 0,
  others                                                                                   numeric(14,2) NOT NULL DEFAULT 0,
  billing_amount_usd                                                                         numeric(14,2),   -- no stated derivation in source (currency conversion) — manual
  credit_amount                                                                                numeric(14,2),
  credit_amount_usd                                                                              numeric(14,2),
  -- Both formulas below are literally named in the source header itself
  -- ("Total Other Charges (L+M+N+...+AA)", "Total Shipping Fees (K+AB)")
  -- and were verified against every real row of the source file — not a
  -- guess. Inlined per the generated-column-can't-reference-generated rule.
  total_other_charges numeric(14,2) GENERATED ALWAYS AS (
    emergency_surcharge + oda + opa + ip_surcharge + declared_value_insurance + address_correction
    + oversize_piece + overweight_piece + additional_handling_charges + restricted_destination_charges
    + elevated_risk_charges + shipment_preparation + duty_enablement_fees + duty_charges
    + other_destination_charges + others
  ) STORED,
  total_shipping_fees numeric(14,2) GENERATED ALWAYS AS (
    freight_amount + (
      emergency_surcharge + oda + opa + ip_surcharge + declared_value_insurance + address_correction
      + oversize_piece + overweight_piece + additional_handling_charges + restricted_destination_charges
      + elevated_risk_charges + shipment_preparation + duty_enablement_fees + duty_charges
      + other_destination_charges + others
    )
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ebay_freight_awb ON ebay_freight_invoice_lines(awb_no);

-- Old sheet: eBay Shipment & Customs Report (daily_shipment_report) — 59
-- columns, entirely manual/CSV-import (nothing in the source states any of
-- these as a formula). Closely analogous to dispatch_invoices but kept
-- separate: it's eBay's own independently-generated record, not something
-- this business keys into Dispatch & Invoice.
CREATE TABLE ebay_shipment_customs_lines (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                        uuid NOT NULL REFERENCES companies(id),
  tracking_no_awb                     text,
  paid_unpaid                           text,
  seller_id                               text,
  seller_name                               text,
  seller_company_name                         text,
  ebay_order_date                               date,
  order_id                                        text,
  ebay_item_no                                      text,
  buyer_name                                          text,
  buyer_id                                              text,
  buyer_tax_id                                            text,
  buyer_country                                             text,
  delivery_date                                               date,
  booking_date                                                  date,
  lsp_name                                                        text,
  lsp_service_type                                                  text,
  shipment_purpose                                                    text,
  scheduled_pickup_date                                                 date,
  actual_pickup_date                                                      date,
  shipping_invoice_no                                                       text,
  shipping_invoice_date                                                       date,
  quantity                                                                      integer,
  item_description                                                                text,
  hsn_code_export_country                                                           text,
  commodity_code_import_country                                                        text,
  meis                                                                                    text,
  gstin_no                                                                                  text,
  iec                                                                                         text,
  pan_no                                                                                         text,
  terms_of_trade_invoice                                                                          text,
  igst_bond_or_ut                                                                                     text,
  igst_amount                                                                                            numeric(14,2),
  ebay_fedex_account_no                                                                                    text,
  lsp_shipping_status                                                                                        text,
  currency_code                                                                                                varchar(3),
  invoice_value                                                                                                  numeric(14,2),
  declared_product_value                                                                                           numeric(14,2),
  declared_shipping_cost                                                                                             numeric(14,2),
  other_landing_cost                                                                                                   numeric(14,2),
  is_multiple_line_item_order                                                                                           boolean,
  other_charges                                                                                                          numeric(14,2),
  oda_charges                                                                                                              numeric(14,2),
  emergency_situation_surcharge                                                                                            numeric(14,2),
  est_duty                                                                                                                   numeric(14,2),
  est_duty_enablement_fees                                                                                                     numeric(14,2),
  commercial_clearance_charges                                                                                                   numeric(14,2),
  overweight_charges                                                                                                             numeric(14,2),
  oversize_charges                                                                                                                 numeric(14,2),
  elevated_risk_charges                                                                                                            numeric(14,2),
  restricted_destination_charges                                                                                                     numeric(14,2),
  additional_handling_charges                                                                                                          numeric(14,2),
  pod_charges                                                                                                                            numeric(14,2),
  ag_order                                                                                                                                 text,
  bucket                                                                                                                                     text,
  prepaid_postpaid                                                                                                                            text,
  country_of_manufacture                                                                                                                        text,
  shipment_selected_keyword                                                                                                                       text,
  cancellation_reason                                                                                                                              text,
  cancellation_remark                                                                                                                                text,
  created_at                                                                                                                                           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ebay_shipment_awb ON ebay_shipment_customs_lines(tracking_no_awb);

CREATE TABLE ebay_wallet_ledger_lines (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL REFERENCES companies(id),
  awb_number_or_transaction_id  text,
  credit_debit_amount             numeric(14,2),
  operation                         text,
  transaction_mode                    text,
  wallet_opening_balance                 numeric(14,2),   -- given directly by the export, not derived — no formula added
  wallet_closing_balance                   numeric(14,2),
  txn_date                                   date,
  payment_method                               text,
  created_at                                     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ebay_tax_invoice_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  txn_date              date,
  description             text,
  memo                      text,
  order_number                text,
  item_number                   text,
  fee_group                       text,
  fee_type                          text,
  currency                            varchar(3),
  net_amount                            numeric(14,2),
  igst_pct                                numeric(6,3),
  igst_amount                               numeric(14,2),
  total_amount                                numeric(14,2),
  charged_by_entity                             text,
  created_at                                      timestamptz NOT NULL DEFAULT now()
);

-- Old sheet: Etsy Monthly Tax Invoice — PDF-only statement, entered by hand
-- via the "Statement Entry" screen (not CSV-uploadable).
CREATE TABLE etsy_monthly_tax_invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                    uuid NOT NULL REFERENCES companies(id),
  invoice_no                      text NOT NULL,
  invoice_date                      date,
  period_from                         date,
  period_to                             date,
  subscription_plan_fees                  numeric(14,2) NOT NULL DEFAULT 0,
  listing_fees_qty                          integer NOT NULL DEFAULT 0,
  listing_fees                                numeric(14,2) NOT NULL DEFAULT 0,
  transaction_fees                              numeric(14,2) NOT NULL DEFAULT 0,
  renew_expired_fees_qty                          integer NOT NULL DEFAULT 0,
  renew_expired_fees                                numeric(14,2) NOT NULL DEFAULT 0,
  renew_sold_fees_qty                                 integer NOT NULL DEFAULT 0,
  renew_sold_fees                                       numeric(14,2) NOT NULL DEFAULT 0,
  etsy_ads_fees                                           numeric(14,2) NOT NULL DEFAULT 0,
  processing_fees                                           numeric(14,2) NOT NULL DEFAULT 0,
  offsite_ads_fees                                            numeric(14,2) NOT NULL DEFAULT 0,
  regulatory_operating_fees                                     numeric(14,2) NOT NULL DEFAULT 0,
  promotional_discount                                            numeric(14,2) NOT NULL DEFAULT 0,
  gst_pct                                                           numeric(6,4) NOT NULL DEFAULT 0,
  total_eur                                                           numeric(14,2),
  -- Subtotal = sum of the 9 real fee columns (excluding the 3 Qty columns
  -- which sit inside that span but are counts, not amounts) minus the
  -- promotional discount; GST Amount = Subtotal * GST %; Total = Subtotal +
  -- GST Amount. All 3 inlined (can't chain generated columns). Matches the
  -- source's own "Subtotal"/"Total" PDF lines to within ~₹1 (source
  -- rounding per-line before the PDF's own subtotal, not a formula error
  -- here — same disclosed discrepancy as the original build).
  subtotal_inr numeric(14,2) GENERATED ALWAYS AS (
    subscription_plan_fees + listing_fees + transaction_fees + renew_expired_fees + renew_sold_fees
    + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount
  ) STORED,
  gst_amount_inr numeric(14,2) GENERATED ALWAYS AS (
    (subscription_plan_fees + listing_fees + transaction_fees + renew_expired_fees + renew_sold_fees
     + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount)
    * gst_pct
  ) STORED,
  total_inr numeric(14,2) GENERATED ALWAYS AS (
    (subscription_plan_fees + listing_fees + transaction_fees + renew_expired_fees + renew_sold_fees
     + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount)
    * (1 + gst_pct)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no)
);

-- Old sheet: eBay Financial Summary Report — PDF-only, hand-entered. The
-- roll-up columns (Refunds Net, Fees Txn Net, Fees Subtotal Net, Expenses
-- Total Net, Net Transfers Net, Adjustments Net, and the sanity-check "Net
-- Cash Movement") chain 3-4 levels deep — rather than fight Postgres'
-- can't-reference-a-generated-column rule with deeply inlined expressions,
-- these are a VIEW instead (ebay_financial_summary_computed_view below),
-- matching the source's own description of the last one as "this system's
-- own derived roll-up ... a sanity-check figure only", i.e. reporting, not
-- a fact to store.
CREATE TABLE ebay_financial_summary (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      uuid NOT NULL REFERENCES companies(id),
  period_from                       date NOT NULL,
  period_to                           date NOT NULL,
  generated_date                        date,
  orders_credits                          numeric(14,2) NOT NULL DEFAULT 0,
  orders_net                                numeric(14,2) NOT NULL DEFAULT 0,
  refunds_gross_refunds                       numeric(14,2) NOT NULL DEFAULT 0,
  refunds_gross_claims                          numeric(14,2) NOT NULL DEFAULT 0,
  refunds_gross_payment_disputes                  numeric(14,2) NOT NULL DEFAULT 0,
  fees_insertion_fees                               numeric(14,2) NOT NULL DEFAULT 0,
  fees_promoted_listings_fees                         numeric(14,2) NOT NULL DEFAULT 0,
  fees_other_fees                                       numeric(14,2) NOT NULL DEFAULT 0,
  fees_transaction_fees_debit                             numeric(14,2) NOT NULL DEFAULT 0,
  fees_transaction_fees_credit                              numeric(14,2) NOT NULL DEFAULT 0,
  fees_advanced_listing_upgrade_fees                          numeric(14,2) NOT NULL DEFAULT 0,
  expenses_shipping_labels                                       numeric(14,2) NOT NULL DEFAULT 0,
  expenses_donations                                               numeric(14,2) NOT NULL DEFAULT 0,
  net_transfers_charges                                              numeric(14,2) NOT NULL DEFAULT 0,
  net_transfers_payouts                                                numeric(14,2) NOT NULL DEFAULT 0,
  adjustments_debit                                                      numeric(14,2) NOT NULL DEFAULT 0,
  adjustments_credit                                                       numeric(14,2) NOT NULL DEFAULT 0,
  created_at                                                                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_from, period_to)
);

CREATE VIEW ebay_financial_summary_computed_view AS
SELECT
  s.*,
  (refunds_gross_refunds + refunds_gross_claims + refunds_gross_payment_disputes)                 AS refunds_net,
  (fees_transaction_fees_debit + fees_transaction_fees_credit)                                      AS fees_transaction_fees_net,
  (fees_insertion_fees + fees_promoted_listings_fees + fees_other_fees
    + (fees_transaction_fees_debit + fees_transaction_fees_credit) + fees_advanced_listing_upgrade_fees) AS expenses_fees_subtotal_net,
  ((fees_insertion_fees + fees_promoted_listings_fees + fees_other_fees
    + (fees_transaction_fees_debit + fees_transaction_fees_credit) + fees_advanced_listing_upgrade_fees)
   + expenses_shipping_labels + expenses_donations)                                                  AS expenses_total_net,
  (net_transfers_charges + net_transfers_payouts)                                                    AS net_transfers_net,
  (adjustments_debit + adjustments_credit)                                                           AS adjustments_net,
  ( orders_net
    + (refunds_gross_refunds + refunds_gross_claims + refunds_gross_payment_disputes)
    + ((fees_insertion_fees + fees_promoted_listings_fees + fees_other_fees
        + (fees_transaction_fees_debit + fees_transaction_fees_credit) + fees_advanced_listing_upgrade_fees)
       + expenses_shipping_labels + expenses_donations)
    + (net_transfers_charges + net_transfers_payouts)
    + (adjustments_debit + adjustments_credit)
  )                                                                                                   AS net_cash_movement_check
FROM ebay_financial_summary s;


-- =============================================================================
-- SECTION 16 — HR: ATTENDANCE, HR LETTERS
-- =============================================================================

-- Old sheet: Attendance — one row per person per day, from either the web
-- app's own Punch In/Punch Out (a backup for the physical biometric device)
-- or an imported TeamOffice monthly report. WORK HOURS is genuinely
-- same-row derivable from punch_in/punch_out -> generated column (the old
-- sheet computed it once in punchOut() and stored it; here it's always
-- live and can never be stale/wrong relative to the two timestamps).
CREATE TABLE attendance (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             uuid NOT NULL REFERENCES employees(id),
  company_id                uuid NOT NULL REFERENCES companies(id),
  store_id                    uuid REFERENCES stores(id),
  attendance_date               date NOT NULL,
  punch_in                        timestamptz,
  punch_out                         timestamptz,
  work_hours                          numeric(6,2) GENERATED ALWAYS AS (
                                         CASE WHEN punch_in IS NOT NULL AND punch_out IS NOT NULL
                                              THEN round(EXTRACT(EPOCH FROM (punch_out - punch_in))::numeric / 3600, 2)
                                         END
                                       ) STORED,
  status                                 attendance_status,
  source                                   attendance_source NOT NULL,
  device_status                              attendance_status,     -- filled once a TeamOffice import lands for this person+date
  device_punch_in                              time,
  device_punch_out                               time,
  match_flag                                       text,          -- '✅ Match' / '⚠️ Mismatch: ...' / '— (single source)'
  remark                                             text,
  entered_by_employee_id                               uuid REFERENCES employees(id),
  entered_on                                             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, attendance_date)
);
CREATE INDEX idx_attendance_company_date ON attendance(company_id, attendance_date);

-- Old sheet: Letter Log — audit trail of every HR letter generated (the
-- letter document itself is rendered client-side from a template, never
-- stored here). ref_no auto-assigned same as the other document tables,
-- but WITHOUT the FY reset (matches getNextLetterRefNo_()'s composite
-- counter key company+letterType, no year component).
CREATE TABLE hr_letters (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  for_company_id              uuid NOT NULL REFERENCES companies(id),
  for_employee_id                uuid REFERENCES employees(id),
  for_employee_name_snapshot       text NOT NULL,   -- kept even if for_employee_id later becomes inactive/deleted
  for_employee_code_snapshot         text,
  letter_type                          letter_type NOT NULL,
  ref_no                                 text UNIQUE,   -- auto-assigned, format "PO/JL/0001" (company ref_prefix / letter-type code / seq, no FY)
  letter_date                              date NOT NULL DEFAULT CURRENT_DATE,
  remark                                     text,
  generated_by_employee_id                     uuid NOT NULL REFERENCES employees(id),
  generated_on                                   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hr_letters_company ON hr_letters(for_company_id);

CREATE OR REPLACE FUNCTION trg_hr_letters_ref_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_prefix text;
  v_code   text;
  v_num    int;
  v_type_code_map jsonb := '{
    "Joining Letter":"JL", "Offer Letter":"OL", "Promotion Letter":"PL", "Increment Letter":"IL",
    "Experience Letter":"EL", "Relieving Letter":"RL", "Warning Letter":"WL", "Salary Slip":"SS",
    "Custom / Other Letter":"GL"
  }';
BEGIN
  SELECT ref_prefix INTO v_prefix FROM companies WHERE id = NEW.for_company_id;
  v_code := v_type_code_map ->> NEW.letter_type::text;
  v_num := reserve_next_number(NEW.for_company_id, 'LETTER_' || v_code, false);
  NEW.ref_no := v_prefix || '/' || v_code || '/' || lpad(v_num::text, 4, '0');
  RETURN NEW;
END; $$;
CREATE TRIGGER hr_letters_before_insert BEFORE INSERT ON hr_letters
  FOR EACH ROW WHEN (NEW.ref_no IS NULL) EXECUTE FUNCTION trg_hr_letters_ref_no();


-- =============================================================================
-- SECTION 17 — REPORTING VIEWS
-- Old: Net Revenue sheet (all-time, all-company live summary) and the CRM
-- Dashboard's ad-hoc alert scan (getAlerts_() in Code.gs) — both pure
-- queries over other tables, so both become views rather than stored data.
-- =============================================================================

-- Old sheet: Net Revenue — ALL-TIME, ALL-COMPANY totals from the LIVE
-- operational tables (Dispatch & Invoice + the 3 vendor bill tables) — this
-- is deliberately separate from pl_dashboard_*_view above, which is scoped
-- to the historical Sale & Profit Ledger import. Same 25%-portal-expense
-- assumption; change the 0.25 literal here if the real portal-fee % differs.
CREATE VIEW net_revenue_view AS
SELECT
  (SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices)                                    AS total_value_inr,
  (
    (SELECT COALESCE(SUM(total_amt), 0) FROM freight_bills)
    + (SELECT COALESCE(SUM(gross_total_amt), 0) FROM duty_tax_bills)
    + (SELECT COALESCE(SUM(g_total_plus_gst), 0) FROM purchase_bills)
  )                                                                                                       AS total_expenses_inr,
  (
    (SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices)
    - (
        (SELECT COALESCE(SUM(total_amt), 0) FROM freight_bills)
        + (SELECT COALESCE(SUM(gross_total_amt), 0) FROM duty_tax_bills)
        + (SELECT COALESCE(SUM(g_total_plus_gst), 0) FROM purchase_bills)
      )
  )                                                                                                       AS net_total_value,
  ((SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices) * 0.25)                             AS portal_expenses_25pct,
  (
    (
      (SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices)
      - (
          (SELECT COALESCE(SUM(total_amt), 0) FROM freight_bills)
          + (SELECT COALESCE(SUM(gross_total_amt), 0) FROM duty_tax_bills)
          + (SELECT COALESCE(SUM(g_total_plus_gst), 0) FROM purchase_bills)
        )
    ) - ((SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices) * 0.25)
  )                                                                                                       AS net_earn;

-- Old: getAlerts_() in Code.gs (CRM Dashboard's data-quality checks). Kept
-- as concrete, named checks (not an open-ended rules engine) — same
-- philosophy as the original. "Possible duplicate PO/RF/RG No." here uses
-- orders.ref_no_base (see section 5) instead of re-deriving it with regex
-- on every query.
CREATE VIEW data_quality_alerts_view AS
SELECT o.id AS order_id, o.company_id, o.ref_no, 'Missing buyer info' AS alert_type,
       o.ref_no || ' (' || COALESCE(s.name, 'unknown store') || ') has no buyer name/address or contact number.' AS detail
FROM orders o JOIN stores s ON s.id = o.store_id
WHERE COALESCE(o.buyer_name_address, '') = '' AND COALESCE(o.contact_no, '') = ''
UNION ALL
SELECT o.id, o.company_id, o.ref_no, 'Zero/blank order value',
       o.ref_no || ' (' || COALESCE(s.name, 'unknown store') || ') has no order value set.'
FROM orders o JOIN stores s ON s.id = o.store_id
WHERE COALESCE(o.order_value_usd, 0) <= 0
UNION ALL
SELECT o.id, o.company_id, o.ref_no, 'Exchange rate unavailable',
       o.ref_no || ' — ' || o.exchange_rate_source
FROM orders o
WHERE o.exchange_rate_source LIKE 'Unavailable%'
UNION ALL
SELECT o.id, o.company_id, o.ref_no, 'Possible duplicate PO/RF/RG No.',
       o.ref_no || ' shares a base reference number with another order and is not a recognised batch suffix.'
FROM orders o
WHERE o.ref_no !~ '-\d+/\d+$'
  AND EXISTS (
    SELECT 1 FROM orders o2
    WHERE o2.company_id = o.company_id AND o2.ref_no_base = o.ref_no_base AND o2.id <> o.id
  );

-- Old: Activity Report tab's QUERY() formula (first/last order entry time
-- per employee per day, off All_Orders_Master's ENTRY TIMESTAMP).
CREATE VIEW employee_order_activity_view AS
SELECT
  entry_by_employee_id,
  date_trunc('day', entry_timestamp)::date AS activity_date,
  min(entry_timestamp) AS first_order_time,
  max(entry_timestamp) AS last_order_time,
  count(*) AS orders_entered
FROM orders
GROUP BY entry_by_employee_id, date_trunc('day', entry_timestamp)
ORDER BY activity_date DESC, entry_by_employee_id;


-- =============================================================================
-- SECTION 18 — SEED DATA
-- Structural/business-rule data only (companies, stores, roles,
-- capabilities, role_capabilities, currencies) — NOT bulk migration data
-- (the 280 Sizes values, ~90 Party Master vendor rows, SKU catalog,
-- historical Sale & Profit Ledger rows, exchange-rate history, etc.),
-- which belongs in a separate one-time migration script, not schema.sql.
-- See SCHEMA_NOTES.md for the full list of what still needs migrating.
-- =============================================================================

INSERT INTO companies (name, short_code, ref_prefix) VALUES
  ('Nyko Mart', 'NM', 'PO'),
  ('Rugara', 'RUG', 'RG'),
  ('CASA ARRA', 'CA', 'RF');

INSERT INTO company_profiles (company_id, address, phone, whatsapp, email, iec, gstin, bank_name, account_no, ifsc_code, ad_code)
SELECT id, 'D-489, Sector-29, Pratap Nagar, Jaipur-302033, India', '+91 141 480 5979', '+91 774099 1175',
       'info.nykomart@gmail.com', 'CVAPS0200H', '08CVAPS0200H1Z0', 'PNB Bank', '6143002100005132', 'PUNB0614300', '0304993/PUNB0614300'
FROM companies WHERE short_code = 'NM';

INSERT INTO company_profiles (company_id, address, phone, whatsapp, email, iec, gstin, bank_name, account_no, ifsc_code, ad_code)
SELECT id, 'D-489, Sector-29, Pratap Nagar, Jaipur-302033, India', '+91 9636263302', '+91 6377911920',
       'info.rugara@gmail.com', 'BDHPL8126K', '08BDHPL8126K1Z6', 'PNB Bank', '6143002100008005', 'PUNB0614300', '0304993/PUNB0614300'
FROM companies WHERE short_code = 'RUG';

INSERT INTO company_profiles (company_id, address, phone, whatsapp, email, iec, gstin, bank_name, account_no, ifsc_code, ad_code)
SELECT id, 'Plot No. 80, Ashadeep Green Vatika, Sanganer, Bagru, Jaipur, RJ, India 303905', '+91 9254075423', '+91 9254075423',
       'info.casaarra@gmail.com', 'AUXPR4630C', '08AUXPR4630C1ZA', 'PNB Bank', '6143002100008801', 'PUNB0614300', '0304993/PUNB0614300'
FROM companies WHERE short_code = 'CA';

INSERT INTO stores (company_id, name)
SELECT c.id, s.name FROM companies c
JOIN (VALUES
  ('NM', 'Amazon Arts of Jaipur'), ('NM', 'Etsy Arts of Jaipur'), ('NM', 'Etsy The Decor House'),
  ('NM', 'Etsy Handloom Decor'), ('NM', 'Ebay Arts of Jaipur'), ('NM', 'Arts of Jaipur (Website)'),
  ('NM', 'Jaipur Arts (Website)'),
  ('RUG', 'Amazon Rugara'), ('RUG', 'Etsy The Rugara'), ('RUG', 'Ebay Rugara'), ('RUG', 'The Rugara (Website)'),
  ('CA', 'Amazon Kanjush'), ('CA', 'Etsy Casa Arra'), ('CA', 'Etsy Kanjush'), ('CA', 'Ebay Casa Arra'),
  ('CA', 'CASA ARRA (Website)'), ('CA', 'Kanjush (Website)')
) AS s(short_code, name) ON s.short_code = c.short_code;

INSERT INTO currencies (code, name) VALUES
  ('USD','US Dollar'), ('EUR','Euro'), ('GBP','British Pound'), ('CAD','Canadian Dollar'),
  ('AUD','Australian Dollar'), ('AED','UAE Dirham'), ('JPY','Japanese Yen'), ('CHF','Swiss Franc'),
  ('SGD','Singapore Dollar'), ('INR','Indian Rupee');

INSERT INTO roles (name) VALUES
  ('Order Entry'), ('Logistics'), ('Finance'), ('Listing'), ('Photoshop/Graphics'),
  ('Inventory'), ('Higher Authority'), ('MD'), ('Admin');

INSERT INTO capabilities (code, description) VALUES
  ('order_entry',         'Open the order-entry form and submit new orders'),
  ('csv_upload',          'Bulk-load rows into the back-office log sheets via CSV'),
  ('doc_entry',           'Enter Credit Note / Debit Note / Washing Data / Internal Invoice / Freight & Duty bills'),
  ('stock_entry',         'Enter Stock In / Stock Out movements'),
  ('bill_payment',        'Bill-payment entry (not yet built in the source system)'),
  ('salary_admin',        'Salary / advance tracking (not yet built in the source system)'),
  ('statement_entry',     'Manual entry for the 2 PDF-only statements (Etsy Monthly Tax Invoice, eBay Financial Summary)'),
  ('party_admin',         'Add/update Party Master (vendor) records'),
  ('exchange_rate_admin', 'Maintain Exchange Rate Master'),
  ('attendance_punch',    'Punch In / Punch Out'),
  ('attendance_admin',    'Import TeamOffice attendance report, view mismatches'),
  ('crm_dashboard',       'View the company-wide CRM/overview dashboard'),
  ('approve_level1',      'First-level bill/approval sign-off (not yet built in the source system)'),
  ('approve_level2',      'Second-level bill/approval sign-off (not yet built in the source system)'),
  ('company_item_admin',  'Add new companies / item categories / sizes'),
  ('hr_letters',          'Generate HR letters (Joining/Promotion/Experience/Salary Slip/...)'),
  ('employee_admin',      'Manage the Employees roster (not yet built in the source system)'),
  ('reports',             'Access the Reports suite (not yet built in the source system)');

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, cap FROM roles r
JOIN (VALUES
  ('Order Entry',        'order_entry'), ('Order Entry', 'attendance_punch'),
  ('Logistics',          'csv_upload'),  ('Logistics',   'attendance_punch'),
  ('Finance',            'csv_upload'),  ('Finance', 'doc_entry'), ('Finance', 'stock_entry'),
  ('Finance',            'bill_payment'),('Finance', 'salary_admin'), ('Finance', 'statement_entry'),
  ('Finance',            'party_admin'),('Finance', 'exchange_rate_admin'), ('Finance', 'attendance_punch'),
  ('Finance',            'attendance_admin'), ('Finance', 'crm_dashboard'),
  ('Higher Authority',   'approve_level1'), ('Higher Authority', 'attendance_punch'), ('Higher Authority', 'crm_dashboard'),
  ('MD',                 'approve_level2'), ('MD', 'company_item_admin'), ('MD', 'doc_entry'), ('MD', 'stock_entry'),
  ('MD',                 'statement_entry'), ('MD', 'party_admin'), ('MD', 'exchange_rate_admin'),
  ('MD',                 'attendance_punch'), ('MD', 'attendance_admin'), ('MD', 'hr_letters'), ('MD', 'crm_dashboard'),
  ('Admin',              'company_item_admin'), ('Admin', 'employee_admin'), ('Admin', 'reports'), ('Admin', 'doc_entry'),
  ('Admin',              'stock_entry'), ('Admin', 'party_admin'), ('Admin', 'exchange_rate_admin'),
  ('Admin',              'attendance_punch'), ('Admin', 'attendance_admin'), ('Admin', 'hr_letters'), ('Admin', 'crm_dashboard'),
  -- 2026-08-05: Admin is the account the owner actually logs in as day-to-
  -- day (unlike the old system's per-department role split) — give it every
  -- remaining capability too, so it's a true superuser role rather than
  -- missing exactly the ones (order_entry, csv_upload, etc.) an owner would
  -- hit first while testing/administering the system.
  ('Admin',              'order_entry'), ('Admin', 'csv_upload'), ('Admin', 'bill_payment'),
  ('Admin',              'salary_admin'), ('Admin', 'statement_entry'), ('Admin', 'approve_level1'),
  ('Admin',              'approve_level2'),
  ('Listing',            'attendance_punch'),
  ('Photoshop/Graphics', 'attendance_punch'),
  ('Inventory',          'stock_entry'), ('Inventory', 'attendance_punch')
) AS rc(role_name, cap) ON rc.role_name = r.name;


-- =============================================================================
-- OLD SHEET NAME -> NEW TABLE/VIEW MAPPING  (see SCHEMA_NOTES.md for full detail)
-- =============================================================================
-- README                              -> (n/a — this file + SCHEMA_NOTES.md)
-- Lists                               -> enum types (section 1) + item_categories / sizes / currencies / stores tables
-- All_Orders_Master + Nyko Mart +
--   Rugara + CASA ARRA                -> orders  (ONE table, company_id FK)
-- Counters                            -> sequence_counters + reserve_next_number()
-- Company_Stores + Company_Registry   -> companies + stores
-- Employees                           -> employees (+ roles, capabilities, role_capabilities)
-- Activity Report                     -> employee_order_activity_view
-- SKU_Master                          -> skus
-- Party Master                        -> parties
-- Exchange Rate Master                -> exchange_rates
-- Company_Profiles                    -> company_profiles
-- Dispatch & Invoice                  -> dispatch_invoices
-- Freight Bill                        -> freight_bills
-- Duty & Tax Bill                     -> duty_tax_bills
-- Shipping Bills                      -> shipping_bills
-- Purchase Bill                       -> purchase_bills
-- Freight Reconciliation              -> freight_bill_awb_assignments (manual data) + freight_reconciliation_view (computed) + freight_bill_variance_view (DIFRANCE AMOUNT)
-- Duty Reconciliation                 -> duty_bill_awb_assignments (manual data) + duty_reconciliation_view (computed)
-- Portal Payment Reconciliation       -> portal_payment_reconciliation
-- Bank Statement                      -> bank_statement_lines
-- Etsy Ledger                         -> etsy_ledger_lines
-- eBay Transaction Report             -> ebay_transaction_lines
-- eBay Freight Invoice                -> ebay_freight_invoice_lines
-- eBay Shipment & Customs Report      -> ebay_shipment_customs_lines
-- eBay Prepaid Wallet Ledger          -> ebay_wallet_ledger_lines
-- eBay Tax Invoice Detail             -> ebay_tax_invoice_lines
-- Etsy Monthly Tax Invoice            -> etsy_monthly_tax_invoices
-- eBay Financial Summary Report       -> ebay_financial_summary (+ ebay_financial_summary_computed_view)
-- Net Revenue                         -> net_revenue_view
-- Dispatch & Refund + FBA Refund +
--   No Dispatch & Refund              -> refunds  (ONE table, `source` discriminator)
-- Washing Data                        -> washing_entries
-- Debit Note                          -> debit_notes
-- Credit Note                         -> credit_notes
-- Internal Invoice                    -> internal_invoices
-- Stock Master                        -> stock_items (catalog) + stock_current_view (computed)
-- Stock In                            -> stock_in
-- Stock Out                           -> stock_out
-- Bill Pass Register                  -> bill_pass_register
-- Sale & Profit Ledger                -> sale_profit_ledger
-- P&L Dashboard                       -> pl_dashboard_by_company_view + pl_dashboard_by_month_view
-- Attendance                          -> attendance
-- Letter Log                          -> hr_letters
-- (CRM Dashboard alerts, getAlerts_)  -> data_quality_alerts_view
-- =============================================================================
