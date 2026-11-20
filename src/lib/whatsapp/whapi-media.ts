// 2026-11-20 — Whapi.Cloud media helpers for the "REF PHOTO" automation.
//
// The existing /api/whapi-send-order route sends ONE image by passing a data
// URI straight to /messages/image. The reference-photo flow needs the proper
// two-step media pipeline instead, because it sends several images in a row
// and has to know each WhatsApp message id:
//
//   1. POST /media              → upload the image bytes, get a media id
//   2. POST /messages/image     → send that media id with a caption
//
// Everything here is server-side. The token is read by the caller from
// WHAPI_TOKEN and never reaches the browser.
//
// Reliability rules:
//   • Timeouts — a hung provider call must not hang the caller.
//   • Retry — network errors, HTTP 429 and 5xx are retried (3 attempts,
//     short backoff). A 4xx (bad token, bad recipient) is NOT retried: it
//     will fail identically and the error should surface immediately.
//   • Validation — a send only counts as success when Whapi answers OK AND
//     returns a message id. Anything else is a failure, so a failed message
//     can never be recorded as delivered.

const WHAPI_BASE_URL = "https://gate.whapi.cloud";
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20_000;

type WhapiSuccess = { ok: true; json: unknown };
type WhapiFailure = { ok: false; error: string; retryable: boolean };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function objectValue(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object") return undefined;
  return (input as Record<string, unknown>)[key];
}

function stringValue(input: unknown, key: string): string | null {
  const value = objectValue(input, key);
  return typeof value === "string" && value.trim() ? value : null;
}

/** Best-effort human error from Whapi's various error shapes. */
function extractError(json: unknown, status: number, statusText: string): string {
  const error = objectValue(json, "error");
  if (typeof error === "string" && error.trim()) return error;
  const nested = stringValue(error, "message");
  if (nested) return nested;
  return (
    stringValue(json, "detail") ||
    stringValue(json, "message") ||
    (statusText && statusText.trim()) ||
    `HTTP ${status}`
  );
}

async function post(token: string, path: string, body: Record<string, unknown>): Promise<WhapiSuccess | WhapiFailure> {
  let lastError = "Could not reach WhatsApp — please try again in a moment.";
  let retryable = true;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${WHAPI_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      lastError = "Could not reach WhatsApp — please try again in a moment.";
      retryable = true;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(400 * attempt);
        continue;
      }
      return { ok: false, error: lastError, retryable };
    }

    const json = (await response.json().catch(() => null)) as unknown;

    if (response.ok) {
      // Whapi reports a rejected send as 200 + sent:false in some cases.
      if (objectValue(json, "sent") === false) {
        return { ok: false, error: extractError(json, response.status, response.statusText), retryable: false };
      }
      return { ok: true, json };
    }

    lastError = extractError(json, response.status, response.statusText);
    retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) return { ok: false, error: lastError, retryable };
    await sleep(400 * attempt);
  }

  return { ok: false, error: lastError, retryable };
}

export type WhapiMediaResult = { ok: true; mediaId: string } | { ok: false; error: string };

/**
 * Uploads image bytes and returns the provider's media id. `dataUri` must be a
 * real `data:image/...;base64,...` string; bytes are sent unchanged (no
 * re-encode), so the original image quality is preserved.
 */
export async function uploadWhapiMedia(token: string, dataUri: string): Promise<WhapiMediaResult> {
  const result = await post(token, "/media", { media: dataUri });
  if (!result.ok) return { ok: false, error: result.error };

  // Whapi's documented shape is { id }. Accept the common aliases too rather
  // than failing a successful upload over a field name.
  const mediaId =
    stringValue(result.json, "id") ||
    stringValue(result.json, "media_id") ||
    stringValue(objectValue(result.json, "media"), "id");
  if (!mediaId) return { ok: false, error: "WhatsApp uploaded the photo but did not return a media id." };
  return { ok: true, mediaId };
}

export type WhapiSendResult = { ok: true; messageId: string } | { ok: false; error: string };

/** Sends one image message and returns the WhatsApp message id. */
export async function sendWhapiImage(
  token: string,
  to: string,
  mediaId: string,
  caption: string
): Promise<WhapiSendResult> {
  const result = await post(token, "/messages/image", {
    to,
    media: mediaId,
    ...(caption ? { caption } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error };

  const messageId =
    stringValue(result.json, "id") ||
    stringValue(objectValue(result.json, "message"), "id") ||
    stringValue(objectValue(objectValue(result.json, "messages"), "0"), "id");
  if (!messageId) return { ok: false, error: "WhatsApp accepted the photo but did not return a message id." };
  return { ok: true, messageId };
}

/** Plain-text fallback (used when an order has no photo at all). */
export async function sendWhapiText(token: string, to: string, body: string): Promise<WhapiSendResult> {
  const result = await post(token, "/messages/text", { to, body });
  if (!result.ok) return { ok: false, error: result.error };
  const messageId =
    stringValue(result.json, "id") ||
    stringValue(objectValue(result.json, "message"), "id") ||
    stringValue(objectValue(objectValue(result.json, "messages"), "0"), "id");
  if (!messageId) return { ok: false, error: "WhatsApp accepted the message but did not return a message id." };
  return { ok: true, messageId };
}
