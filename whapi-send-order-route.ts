import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";

// dns.lookup (used by safeExternalFetch's SSRF guard) needs the Node
// runtime, not Edge — same reason telegram-send-order/route.ts sets this.
export const runtime = "nodejs";

// 2026-09-20 — "ESA HI WHATSAAP PAR NHI HO SAKTA HAI KYA": after Telegram got
// real one-click Bot API automation, the user asked for the same on
// WhatsApp. Official WhatsApp Cloud API was ruled out (it cannot post to
// WhatsApp Groups at all — 1:1 only). Every unofficial route (Baileys,
// whatsapp-web.js, OpenWA, self-hosted anything) needs a persistent
// always-on server, which the user's Hostinger plan (shared hosting, no
// Docker/persistent processes) can't run. The user signed up for
// Whapi.Cloud themselves (a hosted WhatsApp-Web-session-as-a-REST-API
// service), connected their number, and explicitly chose this route: "sabse
// kam effort, koi naya kharcha bhi nahi agar free-sandbox limits (150
// msg/day) me fit ho jaate ho". Whapi's own support chat confirmed (user
// pasted verbatim) the free Sandbox plan is permanently free with no
// auto-charges and no forced cutoff when a trial ends.
//
// This route mirrors telegram-send-order/route.ts's shape exactly: fetch
// the order's real photo server-side (never let a third party fetch an
// arbitrary client-supplied URL directly — same SSRF-safe helper), then
// call Whapi's own API with the photo bytes + real text caption as ONE
// WhatsApp message to the order group. No pixels ever get baked with text.
//
// Setup (see .env.example for the full walkthrough):
//   1. panel.whapi.cloud → your channel → copy the API token into
//      WHAPI_TOKEN.
//   2. Find the "Nyko Mart order" group's chat ID: on the same channel page,
//      open the API docs / "Try it" console for GET /groups (or
//      https://whapi.readme.io/reference/getgroups), run it, and find the
//      group in the results — its "id" field looks like
//      "120363194050948049@g.us". That whole string (WITH the @g.us suffix)
//      is WHAPI_GROUP_ID.
// Until both are set, this route returns a clear "not configured" error
// instead of a confusing 500 — the button surfaces that message as-is.
const WHAPI_BASE_URL = "https://gate.whapi.cloud";
const WHAPI_CAPTION_LIMIT = 1024; // matches WhatsApp's own image-caption cap

type SendBody = { photoUrl: string | null; caption: string };

type WhapiResult = { ok: true } | { ok: false; error: string };

async function callWhapi(token: string, path: string, body: Record<string, unknown>): Promise<WhapiResult> {
  let res: Response;
  try {
    res = await fetch(`${WHAPI_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Whapi tak pahunch nahi paye — thodi der me dobara try karein." };
  }
  // Whapi's exact success/error JSON shape isn't fully documented, so this
  // treats any 2xx as success and best-effort extracts a message from
  // whatever error shape comes back, rather than depending on one field.
  if (res.ok) return { ok: true };
  const json = (await res.json().catch(() => null)) as
    | { error?: { message?: string } | string; detail?: string; message?: string }
    | null;
  const message =
    (typeof json?.error === "string" ? json.error : json?.error?.message) ||
    json?.detail ||
    json?.message ||
    res.statusText ||
    `HTTP ${res.status}`;
  return { ok: false, error: message };
}

export async function POST(request: Request) {
  try {
    await requireCapability("order_entry");
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });
    if (err instanceof ForbiddenError) return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
    throw err;
  }

  const token = process.env.WHAPI_TOKEN;
  const groupId = process.env.WHAPI_GROUP_ID;
  if (!token || !groupId) {
    return Response.json(
      {
        ok: false,
        error: "WhatsApp automation abhi configure nahi hai — WHAPI_TOKEN aur WHAPI_GROUP_ID set karne honge (.env.example dekhein).",
      },
      { status: 500 }
    );
  }

  let body: SendBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const caption = (body.caption || "").slice(0, WHAPI_CAPTION_LIMIT);
  const photoUrl = body.photoUrl || null;

  try {
    if (photoUrl) {
      const fetched = await safeExternalFetch(photoUrl);
      if (!fetched.ok) {
        return Response.json({ ok: false, error: `Order ki photo fetch nahi ho payi (${fetched.error}).` }, { status: 502 });
      }
      const photoBuffer = Buffer.from(await fetched.response.arrayBuffer());
      const mimeType = fetched.response.headers.get("content-type") || "image/jpeg";
      const dataUri = `data:${mimeType};base64,${photoBuffer.toString("base64")}`;

      const result = await callWhapi(token, "/messages/image", {
        to: groupId,
        media: dataUri,
        ...(caption ? { caption } : {}),
      });
      if (!result.ok) return Response.json({ ok: false, error: `WhatsApp ne message reject kar diya: ${result.error}` }, { status: 502 });
      return Response.json({ ok: true });
    }

    // No photo on this order — send the caption as a plain text message so
    // the order still goes out rather than silently failing.
    const result = await callWhapi(token, "/messages/text", {
      to: groupId,
      body: caption || "-",
    });
    if (!result.ok) return Response.json({ ok: false, error: `WhatsApp ne message reject kar diya: ${result.error}` }, { status: 502 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "WhatsApp tak pahunch nahi paye — thodi der me dobara try karein." }, { status: 502 });
  }
}
