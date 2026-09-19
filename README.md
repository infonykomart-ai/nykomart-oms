# Audit Phase 2 — Data integrity bugs fixed (2026-09-19)

Ye zip full system audit (`claude/full-system-audit-2026-09-19.md`) ke Phase 2 MEDIUM-severity
fixes hai — data integrity wale bugs (paisa/security wale Phase 1 se alag).

## Kya fix hua

### 1. `sales_invoices.master_invoice_no` — ab unique guarantee hai (item B2)
Pehle sirf `invoice_no` pe hi uniqueness guard tha (`UNIQUE (company_id, invoice_no)`).
`master_invoice_no` pe koi guard hi nahi tha — jabki manual-numbering wala path
(`src/app/dashboard/invoices/actions.ts`) `reserve_next_number()` skip kar deta hai aur sirf
DB constraint pe hi bharosa karta hai duplicate rokne ke liye. Matlab do invoices galti se
same Master Invoice No. share kar sakte the — ye number FedEx ke Department Reference No. jaisi
customs paperwork me use hota hai, to ye real risk tha.

- `db/2026-09-19-sales-invoices-master-invoice-no-unique.sql` — naya `UNIQUE (company_id,
  master_invoice_no)` constraint.
- `db/schema.sql` — wahi constraint table definition me bhi add kar diya (documentation ke liye).
- `src/app/dashboard/invoices/actions.ts` — jab constraint fire ho, to error message ab sahi
  field batata hai (pehle hamesha "invoice_no" bolta tha, chahe galti `master_invoice_no` me
  ho).
- **Live Supabase pe already apply ho chuka hai (aapki permission se)** — run karne se pehle
  check kiya tha ki koi existing duplicate to nahi hai, zero mile, to safe tha.

### 2. Store-wise P&L aur Finance Dashboard — Credit/Debit Note ab account hoti hai (item B3)
Company-wide P&L tab (`pl_dashboard_by_company_view`) purchase bill ke against jo Credit/Debit
Note adjustment hota hai, use already subtract karta tha expense me se. Lekin Store/Marketplace
tab (`pl_dashboard_by_store_view`) aur Finance Dashboard
(`finance_dashboard_monthly()` function) ye adjustment bilkul nahi dekhte the — sirf gross
purchase amount count karte the. Matlab same period ke liye Company tab aur Store/Finance
Dashboard tab ka net profit match nahi karta tha jab bhi koi purchase CN/DN hota.

- `db/2026-09-19-pl-store-finance-purchase-cn-netting.sql` — dono jagah (Store view + Finance
  Dashboard function) me ab wahi Credit/Debit Note netting hai jo Company view me pehle se hai.
- Abhi live data me is tarah ka koi adjustment row hai hi nahi, to koi number turant nahi
  badlega — ye future-proof correctness fix hai jo agli baar aisi CN/DN aane pe sab tabs ko
  automatically consistent rakhega.
- **Live Supabase pe already apply ho chuka hai (aapki permission se)**, dono objects verify
  kiya — Store view 18 rows, Finance Dashboard function 4 months of data return kar raha hai,
  dono clean chal rahe hai.

## Verification kiya

- `npx tsc --noEmit` — poora project, clean.
- `npx eslint` — changed file (`invoices/actions.ts`) pe clean.
- `npm run build` — poora production build successfully complete hua ("✓ Compiled
  successfully").
- Supabase me live confirm kiya: `master_invoice_no` constraint exists
  (`pg_constraint` se), `pl_dashboard_by_store_view` aur `finance_dashboard_monthly()` dono
  bina error ke data return kar rahe hai.

## Deploy kaise karein

1. Is zip ko apne repo me extract karo — 4 files: `db/schema.sql` (replace), 2 nayi `.sql`
   migration files (documentation/reference ke liye — already run ho chuki hai), aur
   `src/app/dashboard/invoices/actions.ts` (replace).
2. `npm run build` chalao apne pipeline me.
3. Deploy kar do.

DB migration is round me KOI naya step nahi hai aapke liye — dono migrations maine khud hi
Supabase me apply kar diye hai (aapki permission se, har ek ke liye alag se poocha tha).

## Baaki phases

Phase 3 (Cleanup, LOW) aur Phase 4 (Supabase hardening + old reconciliation check) abhi baaki
hai. Full list `claude/full-system-audit-2026-09-19.md` project doc me hai. Batao kab agla
phase shuru karu.
