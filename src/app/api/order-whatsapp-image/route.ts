import sharp from "sharp";
import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";

// 2026-09-04: baked-pixel caption REMOVED — this route is now photo-only.
//
// History, for whoever is tempted to re-add it: this route used to
// composite a "details panel" (PO/RF/RG, QTY, Size, Dispatch Date, Photo,
// Colour, Tassel/Fringes, SKU, Note — and a Devanagari-capable font loaded
// via @napi-rs/canvas's GlobalFonts.register(), because Vercel's Node
// runtime ships no system fonts) on top of the photo, because at the time
// `navigator.share({ files, text })` sending the photo and the caption as
// two separate payloads was believed to reliably split into 2 separate
// WhatsApp messages on every device. See order-whatsapp-button.tsx's own
// (long) history comment for the full back-and-forth on that.
//
// As of 2026-09-04, the product decision is: the real, copyable/searchable
// WhatsApp caption is sent as the `text` field of the same
// `navigator.share({ files, text })` call that shares this photo (one
// share-sheet attempt, one message, per the caller's current behavior —
// this route does not decide or touch that), with the "📋 Copy caption"
// button next to it kept as the deliberate fallback for the known,
// platform-side, not-fixable-from-here occasional device split. That
// tradeoff is already decided — do not re-litigate it here, and do not
// re-add baked pixel caption text to this image without reading the linked
// history first (it was flip-flopped on 3+ times already).
//
// What's left here is just the photo pipeline: fetch the source photo
// (reusing safeExternalFetch's CORS workaround, same as
// /api/order-photo-proxy — most photo URLs are on outside domains that
// don't send permissive CORS headers) and downscale it if it's wider than
// WhatsApp needs. No canvas, no font loading, no compositing.
export const runtime = "nodejs";

const MAX_WIDTH = 1000;

export async function GET(request: Request) {
  try {
    await requireCapability("order_entry");
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response("Not signed in.", { status: 401 });
    if (err instanceof ForbiddenError) return new Response("Forbidden.", { status: 403 });
    throw err;
  }

  const params = new URL(request.url).searchParams;
  const raw = params.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  const result = await safeExternalFetch(raw);
  if (!result.ok) return new Response(result.error, { status: result.status });
  const photoBuffer = Buffer.from(await result.response.arrayBuffer());

  let photo = sharp(photoBuffer);
  const meta = await photo.metadata();
  let width = meta.width ?? MAX_WIDTH;
  let height = meta.height ?? Math.round((width * 3) / 4);
  if (width > MAX_WIDTH) {
    const scale = MAX_WIDTH / width;
    height = Math.round(height * scale);
    width = MAX_WIDTH;
    photo = photo.resize(width, height);
  }
  const resizedPhotoBuffer = await photo.jpeg({ quality: 88 }).toBuffer();

  return new Response(resizedPhotoBuffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=60",
    },
  });
}
