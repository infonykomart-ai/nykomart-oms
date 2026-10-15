NYKOMART-OMS — UPDATED CODE ZIP (2026-10-15, CUMULATIVE)
=========================================================
Repo: https://github.com/infonykomart-ai/nykomart-oms
Base: aapke repo ki current origin/main — is zip me AAJ ke SAARE changes hain
      (pichla "ui-fixes" zip bhi isi me shamil hai, usko alag se lagane ki
      zaroorat NAHI hai — sirf yahi zip lagao).

Is zip me kya-kya hai
---------------------
1. ATTENDANCE ADMIN — MANUAL PUNCH AB ASLI TIME KE SAATH SAVE HOTA HAI
   "manual punching kaam nahi kar raha hai or usme ye bhi hona chahiye ki
   kitne baje ka punch dalna hai."
   * pehle: Manual Correction me sirf Status + Remark tha, isliye manual entry
     me punch_in/punch_out KABHI save nahi hote the (na work hours, na report me
     punch dikhta tha) — isi wajah se "manual punching kaam nahi karta" lagta tha.
   * ab: Punch In time (IST) aur Punch Out time (IST) ke field hain (24-hour).
     Punch Out tab tak band rehta hai jab tak Punch In na daala jaye.
   * Punch In time daalo to Status apne aap lag jata hai — wahi rule jo live
     punch me hai (09:45 IST tak Present, uske baad Late). Status khud choose
     karo to wahi lagega.
   * Sirf Punch Out (bina Punch In) daalne par saaf error milega.
   * "Blank time" purane punch ko chhedta nahi — sirf jo field bhari hai wahi
     save hota hai (status sudharne se asli punch delete nahi hota).
   * Save hote hi green message me exactly dikhta hai kya save hua:
     "Saved — Punch In 09:20 · Punch Out 18:05".
   * Work Hours column (generated) khud hi calculate hota hai — wahi purana
     formula, koi change nahi.
2. AMAZON KA TOTAL BUDGET / TOTAL SPEND — ASLI CONVERSION RATE KE SAATH
   "TOTAL BUDGET KITNA HUA AMAZON KA SPEND KITNA HUA PERFECT CALCULATION SE
   ACTUAL CONVERSATION KE HISAB SE JO DAILY BASIS PAR UPDATE HO AUTOMATICLLY."
   * Amazon Country section ke upar summary strip: Total Budget (USD),
     Total Spend (USD), Total Spend (₹) @ live rate, Budget Used %, Total
     Sales (USD) + order count, Spend % of Sales.
   * Table me naya column: "Spend (₹ @ live rate)" — aur TOTAL row bhi usi rate
     par convert hota hai, to strip aur table ke numbers kabhi alag nahi honge.
   * Neeche line me: "Actual conversion: 1 USD = ₹…", rate ka source, rates
     kab fetch hui, aur market rate kab last badla.
   * Rate khud refresh hota hai: cache 12 ghante se purani hui to page khulte
     hi naya rate aa jata hai (koi cron/Google Sheet me manually daalne ki
     zaroorat nahi). Manually turant chahiye to "↻ Refresh rates" button.
   * Internet/API fail ho to page toot‑ta NAHI — purana cached rate dikhta hai
     aur ⚠ warning saath likha aata hai.
   * Ye rate sirf SCREEN/EXPORT calculation ke liye hai. Aapki legal/customs
     rate (exchange_rates, CBIC notification wali) ko chhua nahi gaya.
   * CSV/Excel export me bhi ₹ wala column aata hai (rate ke saath).
3. AMAZON COUNTRY SECTION + STATEMENT VERIFICATION (pichle round se, isme hai)
   * Amazon ka Budget/Spend ab har COUNTRY ke hisab se (USA, Canada, Mexico,
     Australia, UK, Germany, Italy, Japan, France, Spain, India, UAE) — Etsy /
     eBay / Website par ye field aata hi nahi, unka ek hi row per day rehta hai.
   * Har row par Statement column: ✅ x/y verified (marketplace statement se
     match), ⚠️ partial, ⏳ 0/y (statement import nahi hui) — aur usi store ke
     us mahine ke statement detail ka LINK.
4. UI ROUND (pichle round se, isme hai)
   * Hinglish UI text → English (user-visible strings only).
   * Responsive layout — koi column/text kisi par nahi chadhta, chhoti screen
     par fields stack ho jate hain; tables me horizontal scroll.
   * Text color/font theme ke according auto adjust (inherit-only).

DB MIGRATIONS — Supabase SQL Editor me ORDER se run karo (agar pehle nahi ki)
-----------------------------------------------------------------------------
1. db/2026-10-15-ad-spend-amazon-country.sql   (store_ad_spend me country_code
   + nayi unique key) — agar pehle run kar li hai to SKIP karo.
2. db/2026-10-15b-fx-rate-cache.sql            (nayi fx_rate_cache table —
   Amazon ke ₹ conversion ke liye ZAROORI hai). Ye nayi hai, ab run karni hai.
Dono files is zip me db/ folder me hi hain.

Files kaise lagayen
-------------------
Tareeka 1 — file-by-file: zip kholo, files ko repo me SAME PATH par copy/paste
            (overwrite). GitHub par "Add file → Upload files" bhi chalega.
Tareeka 2 — patch (ek command): zip me do patch hain —
            * changes-origin-main-to-worktree-2026-10-15.patch
              (aapke current repo ke UPAR — yahi use karo)
            * changes-e9a39af-to-worktree-2026-10-15.patch
              (sirf tab, jab pichla ui-fixes zip pehle hi laga diya ho)
            repo root me rakh kar:  git apply <patch-file>

Verify jo maine kiya
--------------------
* npx tsc --noEmit      → 0 errors
* npx eslint (badele hue area) → 0 errors
* Dono patches ko origin/main ke ek saaf copy par apply karke check kiya —
  apply ke baad woh copy EXACTLY isi code jaisi bani (koi file missing nahi).
* Amazon section ka ₹ total / total row dono ek hi rate se — ek hi jagah
  (Amazon country rows) se derive hote hain, isliye screen / CSV / Excel
  ke numbers alag nahi ho sakte.

Note: is round me koi naya npm package nahi chahiye (live rate ke liye koi
library use nahi ki — seedha fetch).
