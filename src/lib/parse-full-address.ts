// Full-address splitter — thin compatibility shim (rewritten 2026-11-22).
//
// The original 2026-09-10 version of this file lived here and did the whole
// job with US-shaped assumptions: it looked for "City, ST 12345" at the end
// of the text and treated everything before it as the street. That fixed the
// FedEx "Recipient state and postal code mismatch" bug for US addresses, but
// it produced wrong output for the countries this business actually ships to
// (Germany's "10115 Berlin", the UK's postcode-on-its-own-line, India's
// "Bengaluru, Karnataka 560001"), and it had no way to say "I'm not sure".
//
// The engine now lives in src/lib/address/ (country rules, parser, provider
// verification, and tests for 30+ countries). This file is kept ONLY so the
// three existing callers — courier-booking/actions.ts, shipglobal/actions.ts,
// b2b/b2b-client.tsx — and the two order forms keep compiling and behaving
// the same shape-wise. New code should import from "@/lib/address".
//
// Nothing that used to work is dropped: address1 still carries the apartment/
// suite text, address2 still carries the extra address line(s), and every
// field is still a best-effort value in an ordinary editable input.

import { parseAddress } from "./address/parse";

export type ParsedAddress = {
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  /** Canonical country name (e.g. "United States"), or "" if unresolved. */
  country: string;
};

/**
 * Best-effort full-address splitter. Multi-line clipboard text is the ideal
 * input; a single collapsed line still yields everything the country's own
 * written order determines. Never throws — unresolved fields come back "".
 */
export function parseFullAddress(raw: string | null | undefined): ParsedAddress {
  const { fields } = parseAddress(raw);
  return {
    address1: fields.street,
    address2: fields.address2,
    city: fields.city,
    state: fields.state,
    postalCode: fields.postalCode,
    country: fields.country,
  };
}

/**
 * True when `text` looks like it carries more than a plain street address, so
 * an onPaste can safely be intercepted for auto-splitting. A plain
 * "123 Main St" paste must behave exactly as a normal text input always has.
 */
export function looksLikeFullAddress(text: string): boolean {
  if (!text || !text.trim()) return false;
  if (/\r?\n/.test(text)) return true;

  const { fields } = parseAddress(text);
  if (fields.postalCode || fields.state || fields.countryCode) return true;

  // No postcode/state/country, but a comma-separated "street, city" shape
  // ("12 Rue de Rivoli, Paris") is still worth splitting.
  const segments = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length >= 3) {
    const last = segments[segments.length - 1];
    return !/\d/.test(last) && last.split(/\s+/).length <= 5;
  }
  return false;
}
