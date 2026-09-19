# Full Build Fix + Closeup Photo Feature — 2026-09-19

Aapne poori repo ki zip di thi ("puri zip de raha") — usse maine build ki
saari baaki errors ki asli wajah dhoondi aur fix ki. Neeche sab kuch hai.

## Asli wajah (in sabki)

Aapke `db/` folder mein 3 migration files thi jo kabhi live database par
chali hi nahi thi — code unhe already assume kar raha tha, isliye build
fail ho raha tha:

1. `db/2026-09-18-orders-multi-photo-and-capability-sync.sql` — `orders.photo_urls`
   ko proper array banana tha + `sync_capabilities` function banana tha.
2. `db/2026-09-18-pl-month-per-company.sql` — `pl_dashboard_by_month_view`
   mein company_id/company_name add karna tha.
3. `db/2026-09-13-credit-note-awb-and-duplicate-guard.sql` — `credit_notes.awb_no`
   column add karna tha.

**Maine yeh teeno seedha aapke live Supabase database par apply kar di hain**
(aapki permission se — maine pehle poocha tha). Ab koi extra DB step nahi
karna — bas neeche di gayi code files apne repo mein copy kar dein.

## DB par jo actually hua (already live, kuch mat karna)

- `orders.photo_urls`: `text` (scalar, jisme kuch rows mein JSON-string
  aur kuch mein plain URL mila-jula data tha) → asli `text[]` array mein
  convert kar diya. **871 orders check kiye — 551 non-null rows, koi bhi
  photo link nahi khoya** (verify kiya before/after count se).
- `sync_capabilities()` function ban gaya.
- `pl_dashboard_by_month_view` rebuild hua — company_id/company_name add
  hue, aur ek purani migration (2026-09-17b) ka `total_sale_value_usd`
  column bhi wapas add kiya (2026-09-18 wali migration usse hata deti,
  kyunki wo migration us column ke aane se PEHLE likhi gayi thi — maine
  dono ko sahi se merge kiya).
- Is naye view ko security audit ke hisaab se `anon`/`authenticated` se
  wapas REVOKE bhi kar diya (jaisa poore app mein already convention hai
  — service-role client se hi query hoti hai).
- `credit_notes.awb_no` column add hua.
- Ek safety-net backup table (`_backup_orders_photo_urls_20260919`) bana
  ke rakha hai — photo_urls convert hone se pehle ka original data, RLS
  ON hai (koi access nahi). Verify ho gaya to aap chahein to isse drop
  karwa sakte hain, bata dena.

## ⚠️ Ek cheez jo maine JAAN-BOOJH kar apply nahi ki — aapko batana zaroori

`2026-09-13-credit-note-awb-and-duplicate-guard.sql` mein ek dusra hissa
bhi tha: `bill_pass_register` par ek duplicate-entry-rokne wala unique
index. Maine wo lagane se PEHLE check kiya to **1 existing row already us
rule ko violate kar rahi hai**:

- Company: `d1b13f6d-10ad-4997-b38b-143b042c0aa6`
- Party: `298d7829-f72b-4aa6-8a2f-101e3aaa4183`
- Vendor Invoice No.: `AG/26-27/21`
- Type: Purchase, Date: 2026-07-17
- **2 baar entry hai**

Yeh genuinely double-entry lagta hai (migration ka apna stated purpose hi
yahi hai). Maine index isliye nahi lagaya kyunki isse database error deta
(duplicate hote hue unique index ban hi nahi sakta), aur maine data khud
delete/merge nahi kiya — yeh aapka decision hai ki dono entries mein se
konsi galat hai. Jab aap confirm karein, main index bhi laga dunga.

## Code files (10) — apne repo mein copy karein

- `src/types/database.ts` — live database se dobara generate kiya (Supabase
  ke apne tool se, haath se nahi likha) — ab teeno migrations ke baad ka
  sahi schema reflect karta hai.
- `src/app/dashboard/courier-booking/tracking-data.ts`,
  `src/app/dashboard/documents/actions.ts`,
  `src/app/dashboard/documents/courier-bill-pdf-actions.ts`,
  `src/app/dashboard/documents/page.tsx`,
  `src/app/dashboard/leave/admin/page.tsx` — yeh sab pre-existing chhote
  type-mismatch the (DB column plain `text` hai lekin app ka apna type
  usse zyada narrow — "manual"/"api"/"rate_card_estimate" jaisa — expect
  karta tha). Koi behavior change nahi, sirf sahi type-cast add kiya.
- `src/app/dashboard/reports/finance-dashboard/page.tsx` — ek RPC call mein
  `null` ki jagah `undefined` bhेजna tha (dono ka database mein matlab
  same hai — bas TypeScript ka apna rule hai).
- `src/app/dashboard/parties/page.tsx` — ek jagah `<a>` tag tha jahan
  Next.js `<Link>` hona chahiye tha (build lint error).
- `src/components/simple-charts.tsx` — Donut chart render karte waqt ek
  variable ko render ke beech mein modify kar raha tha (naya stricter
  React lint rule isse pakad leta hai) — same output, bas render se pehle
  compute karne wala tareeka.

## Naya: Closeup Photo feature complete ho gaya

Aapne pehle poocha tha: "order me ek to main photo ka section hai dusra
ab or banana hai jisme Closeup photo ka option ho ek se jyada photo url
dal sake, order page par bhi jayegi photo, whatsapp telegram sabhi jagah
jaise pehle jari thi vaise hi."

Investigate karne par pata chala — iska backend (database column, save
logic, order-detail-page par saari photos dikhana) **pehle se ban chuka
tha** (kisi pichhle round mein), lekin **naye order form mein actual
"+ Add Closeup Photo" input hi missing tha** — isliye feature adhoora tha.

**Ab `src/app/dashboard/orders/new/order-form.tsx` mein add kar diya**:

- Har Item block mein, existing "Photo URL" field ke neeche ek naya
  "Closeup Photos" section hai.
- "+ Add Closeup Photo" button se jitni chahen utni extra photo links add
  kar sakte hain (upload button bhi hai, jaise main photo wale field mein
  hai) — har ek ko "Remove" se hata bhi sakte hain.
- Save karne par: main Photo URL hamesha photo #1 rehta hai (WhatsApp/
  Telegram/print sheet ke liye — jaisa pehle se chal raha tha, waisa hi,
  bilkul nahi chhua), aur saari closeup photos + main photo milakar
  `photo_urls` mein save hoti hain.
- Order detail page (`orders/[id]`) par yeh sab photos already dikhti
  hain (yeh part pehle se bana hua tha) — grid mein, har ek click karne
  par full image khulti hai.

**Scope note**: yeh sirf **naya order banate waqt** kaam karta hai abhi.
Kisi **existing order ko edit** karke closeup photos add/remove karne ka
option abhi nahi hai (sirf single main Photo URL edit hota hai wahan) —
agar chahiye to bata dena, wo bhi add kar dunga.

## Verification

- `npx tsc --noEmit` — clean, 0 errors.
- `npx eslint .` — 0 errors (sirf 6 pre-existing, harmless warnings jo
  build ko fail nahi karte — unused variable jaise chhote cheezein).
- `npm run build` — **saari 86 pages successfully generate hui, koi error
  nahi.**

## Deploy karte waqt

Upar di gayi 10 files apne repo mein same path par copy kar dein aur
push kar dein. Database side sab already ready hai — koi SQL nahi
chalani.
