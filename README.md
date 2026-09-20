# Fix round 2 — remaining build errors — 2026-09-20

Naya error aaya:

```
order-form.tsx(5,31): error TS2307: Cannot find module '../photo-url-field'
telegram-send-order-route.ts(105,18): error TS2339: Property 'telegram_chat_id' does not exist...
whapi-send-order-route.ts(130,18): error TS2339: Property 'whapi_group_id' does not exist...
```

Teen alag-alag cheezein hain. **Har file ka EXACT path niche diya hai — bilkul wahi path use karna, warna phir se error aayega.**

## 1. `photo-url-field.tsx` — ek aur missing file

Yeh bhi wahi wali problem hai (upload ke time delete ho gayi thi), bas yeh
`orders/new/` folder me nahi, ek folder UPAR `orders/` me hai:

**Is zip ki `photo-url-field.tsx` ko yahan daalo:**
```
src/app/dashboard/orders/photo-url-field.tsx
```
⚠️ `orders/new/` ke ANDAR NAHI — `orders/` me seedha, `new` folder se
bahar.

## 2. `database.types.ts` — pichhle zip se already diya tha, lagta hai abhi tak nahi laga

`telegram_chat_id does not exist` / `whapi_group_id does not exist` — yeh
error tabhi aata hai jab TypeScript ka types file purana hai. Iska fix:

**Is zip ki `database.types.ts` ko yahan daalo (file ka NAAM badal ke):**
```
src/types/database.ts
```
(Naam `database.ts` hona chahiye, `database.types.ts` nahi — file ke andar
ka content chahiye, naam sirf isliye alag rakha hai taaki aap yahan se
confuse na ho ki kaunsi file kis liye hai.)

## 3. API route files — pichhli baar shayad galat jagah/naam se gayi thi

Yeh do files **bilkul route.ts naam se, apne alag folder ke andar** honi
chahiye — agar inhe "whapi-send-order-route.ts" naam se hi kahin daal diya
tha (jaisa zip me tha), to Next.js unhe API route hi nahi maanega, aur
button kaam nahi karega (chahe build pass ho jaaye).

**`whapi-send-order-route.ts` ko:**
1. Naya folder banao: `src/app/api/whapi-send-order/`
2. Us folder ke andar file ka naam rakho: `route.ts` (na ki
   `whapi-send-order-route.ts`)
3. Poora path: `src/app/api/whapi-send-order/route.ts`

**`telegram-send-order-route.ts` ko:**
1. Naya folder banao: `src/app/api/telegram-send-order/`
2. Us folder ke andar file ka naam rakho: `route.ts`
3. Poora path: `src/app/api/telegram-send-order/route.ts`

Agar pehle se kahin `whapi-send-order-route.ts` ya
`telegram-send-order-route.ts` naam ki koi file repo me pada hai (kisi bhi
folder me), usko **delete** kar dena — sirf `route.ts` naam wali hi
rehni chahiye, apne apne sahi folder me.

## Summary — is zip ke baad total files check list

| Is zip ki file | Kahan jaani hai |
|---|---|
| `photo-url-field.tsx` | `src/app/dashboard/orders/photo-url-field.tsx` |
| `database.types.ts` | `src/types/database.ts` (naam badal ke) |
| `whapi-send-order-route.ts` | `src/app/api/whapi-send-order/route.ts` (naam badal ke) |
| `telegram-send-order-route.ts` | `src/app/api/telegram-send-order/route.ts` (naam badal ke) |

Sab daalne ke baad Vercel naya build try karega. Agar phir bhi koi error
aaye, poora build log paste kar dena — turant dekh lunga.
