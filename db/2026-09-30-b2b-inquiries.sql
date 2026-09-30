-- 2026-09-30 — "B2B INQUIRY HANDLE / REPORT / INVOICE / AND RELATED SECTION
-- PAYMENT MODE & MANY MORE — MAKE MANAGING SYSTEM" (user, verbatim): a
-- complete B2B (bulk-buyer) inquiry pipeline inside the OMS, alongside the
-- existing retail/marketplace order flow.
--
-- WHAT SHIPS:
--   1. b2b_inquiries           — the inquiry register: buyer, source, priority,
--                                 folio number (B2B-<FY>-####, app-reserved via
--                                 reserve_next_number like every other doc),
--                                 requirement notes, a follow-up due date, and a
--                                 won/lost/converted outcome. status follows
--                                 Open → In Discussion → Quotation Sent → Won /
--                                 Lost / Converted.
--   2. b2b_inquiry_items       — the asked-for products (description/qty/unit
--                                 price free-typed — inquiries arrive as text
--                                 / WhatsApp / email, not structured SKUs).
--   3. b2b_quotations          — one inquiry, one quotation (1:1 like
--                                 dispatch_invoices is 1:1 to orders): quote
--                                 number Q-<FY>-####, validity date, tax &
--                                 shipping, totals as GENERATED columns (same
--                                 computed-in-DB pattern as internal_invoices).
--                                 Sent on WhatsApp/email outside the app;
--                                 sent_at records when.
--   4. b2b_payments            — money actually received against a
--                                 quotation/invoice: payment_mode
--                                 (Cash/Bank Transfer/UPI/Cheque/Card/Advance)
--                                 + reference no, reference date, amount,
--                                 realized/unrealized — the "payment mode"
--                                 tracking the user asked for.
--   5. capability b2b_inquiry  — MD/Admin to start; grant further via
--                                 Roles & Permissions (zero code change).
--
-- WHY SEPARATE TABLES (not rows on `orders`): B2B buyers don't place PO/RF/RG
-- orders; they send inquiries, negotiate, and only sometimes convert. The
-- orders table's shape (store-scoped, SKU/size/category-NOT-NULL, marketplace
-- fields) fights that at every column. A converted inquiry's buyer name is
-- copied into the eventual order's buyer_name_address free-text (the same
-- place all other non-structured buyer info lives) — no FK needed, and the
-- inquiry row itself records the conversion (status='Converted' +
-- converted_order_ref) without forcing the two flows to merge.
--
-- NUMBERING: reserve_next_number(company, 'B2B_INQ', false) + 'B2B-' ||
-- fy_label(today) || '-' || lpad(4) — reserved in APPLICATION code (the same
-- "app reserves, not a DB trigger" reasoning as orders.ref_no), so the
-- follow-up "re-quote" flow can reserve or reuse without a second trigger
-- firing. Quotation numbers Q-<FY>-#### use the same scheme.

BEGIN;

-- ── 1. Inquiry register ─────────────────────────────────────────────────────
CREATE TABLE b2b_inquiries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  inquiry_no          text NOT NULL,            -- B2B-26-27-0001 (app-reserved)
  inquiry_date        date NOT NULL,

  -- The buyer. B2B buyers here are walk-in/WhatsApp/email trade buyers — no
  -- parties row needed until they become a real vendor; name + contact is
  -- free text exactly like orders.buyer_name_address.
  buyer_name          text NOT NULL,
  buyer_company       text,
  buyer_contact_no    text,
  buyer_email         text,
  buyer_country       text,

  -- How the inquiry arrived (walk-in / whatsapp / email / website / referral
  -- / exhibition …) — free text so new sources never need a migration.
  source              text,
  -- Hot / Warm / Cold.
  priority            text NOT NULL DEFAULT 'Warm' CHECK (priority IN ('Hot', 'Warm', 'Cold')),

  requirement_notes   text,
  -- What they want it for / any deadline they mentioned (free text).
  remarks             text,

  follow_up_date      date,
  status              text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Discussion', 'Quotation Sent', 'Won', 'Lost', 'Converted')),
  -- enum lives in app code; text + CHECK keeps fresh-DB and live-DB in step
  -- (see the pattern used by b2b_payments.payment_mode below).

  -- Set when the inquiry converts into a real order (status → 'Converted').
  converted_order_id  uuid REFERENCES orders(id) ON DELETE SET NULL,
  converted_order_ref text,

  entered_by_employee_id uuid REFERENCES employees(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, inquiry_no)
);
CREATE INDEX idx_b2b_inquiries_company_date ON b2b_inquiries(company_id, inquiry_date DESC);
CREATE INDEX idx_b2b_inquiries_status       ON b2b_inquiries(company_id, status);
CREATE INDEX idx_b2b_inquiries_followup     ON b2b_inquiries(company_id, follow_up_date) WHERE follow_up_date IS NOT NULL AND status NOT IN ('Won', 'Lost', 'Converted');

