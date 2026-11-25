// 2026-11-24 — One stable hash of the English source of a listing.
//
// It answers exactly one question: "is the content the stored keywords and
// listings were produced from still the same?" If yes, a run may reuse them
// instead of paying for another research + ten generation calls.
//
// The hash is built from an explicit, ordered field list (never
// JSON.stringify(object) directly) so a database row that returns columns in a
// different order does not look like changed content.
//
// Images are included by URL: localized alt text is written from the photo, so
// replacing a photo must invalidate the cached listing.
// Server-only (node:crypto); never imported by a client component.

import { createHash } from "node:crypto";

export type SeoSourceSnapshot = {
  projectName?: string | null;
  category?: string | null;
  title?: string | null;
  description?: string | null;
  tags?: string | null;
  /** Structured product facts (optional; kept for projects created earlier). */
  product?: Record<string, unknown> | null;
  images?: Array<{ url?: string | null }> | null;
};

/** Trim + collapse whitespace so cosmetic edits do not invalidate the cache. */
function normalize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function contentHash(snapshot: SeoSourceSnapshot): string {
  const facts = Object.entries(snapshot.product ?? {})
    .map(([key, value]) => [key, normalize(typeof value === "string" ? value : String(value ?? ""))] as const)
    .filter(([, value]) => value.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const images = (snapshot.images ?? []).map((image) => normalize(image?.url ?? "")).filter(Boolean);

  const payload = JSON.stringify({
    projectName: normalize(snapshot.projectName),
    category: normalize(snapshot.category),
    title: normalize(snapshot.title),
    description: normalize(snapshot.description),
    tags: normalize(snapshot.tags),
    facts,
    images,
  });

  return createHash("sha256").update(payload).digest("hex");
}
