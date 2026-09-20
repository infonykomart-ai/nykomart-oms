# Final fix — folder structure ke sath — 2026-09-20

Is zip ke andar **`src` folder hai, bilkul waise hi jaise aapke repo me
hona chahiye** — koi path khud nahi sochna padega.

## Kaise use karein

1. Is zip ko apne computer par **extract/unzip** karo. Andar ek `src`
   naam ka folder milega.
2. GitHub par apne repo (`nykomart-oms`) ke root me jaao (jaha se `src`
   folder dikhta hai).
3. **"Add file" → "Upload files"** dabao.
4. Us `src` folder ko (poore ka poora, andar se files nikal kar nahi —
   `src` folder ko hi) upload screen par **drag-and-drop** kar do.
   GitHub is se andar ki saari sub-folders (types, app/api/..., app/
   dashboard/orders/...) apne aap sahi jagah par rakh dega, kyunki yeh
   zip ke andar already sahi structure me hai.
5. Commit message likh ke commit kar do.

Agar drag-and-drop se folder upload ka option na dikhe (kabhi kabhi
browser is par depend karta hai), to yeh tareeka try karo:
- GitHub Desktop app use karo (agar installed hai): repo clone karo, is
  `src` folder ko apne local repo ke `src` folder ke UPAR copy-paste kar
  do (merge ho jayega, replace confirm maang sakta hai — "Yes/Replace"
  bolna), phir commit + push kar do.

## Is zip me kya hai (8 files, sahi path par already)

```
src/
├── types/
│   └── database.ts
└── app/
    ├── api/
    │   ├── whapi-send-order/
    │   │   └── route.ts
    │   └── telegram-send-order/
    │       └── route.ts
    └── dashboard/orders/
        ├── photo-url-field.tsx
        └── new/
            ├── actions.ts
            ├── order-form.tsx
            ├── order-whatsapp-button.tsx
            └── page.tsx
```

Yeh sab is session me jo bhi problem aayi (missing files, galat folder,
galat naam) — sabka final, sahi version hai. Isko upload karne ke baad
`npx tsc --noEmit` yahan clean chal chuka hai (0 errors) — matlab agar
yeh sahi jagah chala gaya, Vercel build bhi pass hona chahiye.

## Uske baad

Build phir se try karega Vercel (ya "Redeploy" dabana pad sakta hai). Jo
bhi log aaye, paste kar dena.
