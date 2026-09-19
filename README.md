# Audit Phase 1 — Security + Money bugs fixed (2026-09-19)

Ye zip full system audit (`claude/full-system-audit-2026-09-19.md`) ke Phase 1 HIGH-severity
fixes hai — security aur paisa-galat wale bugs.

## Kya fix hua

### 1. Courier booking — cross-company booking block ho gaya
`src/app/dashboard/courier-booking/actions.ts` — FedEx/UPS/Aramex/Delhivery/Shiprocket/DHL,
sabhi 6 booking actions ab order ko book karne se PEHLE check karte hai ki wo order employee ke
access wali company ka hi hai. Pehle koi bhi order_id bhej ke, kisi bhi company ke against real
shipment book ho sakti thi (galti se ya jaan-bujh kar).

### 2. Group message — bina login check ke data leak band hua
`src/app/dashboard/messages/popup-actions.ts` — `getGroupMembers` me koi bhi auth check nahi
tha — koi bhi conversation ID daal ke un members ke naam nikal sakta tha, chahe wo us group me
ho ya na ho. Ab signed-in employee + us group ka member hona zaroori hai.

### 3. `listRelatedNotesForBills` me bhi wahi gap band kiya (precautionary)
`src/app/dashboard/documents/actions.ts` — abhi tak sirf safe jagah se hi call ho raha tha,
lekin isme bhi koi auth check nahi tha. Future me galti se client component se call ho jata to
yehi leak ban jata — pehle hi fix kar diya.

### 4. Multi-AWB Credit Note — GST wala under-credit fix
`src/app/dashboard/bill-payment/credit-note-actions.ts` — jab ek Credit Note me multiple AWB
bills cover hote the (GST ke saath), to Credit Note document me to poora GST-inclusive amount
dikhta tha, lekin har bill ka payable sirf BASE amount se kam hota tha — matlab vendor ko GST
ka hissa real me kabhi credit hi nahi hota tha bill-wise. Ab har bill ka adjustment bhi
GST-inclusive amount se hi hota hai, poora total Credit Note document se exactly match karta
hai.

### 5. Refund — different currency me cap bypass ho jata tha, fix kiya
`src/app/dashboard/orders/actions.ts` —
- Pehle: agar refund order ki currency se ALAG currency me enter hota tha, to koi limit hi
  nahi lagti thi — order ki value se kितना bhi zyada refund ho sakta tha.
- Ab: same-currency wala original check (jo aapne pehle explicitly decide kiya tha) bilkul
  wahi hai, waisa hi rahega. Uske saath ek DOOSRA, independent INR-based safety-net cap add
  kiya — jo app already har refund ke liye INR me convert karke store karta hai, wahi number
  reuse kiya hai. Matlab ab kisi bhi currency me refund enter karo, ek real limit hamesha
  lagegi.
- FULL REFUND / PARTIAL REFUND wala label bhi fix kiya — pehle alag currency me galat
  classify ho sakta tha, ab dono side INR me compare hote hai.

### 6. `recurring_card_debits` table — LIVE Supabase me ban gayi (already run)
Ye table pehle live database me thi hi nahi (migration kabhi run hi nahi hua tha), jabki
Expenses page ka code isko already use kar raha hai — matlab ye feature abhi tak broken tha.
Maine aapki permission se ise Supabase me abhi run kar diya hai — **ye step already ho chuka
hai, aapko kuch nahi karna is table ke liye.**

Ek asli bug bhi mila migration file me hi: `UNIQUE (company_id, lower(vendor_name))` — Postgres
me table-level UNIQUE constraint ke andar `lower(...)` jaisa function allowed nahi hai, sirf
plain column names allowed hai. Isi wajah se ye migration pehle kabhi successfully run nahi ho
paya hoga. Fix: usi cheez ke liye ek UNIQUE INDEX banaya (`uq_recurring_card_debits_company_vendor`)
jo function ke saath kaam karta hai. Yehi fix `db/2026-09-15-recurring-card-debits.sql` file
me bhi update kar diya hai (documentation ke liye), zip me included hai.

## Verification kiya

- `npx tsc --noEmit` — poora project, clean.
- `npx eslint` — sabhi 5 changed files pe, clean (sirf 2 pre-existing unrelated warnings).
- `npm run build` — poora production build successfully complete hua.
- Supabase me live confirm kiya: `recurring_card_debits` table + dono naye columns +
  RLS policy sab present hai.

## Deploy kaise karein

1. Is zip ko apne repo me extract karo (5 existing files replace ho jayenge, ek .sql file naya
   add hoga).
2. `npm run build` chalao apne pipeline me.
3. Deploy kar do.

DB migration is round me KOI naya step nahi hai aapke liye — `recurring_card_debits` wala
migration maine khud hi Supabase me apply kar diya hai (aapki permission se).

## Baaki phases

Full audit list (Phase 2, 3, 4 — data integrity, cleanup, Supabase hardening) is
`claude/full-system-audit-2026-09-19.md` project doc me hai. Batao kab agla phase shuru karu.
