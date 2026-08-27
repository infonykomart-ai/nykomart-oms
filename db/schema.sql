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
  ('Pending', 'Confirmed', 'In Production', 'Dispatched', 'Delivered', 'Hold', 'Cancelled', 'Returned');

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

-- 2026-08-12: 'Salary'/'Advance' added so a Salary Payment or Employee
-- Advance can be inserted into bill_pass_register (the SAME payable
-- ledger every vendor/courier bill already uses) — see
-- db/2026-08-12-finance-salary-advance.sql for the full rationale.
CREATE TYPE invoice_type AS ENUM
  ('DUTY TAX', 'Purchase', 'FREIGHT INVOICE', 'Printing', 'Washing', 'Disbursement FEE', 'Service', 'JOB WORK', 'Salary', 'Advance');

-- 2026-08-12 (round 11): new — the "Approvals (L1)"/"Approvals (L2)"
-- dashboard tiles had no backing workflow anywhere (never built even in
-- the old Apps Script system). Deliberately minimal 2-level chain over
-- bill_pass_register — see db/2026-08-12-round11-unbuilt-dashboard-
-- sections.sql for the full rationale; flagged as a genuine new design,
-- not a port of existing business logic.
CREATE TYPE bill_approval_status AS ENUM ('Pending', 'Approved L1', 'Approved L2', 'Rejected');

CREATE TYPE refund_type AS ENUM ('PARTIAL REFUND', 'FULL REFUND', 'A TO Z CLAIM', 'NO REFUND', 'CUSTOM TAX');

-- Not in the old system — needed because Dispatch & Refund / FBA Refund /
-- No Dispatch & Refund (3 near-identical sheets) are unified into one
-- `refunds` table (see section 14); this discriminates which of the 3 a
-- given row came from (FBA Refund has no ITEM ID; No Dispatch & Refund adds
-- a REASON field — both nullable on the unified table).
CREATE TYPE refund_source AS ENUM ('DISPATCH', 'FBA', 'NO_DISPATCH');

-- 2026-08-11: 'Holiday' added (a specific calendar date, e.g. Diwali —
-- varies year to year) alongside the pre-existing 'Week Off' (the
-- recurring weekly-off day, see companies.weekly_off_days below) — kept
-- distinct rather than merged into one bucket, though the payroll report
-- treats both identically (never Absent, never deducted).
CREATE TYPE attendance_status AS ENUM ('Present', 'Absent', 'Week Off', 'Half Day', 'Leave', 'Late', 'Holiday');

CREATE TYPE attendance_source AS ENUM ('Web Punch', 'TeamOffice Import', 'Manual Entry');

-- 2026-08-07: Employee Master expansion — see employees table below.
CREATE TYPE employee_gender AS ENUM ('Male', 'Female');
CREATE TYPE employee_marital_status AS ENUM ('Married', 'Unmarried');

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
  -- 2026-08-06: sales_invoices' "Master Invoice No." prefix (see
  -- claude/invoice-origin-declarations-and-numbering.md section 3/5) — one
  -- fixed prefix per company (NYM/RA/CASA), separate from ref_prefix
  -- (PO/RF/RG, which is per-ORDER not per-invoice) and from
  -- stores.invoice_ref_prefix (which is per-STORE/marketplace, not company).
  master_invoice_prefix text,
  -- 2026-08-11: recurring weekly-off day(s) for attendance/payroll, e.g.
  -- every Sunday off. 0=Sunday..6=Saturday (matches both JS Date.getDay()
  -- and Postgres EXTRACT(DOW FROM date)). See holidays table (SECTION 16)
  -- for one-off calendar-date holidays, which this is deliberately kept
  -- separate from.
  weekly_off_days int[] NOT NULL DEFAULT '{0}',
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
  -- 2026-08-06: sales_invoices' customer-facing "Invoice No." prefix (see
  -- claude/invoice-origin-declarations-and-numbering.md section 3/5) —
  -- confirmed per-STORE/marketplace, not per-company: Nyko Mart's Etsy+
  -- Website stores share "NL", but its Amazon stores are "AN" and eBay is
  -- "EBY". Nullable — a newly-added store has no prefix until an admin
  -- sets one (see db/2026-08-06-invoice-prefixes.sql for the seed mapping
  -- of all 17 existing stores); invoice generation refuses to proceed
  -- without one rather than silently guessing.
  invoice_ref_prefix text,
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
  email           text UNIQUE,           -- 2026-08-06: denormalized copy of the auth.users login email — added for the
                                          -- in-app "create new employee login" admin screen (was previously created by
                                          -- hand in the Supabase dashboard). Postgres UNIQUE allows multiple NULLs, so
                                          -- this stays optional for any row created before this column existed.
  role_id         uuid NOT NULL REFERENCES roles(id),
  active          boolean NOT NULL DEFAULT true,
  password_hash   text,                  -- bcrypt/argon2 hash — NEVER plaintext (unlike the old PASSWORD column)
  employee_code   text,                  -- ties to the TeamOffice biometric export's "Empcode" column
  designation     text,
  date_of_joining date,

  -- 2026-08-07: Employee Master expansion (full profile) + birthday/
  -- anniversary celebration feature. anniversary_date is only meaningful
  -- when marital_status = 'Married' — the app UI hides/shows that field
  -- accordingly rather than the DB enforcing it, since an Unmarried row
  -- legitimately just leaves it null forever.
  whatsapp_no             text,
  gender                  employee_gender,
  marital_status          employee_marital_status,
  dob                     date,
  anniversary_date        date,
  photo_url                text,      -- direct image URL (same pattern as companies.logo_url) — no upload widget built yet
  family_contact_1_name       text,
  family_contact_1_relation    text,
  family_contact_1_number       text,
  family_contact_2_name          text,
  family_contact_2_relation       text,
  family_contact_2_number          text,

  -- 2026-08-22: dashboard theme system — per-employee preference (see
  -- db/2026-08-22-employee-theme-prefs.sql). theme_id is one of the 5
  -- preset theme keys (see src/lib/theme/themes.ts); custom_accent_color
  -- is an optional hex override of just the active theme's accent
  -- variable. Both NULL = using the default theme ('navy-gold') with no
  -- accent override.
  theme_id                text,
  custom_accent_color     text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)              -- matches old verifyCredentials_()'s (company, name) lookup key
);
CREATE INDEX idx_employees_company ON employees(company_id);
CREATE UNIQUE INDEX idx_employees_code ON employees(employee_code) WHERE employee_code IS NOT NULL;
ALTER TABLE employees
  ADD CONSTRAINT employees_theme_id_check
    CHECK (theme_id IS NULL OR theme_id IN ('navy-gold', 'day', 'eye-comfort', 'night', 'ocean'));
ALTER TABLE employees
  ADD CONSTRAINT employees_custom_accent_color_check
    CHECK (custom_accent_color IS NULL OR custom_accent_color ~ '^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$');

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

-- 2026-08-08: "AD SPEND VALI JO ENTRY HAI VO SIRF UTNI HI ENTRY DIKHNI
-- CHAHIYE JIS BANDE KO JIS STORE PAR KAAM KAR RAHA HAI" — which store(s) a
-- login is actually assigned to work on, distinct from employee_company_
-- access above (which company a login may switch into). Used to scope the
-- Store Ad Spend module: an employee with only ad_spend_entry (no
-- ad_spend_report_all) sees/enters only their own assigned store(s); an
-- empty row set here means "no store assigned yet" (sees nothing, not
-- everything — never default-open). Employees with ad_spend_report_all
-- (Finance/Higher Authority/MD/Admin) bypass this table entirely and see
-- every store. No self-service UI beyond the Employees admin screen's
-- "Store Access" panel (employee_admin capability).
CREATE TABLE employee_store_access (
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, store_id)
);
CREATE INDEX idx_employee_store_access_store ON employee_store_access(store_id);


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

