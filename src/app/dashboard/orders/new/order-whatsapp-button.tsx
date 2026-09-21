"use client";

import { useState, useTransition } from "react";
import { markOrderWhatsAppSent } from "./actions";

/**
 * "Send on WhatsApp" / "Send on Telegram" for one order — item 4 + 5.
 *
 * 2026-09-20 — FINAL, per explicit user confirmation after the old flow
 * broke on desktop (PO-A783/PO-A784: a composite image with a baked "TOP
 * PRIORITY" banner + details table + photo flattened into ONE image, and
 * desktop still needed a manual download+attach+paste that kept landing as
 * TWO separate WhatsApp/Telegram messages instead of one). Two decisions
 * were asked and confirmed directly:
 *
 *   1. NEVER bake the caption into the photo's pixels again, for ANY order
 *      — including Amazon "TOP PRIORITY" ones. The photo sent/shared is
 *      always the real, unmodified `order.photo_url` image (fetched
 *      through /api/order-photo-proxy so CORS/hotlinking on vendor image
 *      hosts never breaks it). The caption travels ONLY as real,
 *      copyable/editable/searchable text — never painted onto the image.
 *   2. Telegram gets REAL one-click automation via the Telegram Bot API
 *      (/api/telegram-send-order — server-side `sendPhoto`, one call, one
 *      message, zero manual steps). WhatsApp stays on the no-Business-API
 *      manual/share approach chosen earlier (BRAIN.md §9 /
 *      customer-whatsapp-button.tsx's header comment) — just fixed to use
 *      the real photo instead of a composite.
 *
 * WhatsApp flow (shareWhatsApp):
 *  1. Mobile (Web Share API with files): shares the real photo + the real
 *     caption as `text` in one call — the OS share sheet keeps files+text
 *     together as ONE message, with the text as the photo's native
 *     caption.
 *  2. Desktop (no reliable file Share API): the real photo downloads and
 *     the caption auto-copies to the clipboard; the employee attaches the
 *     downloaded photo in WhatsApp and pastes (Ctrl+V) the caption into
 *     that SAME caption box, then sends — one message, a real searchable
 *     caption, nothing baked into the image.
 *  3. If the photo can't be fetched at all: falls back to a text-only
 *     wa.me link with the photo's URL included in the text, so the message
 *     still goes out rather than silently failing.
 *
 * Telegram flow (sendTelegram): one click, fully automated — POSTs to
 * /api/telegram-send-order, which calls Telegram's Bot API server-side.
 * No download, no clipboard, no manual attach-and-paste.
 *
 * WhatsApp AUTO flow (sendWhapiAuto) — added 2026-09-20, same day, after the
 * user asked "ESA HI WHATSAAP PAR NHI HO SAKTA HAI KYA" (same one-click
 * automation on WhatsApp too). Official WhatsApp Cloud API can't post to
 * Groups at all; every unofficial route needs a persistent server the
 * user's hosting can't run — so the user signed up for Whapi.Cloud (a
 * hosted WhatsApp-Web-session API) themselves and chose it explicitly. This
 * button POSTs to /api/whapi-send-order, which calls Whapi's API
 * server-side — photo + caption, one message, no manual step. It sits
 * ALONGSIDE the original manual "📱 Send on WhatsApp" button (not replacing
 * it): Whapi's free tier is a rate-limited Sandbox (150 msg/day) and the
 * user may not always have WHAPI_TOKEN/WHAPI_GROUP_ID configured, so the
 * manual share flow stays as a zero-dependency fallback that always works.
 *
 * ── Older history (kept for context only — NOT current behavior) ──
 * 2026-08-07: first version, wa.me text-only, no image at all.
 * 2026-08-08 → 2026-09-15: repeated flip-flopping between a baked-pixel
 * composite and a real text caption, chasing platform-specific
 * message-splitting bugs on different devices — see the (now-unused)
 * order-whatsapp-image/route.ts header comment for the full blow-by-blow.
 * That composite route is left in the codebase but is no longer called
 * from here as of 2026-09-20.
 *
 * A separate "📋 Copy caption" button next to these copies the same
 * caption text to the clipboard on its own — useful any time the caption
 * needs to be pasted again without re-sending.
 */
