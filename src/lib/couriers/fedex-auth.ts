// Shared FedEx OAuth2 client_credentials token fetch — ONE FedEx developer
// app (FEDEX_API_CLIENT_ID/SECRET, already live for tracking polling, see
// src/app/api/cron/poll-fedex-tracking/route.ts) covers multiple product
// scopes (Track API + Ship API) in FedEx's own developer portal, so the
// same credentials are reused here for booking rather than asking for a
// second set of env vars. Extracted out of poll-fedex-tracking/route.ts
// (2026-09-01) so both tracking and booking share one implementation
// instead of two copies drifting apart — that cron route now imports this
// instead of keeping its own private copy.
//
// NOT the same thing as UPS_WEBHOOK_CLIENT_ID/SECRET
// (src/app/api/webhooks/courier/ups/token/route.ts) — that pair issues OUR
// OWN token so UPS can call OUR webhook (inbound direction). This file is
// the outbound direction: US calling FedEx's OAuth endpoint to get a
// bearer token to call FedEx's own API with. UPS booking needs its own,
// separate outbound OAuth2 client_credentials flow against UPS's endpoint
// — see ups-ship.ts, which deliberately does NOT reuse anything from the
// ups/token/route.ts webhook-auth pair.

export const FEDEX_API_BASE = process.env.FEDEX_API_BASE_URL || "https://apis.fedex.com";

export async function getFedexAccessToken(): Promise<string> {
  const clientId = process.env.FEDEX_API_CLIENT_ID;
  const clientSecret = process.env.FEDEX_API_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("FEDEX_API_CLIENT_ID / FEDEX_API_CLIENT_SECRET are not set.");
  }

  const res = await fetch(`${FEDEX_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`FedEx OAuth token request failed ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}
