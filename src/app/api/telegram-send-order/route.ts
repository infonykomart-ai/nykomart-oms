import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";

// dns.lookup (used by safeExternalFetch's SSRF guard) needs the Node
// runtime, not Edge — same reason order-photo-proxy/route.ts sets this.
export const runtime = "nodejs";

// 2026-09-20 — "TELEGRAM PAR BHI YAHI SEEN CHAL RAHA DONO KO FIX KAR KE SAHI
// KARO ... YA WATSAAP API KA JUGAD KARE": the Telegram side of
// order-whatsapp-button.tsx used to be the exact same manual "photo
// downloads, caption copies to clipboard, employee attaches + pastes by
// hand" flow as WhatsApp — which is what kept landing as two separate
// Telegram messages. Asked directly, the user chose real Telegram Bot API
// automation over WhatsApp Business API (WhatsApp stays on the manual/
// share flow — see order-whatsapp-button.tsx's header comment). This route
// makes "Send on Telegram" an actual one-click, one-message send: Telegram
// Bot API `sendPhoto` (or `sendMessage` if the order has no photo) with the
// real order photo and the caption riding as the photo's native `caption`
// field — never baked into pixels, never a second message.
//
// Setup (see .env.example for the full walkthrough):
//   1. Talk to @BotFather on Telegram, /newbot, copy the token it gives you
//      into TELEGRAM_BOT_TOKEN.
//   2. Add that bot to the target group (e.g. "NYKO Orders ALL"), send any
//      message in the group, then open
//      https://api.telegram.org/bot<token>/getUpdates in a browser and read
//      the group's chat.id (a negative number) into TELEGRAM_ORDER_CHAT_ID.
// Until both are set, this route returns a clear "not configured" error
// instead of a confusing 500 — the button surfaces that message as-is.
//
// No `parse_mode` is set on purpose: order fields (SKU, buyer note, ref no)
// are free text an employee typed, and Telegram's Markdown/HTML parsers
// throw a hard 400 on unbalanced special characters (a stray `_` or `<` in
// a note would otherwise silently break every send). Plain text always
// sends, which matters far more here than bold labels.
const TELEGRAM_CAPTION_LIMIT = 1024; // Telegram's own cap on a photo's caption

type SendBody = { photoUrl: string | null; caption: string };

async function callTelegram(token: string, method: "sendPhoto" | "sendMessage", form: FormData | URLSearchParams) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    body: form as BodyInit,
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !json?.ok) {
    return { ok: false as const, error: json?.description || res.statusText || "Telegram rejected the message." };
  }
  return { ok: true as const };
}

export async function POST(request: Request) {
  try {
    await requireCapability("order_entry");
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });
    if (err instanceof ForbiddenError) return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
    throw err;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ORDER_CHAT_ID;
  if (!token || !chatId) {
    return Response.json(
      {
        ok: false,
        error:
          "Telegram bot abhi configure nahi hai — TELEGRAM_BOT_TOKEN aur TELEGRAM_ORDER_CHAT_ID set karne honge (.env.example dekhein).",
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
  const caption = (body.caption || "").slice(0, TELEGRAM_CAPTION_LIMIT);
  const photoUrl = body.photoUrl || null;

  try {
    if (photoUrl) {
      const fetched = await safeExternalFetch(photoUrl);
      if (!fetched.ok) {
        return Response.json({ ok: false, error: `Order ki photo fetch nahi ho payi (${fetched.error}).` }, { status: 502 });
      }
      const photoBuffer = Buffer.from(await fetched.response.arrayBuffer());
      const form = new FormData();
      form.set("chat_id", chatId);
      if (caption) form.set("caption", caption);
      form.set("photo", new Blob([photoBuffer]), "photo.jpg");

      const result = await callTelegram(token, "sendPhoto", form);
      if (!result.ok) return Response.json({ ok: false, error: `Telegram ne message reject kar diya: ${result.error}` }, { status: 502 });
      return Response.json({ ok: true });
    }

    // No photo on this order — send the caption as a plain message so the
    // order still goes out rather than silently failing.
    const params = new URLSearchParams({ chat_id: chatId, text: caption || "-" });
    const result = await callTelegram(token, "sendMessage", params);
    if (!result.ok) return Response.json({ ok: false, error: `Telegram ne message reject kar diya: ${result.error}` }, { status: 502 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Telegram tak pahunch nahi paye — thodi der me dobara try karein." }, { status: 502 });
  }
}
