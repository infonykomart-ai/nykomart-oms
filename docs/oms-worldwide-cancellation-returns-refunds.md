# Worldwide Order, Cancellation, Return, Refund & Duty-Refund management
### Audit of the existing NykoMart OMS + integration design (no duplicate ERP, no parallel sheets)

Date: 2026-11-01 · Scope: order cancellations (pre/post dispatch), returns & RTO, buyer refunds
(full/partial), international duty & import-VAT refunds, DDP/DDU, payment-gateway/chargeback
handling, export & GST documents, order-wise P&L, central dashboard.

This document is the **deliverable of the audit**: it maps every module the requirement asks for
onto tables, routes and actions that already exist in this codebase, names the real gaps, and
proposes the smallest set of additions. Nothing here asks for a second ERP — the rule followed
throughout is *extend the existing record, never re-record the same money in a new table*.

---

## 1. What already exists (audited, file by file)

| Area | Table / route | Notes |
|---|---|---|
| Orders | `orders` (`src/app/dashboard/orders`) | `ref_no`, `marketplace_order_no`, `store_id`, `company_id`, `order_date`, `dispatch_date`, `status` (`order_status` enum), `shipment_status`, `advance_tracking`, `final_tracking`, `invoice_id`, `order_currency`, `order_value_original`, `order_value_usd`, `order_value_inr`, buyer country/VAT/EORI/IOSS fields |
| Cancel (pre-dispatch) | `cancelOrder()` in `orders/actions.ts` | Sets `status = 'Cancelled'`; refund is a **separate** step |
| Cancel (post-dispatch) / RTO | `returnOrder()` | Sets `status = 'Returned'` (same value courier RTO already writes) |
| Refunds (live) | `order_refunds` + `saveOrderRefundCore()` | One row per refund: amount, currency, date, reason, `credit_note_id`, calculator breakdown (`order_value_refund_amount`, `shipping_refund_amount`, `duty_refund_amount`, `refund_basis_percent`), and `refund_amount_inr` / `refund_amount_usd` converted at the refund date's rate |
| Credit notes | `credit_notes` | Auto-created by `saveOrderRefundCore()` when the order already has an invoice (that *is* the "Dispatch & Refund" case) |
| Refunds (historical) | `refunds` | Imported marketplace sheets (`refund_source` = DISPATCH / FBA / NO_DISPATCH), USD only, read-only |
| Shipments / AWB | `order_shipments`, `order_packages`, `courier_shipments` (`awb_no`, `ddp_ddu`, `status`, `label_url`, `booked_amt`), `freight_bill_awb_assignments`, `duty_bill_awb_assignments` | AWB-level link between an order and its freight/duty cost already exists |
| Duty / import VAT (cost side) | `duty_tax_bills` (+`duty_tax_amt_usd/inr`, `gst_18pct_amt`, courier credit note `credit_note_no/date/amt`, `disbursement_fee`, `courier_duty_charges_adj`) | What the courier charged *us* for duty — not what the buyer paid |
| Export documents | `shipping_bills`, `dispatch_invoices`, `sales_invoices`, `debit_notes`, `internal_invoices` | Export invoice + shipping bill registers exist as entry logs |
| Payables / ledger | `bill_pass_register` (+`_payments`, `_adjustments`), `bill_approval_status` enum, approvals L1/L2 | Every vendor/courier bill, incl. DUTY TAX and FREIGHT INVOICE |
| Currency | `currencies`, `exchange_rates`, `customs_exchange_rates`, `fx_rate_cache`, `computeCurrencyConversion()` | Historical rates are already used per document date |
| P&L | `sale_profit_ledger`, `pl_dashboard_by_company_view`, `pl_dashboard_by_month_view`, Reports → Sale & Profit, `reports/pnl` route | `order_refunds.refund_amount_inr/usd` is already netted against revenue |
| Audit trail | `audit_log`, `entry_errors` | Generic entity/action/diff log; separate "wrong entry" review queue |
| Roles | `roles`, `capabilities`, `role_capabilities`, `requireCapability()` | `order_entry`, `reports`, `approve_level1`, `approve_level2`, … |