COMMENT ON COLUMN b2b_inquiries.inquiry_no IS
  'App-reserved via reserve_next_number(company_id, ''B2B_INQ'', false) formatted B2B-<FY>-####; the FY label comes from fy_label(inquiry_date) so a backdated entry still gets the right year';

-- ── 2. Asked-for items (free-typed; inquiries arrive unstructured) ──────────
CREATE TABLE b2b_inquiry_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id      uuid NOT NULL REFERENCES b2b_inquiries(id) ON DELETE CASCADE,
  description     text NOT NULL,
  qty             numeric(12,2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit            text DEFAULT 'pcs',
  unit_price      numeric(14,2),
  remark          text,
  display_order   integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_b2b_inquiry_items_inquiry ON b2b_inquiry_items(inquiry_id, display_order);

-- ── 3. Quotation / invoice for the inquiry (1:1, like dispatch_invoices) ────
CREATE TABLE b2b_quotations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id        uuid NOT NULL UNIQUE REFERENCES b2b_inquiries(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id),
  quote_no          text NOT NULL,          -- Q-26-27-0001 (app-reserved)
  quote_date        date NOT NULL,
  valid_until       date,

  buyer_name        text NOT NULL,          -- copied from the inquiry at save time; stays editable
  buyer_contact_no  text,
  buyer_email       text,
  buyer_country     text,

  subtotal          numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_percent       numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_percent >= 0),
  tax_amount        numeric(14,2) GENERATED ALWAYS AS (round(subtotal * tax_percent / 100.0, 2)) STORED,
  shipping_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  total_amount      numeric(14,2) GENERATED ALWAYS AS (round(subtotal * (1 + tax_percent / 100.0) + shipping_amount, 2)) STORED,
  currency          varchar(3) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),

  terms             text,
  notes             text,
  sent_at           timestamptz,            -- "WhatsApp/email se bhej diya" — set by the Send action

  entered_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, quote_no)
);
CREATE INDEX idx_b2b_quotations_company ON b2b_quotations(company_id, quote_date DESC);

COMMENT ON COLUMN b2b_quotations.total_amount IS
  'GENERATED: round(subtotal * (1 + tax%/100) + shipping, 2) — same computed-in-DB pattern as internal_invoices.amount/gst_18pct/total_amount, so app code can never drift from the money math';

-- ── 4. Payments received (mode + reference + realization) ───────────────────
CREATE TABLE b2b_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id    uuid NOT NULL REFERENCES b2b_quotations(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id),
  payment_date    date NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  -- The "PAYMENT MODE" column the user asked for: Cash / Bank Transfer / UPI /
  -- Cheque / Card / Advance.
  payment_mode    text NOT NULL CHECK (payment_mode IN ('Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card', 'Advance')),
  reference_no    text,                     -- UTR / cheque no / txn id
  reference_date  date,
  realized        boolean NOT NULL DEFAULT true,  -- cheque can stay unrealized till it clears
  remark          text,
  entered_by_employee_id uuid REFERENCES employees(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_b2b_payments_quotation ON b2b_payments(quotation_id);
CREATE INDEX idx_b2b_payments_company   ON b2b_payments(company_id, payment_date DESC);

-- ── 5. Capability + grant (MD/Admin to start — expand via the matrix) ───────
INSERT INTO capabilities (code, description) VALUES
  ('b2b_inquiry', 'B2B Inquiry Management — handle trade-buyer inquiries end to end: register, quote, invoice, payments received (mode-wise), and reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'b2b_inquiry' FROM roles r WHERE r.name IN ('MD', 'Admin')
ON CONFLICT DO NOTHING;

-- ── 6. RLS — the app reads/writes through service-role actions only, but the
-- table must never be anon-readable; audit_log's allow_authenticated_all
-- policy is the established precedent for app-managed tables (all ~74 tables
-- in this app follow it — see README security model + src/proxy.ts).
ALTER TABLE b2b_inquiries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_inquiry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_quotations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_payments      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_authenticated_all ON b2b_inquiries;
CREATE POLICY allow_authenticated_all ON b2b_inquiries FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_inquiry_items;
CREATE POLICY allow_authenticated_all ON b2b_inquiry_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_quotations;
CREATE POLICY allow_authenticated_all ON b2b_quotations FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_payments;
CREATE POLICY allow_authenticated_all ON b2b_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
