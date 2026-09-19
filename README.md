# Audit Phase 3 — Cleanup (LOW severity) — 2026-09-19

Yeh Phase 3 hai — audit ke LOW severity items (C1 se C6). Pichle Phase 1 (Security+Money)
aur Phase 2 (Data Integrity) already deliver ho chuke hain. Neeche har item ka detail hai —
kya tha, kya fix kiya, kaunse files change hue.

---

## C1 — Credit Note Rate Difference Calculator mein GST missing tha

**Important: original audit finding thoda galat tha, yahan diagnosis correct kiya gaya hai.**

Pehle laga tha ki **Debit Note's** Rate Difference Calculator mein GST missing hai. Deep check
karne par pata chala ki Debit Note ka calculator already sahi hai by design — `debit_notes`
table mein `cgst_2_5pct`, `sgst_2_5pct`, `total_amount` GENERATED columns hain jo automatically
5% GST add kar dete hain. Yeh exactly waisa hi kaam karta hai jaisa uske apne worked example
mein documented hai (Qty 20, Debit Amount 200, CGST/SGST 5-5, Total 210). Isse chheda nahi gaya.

Asli bug **Credit Note's** parallel calculator mein mila — uske sibling flow (Bill Payment
panel ka apna CN dialog) mein pehle se hi `gst_rate_pct` field hai, lekin `documents` page ka
Rate Difference Calculator flow mein GST field tha hi nahi. Ab fix kar diya:

- Credit Note form mein GST % dropdown add kiya (No GST / 2.5% / 3% / 4% / 6% / 9% — same
  options jo Bill Payment panel already use karta hai).
- Base amount + GST breakdown preview mein dikhta hai ab ("Base ₹X + GST Y% = ₹Z").
- `credit_notes.gst_rate_pct` column (already exists, pehle se hi Bill Payment flow use karta
  tha) ab is flow se bhi set ho sakta hai. GST blank chhodne par pehle jaisa hi behavior (no
  GST) rehta hai — koi existing data ya flow break nahi hota.

Files: `src/app/dashboard/documents/actions.ts`, `src/app/dashboard/documents/credit-note-form.tsx`

---

## C2 — Currency conversion mein rounding double ho raha tha

`src/lib/orders/currency.ts` mein jab koi order INR ke alawa kisi aur currency mein hota tha,
to USD equivalent nikalne ke liye pehle INR ko round kiya jaata tha, phir us rounded value ko
exchange rate se divide karke USD nikalta tha — isse chhota sa rounding error accumulate ho
sakta tha. Ab USD seedha unrounded INR se derive hota hai, aur final INR value alag se round
hoti hai. Numbers ab zyada accurate hain, especially bulk/summary reports mein jahan yeh farak
add up ho sakta tha.

Files: `src/lib/orders/currency.ts`

---

## C3 — Dead code delete kiya

`src/app/dashboard/companion-preview/companion.tsx` aur `companion-config.ts` — yeh do files
kisi bhi jagah use nahi ho rahi thi. Companion feature already `src/components/companion/`
wali files use karta hai (`companion-character.tsx` / `companion-config.ts`) —
`companion-preview-client.tsx` unhi ko import karta hai. Confirm karne ke baad dono purani
files delete kar di gayi.

**Note:** Zip file mein deleted files "change" ke roop mein nahi dikhengi (zip sirf jo files
hain unhe hi rakhta hai) — is README mein explicitly note kiya ja raha hai taaki deploy karte
waqt yeh 2 files bhi manually delete ki jaayein: apne repo se
`src/app/dashboard/companion-preview/companion.tsx` aur
`src/app/dashboard/companion-preview/companion-config.ts` remove kar dena.

---

## C4 — Documents page slow load ho rahi thi (sequential queries)

`src/app/dashboard/documents/page.tsx` mein 4 alag-alag database queries ek ke baad ek
(sequentially) await ho rahi thi, jabki unmein koi dependency nahi thi — sab independent
queries thi. Ab sab `Promise.all([...])` mein parallel chalti hain. Page load speed better
hogi, especially jab bahut saare documents/bills honge.

