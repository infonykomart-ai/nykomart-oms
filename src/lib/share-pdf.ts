"use client";

// 2026-09-19 — shared low-level "share this PDF" mechanics, extracted from
// src/components/bill-statement-actions.tsx so the new Doc Statement
// dialog (Credit Note / CSB Filing / Refund / Order Refund — see
// doc-statement-actions.tsx) reuses the EXACT same Web-Share-then-fallback
// behavior instead of a second copy. bill-statement-actions.tsx itself is
// left as-is (a working, shipped payment feature) — this file is the one
// place both the old and any new action bar can pull the mechanics from.

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Tries the Web Share API with the real PDF file attached (the only path
 * that actually ATTACHES a file — works in the mobile share sheet for
 * WhatsApp/Telegram/etc). Returns true if the share sheet was successfully
 * invoked (regardless of whether the user completed or cancelled it from
 * there — cancellation is not an error the caller needs to react to).
 * Returns false when Web Share isn't available/can't share this payload,
 * so the caller should fall back to download + a wa.me/t.me/mailto link.
 */
export async function tryShareFile(blob: Blob, filename: string, text: string, title: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !("share" in navigator) || !("canShare" in navigator)) return false;
  const file = new File([blob], filename, { type: "application/pdf" });
  const shareData = { files: [file], text, title };
  if (!navigator.canShare(shareData)) return false;
  try {
    await navigator.share(shareData);
    return true;
  } catch {
    return false; // user cancelled, or the share sheet itself failed — caller falls back
  }
}
