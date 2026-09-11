-- 2026-09-11 — Phase 3 of building the enterprise Payroll & HR blueprint
-- (claude/payroll-hr-architecture-design-2026-09-11.md) into the real OMS.
-- See claude/hr-payroll-build-roadmap-2026-09-11.md for the full phase
-- plan and Phases 1-2 (CTC payroll structure, leave types + balances).
--
-- This round adds three small, independent Core HR pieces on top of the
-- existing Employees admin (/dashboard/admin/employees, requireCapability
-- ("employee_admin")) — no new capability needed, no existing table's
-- existing behavior changes:
--   1. Org chart — a single "reports_to_employee_id" column.
--   2. Onboarding checklist — a simple per-company template + per-employee
--      progress ledger (not a full e-signature pipeline — that needs a
--      real e-sign provider this business doesn't have).
--   3. Employee documents — ID proofs/certificates, stored in a PRIVATE
--      Storage bucket (unlike employee-photos, which is public — these can
--      be sensitive, so reads go through a gated proxy route, never a
--      public/signed URL handed to the browser).

-- ── 1. Org chart ───────────────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN reports_to_employee_id uuid REFERENCES employees(id);
COMMENT ON COLUMN employees.reports_to_employee_id IS
  'Optional — who this employee reports to, for the Org Chart view (/dashboard/admin/employees/org-chart). '
  'NULL = shown as a top-level node (e.g. the MD/owner, or simply not set yet).';

-- ── 2. Onboarding checklist ────────────────────────────────────────────
-- Per-company TEMPLATE (admin-configurable list of steps, e.g. "Offer
-- letter signed", "ID proofs collected", "Bank details on file", "System
-- access granted", "Induction completed") + a per-employee PROGRESS ledger
-- against it. A new checklist item added later does NOT retroactively mark
-- existing employees as needing it "again" — it simply appears as an
-- unchecked row for everyone the next time their checklist is viewed.
CREATE TABLE onboarding_checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  title       text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, title)
);
COMMENT ON TABLE onboarding_checklist_items IS
  'Per-company onboarding checklist TEMPLATE — admin-configurable list of steps. Not per-employee; '
  'see employee_onboarding_progress for who has actually completed which step.';

CREATE TABLE employee_onboarding_progress (
  employee_id             uuid NOT NULL REFERENCES employees(id),
  checklist_item_id       uuid NOT NULL REFERENCES onboarding_checklist_items(id),
  completed_at            timestamptz,
  completed_by_employee_id uuid REFERENCES employees(id),
  notes                   text,
  PRIMARY KEY (employee_id, checklist_item_id)
);
COMMENT ON TABLE employee_onboarding_progress IS
  'One row per (employee, checklist item) once first touched. completed_at IS NULL = not yet done — '
  'a row only needs to exist here once it has been checked at least once; an untouched item simply has '
  'no row and reads as "not done" by absence, same as attendance''s own "no row = derive it" convention.';

-- ── 3. Employee documents ──────────────────────────────────────────────
CREATE TABLE employee_documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             uuid NOT NULL REFERENCES employees(id),
  company_id              uuid NOT NULL REFERENCES companies(id),
  doc_type                text NOT NULL,   -- free text — "Aadhaar Card", "PAN Card", "Offer Letter (signed)", "Educational Certificate", ...
  file_name               text NOT NULL,
  storage_path            text NOT NULL,
  mime_type               text,
  file_size               bigint,
  notes                   text,
  uploaded_by_employee_id uuid REFERENCES employees(id),
  uploaded_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_employee_documents_employee ON employee_documents(employee_id, uploaded_at DESC);
COMMENT ON TABLE employee_documents IS
  'ID proofs, certificates, signed letters, etc. per employee. Files live in the PRIVATE '
  '"employee-documents" Storage bucket (storage_path is the object key, never a public URL) — served only '
  'through /api/employee-document/[id], gated to requireCapability("employee_admin"), same '
  'gated-download-proxy pattern as message-attachment/order-photo-proxy.';

-- PRIVATE bucket (public: false) — unlike employee-photos, these files may
-- be sensitive (ID proofs) and must never be reachable by a guessed/shared
-- URL. Idempotent — safe to run again.
insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', false)
on conflict (id) do nothing;
