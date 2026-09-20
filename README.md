# Fix: "Cannot find module './actions'" build error — 2026-09-20

## Kya hua

Vercel build 3 baar fail hui, hamesha yahi error:

```
order-whatsapp-button.tsx(4,39): error TS2307: Cannot find module './actions'
```

Iska matlab: aapke GitHub repo ke is folder me —
`src/app/dashboard/orders/new/` — se **`actions.ts` file gayab ho gayi hai**
(shayad `order-form.tsx` bhi). Yeh file maine kabhi touch nahi ki thi —
lagta hai jab aapne meri di hui 2 files (`order-whatsapp-button.tsx` aur
`page.tsx`) us folder me upload ki, to GitHub ne (ya jo bhi tareeka use
kiya) us folder ki PURANI files (`actions.ts`, `order-form.tsx`) delete kar
di, sirf nayi 2 files reh gayi.

## Fix

Is zip me wahi 2 files hain jo missing ho gayi thi — inhe wapas usi folder
me daal do:

- `actions.ts` → `src/app/dashboard/orders/new/actions.ts`
- `order-form.tsx` → `src/app/dashboard/orders/new/order-form.tsx`

(Yeh dono files maine kabhi edit nahi ki — bilkul wahi content hai jo
pehle se hona chahiye tha.)

Ab us folder me total **4 files** honi chahiye:
- `actions.ts` (is zip se)
- `order-form.tsx` (is zip se)
- `order-whatsapp-button.tsx` (pehle wale zip se — already daal chuke ho)
- `page.tsx` (pehle wale zip se — already daal chuke ho)

## Aage se aisa na ho, iske liye

Jab bhi main koi zip doon jisme sirf CHUNE HUE files hon (poora folder
nahi), to un files ko **ek-ek karke** upload/replace karna — GitHub ke
"Add file → Upload files" wale screen par agar poora folder drag-drop
karoge to sirf wahi files rahengi jo aap daal rahe ho, baaki purani files
(jo upload me shamil nahi thi) delete ho sakti hain. Har file ko uske apne
path par jaake, uske "pencil/edit" icon se edit karna sabse safe tareeka
hai.

## Verify

Dono files upload karne ke baad Vercel apne aap ek naya build try karega
(ya "Redeploy" dabana pad sakta hai). Is baar `Cannot find module
'./actions'` error nahi aana chahiye.
