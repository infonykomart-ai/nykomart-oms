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

  function waPhone() {
    const raw = (order.contact_no ?? "").replace(/[^\d]/g, "");
    if (!raw) return "";
    // Indian mobile numbers are usually saved without the country code —
    // default to 91 (India) when it looks like a bare 10-digit number.
    // Numbers already carrying a country code (11+ digits) pass through.
    return raw.length === 10 ? `91${raw}` : raw;
  }

  async function handleShare() {
    setError(null);
    const text = buildMessage();

    // Path 1: native share sheet with the actual photo attached.
    if (order.photo_url && typeof navigator !== "undefined" && "share" in navigator) {
      try {
        const res = await fetch(order.photo_url, { mode: "cors" });
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], "product-photo.jpg", { type: blob.type || "image/jpeg" });
          const shareData = { files: [file], text, title: order.ref_no };
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
    const phone = waPhone();
    const fullText = order.photo_url ? `${text}\n\n*Photo Link:* ${order.photo_url}` : text;
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(fullText)}`
      : `https://wa.me/?text=${encodeURIComponent(fullText)}`;
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
