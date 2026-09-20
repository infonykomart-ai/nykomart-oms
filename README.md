# WhatsApp Auto-Send (Whapi.Cloud) — 2026-09-20

Aapne pucha tha — "ESA HI WHATSAAP PAR NHI HO SAKTA HAI KYA" (jo Telegram par
one-click automation ho gaya, wahi WhatsApp par bhi). Poori jaanch ke baad
(official WhatsApp API groups support nahi karta, aur baaki saare options
ko ek hamesha-on server chahiye jo aapke hosting par nahi chal sakta), aapne
khud **Whapi.Cloud** choose kiya — usme aapka number pehle se connect ho
chuka hai. Yeh us integration ka code hai.

## Kya naya hai

Ab order ke button row me **teen** buttons hain:

1. **📱 Send on WhatsApp** — pehla wala, manual/share flow (koi naya config
   nahi chahiye, hamesha kaam karega). Isko **hataya nahi hai**.
2. **🚀 Send on WhatsApp (Auto)** — **NAYA**. Ek click me photo + caption ek
   hi WhatsApp message me, "Nyko Mart order" group me, Whapi.Cloud ke through
   automatically chala jaata hai. Koi download/attach/paste nahi.
3. **☁️ Send on Telegram** — pehle se maujood (already deployed).

Auto button jaan-boojh kar manual button ko **replace nahi karta** — Whapi
ka free plan rate-limited hai (150 messages/day), isliye manual flow ek
hamesha-kaam-karne-wala fallback ke roop me rehta hai.

## Aapko jo karna hai (isko chalane ke liye)

### 1. Group ID nikalo (agar abhi tak nahi nikali)

1. `https://panel.whapi.cloud` par apne channel (NEBULA-X8SK6) ka page kholo.
2. Wahan API docs ka link milega — ya seedha yeh kholo:
   `https://whapi.readme.io/reference/getgroups`
3. Us page par apna channel select karke **"Try It!"** dabao (yeh
   `GET /groups` call karega, aapke token se authenticated).
4. Response me apna **"Nyko Mart order"** group dhundo. Uske `"id"` field me
   kuch aisa dikhega: `"120363194050948049@g.us"`.
5. Yeh **poora string** (`@g.us` ke saath) copy kar lo — yeh
   `WHAPI_GROUP_ID` hai.

### 2. Vercel me env vars set karo

Settings → Environment Variables me:

- `WHAPI_TOKEN` = aapka Whapi channel ka token (jo screenshot me dikha tha:
  `MIFRo6aUgpfbnBFcBspaNeLxTmcXSblb` — agar wahi abhi bhi valid hai, wahi
  daal do; agar naya generate kiya hai to naya wala).
- `WHAPI_GROUP_ID` = step 1 se mila poora string.

Poora detail `.env.example` file me bhi hai (dono naye env vars neeche
`# Whapi.Cloud (added 2026-09-20)` section me).

### 3. Files copy karo apne repo me

- `whapi-send-order-route.ts` → apne repo me copy karo path par:
  `src/app/api/whapi-send-order/route.ts` (**naya folder banana hoga**:
  `whapi-send-order`)
- `order-whatsapp-button.tsx` → same path par replace karo:
  `src/app/dashboard/orders/new/order-whatsapp-button.tsx`
- `.env.example` → apne repo ke root me replace karo.

### 4. Push/deploy

Koi SQL/database change nahi hai. Push karo, Vercel deploy karega.

**Jab tak `WHAPI_TOKEN`/`WHAPI_GROUP_ID` set nahi honge**, naya "🚀 Send on
WhatsApp (Auto)" button ek saaf error dikhayega ("WhatsApp automation abhi
configure nahi hai...") — baaki dono buttons (manual WhatsApp, Telegram)
turant kaam karenge, unko koi asar nahi.

## Cost/continuity — already confirmed by aapne khud

Whapi support ne khud bataya (aapne paste kiya tha): trial khatam hone par
koi automatic charge nahi hota. Aap channel page ke button se **free
Sandbox plan** (same 150 msg/day limit, koi time-limit nahi) par switch kar
sakte ho, ya chaho to paid plan (~$29/month) le sakte ho unlimited ke liye.
Free Sandbox aapke office-hours (9:30–7pm) ke order-volume ke liye kaafi
hona chahiye.

## Pehla test kaise karein

1. Env vars set karne ke baad, kisi ek order par "🚀 Send on WhatsApp
   (Auto)" dabao.
2. Agar group me message aa jaaye — ho gaya, kaam kar raha hai.
3. Agar error aaye ("WhatsApp ne message reject kar diya: ..."), wahi error
   text mujhe bhej dena — Whapi ka exact response schema unke docs me poori
   tarah likha nahi tha, isliye pehli live call ka exact error message
   dekh kar agar field names adjust karne padein to turant kar dunga.

## Files (3) is zip me

- `whapi-send-order-route.ts` — naya API route, Telegram wale route jaisa
  hi pattern: order ki asli photo server-side fetch karta hai, phir Whapi
  ke `POST /messages/image` (ya photo na ho to `POST /messages/text`) ko
  call karta hai.
- `order-whatsapp-button.tsx` — naya "🚀 Send on WhatsApp (Auto)" button add
  kiya gaya hai, purane dono buttons (manual WhatsApp + Telegram) same hain.
- `.env.example` — `WHAPI_TOKEN` aur `WHAPI_GROUP_ID` ka poora documentation.

## Verification

- `npx tsc --noEmit` — clean, 0 errors.
- `npx eslint` (changed files) — 0 errors/warnings.
- `npm run build` — saari pages successfully generate hui, naya
  `/api/whapi-send-order` route bhi build me register hua.
- Live send abhi test nahi hui hai (group ID pehle chahiye) — Whapi ka exact
  success/error response schema unke docs me publicly nahi likha tha, is
  liye route generic hai (koi bhi 2xx = success maanta hai, error message
  jo bhi field me mile usko dikhata hai). Pehli live send ke baad agar kuch
  adjust karna pade to bata dena.
