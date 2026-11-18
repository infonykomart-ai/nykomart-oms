# Purchase & Accounts (Phase 1) — audit, design and what is still gated

Migration: **`db/2026-11-18b-purchase-accounts-phase1.sql`** (folded into
`db/schema.sql`). Route: **`/dashboard/accounts`**. Tests:
`src/lib/accounts/*.test.ts`.

---

## 1. What the existing OMS already had (the audit)

Before adding anything, the existing code and `db/schema.sql` were inspected.
The accounting-adjacent pieces that already existed:

| Concern | Existing piece | Reused? |
|---|---|---|
| Office/cash expense logging | `internal_expenses` + `/dashboard/expenses` (bill header, party, invoice, multiple lines, P&L feed) | **Kept unchanged** — it is the P&L overhead feed, not a ledger |
| Vendor payable ledger | `bill_pass_register` + `journal_vouchers`, `/dashboard/bill-payment`, party ledger | **Reused** for purchase/courier/duty payables (Phase 2) |
| Purchase bills | `purchase_bills` (qty × area × rate, GST, round-off, printing kind) | **Reused** for Phase 2 |
| Bank/card accounts | `bank_recon_accounts` (opening balance, card vs bank, statement import) | **Linked** from `fin_accounts.bank_recon_account_id` |
| Measurement engine | `src/lib/measurement.ts` (length/area/weight/qty, exact conversions, `computePurchaseArea`) | **Reused** — Test 7's 10 rugs × 4 × 6 ft = 240 sq ft is proven through it |
| Numbering | `sequence_counters`, `reserve_next_number()`, `format_document_no()`, `fy_label()` | **Reused** — voucher numbers are `NM/EV/26-27/0001` |
| Audit | `audit_log` + `logAudit()` | **Reused** |
| Permissions | `capabilities` / `role_capabilities` / capability registry | **Extended** with 4 codes |
| Departments, employees, parties, roles | existing tables | **Reused** |

What did **not** exist and is therefore genuinely new: a chart of accounts, a
double-entry journal, voucher status workflow with approval limits, petty cash
sub-ledger, reimbursement claims, financial years, opening balances, and
per-company GSTIN/home state.

## 2. Why a new set of tables instead of extending `internal_expenses`

`internal_expenses` deliberately has no status, no GST breakup, no payment
account and no journal. Adding those columns would have made every existing
P&L query and expense screen depend on accounting state, and a posted voucher
would be editable from the P&L screen. The accounting module therefore keeps
its own voucher + journal, and the two modules stay independent:

* `internal_expenses` → P&L overhead line (unchanged).
* `expense_vouchers` → the accounting document, approved then posted.

Nothing in the existing order, inventory, shipping, courier or P&L workflow is
modified by this migration.

## 3. Tables added

| Table | Purpose |
|---|---|
| `fin_financial_years` | per-company FY (label, 1 Apr–31 Mar, current, locked) |
| `fin_accounts` | chart of accounts; cash/bank/petty/card are the same rows flagged with booleans; optional link to `bank_recon_accounts` |
| `fin_opening_balances` | one debit-or-credit row per account per FY, validated to balance, posted once |
| `expense_categories` | shared (`company_id NULL`) + per-company categories/subcategories, default GST rate, ITC eligibility, ledger account |
| `expense_vouchers` | the voucher header: type, mode, payment account, GSTIN/state, totals, status, approval stamps |
| `expense_voucher_items` | expense lines: qty × rate, discount, taxable value, CGST/SGST/IGST/cess, ITC |
| `expense_voucher_charges` | freight/loading/kanta/labour… each with its own GST and allocation method |
| `fin_journal_entries` | the double-entry ledger; written only by the three posting functions |
| `petty_cash_accounts` / `petty_cash_transactions` | custodian, opening balance, movements (allocation, replenishment, expense, return, verification) |
| `employee_expense_claims` | claim → review → payable, with a duplicate-claim fingerprint |
| `fin_approval_limits` | per-role approval ceiling + whether self-approval is allowed |
| `expense_voucher_events` | workflow trail (from → to, actor, reason) |
| `fin_settings` | legal name, GSTIN, home state, round-to-rupee |

Indexes cover company + date, status, payment account, party, FY, voucher and
account. A partial unique index on `(company_id, party_id, lower(invoice_no))`
prevents a duplicate vendor invoice (Test 9).

## 4. Accounting rules encoded in the system

* **All totals are integer paise** (`src/lib/accounts/money.ts`). No float is
  ever summed. Storage is `numeric(14,2)`.
* **GST split**: same state → CGST + SGST, interstate → IGST. The intrastate
  half is rounded once and the remainder goes to SGST, so the two heads always
  add up to the computed tax.
* **Inclusive/exclusive** both supported; inclusive extracts the base then the
  tax, so base + tax = the amount typed.
* **ITC**: only an ITC-eligible line debits the input-GST accounts. Ineligible
  GST stays inside the expense cost (never a fake asset).
