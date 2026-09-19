# Order Save + Orders List + Attendance Holiday Fix — 2026-09-19

## 1. "Order save nahi ho raha" (New Order + Order Edit)
Save click karne par kuch hota hi nahi tha — no error, no response.

**Root cause**: `Photo URL` field (`type="url"`) aur `Email` field (`type="email"`)
— dono jagah browser ka apna strict format-check lagta hai, chahe field required
na ho. Usme koi aisi value ho jo "perfect" URL/email na lage (WhatsApp/Google
Photos se paste kiya link jisme `https://` missing ho, ya Email me koi purana
messy/typo text) — to **poora form silently submit hi nahi hota**, browser save
se pehle hi rok deta hai. Sabse risky: **Order Edit** — kisi bhi purane order ka
Email field agar pehle se messy hai, to sirf "Save Changes" click karne se bhi
kuch nahi hoga, bina kuch type kiye bhi.

**Fix — 3 files**:
1. `src/app/dashboard/orders/photo-url-field.tsx` — `type="url"` → `type="text"`
2. `src/app/dashboard/orders/new/order-form.tsx` — Email: `type="email"` → `type="text"`
3. `src/app/dashboard/orders/order-edit-form.tsx` — Email: `type="email"` → `type="text"`

## 2. "Orders list me kuch dikh hi nahi raha" (0 orders) — ALREADY LIVE-PATCHED
Live Supabase logs check kiye to pata chala: live site ka deployed code
`orders` table se `photo_urls` (plural) column mangta hai — jo database me
kabhi bana hi nahi, sirf `photo_url` (singular) hai. Isse har GET (Orders list)
aur har POST (Save) 400 error de raha tha — data delete nahi hua tha, sirf query
hi fail ho rahi thi.

**Turant unblock kar diya gaya hai**: database me ek `photo_urls` compatibility
column add kar diya (already applied, kuch karne ki zarurat nahi) — Orders list
aur Save dono ab live kaam kar rahe honge. Is checkout ke current code me
`photo_urls` kahi bhi use nahi hota (sirf sahi `photo_url` hai), matlab live
site abhi bhi is checkout se **purana** code chala raha hai — jab bhi agla
deploy karoge, ye apne aap bhi consistent ho jayega.

## 3. Naya mila: Attendance page — Holidays galat/missing (September jaisa month)
Live logs me ek aur repeated error mila: Attendance page (`/dashboard/attendance`,
har employee ka apna daily page) har load par ek invalid query bhej raha tha —
`holiday_date <= "2026-09-31"`. September me 31 tareek hoti hi nahi (30 din ka
mahina), isliye Postgres ne is query ko reject kar diya — matlab **is poore
month ke liye Holiday category kabhi sahi se load hi nahi ho rahi thi**
(silently, koi error screen nahi dikhta, bas Holiday wale din galat category
me dikhte — jaise "Absent" ya khali).

Same bug class already fix ho chuka tha Salary aur Attendance-Admin pages me
(`daysInMonth()` helper use karke) — bas ye ek employee-facing Attendance page
reh gaya tha jahan purana hardcoded `-31` tha. Ab fix kar diya, same helper use
karke — Apr/Jun/Sep/Nov (30-din months) aur Feb (28/29-din) sabhi ab sahi date
bhejenge.

**Fix — 1 file**:
4. `src/app/dashboard/attendance/page.tsx`

## Deploy
In 4 files ko apne live repo me same path par replace karke deploy kar do.
`npx tsc --noEmit` aur `npx eslint` dono in charo files par clean hain.