**Conclusion of the audit:** cancellation, return, auto credit note, refund caps, multi-currency
conversion, duty tracking *cost* side, AWB links, approvals, audit log and order-wise P&L already
exist. The system is **not** missing modules; it is missing (a) a refund *lifecycle* (requested →
approved → paid → failed) with duplicate prevention, (b) an explicit DDP/DDU + duty-refund
*recovery* ledger at order level, (c) a return/RTO tracking record tied to the AWB, and (d) a
single dashboard that puts all of it on one screen.

---

## 2. Module → existing record mapping (relationship keys)

```
orders.id ─┬─< order_refunds.order_id          (1 order → N refunds)
           ├─< credit_notes.order_id           (auto, when invoiced)
           ├──── orders.invoice_id → sales_invoices.id
           ├─< order_shipments.order_id ─< courier_shipments.order_shipment_id  (AWB, ddp_ddu)
           ├─< order_packages.order_id
           ├─< purchase_bills.order_id          (cost of goods for that order)
           ├─< sale_profit_ledger.order_id      (revenue/cost/profit snapshot)
           └─< order_refunds.credit_note_id >── credit_notes.id

duty_bill_awb_assignments.awb_no ── courier_shipments.awb_no ── duty_tax_bills.id
freight_bill_awb_assignments.awb_no ─ courier_shipments.awb_no ─ freight_bills.id
bill_pass_register.source = 'duty_bill' | 'freight_bill' | 'purchase_bill'  (id in source_id)
```

The business identifiers the requirement lists map as: **Order ID** → `orders.ref_no` /
`orders.id`; **Shipment ID** → `order_shipments.id`; **AWB** → `courier_shipments.awb_no`;
**Return ID** → proposed `order_returns.id` (§3.3); **Refund ID** → `order_refunds.id`;
**Payment txn ID** → proposed `order_refunds.gateway_txn_id` (§3.1); **Duty refund ID** → proposed
`order_refunds.duty_claim_id` / `duty_refund_claims.id` (§3.2).

---

## 3. Database changes — only where necessary

Four additions, all **additive and nullable**, so no existing row, report or query breaks. Every
proposal ships as a plain SQL file in `db/` that you run once in Supabase.

### 3.1 Refund lifecycle + duplicate guard (highest value, smallest change)

`order_refunds` today records money that has *already* left. It has no status, no gateway
reference and no guard against entering the same refund twice. Add:

```sql
create type refund_state as enum ('Requested','Approved','Processing','Paid','Failed','Cancelled');
alter table order_refunds
  add column state refund_state not null default 'Paid',      -- existing rows = already paid
  add column gateway_txn_id text,                             -- Razorpay/PayPal/Amazon/Etsy id
  add column approved_by_employee_id uuid references employees(id),
  add column approved_at timestamptz,
  add column failure_reason text;
-- duplicate guard at DB level (belt + braces to the app check):
create unique index order_refunds_no_duplicate
  on order_refunds (order_id, refund_currency, refund_amount, refund_date)
  where state in ('Requested','Approved','Processing','Paid');
```

Why this shape: `state` keeps the "money already gone" semantics for every historical row, and the
partial index blocks the exact duplicate (same order + currency + amount + date) without blocking a
legitimate second partial refund on the same day for a different amount.

### 3.2 Duty & import-VAT refund (buyer side vs customs recovery side)

Two different questions the requirement keeps apart:

* **Buyer duty refund** — what we return to the buyer. Already captured as
  `order_refunds.duty_refund_amount` (part of the refund total, converted to INR at refund date).
  No new column needed.
* **Customs / courier recovery** — what we claim back from the courier or customs. Tracked today
  only as a credit note on `duty_tax_bills` (`credit_note_no/date/amt`), which cannot express
  "claimed but not received". Add one small table:

```sql
create table duty_refund_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  order_id uuid references orders(id),
  awb_no text,
  duty_tax_bill_id uuid references duty_tax_bills(id),
  claim_type text not null check (claim_type in ('IMPORT_DUTY','IMPORT_VAT','DISBURSEMENT_FEE','EXPORT_GST')),
  claim_currency varchar(3) not null references currencies(code),
  claim_amount numeric(14,2) not null check (claim_amount > 0),
  claim_date date not null,
  received_amount numeric(14,2) not null default 0,
  received_date date,
  status text not null default 'Pending' check (status in ('Pending','Claimed','Partially Received','Received','Rejected')),
  document_ref text,          -- shipping bill / CSB-V / GST refund ARN
  remark text,
  entry_by_employee_id uuid not null references employees(id),
  created_at timestamptz not null default now()
);
```
`claim_type = 'EXPORT_GST'` is what keeps the export-GST refund (rule 15 / LUT / ARN) separate from
the international import-duty refund, as required.