-- sales_invoices numbering: "NL-26-27-001" (prefix / FY / 3-digit sequence,
-- hyphen-separated) — 2026-08-06 user's explicit decision, confirmed over
-- the real historical samples' different "NL-170-26-27" (sequence-first)
-- ordering (see claude/invoice-origin-declarations-and-numbering.md section
-- 3). Used for BOTH the customer-facing Invoice No. (prefix = the order's
-- store.invoice_ref_prefix) and the Master Invoice No. (prefix = the
-- company's master_invoice_prefix) — same format, different prefix source.
CREATE OR REPLACE FUNCTION format_invoice_no(p_prefix text, p_fy text, p_num integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT p_prefix || '-' || p_fy || '-' || lpad(p_num::text, 3, '0'); $$;

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
-- 2026-08-11: harmonized_tariff_number added — "HSN code ke sath ek coloum
-- Harmonized Tariff Number" (a column alongside HSN code). HSN is the
-- universal 6-digit code; several destination countries extend it with
-- their own longer national tariff schedule (e.g. USA's 10-digit HTS —
-- see https://hts.usitc.gov/). Same nullable/manual-entry pattern as
-- hsn_code above (no per-country lookup — the business enters whichever
-- code applies for their typical destination, same as HSN).
CREATE TABLE item_categories (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      citext NOT NULL UNIQUE,
  hsn_code                  text,
  harmonized_tariff_number  text
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
  -- 2026-08-12 (round 8): a vendor's own bank details, so a Bill Pass
  -- Register payment can be made without hunting the physical bill for
  -- account info. Same shape as company_profiles' own bank_name/
  -- account_no/ifsc_code. account_holder_name is only set when it
  -- genuinely differs from the party's own name.
  bank_name             text,
  account_no            text,
  ifsc_code             text,
  account_holder_name   text,
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
  automation_tag           text,      -- 2026-08-24: set by the automation rules engine's "set_tag" action (see db/2026-08-24-automation-rules.sql) — free text, purely informational
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
  tax_id                   text,      -- legacy generic VAT/IOSS/Tax ID field — superseded 2026-08-11 by the 3
                                       -- separate fields below; kept for old orders, no longer written by new UI.

  -- 2026-08-11: "EORI NO, VAT No, IOSS no order entry me pahle se mojud
  -- hota hai automatic aane chahiye lekin edit mode me rahe" — separate
  -- fields (replacing the single generic tax_id above) so Invoice
  -- generation can auto-pull the correct one instead of guessing.
  -- destination_country likewise moves here from being invoice-only, since
  -- buyer_name_address is a single free-text field and can't be reliably
  -- parsed for country — see src/app/dashboard/invoices/actions.ts's
  -- auto-pull logic. All usually blank; only applicable for UK/EU
  -- shipments (destination_country obviously always applies).
  vat_number                text,
  eori_number                text,
  ioss_number                text,
  destination_country        text,

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

  -- 2026-08-06: "WHATS APP INTIGRATION" — item 5. No WhatsApp Business API
  -- is used (user chose the simpler route: share via the order-entry
  -- employee's OWN WhatsApp, using the Web Share API / wa.me link from the
  -- browser — see order-whatsapp-button.tsx). This column only tracks
  -- "has someone triggered the share for this order yet" so the Order
  -- Entry list can show a status + only prompt again for orders not sent.
  -- Not proof of delivery — the actual send/confirm still happens inside
  -- WhatsApp itself, outside this app's control.
  whatsapp_sent_at          timestamptz,

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

-- 2026-08-17 perf fix — crm/page.tsx previously pulled every order row's
-- status column (no limit, no server-side aggregation) just to count
-- per-status totals in Node; this does the same GROUP BY in the database
-- instead, using idx_orders_status above. See
-- db/2026-08-17-ebay-indexes-and-order-status-rpc.sql.
CREATE OR REPLACE FUNCTION get_order_status_counts(p_company_id uuid)
RETURNS TABLE (status order_status, cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT o.status, count(*)
  FROM orders o
  WHERE o.company_id = p_company_id
  GROUP BY o.status;
$$;

COMMENT ON COLUMN orders.ref_no IS
  'PO/RF/RG number, possibly with a "-position/total" buyer-batch suffix (e.g. "PO-0001-1/2"). Base number '
  'reservation and batch-suffix tagging are APPLICATION LOGIC (see top-of-file BUSINESS RULES comment), not '
  'a DB default/trigger, because both are conditional on live lookups (duplicate-dispatched-order reuse '
  'check; buyer-batch membership) that must happen before/around the INSERT, not purely from it.';

-- Store-level Daily Spend tracking (pending item 3 — see db/2026-08-08-
-- store-ad-spend.sql for the full rationale). QTY ORD/USD (order count and
-- value) are computed live by joining `orders` here by store_id+order_date
-- — never duplicated into this table. Only Budget/Spend (external ad-
-- platform numbers) are stored — one row per (store, date) that has data;
-- a day with no ad spend simply has no row.
CREATE TABLE store_ad_spend (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              uuid NOT NULL REFERENCES stores(id),
  spend_date            date NOT NULL,
  budget_usd            numeric(12,2) NOT NULL DEFAULT 0,
  spend_usd             numeric(12,2) NOT NULL DEFAULT 0,
  entry_by_employee_id  uuid NOT NULL REFERENCES employees(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, spend_date)
);
CREATE INDEX idx_store_ad_spend_date  ON store_ad_spend(spend_date);
CREATE INDEX idx_store_ad_spend_store ON store_ad_spend(store_id);


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
  -- 2026-08-12: "shipment ke against me courier ka credit note aagya" —
  -- captured against THIS specific bill, matching how the physical
  -- document actually arrives (against one courier invoice), not as a
  -- free-floating ledger line elsewhere.
  credit_note_no          text,
  credit_note_date         date,
  credit_note_amt           numeric(14,2) NOT NULL DEFAULT 0,
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
  -- 2026-08-12: same courier-credit-note capture as freight_bills above.
  credit_note_no            text,
  credit_note_date           date,
  credit_note_amt             numeric(14,2) NOT NULL DEFAULT 0,
  -- 2026-08-12 (round 10): manual bottom-summary fields off the real Duty
  -- Tax Bill document (DISBURSEMENT FEE / COURIER DUTY CHARGES / TOTAL
  -- PAYABLE AMT) — same "manual, matches the physical bill" convention as
  -- gst_18pct_amt above; total_payable_amt is NOT a generated formula
  -- because the real bills seen don't reconcile to one cleanly.
  disbursement_fee            numeric(14,2) NOT NULL DEFAULT 0,
  courier_duty_charges_adj      numeric(14,2) NOT NULL DEFAULT 0,
  total_payable_amt               numeric(14,2),
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
-- "G. TOTAL + GST" defaults to a flat 5% GST (2.5% CGST + 2.5% SGST) when
-- no per-bill GST rate is picked (gst_rate_pct IS NULL — every bill
-- entered before the GST feature existed, see
-- db/2026-08-17-purchase-bills-gst.sql), otherwise uses the real selected
-- rate, doubled (CGST+SGST or IGST both total the same tax — see that
-- migration's comment), plus round_off_amt (see
-- db/2026-08-17-purchase-bills-round-off.sql).
CREATE TABLE purchase_bills (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_party_id         uuid NOT NULL REFERENCES parties(id),
  vendor_invoice_no        text NOT NULL,
  vendor_invoice_date       date,
  qty                        integer NOT NULL DEFAULT 1,
  sq_feet                     numeric(10,2) NOT NULL DEFAULT 0,
  -- 2026-08-17: which unit `sq_feet` (and thus unit_rate) is actually in —
  -- vendor's rate is always quoted per whatever unit THEY billed in, so
  -- this must travel with the quantity rather than always assuming feet
  -- (see db/2026-08-17-purchase-bills-qty-unit.sql — a real financial bug
  -- otherwise, e.g. MTR quantity x per-MTR rate silently inflated ~3.28x
  -- if converted to feet first).
  -- 2026-08-27: 'PCS' added — some vendors bill by piece count with a rate
  -- PER PIECE, not by size (e.g. garment vendors: "16 PCS @ Rs.260/pc", no
  -- length/area at all). The app sends sq_feet = 1 whenever qty_unit =
  -- 'PCS', so the existing total_amount formula below (qty * sq_feet *
  -- unit_rate) collapses to qty * rate-per-piece with no formula change —
  -- see db/2026-08-27-purchase-bills-pcs-unit.sql.
  qty_unit                     text NOT NULL DEFAULT 'FT'
                                  CHECK (qty_unit IN ('FT', 'MTR', 'INCH', 'YARD', 'CM', 'PCS')),
  work_description             text,        -- "WORK1" in the source — general purpose confirmed 2026-08-04, see SCHEMA_NOTES.md #6
  unit_rate                     numeric(14,2) NOT NULL DEFAULT 0,
  order_id                       uuid REFERENCES orders(id),   -- optional make-to-order reference (added 2026-08 round)
  -- 2026-08-17: purchase_bills never had its own company_id — it was
  -- always derived from order_id -> orders.company_id, which only works
  -- when an order is linked. Raw-material general-stock purchases have no
  -- order to derive it from, so this is a real column now: set from the
  -- linked order when there is one, or the entering employee's currently
  -- selected company otherwise (see
  -- db/2026-08-17-purchase-bills-optional-order-company-id.sql).
  company_id                     uuid REFERENCES companies(id),
  -- 2026-08-17: manual per-bill CGST+SGST/IGST choice (checked live —
  -- most vendor parties have no GST number on file, so auto-deciding
  -- isn't reliable). gst_rate_pct is the CGST/SGST INDIVIDUAL rate — total
  -- GST is always double this, however it's itemized (see
  -- db/2026-08-17-purchase-bills-gst.sql). Both nullable — no rate picked
  -- keeps the historical flat-5% g_total_plus_gst fallback below.
  gst_rate_pct                   numeric(4,2) CHECK (gst_rate_pct IN (2.5, 3, 4, 9)),
  gst_type                       text CHECK (gst_type IN ('CGST_SGST', 'IGST')),
  -- 2026-08-17: manual signed adjustment so the system total can match a
  -- vendor invoice that itself rounds off by a few paise (e.g. -0.30) —
  -- see db/2026-08-17-purchase-bills-round-off.sql. CHECK just guards
  -- against a fat-fingered full amount landing in this field by mistake;
  -- a real round-off is always small.
  round_off_amt                   numeric(8,2) NOT NULL DEFAULT 0
                                     CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000),
  -- TOTAL SQ FEET = QTY * SQ FEET, then TOTAL AMOUNT = TOTAL SQ FEET * UNIT
  -- RATE — inlined fully (qty * sq_feet * unit_rate) since a generated
  -- column can't reference another generated column.
  total_sq_feet                   numeric(14,2) GENERATED ALWAYS AS (qty * sq_feet) STORED,
  total_amount                     numeric(14,2) GENERATED ALWAYS AS (qty * sq_feet * unit_rate) STORED,
  g_total_plus_gst                  numeric(14,2) GENERATED ALWAYS AS (
                                       (qty * sq_feet * unit_rate)
                                       + (qty * sq_feet * unit_rate) * (CASE WHEN gst_rate_pct IS NOT NULL THEN gst_rate_pct * 2 ELSE 5 END / 100)
                                       + round_off_amt
                                     ) STORED,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  -- 2026-08-12 (round 10): "JIS JIS PO RF RG NO KO SELECT KARE UNKE LIYE
  -- JO PARTY INVOICE DALE VO SABHI ME UPDATE HO JAYE" — one vendor invoice
  -- legitimately covers many orders now (Purchase Bill multi-PO select),
  -- so the same (vendor, invoice_no) pair appears on several rows, one per
  -- order. Widened from UNIQUE(vendor_party_id, vendor_invoice_no) to also
  -- key on order_id — a true duplicate is now "same vendor, same invoice,
  -- same order", not "same vendor, same invoice" alone.
  UNIQUE (vendor_party_id, vendor_invoice_no, order_id)
);
CREATE INDEX idx_purchase_bills_order ON purchase_bills(order_id);
CREATE INDEX idx_purchase_bills_company ON purchase_bills(company_id);

-- Inventory / Stock for finished goods (pending item 4, 2026-08-08) — see
-- db/2026-08-08-inventory-finished-stock.sql for the full design. A
-- DIFFERENT code space from the raw-material stock_items/stock_in/stock_out
-- module below — keyed the same loose free-text way orders themselves
-- store SKU/Size.
CREATE TABLE finished_stock (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_category_id  uuid NOT NULL REFERENCES item_categories(id),
  sku_label         text NOT NULL DEFAULT '',
  size_label        text NOT NULL DEFAULT '',
  qty               integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_category_id, sku_label, size_label)
);
CREATE TABLE finished_stock_movements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_category_id      uuid NOT NULL REFERENCES item_categories(id),
  sku_label             text NOT NULL DEFAULT '',
  size_label            text NOT NULL DEFAULT '',
  qty_change            integer NOT NULL,
  reason                text NOT NULL,
  order_id              uuid REFERENCES orders(id),
  entry_by_employee_id  uuid REFERENCES employees(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_finished_stock_movements_order ON finished_stock_movements(order_id);


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

-- Gap 1 (multi-package per order, 2026-08-20) — one row per real AWB used
-- for an order (an order can now have more than one, or several packages
-- can share one AWB — see claude/gap1-multipackage-design-2026-08-20.md
-- and db/2026-08-20-order-shipments-and-packages.sql for the full design).
-- order_packages (below) is the physical-box breakdown FK'd to whichever
-- shipment/AWB it travels under. dispatch_invoices stays as an order-level
-- SUMMARY kept in sync from these by src/lib/order-packages/resync-
-- dispatch-summary.ts, not restructured.
CREATE TABLE order_shipments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                uuid NOT NULL REFERENCES orders(id),
  shipment_no             integer NOT NULL,   -- 1-based; "shipment i of N" when an order has >1 AWB
  courier_name            text,
  awb_no                  text,
  delivered_status        delivered_status,
  delivered_date          date,
  last_update_date        date,
  remark                  text,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (shipment_no > 0),
  UNIQUE (order_id, shipment_no)
);
CREATE INDEX idx_order_shipments_order ON order_shipments(order_id);
CREATE INDEX idx_order_shipments_awb   ON order_shipments(awb_no);

CREATE TABLE order_packages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_shipment_id  uuid NOT NULL REFERENCES order_shipments(id),
  package_no         integer NOT NULL,   -- 1-based within the shipment — "i of N" on the physical label
  weight_kg          numeric(10,3),
  length_cm          numeric(10,2),
  width_cm           numeric(10,2),
  height_cm          numeric(10,2),
  volumetric_weight  numeric(10,3),
  remark             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (package_no > 0),
  UNIQUE (order_shipment_id, package_no)
);
CREATE INDEX idx_order_packages_shipment ON order_packages(order_shipment_id);

-- 2026-08-24: audit log + automation rules engine — see
-- db/2026-08-24-audit-log.sql and db/2026-08-24-automation-rules.sql for
-- the full design rationale.
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid REFERENCES companies(id),
  employee_id   uuid REFERENCES employees(id),
  employee_name text NOT NULL,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid,
  entity_label  text,
  changes       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_company_date ON audit_log(company_id, created_at DESC);
CREATE INDEX idx_audit_log_entity        ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_employee      ON audit_log(employee_id, created_at DESC);

CREATE TABLE automation_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid REFERENCES companies(id),
  name                   text NOT NULL,
  trigger_type           text NOT NULL,
  enabled                boolean NOT NULL DEFAULT true,
  conditions             jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions                jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_employee_id uuid REFERENCES employees(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  fire_count             integer NOT NULL DEFAULT 0,
  last_fired_at          timestamptz
);
CREATE INDEX idx_automation_rules_trigger ON automation_rules(trigger_type) WHERE enabled = true;

CREATE TABLE automation_rule_logs (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id  uuid NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id),
  fired_at timestamptz NOT NULL DEFAULT now(),
  result   text NOT NULL,
  detail   text
);
CREATE INDEX idx_automation_rule_logs_rule ON automation_rule_logs(rule_id, fired_at DESC);

CREATE TABLE freight_bill_awb_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freight_bill_id   uuid NOT NULL REFERENCES freight_bills(id),
  order_id           uuid NOT NULL REFERENCES orders(id),   -- denormalized from order_shipment_id for existing joins/display
  order_shipment_id    uuid NOT NULL REFERENCES order_shipments(id),  -- the actual 1-AWB-per-assignment unit (Gap 1, 2026-08-20)
  bill_weight_kg       numeric(10,3),    -- off the physical courier bill — not derivable from anything on file
  difference_amt         numeric(14,2), -- MANUAL — see comment on freight_bills.gross_total_amt / original author's note
  -- 2026-08-12 (round 10): "Dimensional weight" — present on the real
  -- Freight Bill Excel, no package-dimension data exists anywhere else in
  -- this schema to derive it from, so it's a manual entry alongside
  -- bill_weight_kg. Per-AWB credit/debit note — "COURIOR KA CREDIT NOTE YA
  -- DEBIT NOTE... TRACKING NUMBER KE AGAINST ME AAYEGA" — for when a note
  -- applies to one specific shipment rather than the whole invoice (the
  -- whole-bill-level credit note fields stay on freight_bills itself).
  dimensional_weight_kg    numeric(10,3),
  credit_note_no             text,
  credit_note_date            date,
  credit_note_amt               numeric(14,2),
  debit_note_no                   text,
  debit_note_date                  date,
  debit_note_amt                     numeric(14,2),
  remark                  text,
  UNIQUE (order_shipment_id)   -- one AWB is billed under exactly one freight invoice (Gap 1, 2026-08-20 — was UNIQUE(order_id))
);
CREATE INDEX idx_freight_awb_assign_bill ON freight_bill_awb_assignments(freight_bill_id);
CREATE INDEX idx_freight_awb_assign_shipment ON freight_bill_awb_assignments(order_shipment_id);

CREATE TABLE duty_bill_awb_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_tax_bill_id   uuid NOT NULL REFERENCES duty_tax_bills(id),
  order_id            uuid NOT NULL REFERENCES orders(id),   -- denormalized from order_shipment_id for existing joins/display
  order_shipment_id      uuid NOT NULL REFERENCES order_shipments(id),  -- Gap 1, 2026-08-20 — see freight_bill_awb_assignments above
  duty_tax_amt_usd      numeric(14,2),
  duty_tax_amt_inr        numeric(14,2),
  other_charge              numeric(14,2),
  gst_18pct                  numeric(14,2),
  -- 2026-08-12 (round 10): same per-AWB credit/debit note capture as
  -- freight_bill_awb_assignments above.
  credit_note_no               text,
  credit_note_date               date,
  credit_note_amt                  numeric(14,2),
  debit_note_no                      text,
  debit_note_date                     date,
  debit_note_amt                        numeric(14,2),
  remark                      text,
  UNIQUE (order_shipment_id)
);
CREATE INDEX idx_duty_awb_assign_bill ON duty_bill_awb_assignments(duty_tax_bill_id);
CREATE INDEX idx_duty_awb_assign_shipment ON duty_bill_awb_assignments(order_shipment_id);