export function OrderWhatsAppButton({
  order,
}: {
  order: {
    id: string;
    ref_no: string;
    buyer_name_address: string | null;
    contact_no: string | null;
    photo_url: string | null;
    item_category_name: string | null;
    size_label: string | null;
    qty: number;
    order_value_original: number;
    order_currency: string;
    whatsapp_sent_at: string | null;
    dispatch_date: string | null;
    // 2026-09-21 — "order page me ek option jodna hai estimate dispatch
    // date jo whatsaap par jati hai": rough/planned dispatch date, set at
    // order entry or via the Orders hub's edit form (order-edit-form.tsx).
    // Shown in the packing message alongside the real Dispatch Date (which
    // stays "-" until the order actually ships).
    estimated_dispatch_date: string | null;
    sku_label: string | null;
    colour: string | null;
    tassel_fringes: boolean | null;
    photo_type: string | null;
    remark: string | null;
    is_amazon: boolean;
    // 2026-09-20b — which company (Nyko Mart / Rugara / CASA ARRA) this
    // order belongs to, so the Telegram/WhatsApp auto-send routes can pick
    // THAT company's own group instead of a single hardcoded one — see
    // whapi-send-order/route.ts and telegram-send-order/route.ts header
    // comments. null is fine (routes fall back to the global env var).
    company_id: string | null;
  };
}) {
  const [sentAt, setSentAt] = useState(order.whatsapp_sent_at);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [telegramSending, setTelegramSending] = useState(false);
  const [whapiSending, setWhapiSending] = useState(false);

  function flashNotice(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 12000); // long enough to act on the steps
  }

  // 2026-09-02: "tassel fringes sirf cotton rug me hota hai" — the field is
  // only meaningful for cotton rugs; showing "Tassel/Fringes: No" on every
  // other item (jute, tufted, etc.) was pure noise in the packing message.
  // item_category_name values are the fixed product-type strings set at
  // order entry (see actions.ts's category map, e.g. "HANDMADE 100% COTTON
  // RUG") — a simple substring check is enough and doesn't need a new
  // column or a schema change.
  const isCottonRug = (order.item_category_name || "").toLowerCase().includes("cotton");

  // 2026-08-07: production/packing-facing message — fixed field template
  // given directly by the user (PO/RF/RG, QTY, Size, Dispatch Date,
  // Estimated Dispatch Date [added 2026-09-21], Photo, Colour, Tassel/
  // Fringes, SKU, Note), all pulled straight from the order entry rather
  // than typed by hand. Deliberately does NOT include buyer name/value —
  // this message rides along with the product photo to whoever is
  // packing/dispatching, not the customer. Amazon orders get a
  // "TOP PRIORITY" flag up top (store name match, see page.tsx).
  //
  // `bold` toggles WhatsApp-style single-asterisk emphasis around the fixed
  // labels: WhatsApp itself renders `*text*` as bold once the caption is
  // pasted/sent there, so WhatsApp keeps bold=true (unchanged from before).
  // Telegram calls this with bold=false — see /api/telegram-send-order's
  // header comment for why (Telegram's parse modes throw hard errors on
  // unbalanced markdown characters inside free-text order fields like SKU
  // or Note, so the Telegram caption is sent as plain text with no
  // parse_mode at all, and literal asterisks here would just look broken).
  function buildMessage(bold: boolean = true) {
    const wrap = (label: string) => (bold ? `*${label}*` : label);
    const lines = [
      order.is_amazon ? (bold ? "*TOP PRIORITY*\n" : "TOP PRIORITY\n") : null,
      `${wrap("PO/RF/RG:")} ${order.ref_no}`,
      `${wrap("QTY:")} ${order.qty}`,
      `${wrap("Size:")} ${order.size_label || "-"}`,
      `${wrap("Dispatch Date:")} ${order.dispatch_date || "-"}`,
      `${wrap("Estimated Dispatch Date:")} ${order.estimated_dispatch_date || "-"}`,
      `${wrap("Photo:")} ${order.photo_type || "-"}`,
      `${wrap("Colour:")} ${order.colour || "-"}`,
      isCottonRug ? `${wrap("Tassel/ Fringes:")} ${order.tassel_fringes ? "Yes" : "No"}` : null,
      `${wrap("SKU:")} ${order.sku_label || "-"}`,
      "",
      `${wrap("Note:")}\n${order.remark || "-"}`,
    ].filter((l) => l !== null);
    return lines.join("\n");
  }

  // Fetches the REAL, unmodified product photo — server-to-server through
  // /api/order-photo-proxy, same SSRF-safe proxy pattern the (now-unused)
  // composite route used, because most photo URLs live on outside vendor/
  // marketplace hosts that don't send CORS headers allowing a browser fetch
  // to read the response directly.
  async function fetchRawPhoto(): Promise<Blob | null> {
    if (!order.photo_url) return null;
    try {
      const res = await fetch(`/api/order-photo-proxy?url=${encodeURIComponent(order.photo_url)}`);
      return res.ok ? await res.blob() : null;
    } catch {
      return null;
    }
  }

  async function shareWhatsApp() {
    setError(null);
    setNotice(null);
    const text = buildMessage();

    let blob: Blob | null = null;
    try {
      blob = await fetchRawPhoto();
    } catch {
      blob = null;
    }

    // Path 1 — mobile share sheet: files+text arrive as ONE message whose
    // caption is the real, searchable text, and the photo itself is
    // exactly what's on the order (no overlay).
    if (blob && typeof navigator !== "undefined" && "share" in navigator) {
      try {
        const file = new File([blob], `${order.ref_no}.jpg`, { type: blob.type || "image/jpeg" });
        const shareData = { files: [file], text };
        if ("canShare" in navigator && navigator.canShare(shareData)) {
          await navigator.share(shareData);
          markSent();
          return;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled
        // real failure → desktop path below
      }
    }

    // Path 2 — desktop: the real photo downloads (no baked text) and the
    // caption auto-copies; the employee attaches the photo and pastes the
    // caption in the caption box → ONE message, searchable caption.
    // (Clipboard write here rides on the click's user activation — if the
    // browser refuses it, the 📋 Copy caption button right below is the
    // same text.)
    if (blob) {
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${order.ref_no}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);

      let copiedOk = false;
      try {
        await navigator.clipboard.writeText(text);
        copiedOk = true;
      } catch {
        copiedOk = false;
      }
      flashNotice(
        `📷 Asli photo (koi text nahi, jaisi hai waisi) download ho gayi — WhatsApp me photo ATTACH karo, caption box me ${
          copiedOk ? "Ctrl+V se PASTE karo (caption copy ho chuka hai)" : "📋 Copy caption button se caption copy karke paste karo"
        }, phir send. Ek hi message jayega aur caption search me milega.`
      );
      markSent();
      return;
    }

    // Path 3 — last resort (photo fetch failed / no photo): text-only deep
    // link so the message still goes out.
    const fullText = order.photo_url ? `${text}\n\n*Photo Link:* ${order.photo_url}` : text;
    window.open(`https://wa.me/?text=${encodeURIComponent(fullText)}`, "_blank", "noopener,noreferrer");
    markSent();
  }

  // Real automation: one call to our own server route, which calls
  // Telegram's Bot API server-side (photo + caption together, one
  // message). No download, no clipboard, no manual attach step.
  async function sendTelegram() {
    setError(null);
    setNotice(null);
    setTelegramSending(true);
    try {
      const res = await fetch("/api/telegram-send-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl: order.photo_url, caption: buildMessage(false), companyId: order.company_id }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Telegram par bhej nahi paye — dobara try karein.");
        return;
      }
      flashNotice("☁️ Telegram par bhej diya — photo aur caption ek hi message me chale gaye.");
      markSent();
    } catch {
      setError("Telegram par bhej nahi paye — internet check karke dobara try karein.");
    } finally {
      setTelegramSending(false);
    }
  }

  // Real automation: one call to our own server route, which calls
  // Whapi.Cloud's API server-side (photo + caption together, one message,
  // to the "Nyko Mart order" WhatsApp group). No download, no clipboard, no
  // manual attach step. Uses buildMessage(true) (bold=true, the default) —
  // unlike Telegram, real WhatsApp DOES render `*text*` as bold once the
  // message actually arrives via the WhatsApp network, so this keeps the
  // same bold labels the manual share flow already used.
  async function sendWhapiAuto() {
    setError(null);
    setNotice(null);
    setWhapiSending(true);
    try {
      const res = await fetch("/api/whapi-send-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl: order.photo_url, caption: buildMessage(), companyId: order.company_id }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error || "WhatsApp (auto) par bhej nahi paye — dobara try karein.");
        return;
      }
      flashNotice("🚀 WhatsApp group par bhej diya — photo aur caption ek hi message me chale gaye.");
      markSent();
    } catch {
      setError("WhatsApp (auto) par bhej nahi paye — internet check karke dobara try karein.");
    } finally {
      setWhapiSending(false);
    }
  }

  function markSent() {
    const now = new Date().toISOString();
    setSentAt(now);
    startTransition(async () => {
      const result = await markOrderWhatsAppSent(order.id);
      if (result.error) setError(result.error);
    });
  }

  // 2026-09-03: safety net alongside the image+text share above — copies
  // the exact same caption as plain text to the clipboard so it can be
  // pasted as its own WhatsApp message whenever it's actually needed to be
  // searchable/copyable (e.g. searching WhatsApp later for a PO/RF/RG
  // number), without depending on the OS share sheet keeping photo+text
  // together. Doesn't send anything by itself and doesn't call markSent()
  // — copying isn't sending.
  async function handleCopyCaption() {
    setError(null);
    try {
      await navigator.clipboard.writeText(buildMessage());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — your browser may be blocking clipboard access.");
    }
  }

  // 2026-08-07: "whatsapp par send karne ka option regular hona chahiye,
  // ek baar send hone ke baad dubara send nahi kar paye ese nahi, bus sent
  // jo hoga vo green ho jaye" — sending stays available every time (e.g. to
  // resend after a mistake, or remind the buyer); the only thing that
  // changes after the first send is the button's own colour (and the
  // card's green tint elsewhere, driven by the same whatsapp_sent_at).
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={isPending}
          onClick={shareWhatsApp}
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
            sentAt
              ? "border-green-400 bg-green-100 text-green-800 hover:bg-green-200"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {sentAt ? "✓ Sent — Send Again" : "📱 Send on WhatsApp"}
        </button>
        {/* 2026-09-20 — real Whapi.Cloud automation (see header comment):
            one click, one automated message, no manual step. Sits beside the
            manual button above as a fallback-safe addition, not a
            replacement — Whapi's free tier is rate-limited and may not
            always be configured. */}
        <button
          type="button"
          disabled={isPending || whapiSending}
          onClick={sendWhapiAuto}
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
        >
          {whapiSending ? "🚀 Sending…" : "🚀 Send on WhatsApp (Auto)"}
        </button>
        {/* 2026-09-20 — real Telegram Bot API automation (see header
            comment): one click, one automated message, no manual step. */}
        <button
          type="button"
          disabled={isPending || telegramSending}
          onClick={sendTelegram}
          className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
        >
          {telegramSending ? "☁️ Sending…" : "☁️ Send on Telegram"}
        </button>
        <button
          type="button"
          onClick={handleCopyCaption}
          title="Copy the caption as text — paste it as its own WhatsApp message if you need to search or copy it later"
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
            copied
              ? "border-green-400 bg-green-100 text-green-800"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {copied ? "✓ Copied" : "📋 Copy caption"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {notice && (
        <p className="mt-1 max-w-md rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800">
          {notice}
        </p>
      )}
    </div>
  );
}
