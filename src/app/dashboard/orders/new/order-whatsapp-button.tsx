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
  };
}) {
  const [sentAt, setSentAt] = useState(order.whatsapp_sent_at);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function buildMessage() {
    const lines = [
      `Order: ${order.ref_no}`,
      order.item_category_name ? `Item: ${order.item_category_name}${order.size_label ? ` (Size: ${order.size_label})` : ""}` : null,
      `Qty: ${order.qty}`,
      `Value: ${order.order_value_original} ${order.order_currency}`,
      order.buyer_name_address ? `Buyer: ${order.buyer_name_address}` : null,
    ].filter(Boolean);
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
    const fullText = order.photo_url ? `${text}\nPhoto: ${order.photo_url}` : text;
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

  if (sentAt) {
    return <span className="text-xs font-medium text-green-700">✓ WhatsApp par bheja gaya</span>;
  }

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={handleShare}
        className="rounded-lg border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 transition hover:bg-green-100 disabled:opacity-60"
      >
        📱 WhatsApp par bhejo
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
