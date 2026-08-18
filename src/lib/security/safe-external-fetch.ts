import dns from "node:dns/promises";
import net from "node:net";

// 2026-08-17 security fix — /api/order-photo-proxy and
// /api/order-whatsapp-image both fetch() an arbitrary client-supplied URL
// server-side (order.photo_url can legitimately be almost any vendor/
// marketplace image host — e.g. artsofjaipur.com — so there's no fixed
// domain allowlist to check against). Requiring `order_entry` capability
// keeps this out of reach of a random visitor, but any signed-in employee
// could still point `url=` at an internal address (localhost, the cloud
// metadata endpoint 169.254.169.254, a private RFC1918 range, etc.) and
// use this server as an SSRF proxy to reach services it shouldn't be able
// to touch from the browser. This resolves the hostname first and refuses
// to fetch anything that lands on a private/loopback/link-local/reserved
// address — and refuses to follow redirects blindly (a check-then-fetch
// without this would let an attacker pass a public URL that 302s to an
// internal one, sailing straight past the check).
//
// Deliberately NOT a domain allowlist (the whole point of this proxy is to
// work with any vendor's photo host) — this only blocks network ranges no
// legitimate product-photo host would ever resolve to.

function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved/broadcast range
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (ULA)
    if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.replace("::ffff:", "")); // IPv4-mapped
    return false;
  }
  return true; // not a parseable IP at all — treat as unsafe rather than guessing
}

export type SafeFetchResult = { ok: true; response: Response } | { ok: false; error: string; status: number };

/**
 * Validates a client-supplied URL is http(s) and doesn't resolve to a
 * private/internal address, then fetches it WITHOUT following redirects
 * (a redirect to an internal address would otherwise bypass the check
 * above entirely). Callers should treat a "redirect" result the same as
 * any other failure — surface a generic "could not fetch" to the caller,
 * don't chase the redirect.
 */
export async function safeExternalFetch(rawUrl: string): Promise<SafeFetchResult> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid url", status: 400 };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { ok: false, error: "Invalid url", status: 400 };
  }

  let addresses: string[];
  try {
    const resolved = await dns.lookup(target.hostname, { all: true });
    addresses = resolved.map((r) => r.address);
  } catch {
    return { ok: false, error: "Could not resolve host", status: 502 };
  }
  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
    return { ok: false, error: "That host is not allowed", status: 400 };
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { redirect: "manual" });
  } catch {
    return { ok: false, error: "Could not fetch photo", status: 502 };
  }
  if (upstream.type === "opaqueredirect" || (upstream.status >= 300 && upstream.status < 400)) {
    return { ok: false, error: "That host redirected — not allowed", status: 502 };
  }
  if (!upstream.ok || !upstream.body) {
    return { ok: false, error: "Could not fetch photo", status: 502 };
  }
  return { ok: true, response: upstream };
}
