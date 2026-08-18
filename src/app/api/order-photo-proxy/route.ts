import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";

// dns.lookup (used by safeExternalFetch's SSRF guard, added 2026-08-17)
// needs the Node runtime, not Edge.
export const runtime = "nodejs";

// 2026-08-07: "order entry me whatsaap par photo jani chahiye" — the
// WhatsApp button (order-whatsapp-button.tsx) tries to attach the actual
// product photo (not just a link) via the Web Share API, which needs the
// image as a real File — that means fetch()-ing order.photo_url in the
// browser first. Most photo URLs live on OUTSIDE domains (vendor/
// marketplace image hosts, e.g. artsofjaipur.com) that don't send CORS
// headers allowing our origin to read the response, so that browser fetch
// was silently failing and falling back to a text-only link every time.
// Fetching the image HERE instead — server-to-server, where CORS doesn't
// apply — and streaming it back same-origin lets the client succeed
// regardless of the source domain's CORS policy.
export async function GET(request: Request) {
  try {
    await requireCapability("order_entry");
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response("Not signed in.", { status: 401 });
    if (err instanceof ForbiddenError) return new Response("Forbidden.", { status: 403 });
    throw err;
  }

  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  const result = await safeExternalFetch(raw);
  if (!result.ok) return new Response(result.error, { status: result.status });
  const upstream = result.response;

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
}
