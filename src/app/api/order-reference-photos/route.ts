import { randomUUID } from "node:crypto";
import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  manualReferencePhotoEventId,
  extractCloseUpPhotoUrls,
  buildReferencePhotoCaption,
} from "@/lib/whatsapp/reference-photos";
import { sendOrderReferencePhotos } from "@/lib/whatsapp/reference-photos-send";

// 2026-11-20 — manual "Send Reference Photos on WhatsApp" + retry endpoint.
//
// The automatic path (updateOrder → after()) calls the SAME
// sendOrderReferencePhotos() function, so photo selection, dedupe, media
// upload, captions and status writing are identical — the button can never
// behave differently from the automation.
//
// Body:
//   { orderId: string, eventId?: string, force?: boolean }
//     eventId absent → this is a deliberate new manual event (a fresh id, so
//                      the same photos may be sent again on purpose).
//     eventId present → retry that exact event (force makes a 'failed' or
//                      'partial' row resumable; already-sent photos are
//                      skipped by URL).
export const runtime = "nodejs";

type Body = { orderId?: string; eventId?: string; force?: boolean };

export async function POST(request: Request) {
  let employee;
  try {
    employee = await requireCapability("order_entry");
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });
    if (err instanceof ForbiddenError) return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
    throw err;
  }

  const token = process.env.WHAPI_TOKEN;
  if (!token) {
    return Response.json(
      {
        ok: false,
        error: "WhatsApp automation is not configured yet — WHAPI_TOKEN has to be set (see .env.example).",
      },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const orderId = (body.orderId ?? "").trim();
  if (!orderId) return Response.json({ ok: false, error: "Order missing." }, { status: 400 });

  const supabase = createServiceRoleClient();
  // "*" rather than a column list: the photo/size columns this flow reads may
  // predate or postdate a patch, and a named list would reject the whole row.
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    return Response.json({ ok: false, error: `Could not load the order: ${orderError.message}` }, { status: 500 });
  }
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return Response.json(
      { ok: false, error: "This order was not found, or you don't have access to this company." },
      { status: 404 }
    );
  }

  const requestedEventId = (body.eventId ?? "").trim();
  const eventId = requestedEventId || manualReferencePhotoEventId(order.id, randomUUID());

  const result = await sendOrderReferencePhotos({
    supabase,
    order,
    token,
    eventId,
    actorEmployeeId: employee.id,
    force: body.force === true,
  });

  if (result.status === "skipped") {
    return Response.json({
      ok: false,
      status: result.status,
      error: "This order has no Close-Up / Reference photos to send.",
      eventId,
    });
  }

  return Response.json({
    ok: result.status === "sent",
    status: result.status,
    eventId: result.eventId,
    logId: result.logId,
    sentCount: result.sentCount,
    totalPhotos: result.totalPhotos,
    messageIds: result.messageIds.filter(Boolean),
    caption: buildReferencePhotoCaption(order.ref_no),
    closeUpPhotoCount: extractCloseUpPhotoUrls(order).length,
    error: result.error,
  });
}