-- The recomputed/looked-up part of the old Freight Reconciliation sheet
-- (everything that was an INDEX/MATCH-by-AWB formula pulling from Dispatch
-- & Invoice) — a straight VIEW joining the manual assignment table above to
-- dispatch_invoices/orders. Column-for-column mapping verified against the
-- old sheet's own di_lookup() calls in build.py (e.g. its "M" GST 18% AMT.
-- lookup is Dispatch & Invoice's SECOND gst column — courier_shipping_
-- charge_without_gst's paired amount — not the first "GST 18%" used inside
-- TOTAL AMT; both are modeled as separate columns on dispatch_invoices).
-- Gap 1 (2026-08-20): awb_no/our_weight/dimensional_weight now pull from
-- the SPECIFIC order_shipments/order_packages row this assignment points
-- at (accurate per-AWB), not dispatch_invoices' order-level summary (which
-- can be a multi-value join once an order has >1 AWB) — di.* stays for the
-- order-level billing figures (charges, gst, invoice_no), which are out of
-- scope for the per-package rearchitecture this round.
--
-- 2026-08-20 (order-value fix): org_sale_amt_inr is now o.order_value_inr
-- (orders), not di.org_sale_amt_inr (dispatch_invoices). The latter is a
-- dead column — nothing in the app writes it, it only ever got a value
-- from the one-time historical import — so every order dispatched since
-- then showed a 0.00 Sale Amt / shipping_pct here. order_value_inr is
-- app-computed on every order insert/edit (see orders table comment
-- above) and is the one true "order value" everywhere revenue/% is
-- computed from; sales_invoices.invoice_value_usd/inr stays completely
-- separate — that's the invoice DOCUMENT's own figure, unrelated to this.
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
  COALESCE(os.awb_no, di.awb_no) AS awb_no,
  di.buyer_country,
  o.order_value_inr          AS org_sale_amt_inr,
  di.our_freight_amt         AS our_shipping_amt,
  di.demand_surcharge_other_charge AS other_charges,
  di.total_amt                AS total_shipping_amt,
  di.gst_18pct_amt             AS gst_18pct,   -- Dispatch & Invoice's 2nd GST column — see comment above
  (COALESCE(di.total_amt,0) + COALESCE(di.gst_18pct_amt,0)) AS gross_shipping_amt,
  COALESCE((SELECT SUM(op.weight_kg) FROM order_packages op WHERE op.order_shipment_id = os.id), di.shipping_weight_kg)::numeric(10,3) AS our_weight,
  a.bill_weight_kg,
  COALESCE((SELECT SUM(op.volumetric_weight) FROM order_packages op WHERE op.order_shipment_id = os.id), di.volumetric_weight)::numeric(10,3) AS dimensional_weight,
  a.difference_amt,               -- MANUAL, see comment on freight_bill_awb_assignments
  CASE WHEN COALESCE(o.order_value_inr, 0) = 0 THEN NULL
       ELSE (COALESCE(di.total_amt,0) + COALESCE(di.gst_18pct_amt,0)) / o.order_value_inr END AS shipping_pct,
  a.remark
FROM freight_bill_awb_assignments a
JOIN freight_bills fb        ON fb.id = a.freight_bill_id
JOIN orders o                 ON o.id = a.order_id
LEFT JOIN order_shipments os   ON os.id = a.order_shipment_id
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
-- 2026-08-20 (order-value fix): same fix as freight_reconciliation_view
-- above — org_sale_amt_inr here is now o.order_value_inr, not the dead
-- di.org_sale_amt_inr. See that view's comment for the full why.
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
  COALESCE(os.awb_no, di.awb_no) AS awb_no,
  di.buyer_country,
  o.order_value_inr AS org_sale_amt_inr,
  frv.gross_shipping_amt         AS shipping_amt,
  a.duty_tax_amt_usd,
  a.duty_tax_amt_inr,
  a.other_charge,
  a.gst_18pct,
  (COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) AS duty_gross_amt,
  (COALESCE(frv.gross_shipping_amt,0) + COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) AS shipping_and_duty,
  CASE WHEN COALESCE(o.order_value_inr,0) = 0 THEN NULL
       ELSE (COALESCE(frv.gross_shipping_amt,0) + COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) / o.order_value_inr
  END AS shipping_and_duty_pct,
  CASE WHEN COALESCE(o.order_value_inr,0) = 0 THEN NULL ELSE frv.gross_shipping_amt / o.order_value_inr END AS shipping_pct,
  CASE WHEN COALESCE(o.order_value_inr,0) = 0 THEN NULL
       ELSE (COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) / o.order_value_inr
  END AS duty_pct,
  a.remark
FROM duty_bill_awb_assignments a
JOIN duty_tax_bills dtb        ON dtb.id = a.duty_tax_bill_id
JOIN orders o                   ON o.id = a.order_id
LEFT JOIN order_shipments os     ON os.id = a.order_shipment_id
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

-- Order Hold/Cancel/Refund (pending item 2, 2026-08-08) — see
-- db/2026-08-08-order-hold-cancel-refund.sql for the full design. One row
-- per refund entered against a cancelled OR returned order (see
-- db/2026-08-25-return-status-and-refund-breakdown.sql); credit_note_id is
-- set only for the dispatched-and-invoiced path (application logic decides
-- that, not a DB trigger).
--
-- 2026-08-25 — user's own clarification, verbatim: an order with no work
-- done on it that gets cancelled needs no Credit Note, just a row here
-- (order.status stays 'Cancelled'). An order that WAS invoiced/dispatched/
-- delivered, and the buyer returns it post-delivery for a customer-
-- satisfaction refund, is NOT a cancellation — "order to dispatch kar diya
-- cancel thodi hua hai" — so that path now sets order.status to 'Returned'
-- instead (see the returnOrder action, orders/actions.ts) while still
-- generating a Credit Note exactly like the Cancel path does, keyed off the
-- same order.invoice_id check. `refund_basis_percent`/`*_refund_amount`
-- below capture the optional %-of-order-value + shipping + duty/tax
-- breakdown the refund calculator now offers — `refund_amount` (above)
-- stays the single authoritative total (auto-filled from the breakdown,
-- but always manually editable — "case-by-case decide karna padta hai"
-- remains the rule, this is a convenience calculator, not a rigid formula).
CREATE TABLE order_refunds (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                  uuid NOT NULL REFERENCES orders(id),
  refund_amount             numeric(14,2) NOT NULL CHECK (refund_amount >= 0),
  refund_currency           varchar(3) NOT NULL REFERENCES currencies(code),
  refund_date               date NOT NULL,
  reason                    text,
  credit_note_id            uuid REFERENCES credit_notes(id),
  entry_by_employee_id      uuid NOT NULL REFERENCES employees(id),
  -- NULL = fully manual entry, calculator not used. Otherwise the % of
  -- order_value_original picked from the 10–100% dropdown.
  refund_basis_percent      numeric(5,2),
  order_value_refund_amount numeric(14,2) NOT NULL DEFAULT 0,
  shipping_refund_amount    numeric(14,2) NOT NULL DEFAULT 0,
  duty_refund_amount        numeric(14,2) NOT NULL DEFAULT 0,
  -- App-computed at save time via the SAME computeCurrencyConversion()
  -- every order's own order_value_usd/order_value_inr uses (official
  -- Exchange Rate Master rate as of refund_date, live-rate fallback, else
  -- left NULL) — regardless of refund_currency, so a refund in EUR (or any
  -- other currency) still nets correctly against INR-denominated revenue.
  -- Used by pl_dashboard_by_company_view / pl_dashboard_by_month_view /
  -- the Sale & Profit report to net a refunded order's revenue against its
  -- refund(s) — 2026-08-25, user confirmed ("ha kar do isko bhi").
  refund_amount_inr         numeric(14,2),
  refund_amount_usd         numeric(14,2),
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_refunds_order ON order_refunds(order_id);

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

-- 2026-08-06: customer-facing export sales invoice (CSB-V/CSB-IV) — item
-- from claude/pending-feature-requests-2026-08-06.md + fully scoped in
-- claude/invoice-origin-declarations-and-numbering.md. NOT the same thing
-- as `internal_invoices` above (that's company-to-company, no customs
-- content at all) — kept as a clearly separate table rather than
-- overloading one "invoices" table with two unrelated shapes.
--
-- One sales_invoice covers one OR MORE `orders` rows (a buyer-batch that
-- ships together — see orders.ref_no_base) via orders.invoice_id below,
-- rather than duplicating line-item data here; the invoice's own item
-- table is built by querying orders WHERE invoice_id = this row's id.
--
-- Numbering: invoice_no uses the order's STORE's invoice_ref_prefix (e.g.
-- "NL"), master_invoice_no uses the COMPANY's master_invoice_prefix (e.g.
-- "NYM") — both via format_invoice_no(), both reserved through
-- reserve_next_number() at generation time in application code (same
-- "app reserves, not a DB trigger" reasoning as orders.ref_no — see that
-- column's comment — because which store's prefix to use depends on which
-- orders were picked, which the DB can't know before the row exists).
CREATE TABLE sales_invoices (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL REFERENCES companies(id),
  store_id                     uuid NOT NULL REFERENCES stores(id),   -- whose invoice_ref_prefix was used
  invoice_no                     text NOT NULL,
  master_invoice_no                text NOT NULL,
  invoice_date                       date NOT NULL DEFAULT CURRENT_DATE,

  -- Shipment Term deliberately free text, not an enum — real samples show
  -- more than just DDP/DDU (see section 6 of the invoice notes doc).
  shipment_term                        text NOT NULL,
  csb_type                               text NOT NULL CHECK (csb_type IN ('CSB-V', 'CSB-IV')),
  courier_company                          text NOT NULL,

  -- FedEx-only, auto-generated per section 2 of the invoice notes doc
  -- (<SCHEME>/N/<TERM>/B/E/-/<DDMMYY>, SCHEME = CS5 for CSB-V / CS4 for
  -- CSB-IV) — application-computed at generation time, stored (not a
  -- generated column) because it's editable afterward like everything else
  -- on an invoice before it's finalized/printed.
  department_reference_no                    text,

  destination_country                          text,
  -- Origin declaration text, auto-selected by destination_country per
  -- section 1 of the invoice notes doc, always editable afterward — same
  -- "generate once into an editable field, never auto-resynced" pattern as
  -- HR Letters' bodyTemplate (see letter-form.tsx).
  origin_declaration                             text,

  -- Per-order (not per-company) — user confirmed 2026-08-06 this is typed
  -- in at invoice time, only when applicable (see section 1c).
  ioss_number                                      text,

  -- 2026-08-08: "WEIGHT OR DIMENSION KYU NAHI MANG RAHA" — customs
  -- declaration needs the shipment's own weight/dimensions typed in AT
  -- invoice time (may differ from whatever dispatch_invoices.shipping_
  -- weight_kg/length_cm/etc. later records for freight-billing purposes —
  -- deliberately a SEPARATE value, not a read of that table, per user's
  -- choice among the options presented). Nullable/optional like the other
  -- editable-afterward invoice fields above.
  weight_kg                                          numeric(10,3),
  length_cm                                          numeric(10,2),
  width_cm                                           numeric(10,2),
  height_cm                                          numeric(10,2),

  buyer_name_address                                 text NOT NULL,   -- copied from the order(s) at generation time, editable
  remark                                               text,

  -- Value breakdown (2026-08-10) — see db/2026-08-10-invoice-value-
  -- breakdown.sql's header comment for the full formula (verified against
  -- a real sample invoice). value_percent/invoice_value_usd/
  -- item_cost_total/insurance_total/freight_total are auto-computed for
  -- CSB-V (marketplace-based 60%, see value-breakdown.ts), left NULL/manual for CSB-IV.
  value_percent                                          numeric(5,2),
  -- 2026-08-11: despite the "_usd" suffix (kept unchanged to avoid a
  -- disruptive rename across every consumer of this column), these 4
  -- totals are in whatever currency invoice_currency below says — CSB-V
  -- now follows the order's own order_currency instead of always USD (see
  -- value-breakdown.ts). For any invoice generated before this change,
  -- invoice_currency is NULL and these are exactly what they always were:
  -- USD (CSB-V) or the order's own currency (CSB-IV, unchanged either way).
  invoice_value_usd                                      numeric(14,2),
  item_cost_total                                        numeric(14,2),
  insurance_total                                        numeric(14,2),
  freight_total                                          numeric(14,2),
  invoice_currency                                       text,   -- see comment above; NULL = legacy invoice, infer as before
  taxable_value_inr                                      numeric(14,2),
  declared_value_words                                   text,

  -- Fuller customs-invoice detail fields (2026-08-10) — see the same
  -- migration file's header comment.
  awb_no                                                 text,
  vessel_flight_no                                       text,
  port_of_discharge                                      text,
  marks_and_nos                                          text,
  no_of_packages                                         integer,
  buyer_email                                            text,
  buyer_phone                                            text,
  other_than_consignee                                   text,
  vat_number                                             text,
  eori_number                                            text,

  -- Broker + Duty Payable block (2026-08-11) — "if there is a designated
  -- broker for this shipment, please provide contact information" +
  -- "Duty & Taxes payable by () Exporter () Consignee () Other". broker_*
  -- are plain manual entry (usually blank — most shipments have no
  -- separate customs broker). duty_payable_by is auto-derived at
  -- generation time from shipment_term (DDP -> Exporter, DDU/DAP ->
  -- Consignee, else left NULL for the preparer to pick manually) — see
  -- src/lib/invoices/duty-payable.ts — but stays freely editable
  -- afterward like every other field on this table.
  broker_name                                            text,
  broker_tel                                             text,
  broker_contact                                         text,
  duty_payable_by                                        text CHECK (duty_payable_by IN ('Exporter', 'Consignee', 'Other')),
  duty_payable_other_specify                             text,

  created_by_employee_id                                 uuid NOT NULL REFERENCES employees(id),
  created_at                                               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, invoice_no)
);
CREATE INDEX idx_sales_invoices_company ON sales_invoices(company_id);

