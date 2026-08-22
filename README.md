# Reports Hub — 3 naye reports (2026-08-22)

"NEXT" pooche jaane par jo option chuna tha ("Reports hub — remaining scope"), phir jo 3 reports
chune the — sabhi ban gaye:

## 1. 📒 Party / Vendor Ledger Report (`/dashboard/reports/party-ledger`)

Sabhi parties (ya ek party chuno) ka Debit/Credit/Balance ledger — company-wide, ek jagah. Ye
wahi ledger hai jo har party ke apne page pe already tha (Party Master → uss party ka Ledger),
lekin ab sabhi parties ka ek saath, filter + download/send ke saath.

- Filter: Company, Party (ya "All parties"), From/To date, Type (Debit/Credit)
- Balance har party ka apna-apna alag chalta hai (agar ek saath kai parties dikh rahi hain to har
  party ki apni history se balance banta hai, doosri party se mix nahi hota)

## 2. 💹 Sale & Profit Report (`/dashboard/reports/sale-profit`)

Har order ka apna Revenue vs Expense — Order Value minus us order ka Courier + Duty expense,
minus 25% portal expense (wahi standard assumption jo CRM ke P&L Dashboard me bhi hai).

**Zaroori note**: Purchase Bill ka kharcha isme SHAMIL NAHI hai — kyunki wo poori company ka ek
saath hota hai, kisi ek order se seedha nahi juda hota, isliye is per-order report me daalna
galat hoga. Poora company-level profit (Purchase Bill ke saath) CRM Overview → P&L Dashboard me
already hai. Report ke upar hi ye baat amber note me likhi hai taaki koi confuse na ho.

- Filter: Company, From/To date (Order Date)
- Purane CSV-import wale records (jo `orders` table se pehle ke hain) bhi isme shamil hain,
  taaki purani history na chhute

## 3. 🧑‍💼 Salary / Attendance Report (`/dashboard/reports/salary`)

Har active employee ka mahine ka payroll summary — Salary/Payroll page (`/dashboard/salary`) jo
formula use karta hai, wahi formula, bas ab export/send ke layak.

- Filter: Company, Month
- Present, Half Day, Leave, Absent, Deduction, Net Pay, aur "Paid?" (salary di ja chuki hai ya
  nahi is mahine)

## Sabhi 3 reports me common (jo pehle se ban chuka tha)

Sabhi teeno Reports hub ke standard pattern pe bane hain — jaisa Outstanding/Purchase Bill/
Freight-Duty report pehle se hai:

- CSV, Excel, Word, PDF/Print, Email, WhatsApp — ek click me
- 🧩 Columns button — jo column nahi dekhna wo chhupa sakte ho, export bhi usi hisaab se hoga
- Reports hub (`/dashboard/reports`) ke top pe 3 naye buttons add ho gaye hain in teeno report
  tak jaane ke liye

## 7 files (koi SQL nahi)

- `src/app/dashboard/reports/page.tsx` — Reports hub me 3 naye buttons add hue
- `src/app/dashboard/reports/party-ledger/page.tsx` + `party-ledger-report-table.tsx` — naya
- `src/app/dashboard/reports/sale-profit/page.tsx` + `sale-profit-report-table.tsx` — naya
- `src/app/dashboard/reports/salary/page.tsx` + `salary-report-table.tsx` — naya

Local machine pe `tsc`, `eslint`, aur full `npm run build` — teeno clean chale, koi error nahi.

## Karne ka order

1. GitHub pe is zip ke andar wale `src` folder ko drag-drop se upload karo.
2. Commit karo — Vercel khud deploy kar dega.
3. `/dashboard/reports` khol ke test kar lena — 3 naye button dikhne chahiye, har ek pe click
   karke apna-apna report khulna chahiye.
