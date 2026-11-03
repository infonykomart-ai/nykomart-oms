-- =============================================================================
-- 2026-11-03b — RETURN REQUESTS WITH MANDATORY APPROVAL
-- =============================================================================
--
-- RULE THIS FILE IMPLEMENTS (owner's words): "jab koi new refund ki entry ho
-- to direct feel ho jaye lekin agar return ki ho to uska approval ke liye
-- admin md vagera ke pass jaye ... final approval jaruri hai."
--
--   • REFUNDS stay exactly as they are — a refund entered by order-entry staff
--     is live immediately (order_refunds row + Credit Note + ledger effect).
--   • RETURNS are now a REQUEST: order-entry staff raise it, nothing changes
--     on the order, the refund register or the accounts until an authorised
--     MD/Admin approves it. Pending requests are visible in their own queue and
--     are never counted as a return.
--   • Approval is the ONLY path that applies the effect: the order is marked
--     Returned and, if a refund amount was requested, the normal
--     saveOrderRefundCore() path records the refund (cap checks included).
--
-- ACCESS: raising a return needs order_entry (or reports); deciding one needs
-- the new `return_approval` capability, seeded below to MD and Admin only.
--
-- Run this file ONCE in the Supabase SQL editor. The app is migration
-- tolerant: without it the Returns page shows a "run this file" banner and
-- refunds keep working unchanged.
-- =============================================================================

CREATE TABLE IF NOT EXISTS return_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES companies(id),
  requested_by       uuid REFERENCES employees(id),
  requested_at       timestamptz NOT NULL DEFAULT now(),
  reason             text NOT NULL,
  note               text,
  -- Optional refund the approver should apply together with the return.
  -- NULL amount = a plain return (goods back, no money movement).
  refund_amount      numeric(14, 2),
  refund_currency    text,
  refund_date        date,
  status             text NOT NULL DEFAULT 'Pending'
                       CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  decided_by         uuid REFERENCES employees(id),
  decided_at         timestamptz,
  decision_note      text,
  -- The order_refunds row created at approval time (NULL when approved
  -- without a refund, so "approved return" and "approved + refunded" stay
  -- distinguishable).
  applied_refund_id  uuid REFERENCES order_refunds(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_requests_company_status ON return_requests(company_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_return_requests_order ON return_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_requested_by ON return_requests(requested_by, status);

ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON return_requests FROM anon, authenticated;

-- Approval capability (MD/Admin only). Kept separate from order_entry so a
-- person who raises returns can never approve their own request.
INSERT INTO capabilities (code, description)
VALUES ('return_approval', 'Approve or reject customer return requests (release the refund and mark the order Returned)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'return_approval'
FROM roles r
WHERE r.name IN ('MD', 'Admin')
ON CONFLICT (role_id, capability_code) DO NOTHING;

-- Optional but recommended: the returns register now carries an approval
-- trail, so an order-entry user can see their own pending requests without
-- being able to decide them.