COMMENT ON TABLE sales_invoices IS
  'PID (Product Identifier) block for EU B2C orders — section 1b of the invoice notes doc — is deliberately '
  'NOT implemented yet: user asked (2026-08-06) to discuss the Manufacturer Product ID / GTIN fallback '
  'approach separately before building it. Every other section (origin declaration, numbering, Department '
  'Reference No., HSN, exporter block) is built.';

-- Added here (not on the `orders` table above, at its original definition)
-- because it references sales_invoices, which is defined after orders in
-- this file. One or more orders (a buyer-batch) point at the same invoice
-- once generated; NULL = not yet invoiced.
ALTER TABLE orders ADD COLUMN invoice_id uuid REFERENCES sales_invoices(id);
CREATE INDEX idx_orders_invoice ON orders(invoice_id);


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
  -- 2026-08-12: employee_id identifies WHICH employee a Salary/Advance row
  -- is for (party_id stays NULL for these — an employee isn't a vendor
  -- party). source/source_id are a loose (deliberately not-FK'd, same
  -- convention as this table's own comment below) pointer back to
  -- whichever salary_payments/employee_advances row auto-inserted this —
  -- NULL/NULL means it was typed in directly, same as every vendor bill.
  employee_id                                                            uuid REFERENCES employees(id),
  source                                                                   text,
  source_id                                                                  uuid,
  -- 2026-08-12 (round 11): new 2-level approval workflow (Approvals L1/L2
  -- dashboard tiles) — see bill_approval_status's own comment above and
  -- db/2026-08-12-round11-unbuilt-dashboard-sections.sql.
  approval_status   bill_approval_status NOT NULL DEFAULT 'Pending',
  approved_l1_by    uuid REFERENCES employees(id),
  approved_l1_at    timestamptz,
  approved_l2_by    uuid REFERENCES employees(id),
  approved_l2_at    timestamptz,
  rejected_by       uuid REFERENCES employees(id),
  rejected_at       timestamptz,
  rejection_reason  text,
  created_at                                                            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bill_pass_company  ON bill_pass_register(company_id);
CREATE INDEX idx_bill_pass_party    ON bill_pass_register(party_id);
CREATE INDEX idx_bill_pass_employee ON bill_pass_register(employee_id);
CREATE INDEX idx_bill_pass_approval_status ON bill_pass_register(approval_status);

-- 2026-08-18 perf fix — bill-payment/page.tsx's main query is
-- `.eq(company_id).gt(balance_due, 0).order(due_date)`; idx_bill_pass_company
-- above covers the company_id half but Postgres still has to sort every
-- matching row by due_date and filter balance_due in-memory. A partial
-- index matching this exact WHERE clause lets it satisfy the whole query
-- (filter + sort) from the index alone. See db/2026-08-18-bill-pass-due-date-index.sql.
CREATE INDEX idx_bill_pass_company_due_date ON bill_pass_register(company_id, due_date) WHERE balance_due > 0;

-- 2026-08-12 (round 11): payment ledger backing the "Bill Payment"
-- dashboard tile — bill_pass_register.total_paid (above) is recomputed as
-- SUM(amount) over this table on every insert (see
-- src/app/dashboard/bill-payment/actions.ts) rather than edited by hand.
CREATE TABLE bill_pass_register_payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_pass_register_id    uuid NOT NULL REFERENCES bill_pass_register(id) ON DELETE CASCADE,
  amount                     numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_date                  date NOT NULL,
  payment_mode                     text,     -- NEFT / RTGS / Cheque / Cash / UPI — free text, no fixed list given
  reference_no                        text,  -- cheque no. / UTR / transaction ref
  remark                                 text,
  entered_by                                uuid REFERENCES employees(id),
  entered_on                                   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bpr_payments_bill ON bill_pass_register_payments(bill_pass_register_id);
-- 2026-08-12 (round 10): also auto-inserted for purchase_bills (source=
-- 'purchase_bill', unambiguous — order_id always resolves one company) and,
-- via an explicit reviewed "Send to Bill Pass Register" action, for
-- freight_bills/duty_tax_bills (source='freight_bill'/'duty_tax_bill') —
-- those two stay a manual confirm step because one invoice can span AWBs
-- across multiple companies with no stored split, so the company can't be
-- inferred safely; see actions.ts. UNIQUE (not a plain index) so a second
-- insert for the same (source, source_id) — e.g. a raced double-submit of
-- "Send to Bill Pass Register" — fails at the DB level instead of silently
-- double-posting; the app's own check-then-insert is only the first line
-- of defense, this is the real backstop.
CREATE UNIQUE INDEX uq_bill_pass_register_source
  ON bill_pass_register(source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;
COMMENT ON TABLE bill_pass_register IS
  'Old sheets: "RUG ARA-ALL BILLS" / "NYKO MART-ALL BILLS" master bill-pass ledgers, unified into one table '
  'with company_id replacing "one workbook per company". Deliberately NOT strictly FK''d to freight_bills / '
  'duty_tax_bills / purchase_bills — the source data doesn''t establish that mapping, so forcing it now risks '
  'guessing; this stays its own standalone payable ledger (see SCHEMA_NOTES.md open question #9). '
  '2026-08-12: also the single Finance-visible ledger for Salary/Advance payouts (employee_id set, party_id '
  'NULL) alongside every vendor/courier bill (party_id set, employee_id NULL) — see salary_payments / '
  'employee_advances below.';
COMMENT ON COLUMN bill_pass_register.source IS
  'NULL = manually entered (vendor/courier bill, typed in directly). ''salary_payment'' / ''employee_advance'' / '
  '''purchase_bill'' = auto-inserted the moment the source row is saved (company unambiguous in all 3 cases). '
  '''freight_bill'' / ''duty_tax_bill'' = inserted via an explicit reviewed "Send to Bill Pass Register" action '
  '(2026-08-12, round 10) since those two invoices can span multiple companies with no stored split.';


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

-- 2026-08-20 — Gap 4 of the "5 real gaps" plan (see
-- claude/five-gaps-implementation-plan-2026-08-20.md and
-- db/2026-08-20-internal-expenses.sql): office/cash overhead (rent,
-- electricity, fuel, etc.) not tied to any purchase order or AWB — a
-- previously-flagged gap (bank-ledger "OFFICE EXP." rows had nowhere to
-- go). Feeds the two P&L views below as a distinct overhead line, kept
-- separate from sale_profit_ledger.total_expenses_inr (per-order
-- marketplace/shipping expense — different meaning) rather than merged
-- into it. category is plain text (validated in actions.ts against an
-- app-level Set, not a DB enum) since the category list is open-ended.
CREATE TABLE internal_expenses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  expense_date            date NOT NULL,
  category                text NOT NULL,
  amount_inr              numeric(14,2) NOT NULL CHECK (amount_inr > 0),
  payment_mode            text,
  remark                  text,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_internal_expenses_company ON internal_expenses(company_id);
CREATE INDEX idx_internal_expenses_date    ON internal_expenses(expense_date);

-- 2026-08-20 (order-value fix, part 2 — P&L goes live): user confirmed P&L
-- should also switch to orders.order_value_inr as its revenue driver
-- instead of only ever reading the CSV-imported sale_profit_ledger. Per
-- the user's own decisions this round: (1) expenses = order-tied Courier +
-- Duty (via freight_reconciliation_view/duty_reconciliation_view, summed
-- per order) PLUS every purchase_bills row company-wide, whether or not
-- it's linked to a specific order (g_total_plus_gst, GST-inclusive — same
-- convention as gross_shipping_amt/duty_gross_amt); (2) month grouping is
-- now orders.order_date (not an invoice date). Cancelled orders are
-- excluded from revenue and expense (a cancelled order isn't a real sale)
-- — Returned stays included, since a return is a fulfilled sale that came
-- back; refunds are handled by the separate `refunds` table, out of scope
-- here. This is an assumption, not a confirmed user decision — flag if
-- Cancelled/Returned handling should differ.
--
-- 2026-08-25 RESOLVED: user confirmed ("ha kar do isko bhi") — Returned
-- (and any other refunded, non-Cancelled) order's revenue here now nets
-- against its refund(s). See `order_refund_totals` in
-- pl_dashboard_by_company_view / pl_dashboard_by_month_view below, and the
-- same fix in src/app/dashboard/reports/sale-profit/page.tsx.
--
-- sale_profit_ledger is NOT dropped and NOT ignored: rows with order_id
-- IS NULL are genuinely historical entries that predate the live `orders`
-- table (per that table's own comment — the Statement Entry CSV-import
-- screen still exists for exactly this backfill case) and have no other
-- source, so they're still added in. Rows WITH an order_id are now
-- skipped here (the live order they point at is already counted via
-- `orders` directly) to avoid double-counting the same sale twice.
CREATE VIEW order_courier_duty_expense_view AS
SELECT
  o.id AS order_id, o.company_id, o.order_date, o.status,
  COALESCE(courier.amt, 0) AS courier_expense_inr,
  COALESCE(duty.amt, 0)    AS duty_expense_inr
FROM orders o
LEFT JOIN (SELECT order_id, SUM(gross_shipping_amt) AS amt FROM freight_reconciliation_view GROUP BY order_id) courier ON courier.order_id = o.id
LEFT JOIN (SELECT order_id, SUM(duty_gross_amt)      AS amt FROM duty_reconciliation_view    GROUP BY order_id) duty    ON duty.order_id    = o.id;
COMMENT ON VIEW order_courier_duty_expense_view IS
  'Per-order Courier+Duty expense (summed across every AWB/shipment on that order), used by the live P&L views '
  'below. Not itself company-scoped in RLS — inherits from `orders`.';

-- 2026-08-25: resolves the "flag if Cancelled/Returned handling should
-- differ" note above — user confirmed Returned-order revenue SHOULD be
-- netted against its refund(s). `order_refund_totals` sums
-- order_refunds.refund_amount_inr (app-computed at save time via the same
-- computeCurrencyConversion() every order value uses — see
-- saveOrderRefund, orders/actions.ts) per order, and total_sale_value_inr
-- below now subtracts it. This covers every refund, not just Returned
-- orders' — including the new goodwill/duty-only refund on an order that
-- stays Dispatched/Delivered (see order-hold-cancel-actions.tsx) — since
-- any money actually paid back to a buyer should reduce recognized
-- revenue regardless of which status button was clicked. Cancelled orders
-- are unaffected either way: their FULL order_value_inr is already
-- excluded by the FILTER below, refund or not.
CREATE VIEW pl_dashboard_by_company_view AS
WITH order_refund_totals AS (
  SELECT order_id, SUM(refund_amount_inr) AS refund_total_inr
  FROM order_refunds
  GROUP BY order_id
),
order_agg AS (
  SELECT o.company_id,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0)) FILTER (WHERE o.status <> 'Cancelled')               AS total_sale_value_inr,
    SUM(COALESCE(cd.courier_expense_inr,0) + COALESCE(cd.duty_expense_inr,0)) FILTER (WHERE o.status <> 'Cancelled') AS order_expenses_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  LEFT JOIN order_refund_totals ort            ON ort.order_id = o.id
  GROUP BY o.company_id
),
purchase_agg AS (
  SELECT company_id, SUM(g_total_plus_gst) AS purchase_expenses_inr
  FROM purchase_bills
  WHERE company_id IS NOT NULL
  GROUP BY company_id
),
historical_agg AS (
  -- pre-`orders`-table CSV backfill rows only — see comment above.
  SELECT company_id, SUM(total_value_inr) AS hist_sale_inr, SUM(total_expenses_inr) AS hist_expense_inr
  FROM sale_profit_ledger
  WHERE order_id IS NULL
  GROUP BY company_id
),
combined AS (
  SELECT
    c.id AS company_id, c.name AS company_name,
    COALESCE(oa.total_sale_value_inr,0) + COALESCE(ha.hist_sale_inr,0) AS total_sale_value_inr,
    COALESCE(oa.order_expenses_inr,0) + COALESCE(pa.purchase_expenses_inr,0) + COALESCE(ha.hist_expense_inr,0) AS total_expenses_inr
  FROM companies c
  LEFT JOIN order_agg oa      ON oa.company_id = c.id
  LEFT JOIN purchase_agg pa   ON pa.company_id = c.id
  LEFT JOIN historical_agg ha ON ha.company_id = c.id
)
SELECT
  combined.company_id, company_name,
  total_sale_value_inr,
  total_expenses_inr,
  (total_sale_value_inr - total_expenses_inr)                          AS net_total_value,
  (total_sale_value_inr * 0.25)                                        AS portal_expenses_25pct,
  ((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) AS net_earn,
  (((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) / NULLIF(total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ie.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) - COALESCE(ie.total_internal_expenses_inr, 0)) AS net_earn_after_overhead
FROM combined
LEFT JOIN (
  SELECT company_id, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses GROUP BY company_id
) ie ON ie.company_id = combined.company_id;
COMMENT ON VIEW pl_dashboard_by_company_view IS
  '2026-08-20: rebuilt to be live off orders.order_value_inr + Courier/Duty reconciliation + purchase_bills '
  '(company-wide) instead of only the CSV-imported sale_profit_ledger — see db/2026-08-20-order-value-fix.sql. '
  'Pre-`orders`-table historical rows in sale_profit_ledger (order_id IS NULL) are still folded in so old '
  'history is not lost.';

-- 2026-08-20: rebuilt off a `months` CTE unioning distinct months from
-- orders.order_date, purchase_bills.vendor_invoice_date, the historical
-- (order_id IS NULL) sale_profit_ledger rows' invoice_date, and
-- internal_expenses — so a month with office expenses but zero sales
-- (e.g. rent paid in a slow month) still appears. Existing 5 columns keep
-- the same name/order/type as before; the 2 new columns are appended at
-- the end. See pl_dashboard_by_company_view's comment above for the same
-- "live orders + company-wide purchase + preserved pre-orders history"
-- design and the Cancelled/Returned assumption.
-- 2026-08-25: same refund-netting as pl_dashboard_by_company_view above —
-- see that view's comment for the full reasoning.
CREATE VIEW pl_dashboard_by_month_view AS
WITH months AS (
  SELECT DISTINCT date_trunc('month', order_date)::date AS month FROM orders WHERE status <> 'Cancelled'
  UNION
  SELECT DISTINCT date_trunc('month', vendor_invoice_date)::date AS month FROM purchase_bills WHERE vendor_invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT date_trunc('month', invoice_date)::date AS month FROM sale_profit_ledger WHERE order_id IS NULL AND invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT date_trunc('month', expense_date)::date AS month FROM internal_expenses
),
order_refund_totals AS (
  SELECT order_id, SUM(refund_amount_inr) AS refund_total_inr
  FROM order_refunds
  GROUP BY order_id
),
order_agg AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0))                                 AS sale_inr,
    SUM(COALESCE(cd.courier_expense_inr,0) + COALESCE(cd.duty_expense_inr,0))                  AS order_expense_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  LEFT JOIN order_refund_totals ort            ON ort.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY date_trunc('month', o.order_date)
),
purchase_agg AS (
  SELECT date_trunc('month', vendor_invoice_date)::date AS month, SUM(g_total_plus_gst) AS purchase_expense_inr
  FROM purchase_bills
  WHERE vendor_invoice_date IS NOT NULL
  GROUP BY date_trunc('month', vendor_invoice_date)
),
historical_agg AS (
  SELECT date_trunc('month', invoice_date)::date AS month,
    SUM(total_value_inr) AS hist_sale_inr, SUM(total_expenses_inr) AS hist_expense_inr
  FROM sale_profit_ledger
  WHERE order_id IS NULL AND invoice_date IS NOT NULL
  GROUP BY date_trunc('month', invoice_date)
),
expense_agg AS (
  SELECT date_trunc('month', expense_date)::date AS month, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses
  GROUP BY date_trunc('month', expense_date)
),
combined AS (
  SELECT
    m.month,
    COALESCE(oa.sale_inr, 0) + COALESCE(ha.hist_sale_inr, 0) AS total_sale_value_inr,
    COALESCE(oa.order_expense_inr, 0) + COALESCE(pa.purchase_expense_inr, 0) + COALESCE(ha.hist_expense_inr, 0) AS total_expenses_inr
  FROM months m
  LEFT JOIN order_agg oa      ON oa.month = m.month
  LEFT JOIN purchase_agg pa   ON pa.month = m.month
  LEFT JOIN historical_agg ha ON ha.month = m.month
)
SELECT
  c.month,
  c.total_sale_value_inr,
  c.total_expenses_inr,
  ((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) AS net_earn,
  (((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) / NULLIF(c.total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ea.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) - COALESCE(ea.total_internal_expenses_inr, 0)) AS net_earn_after_overhead
FROM combined c
LEFT JOIN expense_agg ea ON ea.month = c.month
ORDER BY c.month DESC;
COMMENT ON VIEW pl_dashboard_by_month_view IS
  'Old P&L Dashboard''s month-wise block (previously hardcoded to a trailing 24 months via SUMPRODUCT over '
  'YEAR()/MONTH()) — a view naturally covers all history; LIMIT 24 in the application query if only a '
  'trailing window should be shown. 2026-08-20: rebuilt to be live off orders.order_date/order_value_inr + '
  'Courier/Duty + purchase_bills instead of only sale_profit_ledger — see pl_dashboard_by_company_view''s '
  'comment and db/2026-08-20-order-value-fix.sql.';


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
  -- 2026-08-13: "store par jab order aaya to kon kon si fee lagi vo uske
  -- store ke statement se milani padegi" — auto-extracted from Info (most
  -- row types) or Title (Sale/Refund rows, where Info is blank) so a
  -- store's per-order fees can be looked up by joining on
  -- orders.marketplace_order_no. Verified against a real Jan 2026 export —
  -- every row for a given order repeats "Order #<digits>" verbatim in one
  -- of these 2 columns, always this exact format. See
  -- db/2026-08-13-etsy-order-matching-and-invoice-fix.sql.
  order_number text GENERATED ALWAYS AS (
    COALESCE(substring(info from 'Order #(\d+)'), substring(title from 'Order #(\d+)'))
  ) STORED,
  created_at                           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etsy_ledger_company_date ON etsy_ledger_lines(company_id, txn_date);
CREATE INDEX idx_etsy_ledger_order_number ON etsy_ledger_lines(order_number) WHERE order_number IS NOT NULL;

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

-- 2026-08-13: NEW marketplace — "amazon" (user's own word, ground-up
-- build, ground truth was 2 real "Transactions" report exports: one for
-- amazon.co.uk (GBP), one for amazon.com (USD), same seller ARTS OF
-- JAIPUR / NYKO MART. Order-linked rows (Order Payment/Refund) carry
-- Amazon's own real order ID (format "XXX-XXXXXXX-XXXXXXX") in Order ID
-- — same "native column, no extraction needed" situation as eBay's Tax
-- Invoice Detail. Account-level rows (Service Fees for
-- Subscription/Cost of Advertising/etc., Unavailable balance, Paid to
-- Amazon | Seller repayment) correctly show "---" instead. A few Service
-- Fees rows carry a non-order reference in Order ID instead (a GUID for
-- "Voucher Participation Fee", an "FBA...” code for "FBA Inbound
-- Placement Service Fee") — verified these never collide with Amazon's
-- real dashed order-ID format, so no extra filtering is needed for order
-- matching to stay correct.
-- amazon_fees is signed the same way as Etsy/eBay's fee columns
-- (negative = charge, positive = credited back on a refund) — verified
-- against real Refund rows in both files.
-- currency is NOT parsed from the CSV (the "Total" column's own header
-- literally changes per marketplace — "Total (GBP)" vs "Total (USD)" —
-- so it can't be a single static column-header mapping); each currency's
-- CSV Upload template (see src/lib/statement-import/tables.ts) hardcodes
-- its own currency value + date format instead (see next paragraph). Only
-- GBP and USD are set up so far, since those are the only 2 real exports
-- supplied — a new marketplace/currency needs its own template entry
-- once a real export for it is supplied (not guessed ahead of time).
-- Date format is a REAL per-marketplace landmine: the UK export's Date
-- column is DD/MM/YYYY ("13/08/2026"), the US export's is M/D/YYYY
-- ("8/12/2026") — confirmed against each file's own stated date range in
-- its filename. Postgres' default DateStyle would misparse (or outright
-- reject) one of these if both were imported as plain "date" text, so the
-- importer converts each to ISO before insert based on which currency
-- template was used (see csv-upload/actions.ts's date_dmy/date_mdy
-- column types).
CREATE TABLE amazon_transactions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL REFERENCES companies(id),
  txn_date                     date,
  transaction_status             text,
  transaction_type                 text,
  order_id                           text,   -- Amazon's own order ID, or "---"/a non-order reference for account-level rows — see comment above
  product_details                      text,
  total_product_charges                  numeric(14,2),
  total_promotional_rebates                numeric(14,2),
  amazon_fees                                numeric(14,2),
  other                                         numeric(14,2),
  total_amount                                   numeric(14,2),
  currency                                         varchar(3) NOT NULL,
  created_at                                         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_amazon_txn_company_date ON amazon_transactions(company_id, txn_date);
CREATE INDEX idx_amazon_txn_order_id ON amazon_transactions(order_id) WHERE order_id != '---';

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

-- 2026-08-17 perf fix — was missing the (company_id, date) + order-number
-- index pair that etsy_ledger_lines/amazon_transactions already have; see
-- db/2026-08-17-ebay-indexes-and-order-status-rpc.sql.
CREATE INDEX idx_ebay_tax_company_date ON ebay_tax_invoice_lines(company_id, txn_date);
CREATE INDEX idx_ebay_tax_order_number ON ebay_tax_invoice_lines(order_number) WHERE order_number IS NOT NULL;

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
  -- 2026-08-13: a real Jan 2026 invoice showed a SECOND, flat "Listing
  -- Fees" line with no stated qty/unit price (distinct from the qty-based
  -- one above) — confirmed by the invoice's own Subtotal only reconciling
  -- once this is included. See db/2026-08-13-etsy-order-matching-and-
  -- invoice-fix.sql.
  listing_fees_other                          numeric(14,2) NOT NULL DEFAULT 0,
  transaction_fees                              numeric(14,2) NOT NULL DEFAULT 0,
  -- 2026-08-13: real Feb-Jul 2026 invoices showed 2 more real line-item
  -- shapes the Jan-only sample hadn't revealed yet — verified against all
  -- 7 months (Jan-Jul 2026) real PDFs, not guessed:
  --  1) a THIRD, distinct "Renew Fees" line (qty x $0.20), separate from
  --     "Renew Expired Fees"/"Renew Sold Fees" below — seen in the real
  --     March 2026 invoice (qty 1, INR19).
  --  2) "Renew Expired Fees" and "Renew Sold Fees" can EACH also carry a
  --     second, flat "--"-priced line (same shape as listing_fees_other
  --     above) alongside their qty-based line — seen in Mar/Apr/May/Jun.
  -- Mirrors listing_fees/listing_fees_other's qty+flat pattern so the
  -- Statement Entry form can be filled in exactly line-by-line off the
  -- real PDF without the user having to hand-sum two rows themselves.
  renew_fees_qty                                  integer NOT NULL DEFAULT 0,
  renew_fees                                        numeric(14,2) NOT NULL DEFAULT 0,
  renew_expired_fees_qty                          integer NOT NULL DEFAULT 0,
  renew_expired_fees                                numeric(14,2) NOT NULL DEFAULT 0,
  renew_expired_fees_other                            numeric(14,2) NOT NULL DEFAULT 0,
  renew_sold_fees_qty                                 integer NOT NULL DEFAULT 0,
  renew_sold_fees                                       numeric(14,2) NOT NULL DEFAULT 0,
  renew_sold_fees_other                                   numeric(14,2) NOT NULL DEFAULT 0,
  etsy_ads_fees                                           numeric(14,2) NOT NULL DEFAULT 0,
  processing_fees                                           numeric(14,2) NOT NULL DEFAULT 0,
  offsite_ads_fees                                            numeric(14,2) NOT NULL DEFAULT 0,
  regulatory_operating_fees                                     numeric(14,2) NOT NULL DEFAULT 0,
  promotional_discount                                            numeric(14,2) NOT NULL DEFAULT 0,
  gst_pct                                                           numeric(6,4) NOT NULL DEFAULT 0,
  total_eur                                                           numeric(14,2),
  -- Subtotal = sum of every real fee column above minus the promotional
  -- discount; GST Amount = Subtotal * GST %; Total = Subtotal + GST
  -- Amount. All 3 inlined (can't chain generated columns). Verified
  -- 2026-08-13 against ALL 7 real Jan-Jul 2026 invoices (not just Jan) by
  -- re-summing every printed line item in Python and comparing to each
  -- invoice's own printed Subtotal: residuals were +2/-1/-3/0/+3/-1/-1
  -- rupees respectively — always a couple of rupees either direction,
  -- never growing. This is the SAME disclosed rounding artifact the
  -- original 2026-08-01 build already flagged (Etsy rounds each line to
  -- the nearest rupee before printing, so summing the already-rounded
  -- lines doesn't perfectly equal the PDF's own separately-rounded
  -- Subtotal) — not a formula defect. If a future invoice shows a gap
  -- much bigger than a few rupees, that's worth re-examining.
  subtotal_inr numeric(14,2) GENERATED ALWAYS AS (
    subscription_plan_fees + listing_fees + listing_fees_other + transaction_fees
    + renew_fees + renew_expired_fees + renew_expired_fees_other + renew_sold_fees + renew_sold_fees_other
    + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount
  ) STORED,
  gst_amount_inr numeric(14,2) GENERATED ALWAYS AS (
    (subscription_plan_fees + listing_fees + listing_fees_other + transaction_fees
     + renew_fees + renew_expired_fees + renew_expired_fees_other + renew_sold_fees + renew_sold_fees_other
     + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount)
    * gst_pct
  ) STORED,
  total_inr numeric(14,2) GENERATED ALWAYS AS (
    (subscription_plan_fees + listing_fees + listing_fees_other + transaction_fees
     + renew_fees + renew_expired_fees + renew_expired_fees_other + renew_sold_fees + renew_sold_fees_other
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

-- 2026-08-13: "eBay Financial statement" — a DIFFERENT, simpler PDF report
-- from ebay_financial_summary above (real eBay Commerce Inc. filename
-- "Financial_StatementXxx0126.pdf", vs. the older/richer "Financial
-- Summary Report" the table above was built from). This one is a monthly
-- running-balance statement: opening funds carries forward as next
-- month's opening funds (verified: Jan's Closing 0.00 = Feb's Opening
-- 0.00; Apr's Closing 153.43 = May's Opening 153.43, etc., across 8 real
-- consecutive real monthly PDFs, Dec 2025-Jul 2026).
-- closing_funds_computed's formula (straight signed sum of every field —
-- each already carries the sign printed on the PDF, e.g. "Other fees"
-- and "Payouts" are usually negative) was verified against 4 of the 8
-- real months (Jan/Apr/Jul/Aug-generated) and reproduced the PDF's own
-- printed Closing funds EXACTLY (not just close) every time — a much
-- tighter reconciliation than Etsy's per-line-rounding case, since this
-- report shows only 2-decimal USD figures with no intermediate rounding
-- step. closing_funds_stated is still hand-typed from the PDF (not
-- dropped) so a real data-entry mistake shows up as a mismatch against
-- the generated column, same audit pattern as this file's other
-- computed-vs-stated columns.
CREATE TABLE ebay_monthly_financial_statement (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL REFERENCES companies(id),
  statement_number              text,   -- the PDF's own GUID-style "Statement number"
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

-- 2026-08-11: Holiday calendar — specific calendar dates. NULL company_id
-- = applies to every company (a national holiday); a company_id set = that
-- one company only. Did not exist in the old system at all — genuinely
-- new. See companies.weekly_off_days above for the separate recurring
-- weekly-off pattern.
CREATE TABLE holidays (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid REFERENCES companies(id),   -- NULL = all companies
  holiday_date            date NOT NULL,
  name                    text NOT NULL,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_holidays_date ON holidays(holiday_date);

-- 2026-08-11: monthly salary per employee — versioned by effective_from so
-- a raise doesn't rewrite payroll history for earlier months (the payroll
-- report on /dashboard/salary always looks up the row effective as of the
-- month being calculated). Absent-day deduction convention: per-day rate =
-- monthly_salary / days in that calendar month; days absent beyond
-- allowed_leaves_per_month are deducted at that per-day rate — a
-- common/standard Indian payroll convention, NOT a verified copy of this
-- company's actual written policy (flagged in the UI too).
CREATE TABLE employee_salary (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id               uuid NOT NULL REFERENCES employees(id),
  monthly_salary            numeric(12,2) NOT NULL,
  allowed_leaves_per_month  numeric(4,1) NOT NULL DEFAULT 1,
  effective_from            date NOT NULL,
  entered_by_employee_id    uuid REFERENCES employees(id),
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_employee_salary_employee ON employee_salary(employee_id, effective_from DESC);

-- =============================================================================
-- 2026-08-12 (round 7): Employee Advance + Salary Payment — "sellery
-- advance vala bhi sahi se kaam nahi kar raha, sellery decide karne ka
-- option, agar kisi ne advance liya hai to HR section se connect hokar
-- yaha reflact hona chahiye" + "jitni sellery debit hoyegi account se to
-- uska bhi konse section me jayegi finance ke". Two distinct events that
-- were both previously untracked: employee_salary above is only the
-- fixed MONTHLY RATE (versioned), and the old /dashboard/salary payroll
-- table only ever computed a live PREVIEW from attendance — nothing
-- durable was ever written when salary was actually paid, and no
-- Advance/loan concept existed anywhere.
-- =============================================================================

-- A real loan/advance ledger, not just a free-text note. employee_id is
-- the connection point the Employees (HR) admin screen reads to show
-- "Outstanding Advance: ₹X" per person, that Salary Payment below reads
-- to offer "deduct from this month's salary", AND what auto-inserts into
-- bill_pass_register so Finance sees it the moment it's given.
CREATE TABLE employee_advances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           uuid NOT NULL REFERENCES employees(id),
  company_id            uuid NOT NULL REFERENCES companies(id),
  amount                numeric(14,2) NOT NULL,
  date_given            date NOT NULL,
  reason                text,
  given_by_employee_id  uuid REFERENCES employees(id),
  -- Running total of how much of this advance has been recovered so far
  -- (via one or more salary_payments.advance_deduction_amount rows) — a
  -- plain column, not a live cross-table SUM, because it needs updating
  -- transactionally alongside each salary payment that recovers part of it.
  recovered_amount      numeric(14,2) NOT NULL DEFAULT 0,
  outstanding_amount    numeric(14,2) GENERATED ALWAYS AS (amount - recovered_amount) STORED,
  -- 2026-08-12 (round 9): optional recovery schedule — "10000 advance,
  -- 10 mahine me recover karna hai to har mahine 1000 kate jaye". NULL =
  -- no schedule, fully manual amount typed each month (the original
  -- behavior). monthly_installment is GENERATED so it can never drift
  -- from amount/recovery_months.
  recovery_months       int CHECK (recovery_months IS NULL OR recovery_months > 0),
  monthly_installment   numeric(14,2) GENERATED ALWAYS AS (
                           CASE WHEN recovery_months IS NOT NULL AND recovery_months > 0
                             THEN ROUND(amount / recovery_months, 2)
                             ELSE NULL
                           END
                         ) STORED,
  remark                text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_employee_advances_employee ON employee_advances(employee_id);
CREATE INDEX idx_employee_advances_company  ON employee_advances(company_id);
COMMENT ON TABLE employee_advances IS
  'Real advance/loan tracking — was previously just the salary_admin capability''s description ("not yet '
  'built in the source system"). Deliberately per-advance (not one running per-employee balance) so each '
  'advance keeps its own date/reason/recovery history.';

-- The ACTUAL "salary was paid" record. UNIQUE(employee_id, pay_month)
-- mirrors the same one-per-period idempotency guard used elsewhere in
-- this codebase (daily_work_logs' carry-over unique index, tasks' submit
-- guards) — can't accidentally pay the same employee twice for one month.
CREATE TABLE salary_payments (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id                  uuid NOT NULL REFERENCES employees(id),
  company_id                   uuid NOT NULL REFERENCES companies(id),
  pay_month                    date NOT NULL,   -- always the 1st of the month, e.g. 2026-08-01
  gross_salary                 numeric(14,2) NOT NULL,
  attendance_deduction_amount  numeric(14,2) NOT NULL DEFAULT 0,
  -- How much of this payment was withheld to recover an outstanding
  -- employee_advances balance — captured here (not just on the advance
  -- row) so a single salary payment's own breakdown is self-contained.
  advance_deduction_amount     numeric(14,2) NOT NULL DEFAULT 0,
  advance_id                   uuid REFERENCES employee_advances(id),
  -- GREATEST(0, ...) floor: a defensive guarantee this never goes
  -- negative, even though nothing upstream should ever produce a
  -- deduction total larger than gross_salary in practice.
  net_paid_amount               numeric(14,2) GENERATED ALWAYS AS (GREATEST(0, gross_salary - attendance_deduction_amount - advance_deduction_amount)) STORED,
  payment_date                  date NOT NULL,
  paid_by_employee_id           uuid REFERENCES employees(id),
  remark                        text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, pay_month)
);
CREATE INDEX idx_salary_payments_employee     ON salary_payments(employee_id);
CREATE INDEX idx_salary_payments_company_month ON salary_payments(company_id, pay_month);
COMMENT ON TABLE salary_payments IS
  'The actual "salary was paid" event — distinct from employee_salary above (the fixed MONTHLY RATE, '
  'versioned by effective_from) and from the payroll preview computeDeduction() renders live. One row per '
  'employee per pay_month once really paid — each insert also auto-inserts a mirror row into '
  'bill_pass_register (source=''salary_payment'') so it shows up in the same Finance ledger as every other bill.';

-- Atomic advance recovery (single-statement UPDATE, race-safe — see
-- db/2026-08-12-finance-salary-advance.sql for the full reasoning).
CREATE OR REPLACE FUNCTION recover_employee_advance(p_advance_id uuid, p_amount numeric)
RETURNS numeric AS $$
  UPDATE employee_advances
  SET recovered_amount = recovered_amount + p_amount
  WHERE id = p_advance_id
  RETURNING recovered_amount;
$$ LANGUAGE sql;

-- 2026-08-11: Daily Work Report — direct equivalent of the standalone
-- "NYKO MART Work & Performance" Apps Script tool's DailyLogs sheet (given
-- as a reference this round), rebuilt against Postgres. One row per work
-- item logged for a given day. Auto-saved from the UI as the employee
-- types (debounced, see attendance/daily-report-form.tsx) rather than one
-- "submit the whole day" button — updated_at is what the browser compares
-- its own localStorage draft against on page load, to decide whether an
-- unsaved draft is newer than what's already saved (refresh-safe).
CREATE TABLE daily_work_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employees(id),
  company_id      uuid NOT NULL REFERENCES companies(id),
  log_date        date NOT NULL DEFAULT CURRENT_DATE,
  category        text,
  description     text NOT NULL DEFAULT '',
  target_qty      text,
  qty_done        text,
  work_status     text,   -- 'Pending' / 'In Progress' / 'Completed' / 'Next Day Carry On'
  estimated_time  text,   -- legacy free-text field, kept for old rows; superseded by the timer columns below
  time_taken      text,   -- legacy free-text field, kept for old rows; superseded by the timer columns below
  remark_sku      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- 2026-08-11 (round 2): "SUBMIT REPORT VALE SECTION ME ESTIMATE TIME KA
  -- OPTION HAI TO USKI JAGH PAR WATCH LAGA DO" — a real Start/Pause watch
  -- replacing the free-text Estimated Time field. timer_started_at
  -- non-null = currently running; time_spent_seconds accumulates every
  -- past Start->Pause interval; first_started_at/last_paused_at are the
  -- "kitne baje start kiya / kitne baje khatm kiya" display fields.
  --
  -- 2026-08-11 (round 4): "daily work vale section se bhi start button ko
  -- hatane ko bola tha, yaha manual entry ka option rakhna tha" — the
  -- Start/live-timer UI for THIS table is gone (Tasks keeps its own
  -- separate timer, unaffected). timer_started_at/first_started_at/
  -- last_paused_at are left in place but unused going forward.
  -- time_spent_seconds is now "Time Consumed", entered manually as
  -- hours*3600 + minutes*60 instead of clocked.
  timer_started_at    timestamptz,
  time_spent_seconds  int NOT NULL DEFAULT 0,
  first_started_at    timestamptz,
  last_paused_at       timestamptz,
  -- "ESTIMATE TIME ME HOUR OR MINUT KA COLOM HO KITNA ESTIMATE TIME
  -- LAGGA" — manually entered, stored as total minutes (hours*60 + mins).
  estimated_time_minutes int,
  -- Next-day auto-carry-over: "agar koi kaam next day ke liye mark kiya hai
  -- to vo agle din automatic Pending me dikh jaye". carried_from_log_id
  -- marks a row as the auto-created copy of a prior day's "Next Day Carry
  -- On" row; carried_forward marks the ORIGINAL row as already copied
  -- forward so carryOverPendingDailyLogs() never double-creates it.
  carried_from_log_id  uuid REFERENCES daily_work_logs(id),
  carried_forward       boolean NOT NULL DEFAULT false,
  -- 2026-08-11 (round 3): "start & pause button ko remove karo ... submit
  -- report ka option ho, submit karte hi khud ke kaam me add ho jaye or md
  -- admin ke page par show ho jaye" — the Time Watch is now Start once +
  -- Submit once (no Pause toggle). NULL = still a draft (auto-saved,
  -- refresh-safe, but not yet a "real" report); non-null = finalized —
  -- this is what My Recent Reports and the Admin/MD Team Daily Work Log
  -- view now filter on, so half-typed drafts never show there.
  submitted_at         timestamptz
);
CREATE INDEX idx_daily_work_logs_employee_date ON daily_work_logs(employee_id, log_date DESC);
CREATE INDEX idx_daily_work_logs_company_date ON daily_work_logs(company_id, log_date DESC);
-- Race safety: carryOverPendingDailyLogs() does a select-then-insert (not
-- atomic) — this turns a concurrent double-carry-over into a harmless
-- no-op (second INSERT for the same source row fails unique, caught by
-- the app) instead of a duplicate "Pending" row.
CREATE UNIQUE INDEX idx_daily_work_logs_carried_from_unique
  ON daily_work_logs(carried_from_log_id) WHERE carried_from_log_id IS NOT NULL;
CREATE INDEX idx_daily_work_logs_submitted ON daily_work_logs(company_id, submitted_at);

-- 2026-08-11 (round 2): Task Assignment — direct rebuild of the legacy
-- "NYKO MART — Work & Performance System" Apps Script tool's Tasks sheet
-- (id/from/to/website/category/priority/deadline/status/description/
-- timeSpentSec/timerStartedAt), matching the screenshots given this round.
-- "TASK KOI BHI KISI KO ASSIGN KAR DE" — any employee can assign a task to
-- any other employee they share company access with (see task_management
-- capability below, granted to every role). company_id is the ASSIGNEE's
-- company (whose team/report this task counts under), not the assigner's.
CREATE TABLE tasks (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id),
  assigned_by_employee_id   uuid NOT NULL REFERENCES employees(id),
  assigned_to_employee_id   uuid NOT NULL REFERENCES employees(id),
  website                   text,             -- free text, e.g. store/marketplace name (mirrors legacy "Website" column)
  category                  text,
  priority                  text NOT NULL DEFAULT 'Medium',   -- Low / Medium / High / Urgent
  deadline                  date,
  status                    text NOT NULL DEFAULT 'Pending',  -- Pending / In Progress / Done
  description                text NOT NULL DEFAULT '',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  -- Live per-task timer — same Start/Pause shape as daily_work_logs above.
  timer_started_at          timestamptz,
  time_spent_seconds        int NOT NULL DEFAULT 0,
  first_started_at          timestamptz,
  last_paused_at            timestamptz
);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to_employee_id, status);
CREATE INDEX idx_tasks_assigned_by ON tasks(assigned_by_employee_id);
CREATE INDEX idx_tasks_company ON tasks(company_id, status);

