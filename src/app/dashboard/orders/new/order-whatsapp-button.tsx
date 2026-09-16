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
 *
 * A separate "📋 Copy caption" button next to it copies the same details
 * as plain text to the clipboard — see the 2026-09-03 note below on why
 * that exists alongside the image-only send.
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
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

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

  // 2026-09-15 (round 2) — "whatsaap or telegram ek msg me, photo or
  // caption jisko agar whatsaap par search kiya jaye to search ho jaye":
  // the baked-pixels composite alone is NOT searchable (WhatsApp search
  // only indexes real text/captions, never pixels). So the flow is now
  // platform-aware, always one message, and the caption is REAL text
  // wherever the platform allows it:
  //
  //  • Mobile (share sheet keeps files+text together — Android and iOS
  //    both compose image+text as ONE message with the text as the
  //    image's caption): navigator.share({ files, text }) → real
  //    searchable caption, one message. The composite (details ALSO
  //    baked above the photo) is what gets shared, so even there the
  //    info survives a text-dropping target.
  //  • Desktop (WhatsApp/Telegram Desktop drop the text field — the
  //    exact bug reported on Windows): the composite DOWNLOADS and the
  //    caption AUTO-COPIES to the clipboard, with on-screen steps:
  //    attach the photo → paste (Ctrl+V) in the caption box → send.
  //    That is one message with a real, searchable caption. No auto-open
  //    of any deep link — a prefilled text input would just become a
  //    SECOND message.
  //  • If the composite can't be fetched at all: fall back to the old
  //    wa.me text link so the message still goes.
  async function fetchComposite(): Promise<Blob | null> {
    if (!order.photo_url) return null;
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
    return res.ok ? res.blob() : null;
  }

  async function shareOrder(target: "whatsapp" | "telegram") {
    setError(null);
    setNotice(null);
    const text = buildMessage();

    let blob: Blob | null = null;
    try {
      blob = await fetchComposite();
    } catch {
      blob = null;
    }

    // Path 1 — mobile share sheet: files+text arrive as ONE message whose
    // caption is the real, searchable text (and the pixels carry the same
    // details as a safety net).
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

    // Path 2 — desktop: composite downloads + caption auto-copies; the
    // employee attaches the photo and pastes the caption in the caption
    // box → ONE message, searchable caption. (Clipboard write here rides
    // on the click's user activation — if the browser refuses it, the
    // 📋 Copy caption button right below is the same text.)
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
      const appName = target === "whatsapp" ? "WhatsApp" : "Telegram";
      flashNotice(
        `📷 Photo (details ke sath) download ho gayi — ${appName} me photo ATTACH karo, caption box me ${
          copiedOk ? "Ctrl+V se PASTE karo (caption copy ho chuka hai)" : "📋 Copy caption button se caption copy karke paste karo"
        }, phir send. Ek hi message jayega aur caption search me milega.`
      );
      markSent();
      return;
    }

    // Path 3 — last resort (composite fetch failed / no photo): text-only
    // deep link so the message still goes out.
    const fullText = order.photo_url ? `${text}\n\n*Photo Link:* ${order.photo_url}` : text;
    const url =
      target === "whatsapp"
        ? `https://wa.me/?text=${encodeURIComponent(fullText)}`
        : `https://t.me/share/url?url=${encodeURIComponent(order.photo_url || " ")}&text=${encodeURIComponent(text)}`;
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
          onClick={() => shareOrder("whatsapp")}
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
            sentAt
              ? "border-green-400 bg-green-100 text-green-800 hover:bg-green-200"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {sentAt ? "✓ Sent — Send Again" : "📱 Send on WhatsApp"}
        </button>
        {/* 2026-09-15 — "whatsaap or telegram par ek hi msg me..." — Telegram
            twin of the WhatsApp button: same composite image (details baked
            in) + same caption text, t.me deep link as the fallback path. */}
        <button
          type="button"
          disabled={isPending}
          onClick={() => shareOrder("telegram")}
          className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
        >
          ☁️ Send on Telegram
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
