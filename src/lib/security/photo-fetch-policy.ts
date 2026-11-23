// 2026-11-23 — allowlist for the server-side photo fetch behind the PDF
// builders (src/lib/documents/photo-data.ts).
//
// WHY THIS EXISTS: the photo URL on an order is typed by staff, and the PDF
// routes fetched whatever http(s) URL was stored — from the server. The shared
// helper src/lib/security/safe-external-fetch.ts already refuses loopback,
// private, link-local and cloud-metadata addresses, but it deliberately has no
// host allowlist because it also serves /api/order-photo-proxy, which must
// work with any vendor's image host. A PDF, by contrast, is built from a URL
// that is already saved on the record, so a much narrower rule is both
// possible and safer: only the company's own Supabase storage host and hosts
// an operator names explicitly may be fetched.
//
// PHOTO_FETCH_ALLOWED_HOSTS is a comma-separated list of hosts:
//   cdn.example.com          that exact host
//   .example.com             example.com and every subdomain
// The Supabase project host is always allowed, taken from
// NEXT_PUBLIC_SUPABASE_URL (falling back to SUPABASE_URL).
//
// Trade-off, deliberately accepted: a photo stored on some other host is
// simply left out of the PDF (the document still renders — see
// toPdfImageSource's "omit, never fail" contract) until that host is listed.
// Nothing is ever fetched outside this list.

export type PhotoFetchEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  PHOTO_FETCH_ALLOWED_HOSTS?: string;
};

/** Lowercase, no scheme, no port, no trailing dot. "" means "not usable". */
export function normalizePhotoHost(raw: string | null | undefined): string {
  let value = (raw ?? "").trim().toLowerCase();
  if (!value) return "";
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname.toLowerCase();
    } catch {
      return "";
    }
  } else {
    // A pasted "cdn.example.com/path" or "cdn.example.com:443" is common
    // enough in an env var that both are tolerated.
    value = value.split("/")[0];
  }
  value = value.replace(/:\d+$/, "").replace(/\.$/, "");
  return value;
}

/** The Supabase storage host plus every host named in the env var. */
export function photoFetchAllowlist(env: PhotoFetchEnv = process.env as PhotoFetchEnv): string[] {
  const hosts: string[] = [];

  for (const raw of [env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_URL]) {
    if (!raw) continue;
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (host) hosts.push(host);
    } catch {
      // A malformed Supabase URL is a configuration problem the app already
      // surfaces elsewhere; it must not make this check throw.
    }
  }

  for (const entry of (env.PHOTO_FETCH_ALLOWED_HOSTS ?? "").split(",")) {
    const host = normalizePhotoHost(entry);
    if (host) hosts.push(host);
  }

  return Array.from(new Set(hosts));
}

/**
 * True only for a host this deployment is willing to fetch from. An empty
 * allowlist allows nothing — "no hosts configured" must never mean "all hosts".
 */
export function isAllowedPhotoHost(hostname: string, allowlist: string[]): boolean {
  const host = normalizePhotoHost(hostname);
  if (!host) return false;

  return allowlist.some((entry) => {
    const allowed = normalizePhotoHost(entry);
    if (!allowed) return false;
    if (allowed.startsWith(".")) {
      const base = allowed.slice(1);
      return !!base && (host === base || host.endsWith(`.${base}`));
    }
    return host === allowed;
  });
}
