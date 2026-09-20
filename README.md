# WhatsApp/Telegram Order-Sharing Fix — 2026-09-20

Aapne jo complaint bheji thi (PO-A783/PO-A784 ke screenshots ke sath) — "photo ke
upar caption likh diya, aur caption alag msg me jata hai" — usko fix kar diya
hai. Neeche poora detail hai.

## Aapne jo confirm kiya tha (2 decisions)

1. **Caption ab kabhi bhi photo ke pixels me bake nahi hoga** — Amazon "TOP
   PRIORITY" orders ke liye bhi nahi. Ab hamesha **asli, bina-chhedi photo**
   jaati hai, aur caption sirf **real text** ke roop me jaata hai (copy/edit/
   search ho sake).
2. **Telegram ab pakka automate ho gaya hai** — "Send on Telegram" button
   dabate hi ek hi click me photo + caption ek hi message me chala jaata hai,
   koi manual download/attach/paste nahi karna. **WhatsApp** aapke pehle wale
   decision ke hisaab se manual/share wale tareeke par hi hai (Business API
   nahi use ki) — bas ab usme bhi asli photo jaati hai, composite image nahi.

## Kya badla — technical summary

### 1. WhatsApp — ab asli photo, kabhi bhi baked overlay nahi

`order-whatsapp-button.tsx` pehle `/api/order-whatsapp-image` route call karta
tha, jo ek **composite image** banata tha — details table + "TOP PRIORITY"
banner + photo, sab ek hi flat image me bake karke. Ab yeh route bilkul call
nahi hota. Iski jagah `/api/order-photo-proxy` (jo pehle se code me tha lekin
kahin use nahi ho raha tha) use hota hai — yeh sirf order ki **asli photo**
server ke through fetch karke deta hai (CORS issues se bachne ke liye), koi
text ya overlay add nahi karta.

- **Mobile** (jaha Web Share API kaam karta hai): asli photo + real text
  caption dono ek sath `navigator.share()` se jaate hain — ek hi WhatsApp
  message banta hai, jisme photo ke sath ka caption search bhi ho sakta hai.
- **Desktop** (jaha yeh API reliable nahi hai): asli photo download hoti hai
  (koi baked text nahi) aur caption clipboard me copy ho jaata hai — aapko
  WhatsApp me photo attach karke caption paste (Ctrl+V) karna hai, phir send.
  Same jaisa pehle tha, bas ab photo par koi text baked nahi hai.
- Agar photo fetch hi nahi ho paayi to purana text-only wa.me link fallback
  hai, taki message phir bhi chala jaaye.

### 2. Telegram — asli Bot API automation (naya)

Ab ek naya server route hai: **`/api/telegram-send-order`**. "Send on
Telegram" button dabate hi:

1. Yeh route order ki asli photo server-side fetch karta hai (same SSRF-safe
   tareeke se jo baaki app me photo fetch karne ke liye use hota hai).
2. Phir Telegram ka apna **Bot API** (`sendPhoto`) call karta hai — photo aur
   caption dono ek hi API call me, ek hi message ban ke aapke Telegram group
   me chala jaata hai.
3. Koi download nahi, koi clipboard nahi, koi manual attach/paste nahi —
   bilkul automatic, ek click.

**Isko chalane ke liye aapko 2 cheezein set karni hongi** (yeh sirf ek baar
karna hai):

1. Telegram par **@BotFather** ko message karo, `/newbot` bhejo, jo naam/
   username maange wo de do — wo aapko ek **token** dega (kuch aisa dikhega:
   `123456789:AAExampleTokenTextGoesHere`). Yeh **`TELEGRAM_BOT_TOKEN`** hai.
2. Us bot ko apne target group me add karo (jaise "NYKO Orders ALL" — jaisa
   screenshot me tha), bilkul waise jaise kisi member ko add karte hain.
3. Us group me koi bhi ek message bhejo, phir apne browser me yeh URL kholo
   (`<token>` ki jagah apna asli token daal ke):
   ```
   https://api.telegram.org/bot<token>/getUpdates
   ```
   Jo JSON aayega usme `"chat":{"id": -1001234567890, ...}` jaisa kuch
   dikhega — wo poora number (minus sign ke sath) **`TELEGRAM_ORDER_CHAT_ID`**
   hai.
4. Yeh dono values apne Vercel project ke **Settings → Environment
   Variables** me daal do (`.env.example` file me poora detail hai).

**Jab tak yeh 2 values set nahi hongi**, "Send on Telegram" button ek saaf
error dikhayega ("Telegram bot abhi configure nahi hai...") — silently fail
nahi hoga, aapko pata chal jayega ki kya karna hai.

### Robustness note (Telegram caption)

Telegram ka apna "bold text" formatting (Markdown/HTML) tab tool todta hai
jab kisi field (jaise SKU ya Note) me special characters (`_`, `<`, waghera)
ho — is wajah se hamne Telegram ke caption ko **plain text** rakha hai (bina
bold ke), taki koi bhi order ka data ho, message kabhi fail na ho. WhatsApp
wala caption pehle jaisa hi bold rehta hai (wahan asterisks WhatsApp khud hi
bold me render karta hai jab paste karte ho).

### Purani composite-image route ka kya hua?

`/api/order-whatsapp-image` (jo composite image banata tha) **delete nahi
kiya** — bas ab kahin se call nahi hota. Iske upar ek comment daal diya hai
jisme 2026-09-20 ka yeh decision likha hai, taki future me koi confusion na
ho. Agar kabhi zaroorat pade to wapas mil jayegi.

## Files (4) — apne repo mein copy karein

- `src/app/api/telegram-send-order/route.ts` — **NAYA FILE**, Telegram Bot
  API automation.
- `src/app/dashboard/orders/new/order-whatsapp-button.tsx` — WhatsApp/
  Telegram dono buttons ka poora naya logic.
- `src/app/api/order-whatsapp-image/route.ts` — sirf ek deprecation comment
  add kiya, code same hai (ab use nahi hota).
- `.env.example` — `TELEGRAM_BOT_TOKEN` aur `TELEGRAM_ORDER_CHAT_ID` ka
  documentation add kiya.

## Verification

- `npx tsc --noEmit` — clean, 0 errors.
- `npx eslint` (changed files) — 0 errors/warnings.
- `npm run build` — saari pages successfully generate hui, koi error nahi,
  naya `/api/telegram-send-order` route bhi build me register hua.

## Deploy karte waqt

1. Upar di gayi 4 files apne repo mein same path par copy kar dein.
2. `TELEGRAM_BOT_TOKEN` aur `TELEGRAM_ORDER_CHAT_ID` Vercel me set kar dein
   (upar wale steps follow karke) — iske bina Telegram button error dega,
   lekin WhatsApp wala button turant kaam karega (usko koi naya config nahi
   chahiye).
3. Push/deploy kar dein — database side kuch nahi badla, koi SQL nahi
   chalani.
