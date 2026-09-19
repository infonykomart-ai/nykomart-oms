# Statement Entry — Edit/Update + Company Default — 2026-09-19

Aapne bheje the 2 screenshots (Recent Etsy Monthly Tax Invoices — 52 invoices, sab "Nyko Mart" ke
neeche) aur poocha tha: "company transfer karna ho ya order ke according apne aap company chose ho
jaye. edit modify ka option ho... update change ka option ho."

Do cheezein maine confirm ki thi aapse:
1. Edit scope — **teeno type** (Etsy Invoice + eBay Summary + eBay Statement). ✅ done.
2. "Order ke according auto company-select" ka matlab — **"jis company me order dala hai usi
   company me chala jaye"**. Neeche D mein explain kiya hai ki isko literally kyun nahi kiya, aur
   uske bajaye kya kiya.

---

## A — Ab teeno statement type edit/update ho sakte hain

Pehle (round 11) sirf **insert-only** tha — ek baar statement save ho gaya (uski Company sahit), to
usko theek karne ka koi tareeka nahi tha, delete karke dobara type karne ke alawa. Isi wajah se
aapki saari 52 Etsy invoices ek hi company ke neeche dikh rahi thi — kisi ne galat company select
kar di hogi kabhi, aur fix karne ka koi option hi nahi tha.

**Fix**: `parties/party-form.tsx` + `parties/actions.ts` mein already jo pattern use ho raha hai
(hidden `*_id` field decide karta hai insert vs update) — wahi teeno statement forms mein add kiya:

- Har "Recent ..." list ke har row par ab ek **Edit** button hai.
- Click karne par, woh row apni jagah pe hi ek pre-filled form mein badal jaata hai (naya page ya
  popup nahi — party list jaisa hi inline behavior).
- Sab kuch edit ho sakta hai, **Company bhi** — yahi seedha "company transfer" wala fix hai.
- Save karne par "Update ..." button, aur ek **Cancel** button bhi hai agar edit cancel karna ho.

Teeno type: Etsy Monthly Tax Invoice, eBay Financial Summary, eBay Financial Statement (Monthly).

## B — Etsy form mein ek missing field bhi mil gaya aur add kar diya

Database mein `account_opening_fee` naam ka column pehle se tha (invoice ke Subtotal/GST/Total ke
calculation mein use hota hai), lekin form mein iske liye koi input hi nahi tha — matlab yeh hamesha
chupchap 0 maan liya jaata tha. Ab form mein "Account Opening Fee" field add kar diya (jahan bhi yeh
value non-zero ho asli invoice mein).

Yeh gap ek dusri jagah bhi mila: is column ke liye TypeScript types file (`src/types/database.ts`)
mein bhi entry missing thi — wahan bhi add kar di, warna build hi fail ho jaata.

## C — 1 chhoti si Etsy list mismatch bhi fix ho gayi

List "Total" line pehle ₹ (rupee) dikha rahi thi lekin agar count singular/plural handling check
karein to koi dikkat nahi thi asal mein — yeh sirf naye edit-in-place UI ke saath dobara likha gaya,
koi number galat nahi tha pehle.

## D — "Order ke according auto company-select" — literally kyun nahi kiya, kya kiya

Yeh 3 statement types (Etsy Monthly Tax Invoice, eBay Financial Summary, eBay Financial Statement)
**ek pura mahina/period ka combined total** hote hain — ek marketplace account ki, kai saari orders
milakar. Inmein koi ek "yeh order" wala column hai hi nahi (na ho sakta hai) — isliye "jis company
me order dala hai" wala rule literally apply nahi ho sakta, kyunki ek statement mein ek saath kai
companies ke orders ho sakte hain agar ek hi Etsy/eBay account se multiple companies operate hoti
hain.

**Isliye practical fix jo kiya**: naya statement enter karte waqt, Company dropdown ab **blank nahi
hota** — apne aap **wahi company select hoti hai jo top-nav mein currently selected hai** (jaisa
poore app mein har jagah "current company" ka matlab hota hai). Dropdown pura editable rehta hai —
agar koi aur company select karni ho to kar sakte hain, bas ab default se galti kam hogi.

Agar aapke paas kisi Etsy/eBay account ka ek fixed 1:1 mapping ho kisi ek company se (jaise "yeh Etsy
shop hamesha X company ki hai"), to woh batayein — us case mein aur zyada smart auto-detect bhi add
ho sakta hai (jaise shop name se automatically match). Filhaal jo kiya woh sabse safe aur samajhne
mein aasan interpretation hai.

---

## Files changed (4)

- `src/app/dashboard/statements/actions.ts` — 3 save actions insert-only se insert-or-update kiye
  (hidden id field decide karta hai), `account_opening_fee` field add kiya.
- `src/app/dashboard/statements/statement-entry-forms.tsx` — sabhi 3 forms mein edit mode
  (record/onDone props, hidden id, pre-filled defaults, Update/Cancel buttons); `account_opening_fee`
  field UI mein add; Company dropdown ka naya `defaultCompanyId` behavior; naye 3 list components
  (Edit button + inline expand) jo pehle page.tsx mein plain read-only the.
- `src/app/dashboard/statements/page.tsx` — recent lists ab full row fetch karte hain (edit ke liye
  chahiye), top-nav ki current company Statement Entry form ko pass hoti hai, list rendering naye
  components use karti hai.
- `src/types/database.ts` — `etsy_monthly_tax_invoices` table ke liye missing `account_opening_fee`
  column type add kiya (yeh Supabase se generate hui file thi, is column ke bina stale thi).

## Verification kiya gaya

- `npx tsc --noEmit` — clean.
- `npx eslint` (saari 4 changed files par) — clean.
- `npm run build` — successful, saare 86 pages generate hue, koi error nahi.
- Koi bhi DB migration is round mein nahi chalaayi — yeh sab pure code-side changes hain (schema
  mein `account_opening_fee` column already tha, sirf TypeScript types file usse miss kar rahi thi).

## Deploy karte waqt yaad rakhna

Saari 4 files apne repo mein same relative path par copy kar dena. Koi DB step nahi hai is baar.
