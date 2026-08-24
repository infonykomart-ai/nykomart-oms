-- =====================================================================
-- Automation rules engine — v1, 2026-08-24.
--
-- WHY: requested after comparing against OpenOMS, which has a trigger ->
-- condition -> action engine. This is a deliberately small v1 of the same
-- shape, NOT a port of OpenOMS's version (that one has ~9 action types
-- including customer-facing webhook/email/marketplace-message actions).
--
-- IMPORTANT SCOPE DECISION: action types are internal-only (add_remark,
-- set_tag) — nothing that messages a customer. This directly follows an
-- earlier explicit decision (2026-08-18) to keep WhatsApp customer notify
-- as a manual "Share on WhatsApp" button, not auto-send. If auto-messaging
-- is wanted later, that's a new decision to make deliberately, not
-- something this engine should do by default.
--
-- v1 trigger: 'order.status_changed' only, fired from holdOrder/
-- cancelOrder (src/app/dashboard/orders/actions.ts) — the two dedicated
-- status-changing actions. Not wired into every place status can change
-- (e.g. the order edit form's status field, bulk-tracking-update's
-- shipment_status write) yet — same incremental-rollout approach as the
-- audit log. See src/lib/automation/engine.ts for the trigger/condition/
-- action evaluation itself.
--
-- Conditions are AND-only (same simplification OpenOMS itself effectively
-- has — see claude/openoms-comparison-and-speed-2026-08-24.md). Stored as
-- a jsonb array so more conditions/actions per rule, and more trigger
-- types, can be added later without a schema change — v1's own UI only
-- exposes one condition + one action per rule to keep the form simple.
--
-- Idempotent (ON CONFLICT DO NOTHING / IF NOT EXISTS) — safe to re-run.
-- =====================================================================

BEGIN;

-- v1 action target: append a short auto-note to the order, or set a small
-- internal tag/flag. Additive column on orders — nullable, no backfill
-- needed, doesn't touch orders.remark (a separately-editable free-text
-- field already used for other things).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS automation_tag text;

CREATE TABLE IF NOT EXISTS automation_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid REFERENCES companies(id),  -- NULL = applies across every company the trigger fires for
  name                   text NOT NULL,
  trigger_type           text NOT NULL,                  -- 'order.status_changed' is the only value in v1
  enabled                boolean NOT NULL DEFAULT true,
  conditions             jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{field, operator, value}, ...] — AND-only
  actions                jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{type, value}, ...] — run in order
  created_by_employee_id uuid REFERENCES employees(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  fire_count             integer NOT NULL DEFAULT 0,
  last_fired_at          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules(trigger_type) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS automation_rule_logs (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id  uuid NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id),
  fired_at timestamptz NOT NULL DEFAULT now(),
  result   text NOT NULL,   -- 'applied' | 'error'
  detail   text
);
CREATE INDEX IF NOT EXISTS idx_automation_rule_logs_rule ON automation_rule_logs(rule_id, fired_at DESC);

ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON automation_rules;
CREATE POLICY allow_authenticated_all ON automation_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE automation_rule_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rule_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON automation_rule_logs;
CREATE POLICY allow_authenticated_all ON automation_rule_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO capabilities (code, description) VALUES
  ('automation_admin', 'Create/manage automation rules (trigger -> condition -> action) — the Automation Rules screen')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'automation_admin' FROM roles r WHERE r.name IN ('Admin', 'MD')
ON CONFLICT DO NOTHING;

COMMIT;
