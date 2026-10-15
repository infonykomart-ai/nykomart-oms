NYKOMART-OMS — UPDATED FILES ZIP (kal 2026-10-14 + aaj 2026-10-15)
===================================================================
Repo: https://github.com/infonykomart-ai/nykomart-oms
Base: aapka pichhla upload commit cf17a3b ("Add files via upload")
Andar ke sabhi 30 files = cf17a3b se lekar ab tak ke saare changes, repo ke
same path par, HEAD (latest) content ke saath.

Isme ye rounds hain
-------------------
1) 2026-10-14  a45f63c  Bill statement me saare PO entries (size/rate/GST) +
                        per-entry edit/delete; B2B PI export fields
2) 2026-10-15  5905482  Unified Printing Register (material-out chalan +
                        received chalan + printing bills ek jagah)
3) 2026-10-15  b8c3d8b  README me B2B PI/CI print round ka documentation
4) 2026-10-15  15bf165  Store Ad Spend: Amazon COUNTRY-wise Budget/Spend +
                        Store Monthly Statement se VERIFY + LINK
5) 2026-10-15  f0439b5  B2B PI: migration run nahi hui to ab SCREEN PAR
                        dikhta hai (pehle chup-chaap "To be provided" chhapta tha)

B2B ka kya hua (aapka sawaal)
-----------------------------
B2B ka pura PI update is zip me pehle se hai — src/app/dashboard/b2b/*.tsx,
b2b/actions.ts, lib/b2b/erp.ts, bill-statement files — aur uske saath
db/2026-10-13-b2b-pi-export-fields.sql (naya, round 1 se).
"To be provided" ka asli reason: woh SQL file database me run nahi hui thi, aur
app chup-chaap chalta rehta tha kyunki quotations select("*") se load hote the
(missing column par PostgREST error nahi deta). Ab ek probe query jaan-boojhkar
un columns ko maangti hai, isliye migration pending ho to 🛠️ setup card khulta
hai jo chalane wali SQL files ki list dikhata hai.

Zaroori: ye 2 SQL files Supabase SQL Editor me run karni hain (ek baar)
---------------------------------------------------------------------
A) db/2026-10-13-b2b-pi-export-fields.sql      -> B2B PI ke payment terms /
   ports / packing / item specs + b2b_export_profiles. ISKE BINA PI me
   "To be provided" aata rahega.
B) db/2026-10-15-ad-spend-amazon-country.sql   -> country_code column +
   (store, date, country) unique key. ISKE BINA Amazon store ki country-wise
   entry SAVE NAHI HOGI. Purani Amazon rows country '' ke saath "Other" row me
   dikhengi — dobara save karne par sahi country aa jayegi.

Files kaise lagayen (2 tareeke)
-------------------------------
Tareeka 1 — file-by-file (GitHub web bhi chalega):
  Zip kholo aur andar ke files ko apne repo me SAME PATH par copy/paste karke
  purani file overwrite kar do. GitHub par: "Add file -> Upload files".

Tareeka 2 — patch (git wale ke liye, sabse safe):
  changes-cf17a3b-to-f0439b5.patch ko repo root me rakho aur chalao:
      git apply changes-cf17a3b-to-f0439b5.patch

Delete karne wali koi file nahi
--------------------------------
Is range me koi file delete nahi hui — sab add/modify hi hain.

Note
----
Agar repo par round 2/3 pehle se hai, to wahi content milega — overwrite safe.
