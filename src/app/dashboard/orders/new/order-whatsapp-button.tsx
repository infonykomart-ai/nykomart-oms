"use client";

import { useState, useTransition } from "react";
import { markOrderWhatsAppSent } from "./actions";

/**
 * "Send on WhatsApp" for one order — item 4 + 5. Deliberately does NOT use
 * a WhatsApp Business API (user chose the simpler route: "khud ka whatsaap
 * use karna hai... share ka option ho"). Instead:
 *
 *  1. If the browser supports the Web Share API with files (most mobile
 *     browsers, and desktop Chrome/Edge on Windows/macOS), this shares the
 *     product photo as an actual attached image — not a link — plus the
 *     order details as text, to whichever app the user picks from the OS
 *     share sheet (WhatsApp being the obvious choice). This is the ONLY
 *     way to get a real image (not a link) into WhatsApp without a
 *     Business API.
 *  2. Otherwise, falls back to a wa.me "click to chat" link pre-filled
 *     with the order details as text (opens WhatsApp Web/Desktop/App) —
 *     the photo itself can't be pre-attached this way, so the text
 *     includes the photo URL as a fallback so nothing is lost.
 *
 * Either way, sending is a manual last step inside WhatsApp itself — this
 * button cannot (and does not claim to) guarantee delivery, only that the
 * employee was hands-off for building the message.
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
    sku_label: string | null;
    colour: string | null;
    tassel_fringes: boolean | null;
    photo_type: string | null;
    remark: string | null;
    is_amazon: boolean;
  };
}) {
  const [sentAt, setSentAt] = useState(order.whatsapp_sent_at);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 2026-09-02: "tassel fringes sirf cotton rug me hota hai" — the field is
  // only meaningful for cotton rugs; showing "Tassel/Fringes: No" on every
  // other item (jute, tufted, etc.) was pure noise in the packing message.
  // item_category_name values are the fixed product-type strings set at
  // order entry (see actions.ts's category map, e.g. "HANDMADE 100% COTTON
  // RUG") — a simple substring check is enough and doesn't need a new
  // column or a schema change.
  const isCottonRug = (order.item_category_name || "").toLowerCase().includes("cotton");

  // 2026-08-07: production/packing-facing message — fixed field template
  // given directly by the user (PO/RF/RG, QTY, Size, Dispatch Date, Photo,
  // Colour, Tassel/Fringes, SKU, Note), all pulled straight from the order
  // entry rather than typed by hand. Deliberately does NOT include buyer
  // name/value — this message rides along with the product photo to
  // whoever is packing/dispatching, not the customer. Amazon orders get a
  // bolded "TOP PRIORITY" flag up top (store name match, see page.tsx).
  function buildMessage() {
    const lines = [
      order.is_amazon ? "*TOP PRIORITY*\n" : null,
      `*PO/RF/RG:* ${order.ref_no}`,
      `*QTY:* ${order.qty}`,
      `*Size:* ${order.size_label || "-"}`,
      `*Dispatch Date:* ${order.dispatch_date || "-"}`,
      `*Photo:* ${order.photo_type || "-"}`,
      `*Colour:* ${order.colour || "-"}`,
      isCottonRug ? `*Tassel/ Fringes:* ${order.tassel_fringes ? "Yes" : "No"}` : null,
      `*SKU:* ${order.sku_label || "-"}`,
      "",
      `*Note:*\n${order.remark || "-"}`,
    ].filter((l) => l !== null);
    return lines.join("\n");
  }

  async function handleShare() {
    setError(null);
    const text = buildMessage();

    // Path 1: native share sheet with ONLY the composite image (photo + all
    // the order details baked in as a caption panel — see
    // /api/order-whatsapp-image). No separate `text` field is passed here.
    //
    // History of this exact decision flip-flopping — read before changing
    // it again:
    //  - 2026-08-08: "PHOTO OR MSG DONO ALAG ALAG KYU JA RAHE HAI EK SATH
    //    JANA CHAHIYE" — photo + a separate `text` field were arriving as 2
    //    SEPARATE WhatsApp messages, on both phone and computer. Fix: drop
    //    `text` entirely, rely only on the caption baked into the image
    //    pixels — nothing left for any platform to split apart.
    //  - 2026-09-01: "SIRF PHOTO HI JA RAHI HAI JO MSG APNE NE SETUP KIYA
    //    THA VO NAHI JA RAHA" — misdiagnosed as the caption not being sent
    //    at all; it was actually just easy to miss on a compressed
    //    chat-bubble thumbnail without opening the image. `text` was added
    //    back as a "considered, not independently device-verified"
    //    trade-off, with the caption panel kept as a safety net.
    //  - 2026-09-02: user reported the EXACT 2026-08-08 symptom again, with
    //    screenshots proving it: photo and text as 2 separate bubbles, 2
    //    separate timestamps. So the 2026-09-01 trade-off did reintroduce
    //    the split on real devices — confirmed, not hypothetical. Back to
    //    image-only, and this time the root complaint the 2026-09-01 change
    //    was chasing (caption easy to miss) is fixed properly instead of by
    //    re-adding `text`: the details panel now renders ABOVE the photo
    //    inside the composite image (see route.ts), not below it, so it's
    //    the first thing visible in a WhatsApp feed thumbnail even when a
    //    tall image gets cropped there — no separate `text` field needed to
    //    make it visible.
    //
    // Do not re-add `text` to shareData here without a device-verified fix
    // for the split — re-adding it on a hunch is exactly what caused this
    // round's regression.
    if (order.photo_url && typeof navigator !== "undefined" && "share" in navigator) {
      try {
        const imageParams = new URLSearchParams({
          url: order.photo_url,
          ref_no: order.ref_no,
          qty: String(order.qty),
          size: order.size_label || "-",
          dispatch_date: order.dispatch_date || "-",
          photo_type: order.photo_type || "-",
          colour: order.colour || "-",
          tassel_fringes: order.tassel_fringes ? "1" : "0",
          show_tassel_fringes: isCottonRug ? "1" : "0",
          sku: order.sku_label || "-",
          note: order.remark || "-",
          is_amazon: order.is_amazon ? "1" : "0",
        });
        const res = await fetch(`/api/order-whatsapp-image?${imageParams.toString()}`);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], `${order.ref_no}.jpg`, { type: blob.type || "image/jpeg" });
          const shareData = { files: [file] };
          if ("canShare" in navigator && navigator.canShare(shareData)) {
            await navigator.share(shareData);
            markSent();
            return;
          }
        }
      } catch {
        // Fetch/share failed (CORS, user cancelled, unsupported) — fall
        // through to the wa.me link below rather than leaving the button
        // stuck with no feedback.
      }
    }

    // Path 2: wa.me text-only link — always works, opens WhatsApp itself.
    // Deliberately NEVER pre-fills order.contact_no here: that's the
    // BUYER's number, but this message (PO/RF/RG + production specs) is
    // for whoever is packing/dispatching, not the customer. Auto-targeting
    // the buyer's number was the actual cause of "the number ... isn't on
    // WhatsApp" errors — a customer's saved contact number often isn't a
    // WhatsApp number at all. Opening a blank chat instead lets the
    // employee pick the right person/group themselves, every time.
    const fullText = order.photo_url ? `${text}\n\n*Photo Link:* ${order.photo_url}` : text;
    const url = `https://wa.me/?text=${encodeURIComponent(fullText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    markSent();
  }

  function markSent() {
    const now = new Date().toISOString();
    setSentAt(now);
    startTransition(async () => {
      const result = await markOrderWhatsAppSent(order.id);
      if (result.error) setError(result.error);
    });
  }

  // 2026-08-07: "whatsapp par send karne ka option regular hona chahiye,
  // ek baar send hone ke baad dubara send nahi kar paye ese nahi, bus sent
  // jo hoga vo green ho jaye" — sending stays available every time (e.g. to
  // resend after a mistake, or remind the buyer); the only thing that
  // changes after the first send is the button's own colour (and the
  // card's green tint elsewhere, driven by the same whatsapp_sent_at).
  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={handleShare}
        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
          sentAt
            ? "border-green-400 bg-green-100 text-green-800 hover:bg-green-200"
            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
        }`}
      >
        {sentAt ? "✓ Sent — Send Again" : "📱 Send on WhatsApp"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
