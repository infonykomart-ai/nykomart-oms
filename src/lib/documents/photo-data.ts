// 2026-11-22d — Phase 4: turn photo URLs into data URIs for @react-pdf.
//
// react-pdf can take a remote URL, but a single unreachable / expired /
// non-image URL makes the whole render fail — and an order PDF must never
// fail because one close-up photo's storage URL expired. So every image is
// fetched here first, one by one, and anything that is not a small, real image
// is simply left out of the PDF (the document prints without that thumbnail).
//
// data: URIs are passed through untouched, so a caller that already embedded
// an image does not download it again.
//
// 2026-11-23 — SECURITY: this used to fetch ANY http(s) URL a staff member had
// typed into a photo field, from the server. Two guards now sit in front of
// every fetch, and a URL failing either is omitted (never rendered):
//   1. Host allowlist — the Supabase storage host plus whatever
//      PHOTO_FETCH_ALLOWED_HOSTS names (photo-fetch-policy.ts). A photo on an
//      unlisted host no longer reaches the network at all; add the host to the
//      env var to bring it back into PDFs.
//   2. Private-address guard — safeExternalFetch resolves the hostname and
//      refuses loopback / RFC1918 / link-local / cloud-metadata targets, and
//      refuses to follow a redirect (which would otherwise bypass the check).
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";
import { isAllowedPhotoHost, photoFetchAllowlist } from "@/lib/security/photo-fetch-policy";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

export async function toPdfImageSource(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return null;

  let hostname: string;
  try {
    hostname = new URL(trimmed).hostname;
  } catch {
    return null;
  }
  if (!isAllowedPhotoHost(hostname, photoFetchAllowlist())) return null;

  try {
    const result = await safeExternalFetch(trimmed, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/*" },
      cache: "no-store",
    });
    if (!result.ok) return null;
    const response = result.response;

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;

    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    // Expired URL, DNS failure, timeout, a storage bucket that now 403s — none
    // of these may break the document; the photo is just omitted.
    return null;
  }
}

/** Same, for a list, preserving order and dropping failures. */
export async function toPdfImageSources(urls: string[], limit = 12): Promise<string[]> {
  const unique = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean))).slice(0, limit);
  const results = await Promise.all(unique.map((url) => toPdfImageSource(url)));
  return results.filter((source): source is string => !!source);
}
