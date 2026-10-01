// 2026-09-30 — shared WhatsApp number normalizer. Originally extracted
// from whatsapp-notify.ts so the punch notifications, the admin "Test"
// send, and the Team Directory's wa.me links all validated the SAME way
// — before that, the directory's links and the notification sender could
// disagree about what a usable number is (the exact class of bug that
// made "kisi ke msg gaya, kisi ke nahi" so hard to pin down).
//
// 2026-09-30 (later same day): punch notifications + the admin Test
// button moved to Telegram (telegram-notify.ts) and whatsapp-notify.ts
// was deleted — this file stays because the Team Directory's wa.me links
// (and any other wa.me/whatsapp_no UI) still need the exact same
// validation. Whapi itself is no longer called from anywhere in this flow.
//
// Whapi (gate.whapi.cloud) wants E.164 digits for a 1:1 chat, e.g.
// "919876543210". The roster stores numbers the way people type them:
// bare 10-digit, 0-prefixed, +91, spaces/dashes — all accepted below.
// Anything that can't be resolved to a valid Indian mobile number returns
// null so callers can reject BEFORE sending (fail loudly, not invisibly).

/**
 * The E.164 digits Whapi expects for a 1:1 chat ("919876543210"), or null
 * when the stored value can't be trusted to reach the right person.
 *
 * Handles the shapes the roster actually contains:
 *   "9876543210"      → 919876543210   (bare 10-digit, assumed India)
 *   "09876543210"     → 919876543210   (STD-style leading 0)
 *   "00919876543210"  → 919876543210   (double international prefix)
 *   "919876543210"    → 919876543210   (already country-coded)
 *   "+91 98765 43210" → 919876543210   (formatted with separators)
 *   "" / "12345" / double country code / wrong length → null
 */
export function normalizeWhatsappNumber(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  // A valid Indian mobile number never starts with 0 — any leading zeros
  // are STD/international prefixes typed by hand, so drop them all.
  digits = digits.replace(/^0+/, "");
  if (digits.length === 10) return `91${digits}`; // bare local number → assume India (whole roster is)
  if (digits.length === 12 && digits.startsWith("91")) return digits; // already has the country code
  return null; // too short, not Indian, or country code typed twice — don't guess
}

/** Small helper for UI badges: does this stored value pass validation? */
export function isUsableWhatsappNumber(raw: string | null | undefined): boolean {
  return Boolean(raw && raw.trim() && normalizeWhatsappNumber(raw) !== null);
}
