# Order Country — automatic detection (2026-08-22)

**Aapka sawaal**: "Jab apne sabhi order me karib karib reciver ka address with zip code
mojud hai to country kyu nahi aari — iska permanent ilaj karo, order me ek jagah dalte hai to
vaha se automatic fetch ho jaye."

## Asli wajah (root cause)

"Top Countries" report (SKU × Country × Size) country **dispatch ke time** manually bhare gaye
`dispatch_invoices` table se le raha tha — jo order sirf DISPATCH hue hain unhi ka country pata
chalta tha. Baaki 645 orders jo abhi dispatch nahi hue (ya dispatch time pe country field khali
reh gaya), unka country hamesha "(unknown)" dikhta tha — jabki order ka address (jisme country
ka naam khud hi likha hota hai, jaise "...Fresno, CA 93722\nUnited States") pehle se hi maujood
tha.

## Fix — permanent, automatic

Ab country **order ke address se hi khud-ba-khud nikal jata hai** — koi naya field bharne ki
zaroorat nahi:

1. Jab bhi order banaya jata hai (Naya Order, Bulk Upload, ya marketplace se auto-sync) — address
   se country turant nikal ke save ho jata hai.
2. Jab bhi order edit karke address badla jata hai — country bhi turant refresh ho jata hai.
3. "Top Countries" report ab isi naye field se country dikhata hai — dispatch ka manual field
   sirf backup/fallback ke liye reh gaya hai.

Country nikalne wala logic 340 real orders ke address pe test kiya — **99.7% sahi match** (340
me se 339 sahi, sirf 1 aisa address jisme line-breaks bilkul nahi the aur postcode+country ek
saath jud gaye the — wo abhi bhi "(unknown)" hi dikhega, galat guess nahi karega). Jaha country
literal naam se nahi likha (jaise sirf "NSW 2074" — Australia ka state+postcode) wahan bhi
postcode ke pattern se pehchan leta hai — US state+zip, Canada postal code, Australia
state+postcode, India ke sheher/state ke naam (Delhi, Mumbai, etc.).

**Zaroori baat**: agar address me country ka pata nahi chal paya (bahut hi ajeeb/adhura address),
to system galat guess nahi karega — wo (unknown) hi rahega, jaisa pehle tha. Kabhi bhi galat
country nahi dikhayega.

## Purane 645 orders ka kya hoga?

Naye/edit hue orders ke liye ye automatic hai. Purane orders (jo is fix se pehle bane the) ke
liye ek **one-click backfill button** banaya hai:

**Admin → Backup Export** page pe ab neeche ek naya section hai — **"🌍 Backfill Buyer Country"**.
Ek click karo, wo sabhi purane orders ka address padh ke country bhar dega (background me apne
aap batches me chalega, jitne bhi order hon). Dubara bhi chala sakte ho — sirf unhi orders ko
touch karega jinka country abhi tak nahi bhara.

## 9 files + 1 SQL

- `db/2026-08-22-orders-buyer-country.sql` — **pehle ye Supabase SQL Editor me run karo** — naya
  `orders.buyer_country` column banata hai
- `src/lib/geo/parse-country.ts` — naya, country nikalne wala core logic
- `src/app/dashboard/orders/new/actions.ts` — Naya Order + Bulk Upload dono me country auto-fill
- `src/app/dashboard/orders/actions.ts` — Order Edit me country auto-refresh
- `src/app/dashboard/reports/sku-country-size/page.tsx` — "Top Countries" ab naye field se
- `src/app/dashboard/admin/backup/actions.ts` — backfill ka server logic
- `src/app/dashboard/admin/backup/buyer-country-backfill-button.tsx` — naya, backfill button
- `src/app/dashboard/admin/backup/page.tsx` — button yahan add hua
- `src/types/database.ts` — naye column ke liye TypeScript types

Local machine pe `tsc`, `eslint`, aur full `npm run build` — teeno clean chale, koi error nahi.

## Karne ka order

1. Pehle Supabase SQL Editor mein `db/2026-08-22-orders-buyer-country.sql` run karo (safe hai,
   dobara bhi chala sakte ho).
2. Phir GitHub pe is zip ke andar wale `src` folder ko drag-drop se upload karo (9 files).
3. Commit karo — Vercel khud deploy kar dega.
4. **Admin → Backup Export** page pe jaake "🌍 Backfill Buyer Country" button ek baar click karo
   — purane 645 orders ka country bhar jayega.
5. Reports → SKU × Country × Size khol ke check kar lena — "(unknown)" ab bahut kam dikhega.
