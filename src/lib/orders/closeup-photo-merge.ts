// 2026-11-22d — Phase 3 follow-up: the pure half of the Close-Up photo read
// path, kept in its own module so it can be unit-tested without Next.js,
// Supabase or a database.
//
// src/lib/orders/closeup-photos.ts does the I/O and calls these functions:
//   • mergeCloseupPhotoSources() — typed `order_attachments` rows first, then
//     the order's own `photo_urls[2..]`, merged by URL so nothing appears twice;
//   • planAttachmentSync() — what to insert / delete / re-order so the typed
//     index matches the order's saved list.
//
// Both are deliberately forgiving: trailing spaces are trimmed, blank URLs are
// dropped, and a URL that appears in BOTH sources (the normal case once the
// backfill has run) is stored once — the typed row's identity wins, and its
// position from the database is kept.
//
// No imports on purpose: anything this file used would drag an alias or a
// server-only module into `node --test`.

export type CloseupPhoto = {
  id: string;
  url: string;
  fileName: string | null;
  sortOrder: number;
};

/** Display name for a photo — derived from the URL, never user-typed. */
export function closeupFileNameFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
    return last || null;
  } catch {
    const last = url.split("?")[0].split("/").filter(Boolean).pop() ?? "";
    return last || null;
  }
}

/** Trims, drops blanks and removes repeats, keeping the FIRST occurrence. */
export function normalizeCloseupUrls(urls: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = (raw ?? "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** One photo per URL; the earliest entry decides id / name / position. */
export function dedupeCloseupPhotos(photos: CloseupPhoto[]): CloseupPhoto[] {
  const seen = new Set<string>();
  const out: CloseupPhoto[] = [];
  for (const photo of photos) {
    const url = photo.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...photo, url });
  }
  return out;
}

/**
 * Typed attachment rows first, then any legacy URL still only in
 * `orders.photo_urls`. A database where the attachment migration is pending
 * therefore shows the legacy list; one where it has run plus the backfill took
 * effect shows each photo once.
 */
export function mergeCloseupPhotoSources(
  typed: CloseupPhoto[],
  legacy: CloseupPhoto[]
): CloseupPhoto[] {
  return dedupeCloseupPhotos([...typed, ...legacy]);
}

export type ExistingAttachmentRow = {
  id: string;
  file_url: string;
  sort_order?: number | null;
};

export type PlannedAttachment = {
  file_url: string;
  file_name: string | null;
  sort_order: number;
};

export type AttachmentSyncPlan = {
  /** Rows to remove: stale URLs and any duplicate row for a kept URL. */
  toDelete: string[];
  /** Rows that do not exist yet, already carrying their saved position. */
  toInsert: PlannedAttachment[];
  /** Existing rows whose stored position no longer matches the saved list. */
  toReorder: { id: string; sort_order: number }[];
};

/**
 * Diff between what the order has saved (`urls`) and what the typed index
 * holds (`existing`). Pure, so the sync can be proven correct in tests without
 * a database.
 */
export function planAttachmentSync(
  existing: ExistingAttachmentRow[],
  urls: (string | null | undefined)[]
): AttachmentSyncPlan {
  const wanted = normalizeCloseupUrls(urls);
  const wantedSet = new Set(wanted);
  const position = new Map(wanted.map((url, index) => [url, index]));

  const kept: ExistingAttachmentRow[] = [];
  const toDelete: string[] = [];
  const seen = new Set<string>();

  for (const row of existing) {
    const url = (row.file_url ?? "").trim();
    // Stale URL, blank row, or a second row for a URL already kept.
    if (!url || !wantedSet.has(url) || seen.has(url)) {
      toDelete.push(row.id);
      continue;
    }
    seen.add(url);
    kept.push({ ...row, file_url: url });
  }

  const toReorder = kept
    .filter((row) => Number(row.sort_order ?? -1) !== position.get(row.file_url))
    .map((row) => ({ id: row.id, sort_order: position.get(row.file_url) as number }));

  const toInsert = wanted
    .map((url, index) => ({ url, index }))
    .filter(({ url }) => !seen.has(url))
    .map(({ url, index }) => ({
      file_url: url,
      file_name: closeupFileNameFromUrl(url),
      sort_order: index,
    }));

  return { toDelete, toInsert, toReorder };
}