### 3.3 Return / RTO record (tied to the original order and AWB)

`orders.status = 'Returned'` says *that* it came back, not *why*, *when*, *which parcel*:

```sql
create table order_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  order_id uuid not null references orders(id),
  order_shipment_id uuid references order_shipments(id),
  awb_no text,
  return_type text not null check (return_type in ('CUSTOMER_RETURN','RTO','REFUSED','DAMAGED','WRONG_ITEM')),
  reason text,
  requested_date date,
  received_date date,
  restocked boolean not null default false,
  status text not null default 'Requested' check (status in ('Requested','In Transit','Received','Closed','Rejected')),
  entry_by_employee_id uuid not null references employees(id),
  created_at timestamptz not null default now()
);
```
Restocking today happens inside `saveOrderRefundCore()` (unconditional, qty from
`purchase_bills`/`orders.qty`). Once `order_returns.received_date` exists, restock should move
there — otherwise the same unit is restocked twice (once on return receipt, once on refund).

### 3.4 Nothing else

No new order-status enum values, no new currency table, no new P&L table, no duplicated
cancellation table. Cancellation stays `orders.status`; refund stays `order_refunds`.

---

## 4. Business logic (rules, as implemented + as to be added)

**Cancellation**
1. Pre-dispatch (`status` before `Dispatched`, no `invoice_id`, no AWB): `cancelOrder()` → optional
   refund row → `state = 'Paid'`; no credit note, category "No Dispatch & Refund".
2. Post-dispatch (AWB exists or `dispatch_date` set): `cancelOrder()` must be blocked in favour of
   `returnOrder()`; the cancellation is then a return + refund and the courier RTO flow applies
   (`order_returns`, `return_type = 'RTO'`).
3. A cancelled/returned order cannot be dispatched again (guard on `dispatch_date`).

**Refund**
4. `refund_amount` ≤ refundable balance, checked twice — same-currency cap and an independent INR
   cap (already implemented in `saveOrderRefundCore()`; do not weaken either).
5. Full refund only when the refunded total covers `order_value_inr` (INR comparison, already
   implemented); otherwise `PARTIAL REFUND`.
6. Duplicate prevention: the unique index in §3.1 + the app check
   ("same order, same currency, same amount, same date already exists").
7. Each refund is converted at the **refund date's** rate and stored (`refund_amount_inr/usd`) so a
   later rate change never rewrites history.
8. Refund on an invoiced order auto-creates the credit note (GST document); a refund on an
   uninvoiced order must not.
9. `state` transitions only forward: Requested → Approved → Processing → Paid / Failed; a Failed
   refund may be retried as a *new* attempt (new `gateway_txn_id`) but not edited.
10. Refund approval needs `approve_level1` (amount ≤ threshold) or `approve_level2`; the same
    employee who requested cannot approve their own refund.

**Duty**
11. DDP: duty is our cost → `duty_tax_bills` → Finance ledger; a buyer duty refund is possible only
    if the buyer actually paid duty (proof: courier invoice/portal receipt).
12. DDU: buyer pays duty at the door → we may still advance it (disbursement) and recover it; the
    recovery is a `duty_refund_claims` row, never a reduction of the order value.
13. Export GST refund and import duty/VAT refund are separate `claim_type` values and separate
    dashboards; they must never net against each other.

---

## 5. Automation, alerts and integration points

| Requirement | Implementation |
|---|---|
| Order status sync | Existing status/shipment_status writers; RTO webhook sets `Returned` |
| Refund eligibility validation | `saveOrderRefundCore()` caps (already live) |
| Duplicate refund prevention | §3.1 unique index + pre-insert check |
| Auto refund calculation | Refund calculator in `order-hold-cancel-actions.tsx` (`refund_basis_percent` → order value + shipping + duty parts) |
| Pending refund alert | Query `order_refunds.state in ('Requested','Approved','Processing')` older than N days → dashboard tile + notification (existing companion-notify helper) |
| Pending return alert | `order_returns.status in ('Requested','In Transit')` |
| Pending duty claim alert | `duty_refund_claims.status in ('Pending','Claimed','Partially Received')` |
| Missing export document alert | `shipping_bills` absent for an export invoice / CSB-V missing for a duty claim |
| Audit log | `audit_log` row on every cancel/return/refund/claim mutation (`entity_type = 'order_refund' \| 'order_return' \| 'duty_refund_claim'`) |
| Webhooks | courier tracking → `order_shipments`/`courier_shipments`; payment gateway → refund `state` + `gateway_txn_id`; marketplace → `marketplace_order_no` refund sheets |

