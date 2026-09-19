# Audit Phase 4 — Supabase Hardening + Old Reconciliation Check — 2026-09-19

Yeh Phase 4 hai — audit ka aakhri phase. Isme 2 items original audit se ZYADA serious nikle
(jo pehle "harmless cleanup" bola gaya tha) — dono ka DB fix **already live apply ho chuka hai**
aapki permission se. Neeche sab detail hai.

**Important: is zip mein saare DB migrations documentation ke liye hain — woh sab pehle se hi
live Supabase par apply ho chuke hain is session mein. Sirf 3 code files (.tsx) hain jo aapko
apne repo mein deploy karni hain.**

---

## D1 — Group Messaging RLS asli security bug (HIGH, already applied live)

Original audit mein yeh "10 duplicate RLS policies, harmless" bola gaya tha — galat tha. Asli
mein `conversations`, `conversation_members`, `conversation_messages`, `companion_events`,
`companion_character_image`, `help_articles`, `direct_messages` — in saari tables par ek
blanket policy (`allow_authenticated_all`) thi jo har logged-in employee ko full access deti
thi, jiski wajah se in tables ki "sahi" scoped policies (jaise "sirf apne conversation ke
messages dikhao") kaam hi nahi kar rahi thi.

**Confirm kiya ki yeh live exploit ho raha tha**: app ka apna "unread message badge" feature
(`messenger-popup.tsx`) bina kisi filter ke har naya group message live subscribe karta hai,
aur developer ka apna comment kehta hai ki yeh sirf RLS policy par depend karta hai — jo tab
tak kaam nahi kar rahi thi. Matlab har employee, apne hi login se, company ke SAARE group
conversations ka live data dekh sakta tha, chahe woh member ho ya na ho.

**Fix**: blanket policy hata di gayi, sahi scoped policies wapas rakh di gayi (perf bhi thodi
better ki gayi). Migration: `db/2026-09-19-messaging-companion-rls-scope-fix.sql` — **already
live apply ho chuka hai**, sirf record ke liye zip mein hai.

---

## D2 — 16 Financial/Report Views bhi seedha REST se accessible the (HIGH, already applied live)

Isi jaisa gap, financial reports ke liye. 16 views (`pl_dashboard_by_company_view`,
`stock_current_view`, `freight_reconciliation_view` etc.) "SECURITY DEFINER" hain — matlab
inki apni permission se chalti hain, caller ki RLS ko bypass karke. Confirm kiya (view ki SQL
khud padhkar): `pl_dashboard_by_company_view` mein koi company-filter hi nahi hai — saari
companies ka data ek saath return hota hai. Page ka apna capability-check (jaise
"reports"/"crm_dashboard") sirf app ke andar hai, database mein nahi — to koi bhi logged-in
employee, page bypass karke seedha REST call se, **saari companies ka poora P&L / stock /
freight-duty data** dekh sakta tha, chahe uske paas woh capability ho ya na ho.

Aapne "saari 16 views fix karo" confirm kiya tha.

**Fix**: in 16 views ka SELECT access `anon`/`authenticated` roles se hata diya gaya
(REVOKE) — sirf server-side service-role access rehta hai. Har page ka apna capability-gate hi
ab access control hai (jaisa poore app mein already hai), bas ab REST bypass se access nahi
milega. Migration: `db/2026-09-19-security-definer-views-revoke-authenticated.sql` —
**already live apply ho chuka hai**.

**3 code files change hui hain** (REVOKE ke baad in pages ka normal query client permission-denied
deta, isliye service-role client par switch kiya gaya — CRM aur Sale-Profit pages pehle se hi
yeh pattern use karte the):
- `src/app/dashboard/stock/page.tsx` (stock_current_view)
- `src/app/dashboard/reports/freight-duty/page.tsx` (freight_reconciliation_view, duty_reconciliation_view)
- `src/app/dashboard/statements/page.tsx` (ebay_financial_summary_computed_view)

**Yeh 3 files aapko deploy karni hain** — baaki sab DB-side already live hai.

---

## D3 — 23 functions mein mutable search_path (already applied live)

Standard Postgres hardening — har function ka `search_path` fix karke `public` par pin kar
diya, taaki koi future search_path override function ko galat table/type par redirect na kar
sake. Koi behavior change nahi, pure hardening. Migration:
`db/2026-09-19-function-search-path-hardening.sql` — **already live apply ho chuka hai**.

## D4 — current_employee_id() ka anon/authenticated access — check kiya, safe hai

Yeh function sirf caller ka apna employee id return karta hai (ya anon ke liye kuch nahi) —
koi data leak nahi. Koi change nahi ki.

## D5 — citext extension public schema mein — naya mila, is round mein touch nahi kiya

Advisor ke fresh scan mein mila, original list mein nahi tha. Iska schema change karna risky
hai (poore codebase mein `citext` type references break ho sakte hain) — flag kar diya, future
round ke liye.

## D6 — 122 unindexed foreign keys, 42 unused indexes — jaisa tha waisa hi chhoda

Yeh dono INFO level hain (WARN/ERROR nahi), performance hygiene hai, urgent nahi — jaisa original
audit mein bola gaya tha, isi round mein touch nahi kiya.

---

## E1 — Company Switcher Round 6 fix — code checkout mein confirm hai, live status pata nahi

Fix (`window.location.reload()` + naya `error.tsx` error boundary) current checkout mein present
hai. Live production site par actually kaam kar raha hai ya nahi — yeh check nahi kiya (isme
production site par login karke click-through karna padta, jo is round mein nahi kiya).

## E2 — Purane vendor-ledger reconciliation gaps — live check kiya, 3/5 fix ho chuke, 2 abhi bhi open hain

Directly Supabase mein check kiya:
- **Aramex RJ2425004810 double-payment** — ✅ THEEK HO GAYA. Ab `total_paid = total_amt`,
  balance zero hai.
- **UPS 5 payments** — ✅ THEEK HO GAYE. Saari 5 invoices ab fully paid hain DB mein.
- **Prachi Rugs 3 invoices** (P/26-27/36, 37, 38) — ✅ THEEK HO GAYE. Saari 3 fully paid hain.
- **FedEx 7 missing invoices** — ⚠️ ABHI BHI 3 BAAKI HAIN. 4 entry ho chuki hain, lekin yeh 3
  abhi bhi `bill_pass_register` mein missing hain: **276432162 (₹1,80,668.20)**,
  **276433820 (₹13,846.80)**, **276434395 (₹11,782.80)** — total **₹2,06,297.80** ek mahine se
  entry nahi hui.
- **New KR Printer ₹5,600 gap** — ❌ ABHI BHI OPEN HAI. Sirf ek bill (J-222, ₹7,150, paid) file
  mein hai — bank ledger ka doosra "AGAINST BILL" row (jo total ₹12,750 banata hai) abhi tak
  entry nahi hua.

**Yeh 2 gaps koi code bug nahi hain** — yeh real missing bill entries hain jinke liye poori
bill details (invoice date, GST split, etc.) chahiye jo sirf invoice_no + amount se nahi pata
chalti. Jab bhi yeh bills mil jayein (ya aap confirm kar dein ki chhodna hai), enter kar denge.

## E3 — FedEx production certification — koi change nahi, yeh aapka apna business step hai (code nahi)

---

## Verification kiya gaya

- `npx tsc --noEmit` — clean.
- `npx eslint` (3 changed files par) — clean.
- `npm run build` — successful, saare pages generate hue, koi error nahi.
- Har DB migration apply karne ke baad Supabase advisors dobara check kiye:
  `security_definer_view` (16 → 0), `function_search_path_mutable` (23 → 0),
  `auth_rls_initplan` (5 → 0), `multiple_permissive_policies` (10 → 0).

## Deploy karte waqt yaad rakhna

1. Saari DB migrations **already live hain** — dobara run karne ki zaroorat nahi.
2. **3 .tsx files** apne repo mein same relative path par copy kar dena — zaroori hai, warna
   Stock / Freight-Duty Report / Statements pages error dene lagengi (kyunki unka purana
   database access DB-side revoke ho chuka hai).
3. FedEx ke 3 missing bills (₹2.06L) aur New KR Printer ka ₹5,600 gap — jab bill details mil
   jayein to batayein, entry kar denge.
