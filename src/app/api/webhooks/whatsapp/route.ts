// 2026-11-25 — Delivery webhook for the WhatsApp status messages.
//
// WHY THIS EXISTS: the send API answering 2xx only proves the message was
// ACCEPTED. "Delivered" and "Read" are the handset's facts and can only come
// back through the provider's webhook — so those two states are written here
// and nowhere else. Anything else in the payload (unknown ids, unknown
// statuses) is ignored on purpose: the log must not claim more than it knows.
//
// SECURITY: WHAPI_WEBHOOK_SECRET is REQUIRED. Configure the same value as the
// webhook's token/header in the Whapi panel. This route writes with the
// service-role client, so a missing secret used to mean "anyone who finds the
// URL can mark a message delivered/read" — the one fail-open hole the 26 Nov
// audit found next to an otherwise fail-closed cron gate. An unset secret now
// answers 503 (a deployment misconfiguration, retried once fixed), and a wrong
// token answers 401, compared in constant time like src/lib/auth/cron-auth.ts.
//
// Always answers 200 once an authenticated body parsed: a provider that gets a
// 5xx retries the same event for hours, and a repeated event is already a no-op
// here.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type StatusEvent = { id?: string; message_id?: string; status?: string; error?: unknown };

/** Whapi sends either { statuses: [...] } or { messages: [...] }. */
function extractEvents(body: unknown): StatusEvent[] {
  const obj = (body ?? {}) as { statuses?: unknown; messages?: unknown; ack?: unknown };
  const list = Array.isArray(obj.statuses) ? obj.statuses : Array.isArray(obj.messages) ? obj.messages : [];
  const events: StatusEvent[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as StatusEvent;
    if (typeof e.status === "string" && (e.id || e.message_id)) events.push(e);
  }
  return events;
}

function mapStatus(status: string): "sent" | "delivered" | "read" | "failed" | null {
  const s = status.toLowerCase();
  if (["sent", "accepted", "server_ack", "delivery_ack"].includes(s)) return "sent";
  if (s === "delivered") return "delivered";
  if (s === "read" || s === "played") return "read";
  if (["failed", "canceled", "cancelled", "rejected", "error"].includes(s)) return "failed";
  return null;
}

function errorText(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && "message" in raw) return String((raw as { message?: unknown }).message ?? "");
  return null;
}

export async function POST(request: NextRequest) {
  const secret = (process.env.WHAPI_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    // Deliberately NOT "accept and rely on the rows being known": with no
    // secret there is no caller to trust, and delivery_status is exactly what
    // the Orders page's amber retry banner is derived from. 503 tells Whapi
    // (and whoever reads the logs) that the deployment is incomplete instead
    // of quietly accepting forged "read" events.
    return NextResponse.json(
      { ok: false, error: "WHAPI_WEBHOOK_SECRET is not configured on this deployment." },
      { status: 503 }
    );
  }

  const supplied = (
    request.headers.get("x-whapi-token") ??
    request.headers.get("x-webhook-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  ).trim();
  // timingSafeEqual throws on a length mismatch, so compare lengths first —
  // the length is already public through the header format.
  const suppliedBuf = Buffer.from(supplied, "utf8");
  const secretBuf = Buffer.from(secret, "utf8");
  if (suppliedBuf.length !== secretBuf.length || !timingSafeEqual(suppliedBuf, secretBuf)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const events = extractEvents(body);
  if (events.length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const supabase = createServiceRoleClient();
  let updated = 0;

  for (const event of events) {
    const status = mapStatus(String(event.status));
    const id = String(event.id ?? event.message_id ?? "").trim();
    if (!status || !id) continue;

    const patch: Record<string, unknown> = { delivery_status: status };
    const at = new Date().toISOString();
    if (status === "sent") patch.sent_at = at;
    if (status === "delivered") {
      patch.delivered_at = at;
      patch.sent_at = at;
    }
    if (status === "read") {
      patch.read_at = at;
      patch.delivered_at = at;
      patch.sent_at = at;
    }
    if (status === "failed") {
      patch.error_message = errorText(event.error) || "The provider reported the message as failed.";
    }

    const { data, error } = await supabase
      .from("order_whatsapp_messages")
      .update(patch as never)
      .eq("provider_message_id", id)
      .eq("message_type", "order_status")
      // Never walk a message backwards: a late 'sent' event must not overwrite
      // 'read' that already arrived.
      .not("delivery_status", "in", '("read")')
      .select("id");

    if (!error && data && data.length > 0) updated += data.length;
  }

  return NextResponse.json({ ok: true, updated });
}