---

## 6. Dashboard (one screen, existing routes)

Reports → Returns & Refunds (this release) already shows: refunds recorded in OMS (count, USD and
other-currency totals, dispatch vs no-dispatch split, duty refunded), marketplace sheets total,
orders in range with cancelled/returned counts and %, refund rows as % of orders, plus per-store
return/cancel rates and both refund tables with CSV/Excel/Word/PDF export.

To be added on the same page once §3 ships: pending refunds (count + amount by state), pending
returns, pending duty claims (claimed / received / outstanding), shipping loss
(`freight_bills` − recovered), gateway charges (from settlement data), and net
revenue − refunds − duty − gateway − freight from the existing P&L views. All of these are
aggregations over tables that already exist, not new storage.

---

## 7. Test cases (international scenarios)

| # | Scenario | Expected |
|---|---|---|
| 1 | US buyer cancels before dispatch, no invoice | Status `Cancelled`, refund row category "No Dispatch & Refund", no credit note, no duty claim |
| 2 | UK buyer cancels after AWB but before delivery, DDP | Cancel blocked → `returnOrder()`, `order_returns` RTO, refund full, credit note created, duty claim allowed (DDP) |
| 3 | Germany buyer, DDU, refuses parcel at door | `Returned` + `REFUSED`, no duty refund to buyer (buyer never paid us duty), courier RTO tracked on AWB |
| 4 | Canada buyer, partial refund 40% of order value | `PARTIAL REFUND`, INR converted at refund date, revenue netted only by that amount |
| 5 | Same partial refund submitted twice, same day, same amount | Second attempt rejected by duplicate guard (index + app message), no second credit note |
| 6 | Two partial refunds same day, different amounts | Both allowed while total ≤ order value |
| 7 | Refund that would exceed order value (USD order, USD refund) | Rejected with the exact over-limit figure |
| 8 | Refund entered in EUR against a USD order | INR safety-net cap applies; no cross-currency primary comparison |
| 9 | Australia buyer paid import GST at door (DDU), then returns | Buyer duty refund tracked in `order_refunds.duty_refund_amount`; independent `duty_refund_claims` recovery with proof document |
| 10 | Courier wrongly charged duty on a DDP shipment | `duty_refund_claims` `IMPORT_DUTY` claim, `Pending` → `Received`, never touches buyer refund |
| 11 | Export order, GST refund (LUT/ARN) pending | `duty_refund_claims` `EXPORT_GST`, missing-document alert until shipping bill + ARN captured |
| 12 | Order refunded while `exchange_rates` later changes | Historical refund amount in INR/USD unchanged; new refunds use the new rate |
| 13 | Refund approved by the same employee who requested it | Blocked by approval rule (needs other approver / L2 above threshold) |
| 14 | Refund marked `Processing` then gateway fails | `Failed` + `failure_reason`; retry allowed as a new attempt, original row kept |
| 15 | Return received but refund never entered | Pending-refund alert; restock happens once, at return receipt, not again on refund |

---

## 8. What was changed in this release (code)

* `src/app/dashboard/returns/page.tsx` — rewritten copy (plain English, no Hinglish), company filter
  moved into the query (`orders!inner`) so it actually filters instead of filtering the *page* after
  `.limit(300)`, new **Store** and **Order no.** filters, an all-stores summary card, a refund-rate
  card, and a duty-refunded total on the OMS card.
* `src/app/dashboard/returns/returns-report-tables.tsx` — section titles/subtitles now say exactly
  what counts what and which date each table uses.

Sections 3 and 4 above are **specification + ready SQL**; they are not applied here because they
change the refund lifecycle (approvals, gateway callback), which is a separate, reviewable step.