Files: `src/app/dashboard/documents/page.tsx`

---

## C5 — Task Management ke background failures kahin dikhte nahi the

`src/app/dashboard/tasks/actions.ts` mein 2 jagah aisi thi jahan koi background/automatic
process fail ho sakta tha but usko sirf server console mein `console.error` kiya jaata tha —
koi bhi employee ya admin ko kabhi pata nahi chalta:

1. Task timer pause/complete karte waqt agar daily-time-log RPC call fail ho jaaye.
2. Task "Done" mark karte waqt agar `daily_work_logs` row create na ho paaye — is case mein
   task UI mein "Done" dikh jaata tha, lekin uska attendance/payroll record silently miss ho
   jaata tha (yeh sabse risky wala gap tha, kyunki payroll data ka gap invisible tha).

Dono jagah ab **Error Log tab** (Admin/MD, `/dashboard/error-log`) par dikhengi, ek naya
source "System" ke through. Existing 3 sources (Validation, Courier/API, Manual flag) mein
ab 4th source "System" add hua hai. Background action khud block/undo nahi hoga (jaisa pehle
tha) — sirf ab admin ko visibility milegi ki kuch fail hua.

Iske alawa ek chhota real bug bhi mila aur fix hua: `daily_work_logs` insert try/catch mein
tha, lekin Supabase query fail hone par exception throw nahi karta (sirf `{ error }` return
karta hai) — isliye woh try/catch us error ko kabhi catch hi nahi karta tha. Ab explicitly
error check karke throw kiya jaata hai, taaki catch block (aur naya Error Log entry) dono
kaam karein.

DB migration (`entry_errors.source` CHECK constraint mein 'system' add karna) **already live
apply ho chuki hai** (aapki permission se, isी session mein) — isliye yeh sirf documentation
ke liye zip mein hai, dobara run karne ki zaroorat nahi.

Files: `src/lib/error-log/log-entry-error.ts`, `src/app/dashboard/error-log/page.tsx`,
`src/app/dashboard/tasks/actions.ts`, `db/2026-09-19-entry-errors-system-source.sql`

---

## C6 — `db/schema.sql` outdated tha (documentation gap)

Live Supabase database mein 5 aise objects the jo `db/schema.sql` (jo poore schema ka
documentation/reference file hai) mein missing the:

- `pl_dashboard_by_company_month_view`
- `pl_dashboard_by_store_view` (Phase 2's B3 fix ke saath — purchase CN/DN netting included)
- `finance_dashboard_monthly()`
- `finance_dashboard_unlinked_purchase_washing()`
- `current_employee_id()`

Sab ab `schema.sql` mein add kar diye gaye hain, aur dependency order ka dhyan rakha gaya hai
(jaise ki agar koi is file ko top-se-bottom run kare, to koi bhi object apne referenced table
se pehle na aaye). Yeh sirf documentation update hai — koi live database change nahi (woh sab
migrations already apply ho chuki thi pichle phases mein).

Files: `db/schema.sql`

---

## Verification kiya gaya

- `db/schema.sql` ka balanced `$$` check (48/48, even) — koi syntax corruption nahi.
- `npx tsc --noEmit` — clean.
- `npx eslint` (saari 7 changed TS/TSX files par) — clean.
- `npm run build` (2 baar) — successful, saare 86 pages generate hue, koi error nahi.

## Deploy karte waqt yaad rakhna

1. Is zip ki saari files apne repo mein same relative path par copy kar dena.
2. **C3 ke 2 files manually delete karna** (upar dekhein) — zip mein nahi hain.
3. `db/2026-09-19-entry-errors-system-source.sql` migration **already live apply ho chuki
   hai** — dobara run karne ki zaroorat nahi, sirf record ke liye zip mein hai.
4. `db/schema.sql` ka poora fresh copy le lena (bahut saare changes hain isme).
