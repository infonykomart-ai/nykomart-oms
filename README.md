# Build Fix — src/types/database.ts — 2026-09-19

## Kya toota tha

Pichhli deploy mein maine `database.ts` ki jo copy di thi, woh mere is session ke local checkout se
thi — aur woh checkout aapke live repo se **purani** nikli. Usmein kuch fields missing thi jo
aapke live code use kar raha tha, isliye build fail hua.

## Is zip mein kya hai (sirf 1 file)

`src/types/database.ts` — maine seedha aapke **live Supabase database** se check karke 2 cheezein
add ki hain:

1. `etsy_monthly_tax_invoices.account_opening_fee` — statement-entry update ke liye (yeh pehle hi
   sahi tha, is zip mein bhi hai).
2. `orders.photo_urls` — yeh column live Postgres mein hai (text, nullable) lekin types file mein
   missing tha. Isse `orders/[id]/page.tsx`, `orders/page.tsx`, `orders/print/page.tsx`, aur
   `orders/new/actions.ts` ke errors clear ho jaayenge.

## Jo is zip mein THEEK NAHI hua — aapko batana zaroori hai

Build log mein 2 aur error groups the:

1. **`crm/page.tsx`** — `pl_dashboard_by_month_view` se `company_id` select ho raha hai, jabki
   maine live database check kiya to us view mein `company_id` column hai hi nahi (woh view sirf
   month-wise hai; `company_id` wali alag view `pl_dashboard_by_company_month_view` hai). Yeh types
   ka issue nahi hai — yeh `crm/page.tsx` ke andar ka asli code bug lagta hai (galat view use ho
   rahi hai, ya dono views mix ho gayi hain).
2. **`capability-sync.ts`** — `sync_capabilities` naam ka ek Postgres function call karta hai jo
   maine live database mein check kiya to exist hi nahi karta.

**Yeh dono is session ke mere kaam se pehle ke hain — meri is session ke local copy mein yeh file
hi maujood nahi hai (`capability-sync.ts`), aur `crm/page.tsx` ka jo version mere paas hai woh
aapke live wale se kaafi chhota/purana hai.** Inhe blind guess karke "fix" karna risky hai — galat
ho sakta hai. In dono ko theek se fix karne ke liye mujhe yeh 2 files ka asli/live content chahiye
(GitHub web editor se copy-paste kar sakte hain, jaise database.ts kiya tha):

- `src/app/dashboard/crm/page.tsx`
- `src/lib/capability-sync.ts`

Yeh mil jaaye to turant patch de dunga.

## Deploy karte waqt

Sirf `src/types/database.ts` copy kar dein apne repo mein — isse `orders`/`photo_urls` wale sab
errors clear ho jaayenge. Baaki 2 error groups (`crm/page.tsx`, `capability-sync.ts`) tab tak
red rahenge jab tak un files ka content na mile.
