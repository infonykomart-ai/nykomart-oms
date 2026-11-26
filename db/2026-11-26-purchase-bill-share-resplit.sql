-- 2026-11-26 — Purchase Bill: re-split a drifted invoice group's Finance shares.
--
-- WHY (the 2026-11-25 bug, in one paragraph)
--   A Purchase Bill is stored one `purchase_bills` row per item, but Finance
--   books the INVOICE: `sendPurchaseBillInvoiceToFinance` posts one
--   `bill_pass_register` row per item and apportions the approved invoice
--   total across them in proportion to each item's own `g_total_plus_gst`.
--   So a ledger row's `total_amt` is a SHARE of a group total, never a copy of
--   its own bill. The old edit path wrote the edited item's own `g_total` into
--   its ledger row: one share became a whole line value, the group's payable
--   moved by the difference, and every sibling share stayed stale. The app now
--   re-splits the group on every edit (src/lib/ledger/apportion.ts +
--   syncPurchaseBillLedgerShares in documents/actions.ts); this file repairs
--   the groups an edit already broke, BEFORE that fix.
--
-- THE INVARIANT THIS RESTORES
--   For every invoice group — (vendor party, vendor invoice no., invoice date),
--   the same identity the posting and edit paths use — the sum of its live
--   ledger shares is exactly the figure Finance reviewed, and each share is
--   that total apportioned by the items' own weights:
--       share_i = round(weight_i / Σweight × group_total, 2)
--   with the last row (by ledger-row id) absorbing the paise remainder so the
--   parts add up to the group total EXACTLY. The group total is NEVER changed
--   here: a group that was already out of step with its bills keeps the
--   payable finance approved — only the split underneath it is corrected.
--   That is the honest repair; re-deriving the total from the bills would
--   quietly rewrite money somebody may already have reviewed or paid.
--
-- WHAT COUNTS AS LIVE
--   `source = 'purchase_bill'`, `source_id` set, and NOT
--   `merged_into_bill_id` — a merged duplicate is audit-only (its amount was
--   netted to zero by db/2026-09-14-bill-merge.sql) and holds no share.
--   Weights come from the bills that own those live rows only, which is
--   exactly what the app's re-split uses.
--
-- GROUPING — THE PARTITION
--   PARTITION BY (vendor_party_id, lower(btrim(vendor_invoice_no)),
--   vendor_invoice_date). The date is part of the key on purpose: the same
--   vendor number could be re-issued in another year, and an undated bill is
--   deliberately NOT folded into a dated group (the app's own loader takes the
--   same conservative route). A single-share group is already proportional, so
--   only groups with two or more live shares are touched.
--
-- IDEMPOTENT
--   The UPDATE only writes rows whose `total_amt` differs from the computed
--   share (`IS DISTINCT FROM`), so a second run changes 0 rows and writes 0
--   audit rows. The audit INSERT additionally skips any ledger row that
--   already carries this action, so even a manual re-run of the file — or a
--   later legitimate re-split of the same row — cannot duplicate an entry.
--
-- AUDIT TRAIL
--   One `audit_log` row per CHANGED ledger row (action
--   `purchase_bill.ledger_share_resplit`, entity `bill_pass_register`), with
--   from → to, the group total it was split out of, the owning purchase bill
--   and the reason. On the database this was written against the repair
--   changes 34 rows, so it writes 34 audit rows; on any other database the
--   count is whatever the report below prints — the two always match, because
--   both read the same `changed` set.
--
-- SAFE TO RUN MORE THAN ONCE. Read the report at the end before COMMIT-ing?

BEGIN;

-- ── 1. The repair ───────────────────────────────────────────────────────────
WITH bills AS (
  SELECT
    pb.id,
    pb.vendor_party_id,
    pb.vendor_invoice_date,
    lower(btrim(pb.vendor_invoice_no)) AS inv_no,
    -- Same weight the app uses: g_total_plus_gst, falling back to total_amount,
    -- and never negative (a negative weight would invert the split).
    GREATEST(COALESCE(pb.g_total_plus_gst, pb.total_amount, 0), 0)::numeric AS weight
  FROM purchase_bills pb
  WHERE pb.vendor_party_id IS NOT NULL
    AND pb.vendor_invoice_no IS NOT NULL
    AND btrim(pb.vendor_invoice_no) <> ''
),

live_shares AS (
  SELECT bpr.id AS mirror_id, bpr.company_id, bpr.source_id AS bill_id, bpr.total_amt
  FROM bill_pass_register bpr
  WHERE bpr.source = 'purchase_bill'
    AND bpr.source_id IS NOT NULL
    AND bpr.merged_into_bill_id IS NULL
),

grouped AS (
  SELECT
    l.mirror_id,
    l.company_id,
    l.bill_id,
    l.total_amt AS old_total,
    b.inv_no,
    b.vendor_party_id,
    b.vendor_invoice_date,
    b.weight,
    sum(l.total_amt) OVER w          AS posted_total,   -- what finance reviewed
    sum(b.weight)    OVER w          AS weight_sum,
    count(*)         OVER w          AS share_count,
    -- Deterministic remainder row: the highest ledger-row id in the group.
    row_number() OVER (
      PARTITION BY b.vendor_party_id, b.inv_no, b.vendor_invoice_date
      ORDER BY l.mirror_id
    ) AS rn
  FROM live_shares l
  JOIN bills b ON b.id = l.bill_id
  WINDOW w AS (PARTITION BY b.vendor_party_id, b.inv_no, b.vendor_invoice_date)
),

