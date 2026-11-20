// 2026-11-20 — the one place that sends an order's Close-Up / Reference photos
// on WhatsApp.
//
// Both callers go through here so the automatic hook and the manual button can
// never disagree:
//   • src/app/dashboard/orders/actions.ts (updateOrder → after())
//   • src/app/api/order-reference-photos/route.ts (manual send + retry)
//
// Workflow (matches the requested automation exactly):
//   order updated → load order ref → check close-up photos →
//   none? stop (existing update workflow unchanged) →
//   upload each image to WhatsApp → send "REF PHOTO <ref>" with the images →
//   save the delivery status, photo ids and WhatsApp message ids.
//
// Delivery truthfulness: a row is 'sent' only when every photo got a WhatsApp
// message id back. A failure is 'failed'/'partial' with sent_at left NULL;
// nothing is ever recorded as delivered just because it was attempted.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isMissingSchemaPiece } from "@/lib/db/missing-column";
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";
import {
  buildReferencePhotoCaption,
  deliveredPhotoUrls,
  extractCloseUpPhotoUrls,
  isSupportedImageMime,
  orderUpdateEventId,
  referencePhotoCaptionFor,
  shouldSkipDuplicate,
  type ExistingSendLog,
  type ReferencePhotoOrder,
} from "./reference-photos";
import { sendWhapiImage, uploadWhapiMedia } from "./whapi-media";

type Client = SupabaseClient<Database>;

/** WhatsApp media is a few MB at most; anything larger is refused early. */
export const MAX_REFERENCE_PHOTO_BYTES = 10 * 1024 * 1024;
/** The order form allows a main photo + two close-ups; allow a little slack. */
export const MAX_REFERENCE_PHOTOS = 10;

export const REFERENCE_PHOTO_MIGRATION = "db/2026-11-20-whatsapp-reference-photos.sql";

export type ReferencePhotoOrderInput = ReferencePhotoOrder & {
  company_id: string | null;
  status?: string | null;
  qty?: number | null;
  size_label?: string | null;
  dispatch_date?: string | null;
  estimated_dispatch_date?: string | null;
  remark?: string | null;
  colour?: string | null;
  sku_label?: string | null;
  photo_type?: string | null;
};

export type ReferencePhotoSendStatus = "sent" | "partial" | "failed" | "skipped" | "duplicate";

export type ReferencePhotoSendResult = {
  status: ReferencePhotoSendStatus;
  eventId: string;
  totalPhotos: number;
  sentCount: number;
  messageIds: string[];
  logId: string | null;
  error: string | null;
};

/**
 * The company's own WhatsApp order group, falling back to the global
 * WHAPI_GROUP_ID env var exactly like /api/whapi-send-order does.
 */
export async function resolveOrderWhatsappGroupId(
  supabase: Client,
  companyId: string | null
): Promise<string | null> {
  const fallback = process.env.WHAPI_GROUP_ID ?? null;
  if (!companyId) return fallback;
  const { data } = await supabase
    .from("companies")
    .select("whapi_group_id")
    .eq("id", companyId)
    .maybeSingle();
  return data?.whapi_group_id || fallback;
}

function joinError(messages: string[]): string | null {
  if (messages.length === 0) return null;
  return messages.join("; ").slice(0, 2000);
}

/**
 * Sends every applicable close-up photo for one order update event.
 *
 * `eventId` defaults to a hash of the order's state. Passing the same eventId
 * again (duplicate webhook, double click) is a no-op when the event was
 * already fully sent; failures/partial sends are retried, skipping the photos
 * that already went out.
 */