-- =============================================================================
-- 2026-08-12 (round 8): Leave Request -> MD/Admin Approval -> Coverage
-- Assignment. An employee applies (with an application/reason text) for a
-- date range; MD/Admin approves or rejects; once approved, MD/Admin can
-- assign another employee to cover the absent employee's store work,
-- which auto-grants that covering employee access to the store for
-- exactly the assigned dates (see leave_coverage_assignments below and
-- getAuthedEmployee() in src/lib/auth/require-capability.ts).
-- =============================================================================
CREATE TYPE leave_request_status AS ENUM ('Pending', 'Approved', 'Rejected');

CREATE TABLE leave_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             uuid NOT NULL REFERENCES employees(id),
  company_id              uuid NOT NULL REFERENCES companies(id),
  from_date               date NOT NULL,
  to_date                 date NOT NULL,
  reason                  text NOT NULL,   -- the "application" text the employee writes
  status                  leave_request_status NOT NULL DEFAULT 'Pending',
  requested_at            timestamptz NOT NULL DEFAULT now(),
  decided_by_employee_id  uuid REFERENCES employees(id),
  decided_at              timestamptz,
  decision_remark         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id, from_date DESC);
CREATE INDEX idx_leave_requests_company_status ON leave_requests(company_id, status);
COMMENT ON TABLE leave_requests IS
  'Real leave application + MD/Admin approval workflow. status starts Pending; once decided (Approved/'
  'Rejected) it is never re-decided — decided_by/decided_at/decision_remark are all set together.';

