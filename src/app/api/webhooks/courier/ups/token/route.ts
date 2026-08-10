// UPS Track Alert (their push-webhook product) doesn't use a shared-secret
// header or an HMAC request signature the way Delhivery/most webhooks do.
// Per UPS's own OpenAPI spec (UPSTrackAlertEnhanced.yaml), when you
// register a tracking-number subscription you also register a
// "credentialsUrl" (a client_credentials OAuth2 token endpoint YOU host) —
// UPS calls THAT URL first to obtain a bearer token, then presents that
// bearer token in the `Authorization` header on every webhook POST to your
// actual callback URL. So this file (the token endpoint) and
// ../route.ts (the webhook receiver) are a matched pair — this issues the
// token UPS will use, and the receiver verifies it.
//
// Implementation: a stateless signed token (no DB/session store needed).
// `access_token` = "<expiresAtEpochSeconds>.<hmacHex>", where hmacHex is
// HMAC-SHA256(UPS_WEBHOOK_TOKEN_SECRET, expiresAtEpochSeconds) — the
// receiver just recomputes the HMAC and checks the expiry, no lookup.
//
// SETUP: generate 3 random secrets and set as env vars —
// UPS_WEBHOOK_CLIENT_ID / UPS_WEBHOOK_CLIENT_SECRET (give these to UPS
// when registering the subscription's credentialsUrl as this route's full
// URL) and UPS_WEBHOOK_TOKEN_SECRET (stays only between this file and
// ../route.ts, never given to UPS).
//
// NOTE: the exact request shape UPS's token-fetch uses (Basic Auth header
// vs. client_id/client_secret in a form body) isn't nailed down from
// public docs alone — this handles both, matching standard OAu2
// client_credentials grant conventions, so it works either way UPS
// actually calls it. Worth confirming against real traffic once the
// subscription is live (courier_webhook_log has nothing to show for THIS
// endpoint though, since token requests aren't tracking events — check
// Vercel's function logs if UPS's calls seem to be failing auth).

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const TOKEN_TTL_SECONDS = 3600;

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function signToken(expiresAt: number): string {
  const secret = process.env.UPS_WEBHOOK_TOKEN_SECRET;
  if (!secret) throw new Error("UPS_WEBHOOK_TOKEN_SECRET is not set.");
  const hmac = crypto.createHmac("sha256", secret).update(String(expiresAt)).digest("hex");
  return `${expiresAt}.${hmac}`;
}

export function verifyUpsToken(token: string): boolean {
  const secret = process.env.UPS_WEBHOOK_TOKEN_SECRET;
  if (!secret) return false;
  const [expiresAtStr, hmac] = token.split(".");
  if (!expiresAtStr || !hmac) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac("sha256", secret).update(expiresAtStr).digest("hex");
  return timingSafeStringEqual(hmac, expected);
}

async function extractClientCredentials(req: NextRequest): Promise<{ clientId: string; clientSecret: string } | null> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep === -1) return null;
    return { clientId: decoded.slice(0, sep), clientSecret: decoded.slice(sep + 1) };
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await req.text();
      const params = new URLSearchParams(body);
      const clientId = params.get("client_id");
      const clientSecret = params.get("client_secret");
      if (clientId && clientSecret) return { clientId, clientSecret };
    } else {
      const body = await req.json();
      if (body?.client_id && body?.client_secret) {
        return { clientId: String(body.client_id), clientSecret: String(body.client_secret) };
      }
    }
  } catch {
    // fall through to null below
  }
  return null;
}

export async function POST(req: NextRequest) {
  const expectedId = process.env.UPS_WEBHOOK_CLIENT_ID;
  const expectedSecret = process.env.UPS_WEBHOOK_CLIENT_SECRET;
  if (!expectedId || !expectedSecret) {
    return NextResponse.json({ error: "server_error", error_description: "Not configured" }, { status: 500 });
  }

  const creds = await extractClientCredentials(req);
  if (!creds || !timingSafeStringEqual(creds.clientId, expectedId) || !timingSafeStringEqual(creds.clientSecret, expectedSecret)) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return NextResponse.json({
    access_token: signToken(expiresAt),
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
  });
}
