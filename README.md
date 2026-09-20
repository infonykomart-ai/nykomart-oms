# Multi-Company Order Notify Routing — 2026-09-20

Aapne pucha tha — "agar casa aara ke order huye to" (yani CASA ARRA ke
orders ka kya hoga). Jaanch karne par pata chala: Telegram aur WhatsApp
(Whapi) dono auto-send buttons ek hi hardcoded group/chat par bhejte the —
matlab CASA ARRA (aur Rugara) ke orders bhi Nyko Mart ke group me chale
jaate. Ab yeh fix ho gaya hai.

## Kya badla

Har company (Nyko Mart / Rugara / CASA ARRA) ab apna **alag WhatsApp group**
aur **alag Telegram group** rakh sakti hai. `companies` table me 2 naye
column add kiye hain:

- `whapi_group_id` — us company ke WhatsApp order group ki ID
- `telegram_chat_id` — us company ke Telegram order group ki ID

**Agar kisi company ke liye yeh set nahi hai (NULL)**, to wahi purana
fallback chalta hai (`WHAPI_GROUP_ID` / `TELEGRAM_ORDER_CHAT_ID` env vars —
Nyko Mart ka group) — isliye Nyko Mart ka flow bilkul pehle jaisa hi chalta
rahega, kuch tootega nahi.

## ✅ Already LIVE kar diya hai (aapki permission se)

1. **Migration apply ho chuki hai** — `companies` table me dono columns
   add ho chuke hain (production DB par, Supabase MCP se seedha).
2. **CASA ARRA set ho chuka hai** — `whapi_group_id` =
   `120363411544640806@g.us` (group "CASA ARRA All Orders", naam se match
   confirm kiya). Ab CASA ARRA ke orders par "🚀 Send on WhatsApp (Auto)"
   dabane se seedha CASA ARRA ke apne group me jaayega, Nyko Mart ke group
   me NAHI.

## ⚠️ Abhi bhi baaki hai

1. **CASA ARRA ka Telegram group** — abhi set nahi hai, isliye CASA ARRA ke
   orders Telegram par bhejne par abhi bhi Nyko Mart ke Telegram group me
   jaayenge (fallback). Agar CASA ARRA ka apna Telegram group hai, uski
   chat ID bata do, main set kar dunga. (ID nikalne ka tareeka: us group me
   bot ko add karo, ek message bhejo, phir
   `https://api.telegram.org/bot<token>/getUpdates` khol ke `chat.id`
   dekho — jaisa Nyko Mart ke liye kiya tha.)
2. **Rugara ka WhatsApp group** — mujhe abhi tak Rugara naam ka koi group
   nahi mila Whapi ke groups list me (jo groups the: NYKO Orders ALL, CASA
   ARRA All Orders, NKRT-* wale, waghera — inme se koi bhi seedha "Rugara"
   naam ka nahi tha). Agar Rugara ke orders ke liye alag WhatsApp group hai
   to uska naam bata do, main dhundh ke set kar dunga — ya agar abhi Rugara
   ke liye koi alag group hi nahi hai, to koi baat nahi, Nyko Mart ke
   fallback group me hi jaate rahenge jab tak koi bana ke bata na do.
3. **Rugara ka Telegram group** — same, abhi tak koi bhi info nahi hai.

Jab bhi yeh values mil jayein, mujhe bata dena — main seedha DB me set kar
dunga (koi naya deploy/code change nahi chahiye, sirf ek DB row update).

## Files (7) — apne repo me copy karein (in sabko already prod DB par
apply kar diya hai, yeh sirf REPO ko sync karne ke liye hai)

- `whapi-send-order-route.ts` → `src/app/api/whapi-send-order/route.ts`
- `telegram-send-order-route.ts` → `src/app/api/telegram-send-order/route.ts`
- `order-whatsapp-button.tsx` → `src/app/dashboard/orders/new/order-whatsapp-button.tsx`
- `orders-new-page.tsx` → `src/app/dashboard/orders/new/page.tsx`
- `database.types.ts` → `src/types/database.ts`
- `.env.example` → repo root
- `2026-09-20-company-order-notify-channels.sql` → `db/2026-09-20-company-order-notify-channels.sql`
  (**yeh migration production DB par already chal chuki hai** — is file ko
  sirf apne git repo me commit karne ke liye copy karo, taki history me
  record rahe. Agar koi staging/dev Supabase project bhi hai to wahan yeh
  file chalana hogi.)

## Verification

- `npx tsc --noEmit` — clean, 0 errors.
- `npx eslint` (changed files) — 0 errors/warnings.
- `npm run build` — saari pages successfully generate hui, dono routes
  (`/api/whapi-send-order`, `/api/telegram-send-order`) build me register
  hue.
- DB migration production par apply ho chuki hai (Supabase MCP se, aapki
  confirmation ke baad) — verified via query, CASA ARRA row me
  `whapi_group_id` set dikh raha hai.
- Live send abhi test nahi hui — jab CASA ARRA se koi naya order daalo aur
  "🚀 Send on WhatsApp (Auto)" dabao, to CASA ARRA ke group me jaana chahiye.
