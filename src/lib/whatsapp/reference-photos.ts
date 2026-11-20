// 2026-11-20 — "REF PHOTO [ORDER NUMBER]": choosing WHICH photos may travel.
//
// An order keeps its photos in two existing columns (no schema change):
//   • orders.photo_url   = the MAIN product photo
//   • orders.photo_urls  = the full list, main first (db/2026-09-18). Every
//                          later entry is a Close-Up / Reference photo.
//
// This module is the single source of truth for that rule, deliberately pure
// (no DB, no fetch, no Next imports) so it can be unit-tested and reused by
// the automatic hook, the manual button and the detail page's counter.
//
// What it must never do:
//   • attach the main product photo as if it were a reference photo,
//   • attach the same photo twice,
//   • attach an invoice / label / document / PDF,
//   • attach a photo that belongs to another order (the URLs always come from
//     that one order row — never from client input),
//   • read or convert order size units. Size/unit data is not touched here
//     and global measurement settings never apply to an order's saved size.

export type ReferencePhotoOrder = {
  id: string;
  ref_no: string;
  photo_url?: string | null;
  photo_urls?: (string | null)[] | null;
};

/** Extensions that can never be a WhatsApp image attachment. */
const NON_IMAGE_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "zip",
  "rar",
  "json",
  "xml",
]);

/**
 * Filename/path words that mean "this is paperwork, not a product close-up".
 * Matched on word boundaries so e.g. "billboard" does not trip "bill".
 */
const DOCUMENT_WORDS =
  /(^|[^a-z])(invoice|label|shipping|packing[-_ ]?slip|document|receipt|customs|duty|bill|statement|packing[-_ ]?list)([^a-z]|$)/i;

const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/**
 * True for an image URL that WhatsApp can accept as a photo attachment.
 *
 * Accepts:
 *   • http(s) URLs ending in .jpg/.jpeg/.png/.webp (case-insensitive),
 *   • extensionless CDN/Supabase URLs (storage URLs often are), unless the
 *     path or query clearly names a document.
 * Rejects:
 *   • non-http(s), non-image extensions, and invoice/label/document-looking
 *     URLs. This is how "exclude unrelated product photos, invoices, shipping
 *     labels and internal documents" is enforced without a new column.
 */
export function isReferencePhotoUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const path = decodeURIComponent(parsed.pathname);
  const lastSegment = path.split("/").filter(Boolean).pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  const extension = dot >= 0 ? lastSegment.slice(dot + 1).toLowerCase() : "";

  if (extension && NON_IMAGE_EXTENSIONS.has(extension)) return false;

  // Paperwork stays out even when it happens to be a PNG/JPG (a scanned
  // shipping label or an invoice screenshot is still not a product close-up).
  const search = `${path} ${parsed.search}`;
  if (DOCUMENT_WORDS.test(search)) return false;

  // A known image extension is then conclusive.
  if (/^(jpe?g|png|webp)$/i.test(extension)) return true;

  // No (or unknown) extension: ordinary hosted images are allowed
  // (Supabase/CDN URLs are often extensionless).
  return true;
}

/** The MAIN photo for an order — photo_url wins, then the list's first entry. */
export function mainOrderPhotoUrl(order: ReferencePhotoOrder): string | null {
  if (order.photo_url && order.photo_url.trim()) return order.photo_url.trim();
  const first = (order.photo_urls ?? []).find((u): u is string => !!u && !!u.trim());
  return first ? first.trim() : null;
}