base AS (
  SELECT
    g.*,
    CASE
      WHEN g.weight_sum > 0 THEN round(g.weight * g.posted_total / g.weight_sum, 2)
      ELSE 0::numeric
    END AS base_share
  FROM grouped g
),

targets AS (
  SELECT
    b.*,
    CASE
      WHEN b.rn = b.share_count THEN
        round(
          b.posted_total
            - (sum(b.base_share) OVER (
                 PARTITION BY b.vendor_party_id, b.inv_no, b.vendor_invoice_date
               ) - b.base_share),
          2
        )
      ELSE b.base_share
    END AS target_amount
  FROM base b
  WHERE b.share_count > 1
),

changed AS (
  UPDATE bill_pass_register bpr
     SET total_amt = t.target_amount
    FROM targets t
   WHERE bpr.id = t.mirror_id
     AND bpr.total_amt IS DISTINCT FROM t.target_amount
  RETURNING
    bpr.id           AS mirror_id,
    bpr.company_id   AS company_id,
    bpr.source_id    AS purchase_bill_id,
    bpr.total_amt    AS new_total,
    t.old_total      AS old_total,
    t.posted_total   AS group_total,
    t.inv_no         AS inv_no
),

-- ── 2. The audit trail, one row per changed ledger row ──────────────────────
audited AS (
  INSERT INTO audit_log (
    company_id, employee_id, employee_name,
    action, entity_type, entity_id, entity_label, changes
  )
  SELECT
    c.company_id,
    NULL,
    'System (db/2026-11-26-purchase-bill-share-resplit.sql)',
    'purchase_bill.ledger_share_resplit',
    'bill_pass_register',
    c.mirror_id,
    'invoice ' || c.inv_no,
    jsonb_build_object(
      'total_amt',    jsonb_build_object('from', c.old_total, 'to', c.new_total),
      'group_total',  c.group_total,
      'purchase_bill_id', c.purchase_bill_id,
      'reason', 'Item edit had overwritten this proportional share with the line value. Restored to its share of the invoice group total; the group total itself is unchanged.'
    )
  FROM changed c
  WHERE NOT EXISTS (
    SELECT 1
    FROM audit_log a
    WHERE a.action = 'purchase_bill.ledger_share_resplit'
      AND a.entity_type = 'bill_pass_register'
      AND a.entity_id = c.mirror_id
  )
  RETURNING 1
)

SELECT
  (SELECT count(*) FROM changed) AS shares_resplit,
  (SELECT count(*) FROM audited) AS audit_rows_written;

COMMIT;


-- ── 3. VERIFY (read-only — run these after COMMIT) ─────────────────────────
--
-- a) The invariant: every multi-share invoice group must be proportional to
--    its bills, splitting that group's own posted total. Expect 0 rows. The
--    one remainder row per group may sit a few paise off its exact share, so
--    that case is excluded here the same way the app's probe excludes it.
--    (This is exactly what probe "invoice groups proportional to their bills"
--    checks at /dashboard/admin/migrations.)
--
-- WITH shares AS (
--   SELECT bpr.id, bpr.total_amt,
--          pb.vendor_party_id,
--          lower(btrim(pb.vendor_invoice_no)) AS inv_no,
--          pb.vendor_invoice_date,
--          GREATEST(coalesce(pb.g_total_plus_gst, pb.total_amount, 0), 0)::numeric AS weight
--     FROM bill_pass_register bpr
--     JOIN purchase_bills pb ON pb.id = bpr.source_id
--    WHERE bpr.source = 'purchase_bill'
--      AND bpr.merged_into_bill_id IS NULL
--      AND pb.vendor_party_id IS NOT NULL
--      AND btrim(coalesce(pb.vendor_invoice_no, '')) <> ''
-- ),
-- grouped AS (
--   SELECT s.*,
--          sum(s.total_amt) OVER w AS posted_total,
--          sum(s.weight)    OVER w AS weight_sum,
--          count(*)         OVER w AS share_count,
--          row_number() OVER (
--            PARTITION BY s.vendor_party_id, s.inv_no, s.vendor_invoice_date
--            ORDER BY s.id
--          ) AS rn
--     FROM shares s
--   WINDOW w AS (PARTITION BY s.vendor_party_id, s.inv_no, s.vendor_invoice_date)
-- )
-- SELECT count(*) AS rows_off_their_share
--   FROM grouped g
--  WHERE g.share_count > 1
--    AND g.weight_sum > 0
--    AND abs(g.total_amt - round(g.weight * g.posted_total / g.weight_sum, 2)) > 0.01
--    AND NOT (
--      g.rn = g.share_count
--      AND abs(g.total_amt - round(g.weight * g.posted_total / g.weight_sum, 2))
--          <= round(0.01 * (g.share_count - 1), 2) + 0.001
--    );
--
-- b) Idempotency proof: re-running the repair statement must report
--    shares_resplit = 0, audit_rows_written = 0.
--
-- c) The audit rows this file wrote:
--
-- SELECT created_at, entity_id, entity_label, changes
--   FROM audit_log
--  WHERE action = 'purchase_bill.ledger_share_resplit'
--  ORDER BY created_at DESC;