* **UPI is a mode, not an account.** `validateVoucherHeader()` requires the
  payment account to be a bank account for UPI/NEFT/RTGS/IMPS/cheque, a cash
  account for Cash and a card account for Credit Card; a UPI voucher also
  requires its UTR. The journal credits that one bank account, so the amount
  appears once in the Bank Book and never in the Cash Book.
* **Posting is atomic and once**: `fin_post_expense_voucher()` locks the
  voucher, refuses unless it is `approved`, refuses if entries already exist,
  refuses a locked FY, re-checks that every account belongs to the company,
  verifies debit = credit, then writes the journal and flips the status — all
  in one transaction.
* **Posted is immutable**: corrections go through
  `fin_reverse_expense_voucher()`, which posts the exact opposite of every entry
  and marks the voucher cancelled.
* **Approval**: voucher must be `submitted`; self-approval is refused unless the
  role's `fin_approval_limits.can_self_approve` is set; a voucher above the
  role's limit cannot be approved by that role.
* **No negative petty cash**: an expense that would take the account below zero
  is refused before it is written.

## 5. UPI mapping (the prompt's Test 4) in practice

```
Internet bill ₹1,000 · mode UPI · account PNB Current · UTR …
Dr Office & Administrative Expenses   847.46
Dr Input CGST                          76.27
Dr Input SGST                          76.27
Cr PNB Current Account              1,000.00
```

* Bank Book: one ₹1,000 outflow.
* Cash Book: no entry.
* UPI report: one row, with the UTR and the bank account name.
* The unique `(source, source_id)`/per-voucher guard and the post function's
  "no existing entries" check make a double posting impossible.

## 6. Setup before Phase 2 (as requested)

Phase 2 purchase bills must not start on a zero ledger. Accounts setup
(`?tab=setup`) covers:

1. **Company settings** — legal name, GSTIN, home state (decides CGST/SGST vs
   IGST), round-to-rupee.
2. **Financial years** — label, start/end, current, locked. Migration seeds the
   current April–March year for every existing company.
3. **Cash / bank / UPI / card accounts** — real accounts, optionally linked to an
   existing `bank_recon_accounts` row, with a UPI handle. "Ensure default chart
   of accounts" creates the standard expense/GST/payable accounts by code.
4. **Opening balances** — one debit-or-credit row per account; the form refuses
   anything that does not balance; "Post to the ledger" calls
   `fin_post_opening_balances()` once per FY (it also refuses a second posting
   and a locked year).
5. **Approval limits** — per role.

## 7. Test coverage actually run

`npm test` covers the pure engine. The master-prompt scenarios proven there:

| Prompt test | Covered by |
|---|---|
| 1 — ₹5,000 electricity + 18% GST | `expense-calc.test.ts` (taxable 5,000; CGST 450; SGST 450; balanced journal) |
| 2 — ₹500 stationery in cash | same file (Cash Book + expense ledger, 2 lines) |
| 3 — ₹5,000 rent from PNB | covered by the same bank-credit path (Test 1/4 use a bank account) |
| 4 — ₹1,000 UPI from PNB | credits the bank account only, asserts cash is untouched |
| 5 — petty cash 5,000 / 1,500 / 2,000 → 5,500 | `petty-cash.test.ts` |
| 6 — ₹50,000 computer + ₹9,000 GST | asset debit 50,000, GST in input accounts |
| 7 — 10 rugs × 4 × 6 ft = 240 sq ft | `measureDimensions()` through the shared engine |
| 9 — duplicate bill | DB unique index (not unit-testable here) |
| 10 — cancelled bill | reversal function (integration) |
| 11 — same state vs interstate | CGST/SGST vs IGST tests |
| 12 — trial balance | all vouchers' journals are balanced; `validateJournal` |

Tests 8 (vendor payment outstanding), the GST-inclusive/discount/charge
allocation cases and the header rules (UPI must be a bank account, cash from
cash, card from card, GSTIN format, status transitions) are also covered.

## 8. What is NOT done yet (deliberately)

* **Phase 2** (common purchase bill entry, asset register, stock purchase,
  vendor payments) — the master prompt requires Phase 1 to be tested and
  approved first. The tables it will post into (`fin_journal_entries`,
  `fin_accounts`, `bill_pass_register`) and its setup are ready.
* **Phase 3** (P&L, balance sheet, cash flow, depreciation) — the journal exists;
  the statements are not built.
* **Phase 4** (unit master, Excel/PDF export of these reports, inventory
  integration) — measurement already uses the shared engine; exports come later.
* **Editing a submitted voucher** — draft/rejected can be deleted and re-entered;
  a posted voucher is corrected by reversal. In-place editing of an approved
  voucher is not offered on purpose.

## 9. Deploying

1. Run `db/2026-11-18b-purchase-accounts-phase1.sql` once in the Supabase SQL
   editor (idempotent). It also creates the `expense-receipts` storage bucket.
2. Redeploy on Vercel.
3. Open `/dashboard/accounts?tab=setup`, fill settings, add the real bank
   accounts and post opening balances.
4. Enter a test voucher, approve it, post it, and check the Trial Balance says
   **balanced**.