-- Who covers an absent (on-approved-leave) employee's store work, and for
-- exactly which dates. This row IS the access grant — getAuthedEmployee()
-- unions any store with an active (today BETWEEN from_date AND to_date)
-- row here into that employee's storeIds/companyIds for the duration,
-- automatically, no separate toggle. Deliberately a SEPARATE table from
-- employee_store_access (permanent Ad Spend store scoping) rather than
-- inserting into it directly — that table's own admin panel does a
-- delete-then-insert of the FULL set on every edit, so mixing a temporary
-- grant into it risks either getting silently wiped out or wiping out a
-- real permanent grant.
CREATE TABLE leave_coverage_assignments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id          uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  covering_employee_id      uuid NOT NULL REFERENCES employees(id),
  store_id                  uuid NOT NULL REFERENCES stores(id),
  from_date                 date NOT NULL,
  to_date                   date NOT NULL,
  assigned_by_employee_id   uuid NOT NULL REFERENCES employees(id),
  assigned_at               timestamptz NOT NULL DEFAULT now(),
  remark                    text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX idx_leave_coverage_leave_request ON leave_coverage_assignments(leave_request_id);
CREATE INDEX idx_leave_coverage_covering_employee ON leave_coverage_assignments(covering_employee_id, from_date, to_date);
COMMENT ON TABLE leave_coverage_assignments IS
  'Not unique per leave_request — MD/Admin can split coverage across multiple people/stores for one leave.';


