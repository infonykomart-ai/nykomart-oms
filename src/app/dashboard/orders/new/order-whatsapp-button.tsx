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
      `*Tassel/ Fringes:* ${order.tassel_fringes ? "Yes" : "No"}`,
      `*SKU:* ${order.sku_label || "-"}`,
      "",
      `*Note:*\n${order.remark || "-"}`,
    ].filter((l) => l !== null);
    return lines.join("\n");
  }

  async function handleShare() {
    setError(null);
    const text = buildMessage();

    // Path 1: native share sheet with the composite image (photo + all the
    // order details baked in as a caption panel underneath it) AND the
    // same text as a real `text` field alongside it.
    //
    // 2026-08-08: "PHOTO OR MSG DONO ALAG ALAG KYU JA RAHE HAI EK SATH JANA
    // CHAHIYE" — user confirmed the photo and a separate text field were
    // arriving as 2 SEPARATE WhatsApp messages on both phone and computer,
    // when `navigator.share({files, text})` was used. The fix at the time
    // was to drop `text` entirely and rely only on the caption baked into
    // the image pixels, so there was nothing left for any platform to
    // split apart.
    //
    // 2026-09-01: "SIRF PHOTO HI JA RAHI HAI JO MSG APNE NE SETUP KIYA THA
    // VO NAHI JA RAHA" — root cause: that 2026-08-08 fix's side effect is
    // that `shareData` never carried a `text` field at all, so WhatsApp's
    // own send screen shows the image with a genuinely EMPTY caption box —
    // there is no separate chat text/caption for WhatsApp to display
    // alongside the photo bubble, only whatever's drawn into the photo
    // itself (which is easy to miss on a compressed chat-bubble thumbnail
    // unless the photo is opened/zoomed). That reads exactly as "only the
    // photo is going" even though the message technically still exists as
    // pixels in the image.
    //
    // Restoring `text` here is a considered, NOT independently
    // device-verified, trade-off: on a device/WhatsApp version where
    // `{files, text}` is handled correctly, this now sends ONE message
    // with a real, visible caption — fixing today's complaint outright. On
    // whatever device/WhatsApp combination caused the ORIGINAL 2026-08-08
    // split, this could reintroduce 2 separate messages (photo, then
    // text) instead of 1 combined one — but even in that worst case the
    // message text now actually arrives as real, readable WhatsApp text,
    // which is strictly better than the current complaint (arriving as
    // NOTHING visible). The baked-in caption panel on the photo itself is
    // left exactly as-is as a safety net either way, so the information is
    // never silently lost regardless of which platform behaviour a given
    // employee's phone/computer exhibits. If "2 separate messages" comes
    // back as a fresh complaint after this, that's the signal this
    // trade-off went the wrong way for that device and needs revisiting —
    // flag it rather than re-guessing.
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
          sku: order.sku_label || "-",
          note: order.remark || "-",
          is_amazon: order.is_amazon ? "1" : "0",
        });
        const res = await fetch(`/api/order-whatsapp-image?${imageParams.toString()}`);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], `${order.ref_no}.jpg`, { type: blob.type || "image/jpeg" });
          const shareData = { files: [file], text };
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
