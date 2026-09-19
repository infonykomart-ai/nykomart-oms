# Order Save Fix — 2026-09-19

## Problem
"Order save nahi ho raha" — New Order aur Order Edit, dono jagah, "Save" click karne
par kuch hota hi nahi tha (no error, no response).

## Root cause
`Photo URL` field (`type="url"`) aur `Email` field (`type="email"`) — dono jagah
browser ka apna strict format-check lagta hai, chahe field required na ho. Agar
usme koi aisi value ho jo ek "perfect" URL/email na lage (jaise WhatsApp/Google
Photos se paste kiya link jisme `https://` missing ho, ya Email me koi purana
messy/typo text) — to **poora form silently submit hi nahi hota**. Na koi error
dikhta hai, na server tak request jaati hai — browser save se pehle hi rok deta
hai.

Sabse zyada risky jagah: **Order Edit form**. Kisi bhi purane order ka Email field
agar pehle se hi thoda messy hai (purana import/typo), to us order ko kholkar
sirf "Save Changes" click karne se bhi kuch nahi hoga — bina kuch type kiye bhi.

## Fix — 3 files changed
1. `src/app/dashboard/orders/photo-url-field.tsx` — Photo URL field: `type="url"` → `type="text"`
2. `src/app/dashboard/orders/new/order-form.tsx` — New Order's Email field: `type="email"` → `type="text"`
3. `src/app/dashboard/orders/order-edit-form.tsx` — Edit form's Email field: `type="email"` → `type="text"`

Koi functionality nahi hati — photo ka broken-link preview check pehle se hi
alag se ho raha tha (`<img onError>`), wo waisa hi kaam karega.

## Deploy
In 3 files ko apne live repo me same path par replace karke deploy kar do.
`npx tsc --noEmit` aur `npx eslint` dono in teeno files par clean hain.

## Ek separate cheez bhi mili (deploy-lag, is fix se alag)
Live error-log (`entry_errors` table) me 18 Sep ka ek order-save error dikha:
`"Could not find the 'photo_urls' column of 'orders' in the schema cache"`
(order PO-A777, Neelu Soni, 3 attempts). Yeh is checkout ke current code me
nahi hai — yahan sahi se `photo_url` (singular) use ho raha hai, jo actual
database column se match karta hai. Iska matlab: live site is checkout se
**purane** code par chal raha hai. Naya deploy jaate hi ye bhi apne aap theek
ho jayega — is fix ke sath ya alag se, jab bhi agla deploy karo.