-- =============================================================================
-- SECTION 16b (2026-08-14) — Help Center + Direct Messaging
-- "sabhi employe ko agar system ke bare me kuch puchna ho to chat boat khul
-- jaye or sabhi ko ek dusre employe se chat karni ho ya kuch bheejna ho uske
-- liye massaging option do online" — a chat-style Help Center (rule-based
-- FAQ/guide search, NOT an AI chat — same 2026-08-01 decision made once
-- already for the old system, to avoid needing the user's own AI API key
-- and an ongoing per-message cost) + 1-to-1 direct messaging between any two
-- employees, with an optional file/image attachment.
--
-- Both open to every signed-in employee, no capability gate (same pattern
-- as My Profile) — only maintaining the Help Center's own article content
-- is capability-gated (help_center_admin, Admin + MD only — see seed data
-- below). RLS policies + the private storage bucket for attachments live in
-- db/2026-08-14m-help-center-and-messaging.sql (not here — this file is
-- also applied to a plain throwaway Postgres for local type-gen/testing,
-- which has no auth.uid()/storage schema, same reason RLS is never defined
-- in this file for any other table either).
-- =============================================================================

CREATE TABLE help_articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      text NOT NULL,
  title         text NOT NULL,
  keywords      text[] NOT NULL DEFAULT '{}',
  answer        text NOT NULL,
  action_href   text,          -- e.g. '/dashboard/orders' — optional "jump to this screen"
  action_label  text,          -- e.g. 'Go to Order Entry'
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_help_articles_category ON help_articles(category, sort_order);

CREATE TABLE direct_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_employee_id    uuid NOT NULL REFERENCES employees(id),
  recipient_employee_id uuid NOT NULL REFERENCES employees(id),
  body                  text,
  attachment_path       text,     -- Storage object path in the private 'message-attachments' bucket
  attachment_name       text,
  attachment_mime       text,
  attachment_size_bytes bigint,
  created_at            timestamptz NOT NULL DEFAULT now(),
  read_at               timestamptz,
  CONSTRAINT direct_messages_not_self CHECK (sender_employee_id <> recipient_employee_id),
  CONSTRAINT direct_messages_has_content CHECK (body IS NOT NULL OR attachment_path IS NOT NULL)
);
CREATE INDEX idx_direct_messages_thread
  ON direct_messages (LEAST(sender_employee_id, recipient_employee_id), GREATEST(sender_employee_id, recipient_employee_id), created_at);
CREATE INDEX idx_direct_messages_recipient_unread
  ON direct_messages (recipient_employee_id, read_at) WHERE read_at IS NULL;
