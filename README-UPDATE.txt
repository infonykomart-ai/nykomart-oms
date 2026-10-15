NYKOMART-OMS — UI / UX CLEANUP ZIP (2026-10-15)
================================================
Repo: https://github.com/infonykomart-ai/nykomart-oms
Base: aapka aakhri upload (origin/main par jo hai) — isme sirf AAJ ka UI cleanup round hai.

Is round me kya kiya
--------------------
1. HINGLISH UI TEXT → ENGLISH
   Buttons, notes, empty states, error/validation messages, placeholders, dialogs,
   WhatsApp/Telegram send replies, AI chat replies — sab English me.
   (src/ me kahin bhi Devanagari nahi tha; target Roman-script Hinglish tha.
   Code ke andar ke COMMENTS jaan-boojh kar waise hi chhode hain — woh UI par dikhte nahi.)
2. LAYOUT — "koi text/column kisi par nahi chadhe, screen ke according auto adjust"
   * Jitne screen tables horizontal scroll ke bina the, unko overflow-x-auto me daala
     (credit note panel, wallet panel, companion access, settlement statement, party ledger).
     Party ledger + settlement table par `print:min-w-0` — print/PDF par koi asar nahi.
   * 23 non-responsive grid-cols-3/4/5/6 field rows (11 forms) ab
     `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N` — desktop par pehle jaisa, chhoti screen par stack.
     (A4 print documents jaan-boojh kar chhode hain.)
3. FONT / TEXT COLOR (src/app/globals.css) — inherits only, kuch bhi force nahi
   * body ka font: theme ka --font-sans (system-ui…) — Arial hata diya.
   * [data-theme] ke andar inherited text color = --oms-text (near-black) — theme badalne par
     apne aap adjust. Jo component apna color set karta hai (white-on-accent button, status pill)
     woh bilkul waise hi rehta hai.
   * [data-theme] table me tabular figures — money/qty columns digit-to-digit align.
4. DEAD CODE saaf: unused totalOutstanding, unused companies prop, unused BarChart import.

AUDIT — jo theek nikla (koi change nahi chahiye tha)
----------------------------------------------------
* 52 static internal hrefs + saare capability tiles + redirect()/router.push() targets:
  sab real page.tsx par resolve hote hain — BROKEN LINK EK BHI NAHI.
* Koi orphan dashboard route nahi, koi href="#", koi khaali onClick, koi "coming soon"/TODO nahi.
* Attendance Admin ke tables pehle se scroll me the (shared tableWrapClass).

Verify
------
* `npx tsc --noEmit` → 0 errors
* `npx eslint src` → 0 errors (bache 3 warnings: 2 `<img>` suggestion + 1 underscore wala
  server-action param — dono jaan-boojh kar aise hain)

Files kaise lagayen
-------------------
Tareeka 1 — file-by-file: zip kholo, files ko repo me SAME PATH par copy/paste (overwrite).
            GitHub par "Add file -> Upload files" bhi chalega.
Tareeka 2 — patch: changes-origin-main-to-e9a39af.patch repo root me rakh kar:
              git apply changes-origin-main-to-e9a39af.patch

NOTE: is round me koi DB migration nahi hai — sirf UI/code changes hain.
