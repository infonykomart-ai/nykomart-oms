# Doc Statement Dialog — Credit Note / CSB Filing / Refund / Order Refund

**Date:** 2026-09-19

## Ye kya hai

Aapne jo pehle "Bill Statement" dialog box banaya tha (Purchase/Courier/Duty bills ke liye — A4
jaisa dialog box, jisme View / Print / WhatsApp / Telegram / Email / Save PDF sab options the),
wahi ab **4 aur document types** ke liye bhi kaam karta hai:

1. **Credit Note** — Documents → Credit Note Register (CN No. par click karo)
2. **CSB Filing** — Documents tab → CSB Filing list (CSB No. ke saamne 📄 View button)
3. **Refund (Historical Marketplace Refund)** — Returns page → Historical Marketplace Refunds
   table (last column me 📄 View)
4. **Order Refund** — Returns page → Order Refunds table (last column me 📄 View)

Button dabate hi ek A4-size dialog box khulta hai jisme us document ki poori detail read-only
dikhti hai, aur upar ek Actions bar hota hai:

- 🖨 Print / Save PDF
- 📱 WhatsApp pe PDF bhejo
- ✈️ Telegram pe PDF bhejo
- 📧 Email pe PDF bhejo
- 📋 Summary copy karo

Bilkul wahi pattern jo Bill Statement dialog me already tha — koi naya UI pattern nahi seekhna
padega, sabko already pata hai ye kaise use karna hai.

## Structure — "duplicate nahi kiya"

Jaisa bola gaya tha ("bs duplicate nahi ho stracture dekh lena"), maine 4 alag dialog boxes nahi
banaye — ek hi generic system banaya hai jo `type` parameter se decide karta hai kaunsa document
dikhana hai:

- `src/lib/doc-statement.ts` — ek hi jagah se sabhi 4 types ka data load hota hai (access-check
  ke saath — jis company ka access nahi hai uska document nahi khulega)
- `src/app/api/doc-statement/[type]/[id]/route.ts` — ek hi API route, sabhi 4 types ke liye
- `src/components/doc-statement-dialog.tsx` — ek hi dialog box component
- `src/components/doc-statement-document.tsx` — ek hi read-only document renderer (screen pe)
- `src/lib/doc-statement-pdf.tsx` — ek hi PDF generator (sabhi 4 types ke liye)
- `src/lib/pdf/render.ts` — PDF banane ka shared helper (Bill Statement wala bhi isi ko use karta
  hai ab)
- `src/lib/share-pdf.ts` — WhatsApp/Telegram/Email pe PDF bhejne ka shared helper
- `src/components/doc-statement-actions.tsx` — Actions bar (Print/WhatsApp/Telegram/Email/PDF)

Baaki 3 files sirf existing pages me naya button jodte hain:

- `src/app/dashboard/credit-notes-register/page.tsx` — Credit Note Register me CN No. click karne
  se dialog khulta hai
- `src/app/dashboard/documents/document-entry-tabs.tsx` — Documents tab me Credit Note aur CSB
  Filing dono list me 📄 View button
- `src/app/dashboard/returns/returns-report-tables.tsx` — Returns page ke dono tables (Order
  Refunds + Historical Refunds) me 📄 View button

## Verification kiya

- `npx tsc --noEmit` — poora project, clean (koi bhi TypeScript error nahi)
- `npx eslint` — sabhi naye/badle hue files pe, clean
- `npm run build` — poora production build successfully complete hua, `/api/doc-statement/[type]/[id]`
  route bhi list me hai

## Deploy kaise karein

1. Is zip ko apne repo me extract karo (`src/` folder ke andar files apni jagah replace/add ho
   jayengi — koi conflict nahi hai kyunki ye saare naye files hain, sirf 3 existing files me
   chhota sa button add kiya hai)
2. `npm run build` (ya jo bhi aapka deploy pipeline hai) chalao
3. Deploy kar do (jaise Vercel)

Pichli baar jo `photo_urls` waala issue mila tha (Orders "0 dikh rahe" wala) — uska matlab tha ki
live site is checkout se different/purani code chala rahi hai. Isliye ye naya feature bhi tabhi
dikhega jab aap ise deploy karenge — sirf zip bhej dene se live site pe apne aap nahi aa jayega.

## Note

Chartered Accountant persona wala full financial/structural audit abhi baaki hai — jab bologe tab
shuru karta hun.