export async function sendOrderReferencePhotos(params: {
  supabase: Client;
  order: ReferencePhotoOrderInput;
  token: string;
  eventId?: string;
  actorEmployeeId?: string | null;
  /** Explicit manual retry of the SAME event id (never used by automation). */
  force?: boolean;
}): Promise<ReferencePhotoSendResult> {
  const { supabase, order, token, actorEmployeeId, force = false } = params;
  const eventId = params.eventId ?? orderUpdateEventId(order);
  const caption = buildReferencePhotoCaption(order.ref_no);
  const photos = extractCloseUpPhotoUrls(order).slice(0, MAX_REFERENCE_PHOTOS);

  const base = {
    eventId,
    totalPhotos: photos.length,
    sentCount: 0,
    messageIds: [] as string[],
    logId: null as string | null,
  };

  // No close-up photos → nothing to attach. The existing order-update
  // workflow (manual/auto order message) continues completely unchanged.
  if (photos.length === 0) {
    return { ...base, status: "skipped", error: null };
  }

  // ---- Duplicate guard -----------------------------------------------------
  const { data: existingRow, error: existingError } = await supabase
    .from("order_whatsapp_messages")
    .select("id, delivery_status, attachment_photo_ids, whatsapp_message_ids, retry_count")
    .eq("order_id", order.id)
    .eq("message_type", "reference_photo")
    .eq("event_id", eventId)
    .maybeSingle();

  if (existingError && isMissingSchemaPiece(existingError)) {
    return {
      ...base,
      status: "failed",
      error: `Reference-photo logging is not available yet — run ${REFERENCE_PHOTO_MIGRATION} in Supabase.`,
    };
  }
  if (existingError) {
    return { ...base, status: "failed", error: `Could not check the WhatsApp log: ${existingError.message}` };
  }

  const existing = existingRow as
    | (ExistingSendLog & { id: string; retry_count: number | null })
    | null;

  if (shouldSkipDuplicate(existing, force)) {
    return {
      ...base,
      status: "duplicate",
      sentCount: existing?.whatsapp_message_ids?.filter(Boolean).length ?? photos.length,
      messageIds: (existing?.whatsapp_message_ids ?? []).filter((id): id is string => !!id),
      logId: existing?.id ?? null,
      error: null,
    };
  }

  // ---- Log row (insert first, retries update the same row) -----------------
  let logId: string | null = existing?.id ?? null;
  if (existing) {
    const { error } = await supabase
      .from("order_whatsapp_messages")
      .update({
        delivery_status: "pending",
        error_message: null,
        attachment_photo_ids: photos,
        message_text: caption,
        retry_count: (existing.retry_count ?? 0) + 1,
        created_by_employee_id: actorEmployeeId ?? null,
      })
      .eq("id", existing.id);
    if (error) return { ...base, status: "failed", error: `Could not update the WhatsApp log: ${error.message}` };
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("order_whatsapp_messages")
      .insert({
        company_id: order.company_id,
        order_id: order.id,
        order_reference: order.ref_no,
        message_type: "reference_photo",
        event_id: eventId,
        message_text: caption,
        attachment_photo_ids: photos,
        delivery_status: "pending",
        created_by_employee_id: actorEmployeeId ?? null,
      })
      .select("id")
      .single();
    if (insertError) {
      const hint = isMissingSchemaPiece(insertError)
        ? ` — run ${REFERENCE_PHOTO_MIGRATION} in Supabase`
        : "";
      return { ...base, status: "failed", error: `Could not write the WhatsApp log${hint}: ${insertError.message}` };
    }
    logId = inserted?.id ?? null;
  }

  async function finalize(
    status: "sent" | "partial" | "failed" | "skipped",
    messageIds: string[],
    errors: string[]
  ): Promise<ReferencePhotoSendResult> {
    const sentCount = messageIds.filter(Boolean).length;
    const sentAt = sentCount > 0 ? new Date().toISOString() : null;
    if (logId) {
      await supabase
        .from("order_whatsapp_messages")
        .update({
          delivery_status: status,
          whatsapp_message_ids: messageIds,
          error_message: joinError(errors),
          sent_at: sentAt,
        })
        .eq("id", logId);
    }
    return {
      status,
      eventId,
      totalPhotos: photos.length,
      sentCount,
      messageIds,
      logId,
      error: joinError(errors),
    };
  }

  // ---- Destination ---------------------------------------------------------
  const groupId = await resolveOrderWhatsappGroupId(supabase, order.company_id);
  if (!groupId) {
    return finalize("failed", new Array(photos.length).fill(""), [
      "No WhatsApp group is set for this company — set companies.whapi_group_id or WHAPI_GROUP_ID.",
    ]);
  }

  // ---- Preserve earlier successes on a retry -------------------------------
  // attachment_photo_ids / whatsapp_message_ids are index-aligned. Map by URL
  // so a retry resumes exactly the missing photos, including a middle failure.
  const messageIds = new Array<string>(photos.length).fill("");
  const delivered = force ? new Set<string>() : deliveredPhotoUrls(existing);
  const previousPhotos = existing?.attachment_photo_ids ?? [];
  const previousIds = existing?.whatsapp_message_ids ?? [];
  for (let i = 0; i < photos.length; i++) {
    if (!delivered.has(photos[i])) continue;
    const previousIndex = previousPhotos.indexOf(photos[i]);
    if (previousIndex >= 0) messageIds[i] = previousIds[previousIndex] ?? "unknown";
  }

  const errors: string[] = [];

  for (let i = 0; i < photos.length; i++) {
    if (messageIds[i]) continue; // already delivered for this event

    const url = photos[i];
    const label = `Photo ${i + 1}`;

    let fetched: Awaited<ReturnType<typeof safeExternalFetch>>;
    try {
      fetched = await safeExternalFetch(url);
    } catch {
      errors.push(`${label}: could not be fetched.`);
      continue;
    }
    if (!fetched.ok) {
      errors.push(`${label}: ${fetched.error}.`);
      continue;
    }

    const mime = fetched.response.headers.get("content-type");
    if (!isSupportedImageMime(mime)) {
      errors.push(`${label}: unsupported image type${mime ? ` (${mime})` : ""} — JPG, PNG or WEBP only.`);
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(await fetched.response.arrayBuffer());
    } catch {
      errors.push(`${label}: could not be downloaded.`);
      continue;
    }
    if (buffer.byteLength === 0) {
      errors.push(`${label}: the image was empty.`);
      continue;
    }
    if (buffer.byteLength > MAX_REFERENCE_PHOTO_BYTES) {
      errors.push(`${label}: larger than 10 MB.`);
      continue;
    }

    const mimeType = (mime ?? "image/jpeg").split(";")[0].trim().toLowerCase();
    const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;

    // Upload first (the requirement's media-id path). Whapi also accepts a
    // data URI / hosted URL directly in /messages/image, so a provider upload
    // response we cannot read (or even a failed upload call) must not drop the
    // photo: fall back to the data URI itself and let the SEND result decide.
    const upload = await uploadWhapiMedia(token, dataUri);
    const mediaReference = upload.ok ? (upload.mediaId ?? upload.mediaUrl ?? dataUri) : dataUri;

    const send = await sendWhapiImage(
      token,
      groupId,
      mediaReference,
      referencePhotoCaptionFor(order.ref_no, i, photos.length)
    );
    if (!send.ok) {
      const uploadNote = !upload.ok ? ` (media upload: ${upload.error})` : "";
      errors.push(`${label}: WhatsApp rejected the image — ${send.error}${uploadNote}`);
      continue;
    }

    messageIds[i] = send.messageId;
  }

  const sentCount = messageIds.filter(Boolean).length;
  if (sentCount === photos.length) return finalize("sent", messageIds, []);
  if (sentCount > 0) return finalize("partial", messageIds, errors);
  return finalize("failed", messageIds, errors.length ? errors : ["No photo could be sent."]);
}