/** Every photo on the order, de-duplicated, in saved order (main first). */
export function allOrderPhotoUrls(order: ReferencePhotoOrder): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [order.photo_url, ...(order.photo_urls ?? [])]) {
    if (!raw) continue;
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * The Close-Up / Reference photos for one order: every saved photo except the
 * main one, kept in order, filtered to real image URLs. Empty array means
 * "send no attachments and keep the existing update workflow unchanged".
 */
export function extractCloseUpPhotoUrls(order: ReferencePhotoOrder): string[] {
  const main = mainOrderPhotoUrl(order);
  return allOrderPhotoUrls(order)
    .filter((url) => url !== main)
    .filter(isReferencePhotoUrl);
}

/** "REF PHOTO PO-A1119" — exactly the order's own reference, never hard-coded. */
export function buildReferencePhotoCaption(refNo: string | null | undefined): string {
  const ref = (refNo ?? "").trim();
  return ref ? `REF PHOTO ${ref}` : "REF PHOTO";
}

/**
 * Caption for photo #index (0-based) of `total`. The first image carries the
 * plain "REF PHOTO <ref>"; later images keep the same reference and add their
 * position, because WhatsApp sends one image per message.
 */
export function referencePhotoCaptionFor(refNo: string, index: number, total: number): string {
  const base = buildReferencePhotoCaption(refNo);
  if (total <= 1 || index <= 0) return base;
  return `${base} (${index + 1}/${total})`;
}

/** True when the bytes WhatsApp would receive are a supported image type. */
export function isSupportedImageMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return SUPPORTED_IMAGE_MIMES.has(mime.split(";")[0].trim().toLowerCase());
}

/** File name for a photo — used only for provider-side bookkeeping. */
export function referencePhotoFileName(refNo: string, index: number, mime: string): string {
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const safeRef = (refNo || "order").replace(/[^\w.-]/g, "-");
  return `${safeRef}-ref-${index + 1}.${ext}`;
}

// ---------------------------------------------------------------------------
// Duplicate prevention
// ---------------------------------------------------------------------------

/** Small, dependency-free 32-bit FNV-1a hash — deterministic on every runtime. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Event id for "the order was updated". Identical order state -> identical id
 * (a duplicated webhook / repeated save is a no-op compare-and-skip); any real
 * change -> a new id, so an intentional new update sends again.
 */
export function orderUpdateEventId(order: ReferencePhotoOrder & {
  status?: string | null;
  qty?: number | null;
  size_label?: string | null;
  dispatch_date?: string | null;
  estimated_dispatch_date?: string | null;
  remark?: string | null;
  colour?: string | null;
  sku_label?: string | null;
  photo_type?: string | null;
}): string {
  const state = [
    order.id,
    order.ref_no,
    order.status ?? "",
    order.qty == null ? "" : String(order.qty),
    // Size/unit is part of the state ONLY as an opaque string — it is never
    // parsed or converted. A size edit is a new update event, that's all.
    order.size_label ?? "",
    order.dispatch_date ?? "",
    order.estimated_dispatch_date ?? "",
    order.remark ?? "",
    order.colour ?? "",
    order.sku_label ?? "",
    order.photo_type ?? "",
    ...allOrderPhotoUrls(order),
  ].join("\u0001");
  return `update-${fnv1a(state)}`;
}

/** A manual send is always a deliberate new event, so it may send again. */
export function manualReferencePhotoEventId(orderId: string, nonce: string): string {
  return `manual-${fnv1a(`${orderId}\u0001${nonce}`)}`;
}

export type ExistingSendLog = {
  delivery_status: "pending" | "sent" | "partial" | "failed" | "skipped";
  attachment_photo_ids?: string[] | null;
  whatsapp_message_ids?: string[] | null;
};

/**
 * Should a send for this event be skipped entirely?
 *   • sent      → already fully delivered, never resend the same event
 *   • skipped   → that event had no close-up photos
 *   • partial   → NOT skipped: retrying the remaining photos is the point
 *   • failed    → NOT skipped: retry is the point
 * `force` is only for an explicit manual retry of the same event id.
 */
export function shouldSkipDuplicate(existing: ExistingSendLog | null | undefined, force = false): boolean {
  if (force || !existing) return false;
  return existing.delivery_status === "sent" || existing.delivery_status === "skipped";
}

/**
 * Which photo URLs were already delivered for this event.
 *
 * attachment_photo_ids and whatsapp_message_ids are index-aligned, with an
 * empty string at every position that did not go out. A retry after a partial
 * send must skip exactly those delivered URLs and never re-send one — even
 * when a middle photo failed while later ones succeeded.
 */
export function deliveredPhotoUrls(existing: ExistingSendLog | null | undefined): Set<string> {
  const delivered = new Set<string>();
  if (!existing) return delivered;
  const photos = existing.attachment_photo_ids ?? [];
  const messageIds = existing.whatsapp_message_ids ?? [];
  for (let i = 0; i < photos.length; i++) {
    if (messageIds[i]) delivered.add(photos[i]);
  }
  return delivered;
}