COMMENT ON TABLE direct_messages IS
  'Private 1-to-1 messages — see db/2026-08-14m-help-center-and-messaging.sql for the RESTRICTIVE RLS '
  'policy that hard-scopes reads/writes to a message''s own sender/recipient.';


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
-- SECTION 17b — MARKETPLACE AUTOMATION + COURIER WEBHOOKS + SHIPGLOBAL
-- 2026-08-12 (round 7): merged in from db/2026-08-08-marketplace-connectors.sql
-- and db/2026-08-10-shipglobal.sql — both were applied directly to the live
-- Supabase project but had never been folded back into this file, so a
-- fresh local build from schema.sql alone (see README's "Local schema
-- checks") silently diverged from production: 5 tables + 1 capability
-- missing, which surfaced as a `src/types/database.ts` regeneration
-- breaking every file that already referenced these tables
-- (src/lib/courier-webhooks/apply-tracking-event.ts,
-- src/app/dashboard/shipglobal/*). Caught and fixed as part of the
-- "poore system ko dubara chaek kar lena" pass this round. No behavior
-- change — this is a pure merge, same tables/columns as those two files.
-- =============================================================================

CREATE TYPE marketplace_provider AS ENUM ('amazon','etsy','woocommerce','ebay','walmart');

-- One row per store's connection to its marketplace API.
CREATE TABLE marketplace_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid NOT NULL UNIQUE REFERENCES stores(id),
  provider          marketplace_provider NOT NULL,
  -- Encrypted with AES-256-GCM in the application layer (src/lib/crypto/
  -- secret-box.ts) BEFORE being written here — never store plain API
  -- keys/secrets. bytea holds: iv(12) || authTag(16) || ciphertext.
  api_key_enc       bytea NOT NULL,
  api_secret_enc    bytea,
  extra_config      jsonb NOT NULL DEFAULT '{}',
  is_active         boolean NOT NULL DEFAULT true,
  last_synced_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES employees(id)
);

-- Every marketplace sync run (cron-triggered) writes one row here.
CREATE TABLE marketplace_sync_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              uuid NOT NULL REFERENCES stores(id),
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  orders_fetched        integer NOT NULL DEFAULT 0,
  orders_created        integer NOT NULL DEFAULT 0,
  orders_skipped_dup    integer NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCESS','FAILED')),
  error_message         text
);
CREATE INDEX idx_sync_log_store_started ON marketplace_sync_log(store_id, started_at DESC);

-- Courier tracking webhooks: raw payload always logged first, before any
-- processing — a parsing bug never loses data, everything can be replayed.
CREATE TABLE courier_webhook_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at       timestamptz NOT NULL DEFAULT now(),
  courier_name      text NOT NULL,
  awb_no            text,
  raw_payload       jsonb NOT NULL,
  processed         boolean NOT NULL DEFAULT false,
  processed_at      timestamptz,
  error_message     text
);
CREATE INDEX idx_courier_webhook_awb ON courier_webhook_log(awb_no);
CREATE INDEX idx_courier_webhook_unprocessed ON courier_webhook_log(processed) WHERE processed = false;

-- Shipglobal — the one courier this app creates real shipments through
-- (every other courier only reacts to an AWB generated by hand elsewhere).
-- One row per company: the "who is shipping this" declaration Shipglobal
-- requires on every addOrder.php call.
CREATE TABLE shipglobal_seller_profiles (
  company_id        uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  seller_nickname   text NOT NULL,
  seller_firstname  text NOT NULL,
  seller_lastname   text NOT NULL,
  seller_mobile     text NOT NULL,
  seller_email      text NOT NULL,
  seller_company    text NOT NULL,
  seller_address1   text NOT NULL,
  seller_address2   text NOT NULL,
  seller_address3   text,
  seller_city       text NOT NULL,
  seller_postcode   text NOT NULL,
  seller_country_code text NOT NULL,
  seller_state      text NOT NULL,
  seller_tax_id_type text,
  seller_tax_id     text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per Shipglobal shipment attempt, 1:1 with an order. Two-phase
-- per Shipglobal's own API shape: addOrder.php ("created") then
-- processDestination.php ("manifested", real carrier tracking_no).
CREATE TABLE shipglobal_shipments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL UNIQUE REFERENCES orders(id),
  service_code          text NOT NULL,
  currency_code          text NOT NULL DEFAULT 'USD',
  csb5_status             smallint NOT NULL DEFAULT 1,
  ship_firstname          text NOT NULL,
  ship_lastname           text NOT NULL,
  ship_mobile             text NOT NULL,
  ship_email              text NOT NULL,
  ship_company            text,
  ship_address1           text NOT NULL,
  ship_address2           text NOT NULL,
  ship_address3           text,
  ship_city                text NOT NULL,
  ship_postcode            text NOT NULL,
  ship_country_code        text NOT NULL,
  ship_state                text NOT NULL,
  item_name                 text NOT NULL,
  item_sku                  text NOT NULL,
  item_qty                  integer NOT NULL DEFAULT 1,
  item_unit_price            numeric(12,2) NOT NULL,
  item_hsn                   text NOT NULL,
  item_tax_rate               numeric(5,2) NOT NULL DEFAULT 0,
  package_weight_g              integer NOT NULL,
  package_length_cm              integer NOT NULL,
  package_breadth_cm              integer NOT NULL,
  package_height_cm                integer NOT NULL,
  ioss_number                       text,
  seller_reference                   text NOT NULL,
  mail_class                          text,
  delivery_confirmation                 text,
  manifest_code                          text,
  status                                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','created','manifested','failed')),
  shipglobal_order_number                  text,
  shipglobal_waybill_number                 text,
  tracking_no                                text,
  label_pdf_base64                            text,
  error_message                                text,
  raw_create_response                           jsonb,
  raw_manifest_response                          jsonb,
  created_at                                      timestamptz NOT NULL DEFAULT now(),
  created_by                                       uuid REFERENCES employees(id)
);
CREATE INDEX idx_shipglobal_shipments_order ON shipglobal_shipments(order_id);
CREATE INDEX idx_shipglobal_shipments_tracking ON shipglobal_shipments(tracking_no);

-- =============================================================================
-- SECTION 17c — FREIGHT COST ESTIMATOR (Gap 5 part 1 of the 5-gaps plan)
-- 2026-08-20 — see claude/five-gaps-implementation-plan-2026-08-20.md and
-- db/2026-08-20-freight-rate-card-and-estimator.sql for full reasoning.
-- Manually-maintained rate card (no courier API — covers Aramex/On Point
-- Express, unlike ShipGlobal above which has zero pricing logic) + saved
-- estimates, optionally linked to an order.
-- =============================================================================
CREATE TABLE courier_rate_cards (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  courier_name            text NOT NULL,
  zone_label              text NOT NULL,
  min_weight_kg           numeric(10,3) NOT NULL DEFAULT 0,
  max_weight_kg           numeric(10,3) NOT NULL,
  base_rate               numeric(14,2) NOT NULL DEFAULT 0,
  rate_per_kg             numeric(14,2) NOT NULL DEFAULT 0,
  fuel_surcharge_pct      numeric(6,3) NOT NULL DEFAULT 0,
  other_charges           numeric(14,2) NOT NULL DEFAULT 0,
  currency                text NOT NULL DEFAULT 'INR',
  remark                  text,
  entered_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (min_weight_kg >= 0),
  CHECK (max_weight_kg > min_weight_kg)
);
CREATE INDEX idx_courier_rate_cards_lookup ON courier_rate_cards(company_id, courier_name, zone_label);

CREATE TABLE freight_cost_estimates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  order_id                uuid REFERENCES orders(id) ON DELETE SET NULL,
  courier_name            text NOT NULL,
  zone_label              text NOT NULL,
  weight_kg               numeric(10,3) NOT NULL CHECK (weight_kg > 0),
  base_rate               numeric(14,2) NOT NULL,
  weight_charge           numeric(14,2) NOT NULL,
  fuel_surcharge_amt      numeric(14,2) NOT NULL,
  other_charges           numeric(14,2) NOT NULL,
  estimated_total         numeric(14,2) NOT NULL,
  currency                text NOT NULL DEFAULT 'INR',
  rate_card_id            uuid REFERENCES courier_rate_cards(id) ON DELETE SET NULL,
  remark                  text,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_freight_cost_estimates_company ON freight_cost_estimates(company_id);
CREATE INDEX idx_freight_cost_estimates_order   ON freight_cost_estimates(order_id);


-- =============================================================================
-- SECTION 18 — SEED DATA
-- Structural/business-rule data only (companies, stores, roles,
-- capabilities, role_capabilities, currencies) — NOT bulk migration data
-- (the 280 Sizes values, ~90 Party Master vendor rows, SKU catalog,
-- historical Sale & Profit Ledger rows, exchange-rate history, etc.),
-- which belongs in a separate one-time migration script, not schema.sql.
-- See SCHEMA_NOTES.md for the full list of what still needs migrating.
-- =============================================================================

INSERT INTO companies (name, short_code, ref_prefix, master_invoice_prefix) VALUES
  ('Nyko Mart', 'NM', 'PO', 'NYM'),
  ('Rugara', 'RUG', 'RG', 'RA'),
  ('CASA ARRA', 'CA', 'RF', 'CASA');

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

-- invoice_ref_prefix per claude/invoice-origin-declarations-and-numbering.md
-- section 3/5: Nyko Mart Etsy+Website -> NL, Amazon -> AN, eBay -> EBY;
-- Rugara Etsy -> ERG, Amazon -> ARG, eBay -> EBRG, Website -> WRG;
-- CASA ARRA all stores combined -> ECA.
INSERT INTO stores (company_id, name, invoice_ref_prefix)
SELECT c.id, s.name, s.prefix FROM companies c
JOIN (VALUES
  ('NM', 'Amazon Arts of Jaipur', 'AN'), ('NM', 'Etsy Arts of Jaipur', 'NL'), ('NM', 'Etsy The Decor House', 'NL'),
  ('NM', 'Etsy Handloom Decor', 'NL'), ('NM', 'Ebay Arts of Jaipur', 'EBY'), ('NM', 'Arts of Jaipur (Website)', 'NL'),
  ('NM', 'Jaipur Arts (Website)', 'NL'),
  ('RUG', 'Amazon Rugara', 'ARG'), ('RUG', 'Etsy The Rugara', 'ERG'), ('RUG', 'Ebay Rugara', 'EBRG'), ('RUG', 'The Rugara (Website)', 'WRG'),
  ('CA', 'Amazon Kanjush', 'ECA'), ('CA', 'Etsy Casa Arra', 'ECA'), ('CA', 'Etsy Kanjush', 'ECA'), ('CA', 'Ebay Casa Arra', 'ECA'),
  ('CA', 'CASA ARRA (Website)', 'ECA'), ('CA', 'Kanjush (Website)', 'ECA')
) AS s(short_code, name, prefix) ON s.short_code = c.short_code;

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
  ('salary_admin',        'Salary payment + advance tracking, connected to Attendance and Finance'),
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
  ('reports',             'Access the Reports suite'),
  ('permissions_admin',   'Manage which role gets which capability — the Roles & Permissions screen itself'),
  ('invoicing',           'Generate export sales invoices (CSB-V/CSB-IV) against dispatched orders'),
  ('ad_spend_entry',      'Enter daily ad Budget/Spend per store; view the combined Orders + Ad Spend report'),
  ('ad_spend_report_all', 'View the complete Ad Spend report across ALL companies/stores (without this, ad_spend_entry is scoped to only the employee''s own assigned store(s) — see employee_store_access)'),
  ('finished_stock_view', 'View finished-goods Inventory/Stock — auto-restocked from cancelled+refunded+already-purchased orders'),
  ('task_management',    'Assign tasks to any teammate, work your own assigned tasks with a Start/Pause timer'),
  ('task_admin',         'View every employee''s tasks and daily reports company-wide (the RD Lohra / Admin / MD view)'),
  -- 2026-08-10, merged into this file 2026-08-12 (see SECTION 17b) —
  -- deliberately NOT granted to the general Order Entry role by default:
  -- creates a REAL external shipment (costs money, real customs
  -- declaration) once real Shipglobal credentials are live.
  ('shipglobal_shipment', 'Create Shipglobal shipments (real external shipment + label + customs declaration)'),
  -- 2026-08-14: Help Center itself needs NO capability (open to every
  -- signed-in employee) — this one only gates maintaining its content.
  ('help_center_admin',   'Add/edit/delete Help Center FAQ & guide articles'),
  -- 2026-08-20: Gap 4 of the 5-gaps plan — see internal_expenses table
  -- (SECTION 12) and db/2026-08-20-internal-expenses.sql. Same role grant
  -- as bill_payment (Finance, Admin).
  ('internal_expense_entry', 'Log office/cash expenses (rent, electricity, fuel, etc.) not tied to any purchase order or AWB'),
  -- 2026-08-20: Gap 5 part 1 of the 5-gaps plan — see SECTION 17c and
  -- db/2026-08-20-freight-rate-card-and-estimator.sql.
  ('freight_rate_admin', 'Maintain the Courier Rate Card (manual freight rate sheet by courier/zone/weight-slab)'),
  ('freight_estimate',   'Use the Freight Cost Estimator to estimate/compare shipping cost before booking/dispatch'),
  -- 2026-08-22: Backup Export — see db/2026-08-22-backup-export-admin.sql.
  -- Deliberately its own capability (not reusing "reports") since this
  -- bypasses per-company scoping and reads every company's orders at once.
  ('data_export_admin', 'Export every order + its generated invoice fields (all companies) as one Excel workbook — the Backup Export page'),
  -- 2026-08-24: see db/2026-08-24-audit-log.sql and
  -- db/2026-08-24-automation-rules.sql.
  ('audit_log_view',   'View the audit log — who changed/deleted what, and when'),
  ('automation_admin', 'Create/manage automation rules (trigger -> condition -> action) — the Automation Rules screen');

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, cap FROM roles r
JOIN (VALUES
  ('Order Entry',        'order_entry'), ('Order Entry', 'attendance_punch'), ('Order Entry', 'finished_stock_view'),
  ('Order Entry',        'task_management'),
  ('Logistics',          'csv_upload'),  ('Logistics',   'attendance_punch'), ('Logistics', 'finished_stock_view'),
  ('Logistics',          'task_management'),
  ('Finance',            'csv_upload'),  ('Finance', 'doc_entry'), ('Finance', 'stock_entry'),
  ('Finance',            'bill_payment'),('Finance', 'salary_admin'), ('Finance', 'statement_entry'),
  ('Finance',            'party_admin'),('Finance', 'exchange_rate_admin'), ('Finance', 'attendance_punch'),
  ('Finance',            'attendance_admin'), ('Finance', 'crm_dashboard'), ('Finance', 'invoicing'),
  ('Finance',            'ad_spend_entry'), -- 2026-08-08: Store-level Daily Spend module.
  ('Finance',            'ad_spend_report_all'), -- 2026-08-08: full cross-store report — see ad_spend_report_all comment above.
  ('Finance',            'finished_stock_view'),
  ('Finance',            'task_management'), ('Finance', 'task_admin'), -- 2026-08-11 (round 2): same set as attendance_punch/attendance_admin.
  ('Higher Authority',   'approve_level1'), ('Higher Authority', 'attendance_punch'), ('Higher Authority', 'crm_dashboard'),
  ('Higher Authority',   'ad_spend_entry'), ('Higher Authority', 'ad_spend_report_all'),
  ('Higher Authority',   'task_management'),
  ('MD',                 'approve_level2'), ('MD', 'company_item_admin'), ('MD', 'doc_entry'), ('MD', 'stock_entry'),
  ('MD',                 'statement_entry'), ('MD', 'party_admin'), ('MD', 'exchange_rate_admin'),
  ('MD',                 'attendance_punch'), ('MD', 'attendance_admin'), ('MD', 'hr_letters'), ('MD', 'crm_dashboard'),
  ('MD',                 'ad_spend_entry'), ('MD', 'ad_spend_report_all'), ('MD', 'finished_stock_view'),
  ('MD',                 'task_management'), ('MD', 'task_admin'), -- 2026-08-11 (round 2): "SABHI LOGO KI REPORT MD KE PASS DIKHE".
  ('MD',                 'employee_admin'), -- 2026-08-06: MD (the actual owner login) should be able to create new
                                             -- employee logins too, not just the separate Admin role — see pending
                                             -- item 12 ("naye user banane ka... sabhi kaam add karo").
  ('MD',                 'permissions_admin'), -- 2026-08-06: MD self-service permissions editor — item 2
                                                -- ("jisko jo permission set karni hai... vo md ke pass honi
                                                -- chhiaye vo apne login kar ke set kar sake").
  ('MD',                 'reports'), -- 2026-08-06: Universal Reports system (item 6) — MD (owner login) gets it too.
  ('MD',                 'invoicing'), -- 2026-08-06: Invoice Generation module.
  ('MD',                 'shipglobal_shipment'),
  ('MD',                 'help_center_admin'),
  ('Admin',              'permissions_admin'),
  ('Admin',              'company_item_admin'), ('Admin', 'employee_admin'), ('Admin', 'reports'), ('Admin', 'doc_entry'),
  ('Admin',              'invoicing'),
  ('Admin',              'stock_entry'), ('Admin', 'party_admin'), ('Admin', 'exchange_rate_admin'),
  ('Admin',              'attendance_punch'), ('Admin', 'attendance_admin'), ('Admin', 'hr_letters'), ('Admin', 'crm_dashboard'),
  ('Admin',              'ad_spend_entry'), ('Admin', 'ad_spend_report_all'), ('Admin', 'finished_stock_view'),
  ('Admin',              'task_management'), ('Admin', 'task_admin'), -- 2026-08-11 (round 2): "REPORT PURI RD LOHRA KO OR ADMIN KO DIKHE" — RD Lohra's login is this role.
  -- 2026-08-05: Admin is the account the owner actually logs in as day-to-
  -- day (unlike the old system's per-department role split) — give it every
  -- remaining capability too, so it's a true superuser role rather than
  -- missing exactly the ones (order_entry, csv_upload, etc.) an owner would
  -- hit first while testing/administering the system.
  ('Admin',              'order_entry'), ('Admin', 'csv_upload'), ('Admin', 'bill_payment'),
  ('Admin',              'salary_admin'), ('Admin', 'statement_entry'), ('Admin', 'approve_level1'),
  ('Admin',              'approve_level2'), ('Admin', 'shipglobal_shipment'), ('Admin', 'help_center_admin'),
  ('Finance',            'internal_expense_entry'), ('Admin', 'internal_expense_entry'), -- 2026-08-20: Gap 4, same grant set as bill_payment.
  ('Finance',            'freight_rate_admin'), ('MD', 'freight_rate_admin'), ('Admin', 'freight_rate_admin'), -- 2026-08-20: Gap 5 part 1, same grant set as exchange_rate_admin.
  ('Order Entry',        'freight_estimate'), ('Logistics', 'freight_estimate'), ('Finance', 'freight_estimate'),
  ('MD',                 'freight_estimate'), ('Admin', 'freight_estimate'),
  ('Listing',            'attendance_punch'), ('Listing', 'task_management'),
  ('Photoshop/Graphics', 'attendance_punch'), ('Photoshop/Graphics', 'task_management'),
  ('Inventory',          'stock_entry'), ('Inventory', 'attendance_punch'), ('Inventory', 'finished_stock_view'),
  ('Inventory',          'task_management'),
  ('Admin',              'data_export_admin'), ('MD', 'data_export_admin'), -- 2026-08-22: Backup Export, Admin/MD only.
  ('Admin',              'audit_log_view'), ('MD', 'audit_log_view'), -- 2026-08-24: Audit log, Admin/MD only to start.
  ('Admin',              'automation_admin'), ('MD', 'automation_admin') -- 2026-08-24: Automation rules engine, Admin/MD only to start.
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
-- Amazon Transactions (UK/GBP + US/USD) -> amazon_transactions
-- Etsy Monthly Tax Invoice            -> etsy_monthly_tax_invoices
-- eBay Financial Summary Report       -> ebay_financial_summary (+ ebay_financial_summary_computed_view)
-- eBay Financial statement (monthly)  -> ebay_monthly_financial_statement
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
