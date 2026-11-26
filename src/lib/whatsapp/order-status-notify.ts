// 2026-11-25 — record + send one automatic order-status WhatsApp message.
//
// THE RULES THIS FILE EXISTS TO KEEP
//   • The order save is the master. Nothing here can throw into the action
//     that changed the status: a dead WhatsApp API must never lose an order.
//   • A message is only created for a REAL transition (from ≠ to) into one of
//     the three trigger statuses — saving the same status again is silent.
//   • The log row is written BEFORE the send, so a crash between the two
//     leaves a 'queued' row the retry job picks up rather than a message that
//     vanished.
//   • 'sent' means the provider accepted it. 'delivered'/'read' are only ever
//     written by the webhook — see /api/webhooks/whatsapp.
//   • The customer number is validated, never guessed; an unusable number is
//     recorded as 'skipped' with the reason, so it shows up in history instead
//     of disappearing.

import type { createServiceRoleClient } from "@/lib/supabase/server";
import {
  MAX_STATUS_RETRIES,
  buildStatusMessage,
  groupRecipient,
  isStatusTransition,
  parseStatusRecipient,
  nextAttemptAt,
  statusEventId,
  triggerForStatus,
  DEFAULT_TEMPLATES,
  TRIGGER_ENABLED_FIELD,
  TRIGGER_TEMPLATE_FIELD,
  type StatusTrigger,
} from "./order-status";
import { getStatusSender } from "./status-sender";
import { resolveOrderWhatsappGroupId } from "./reference-photos-send";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type NotifyResult = {
  status: "sent" | "failed" | "skipped" | "not-a-trigger";
  logId: string | null;
  error: string | null;
};

type SettingsRow = {
  auto_status_enabled?: boolean | null;
  hold_enabled?: boolean | null;
  cancel_enabled?: boolean | null;
  process_enabled?: boolean | null;
  hold_template?: string | null;
  cancel_template?: string | null;
  process_template?: string | null;
};

/** Company settings, or the built-in defaults when no row exists yet. */
async function loadSettings(supabase: ServiceClient, companyId: string): Promise<SettingsRow> {
  const { data, error } = await supabase
    .from("company_whatsapp_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  // A missing migration must not stop the message: defaults are all-on with
  // the standard text, and the row is simply not there yet.
  if (error || !data) return {};
  return data as SettingsRow;
}

function triggerEnabled(settings: SettingsRow, trigger: StatusTrigger): boolean {
  if (settings.auto_status_enabled === false) return false;
  return settings[TRIGGER_ENABLED_FIELD[trigger]] !== false;
}

function templateFor(settings: SettingsRow, trigger: StatusTrigger): string {
  return settings[TRIGGER_TEMPLATE_FIELD[trigger]] ?? DEFAULT_TEMPLATES[trigger];
}

/**
 * Change of status → WhatsApp message for the customer.
 *
 * Call this AFTER the order row was saved. `fromStatus` must be the status the
 * row held before the save (read it first); passing the new value for both
 * makes the whole thing a no-op, which is exactly what a repeated Save does.
 */
export async function notifyOrderStatusChange(
  supabase: ServiceClient,
  params: {
    orderId: string;
    fromStatus: string | null | undefined;
    toStatus: string | null | undefined;
    actorEmployeeId?: string | null;
  }
): Promise<NotifyResult> {
  const base: NotifyResult = { status: "not-a-trigger", logId: null, error: null };
  try {
    const trigger = triggerForStatus(params.toStatus ?? "");
    if (!trigger) return base;
    if (!isStatusTransition(params.fromStatus, params.toStatus)) return base;
    const toStatus = String(params.toStatus);
    const fromStatus = params.fromStatus ? String(params.fromStatus) : "";

    const { data: order } = await supabase
      .from("orders")
      // No contact_no: this message goes to the company's order group, never
      // to the customer's number.
      .select("id, ref_no, company_id")
      .eq("id", params.orderId)
      .maybeSingle();
    if (!order) return { ...base, status: "skipped", error: "Order not found when the message was prepared." };

    const settings = await loadSettings(supabase, order.company_id);
    if (!triggerEnabled(settings, trigger)) {
      // Deliberately no row: an admin turned this off, so there is nothing to
      // send and nothing to retry.
      return { ...base, status: "skipped", error: "Automatic status messages are turned off for this company." };
    }

    const text = buildStatusMessage(templateFor(settings, trigger), order.ref_no);
    if (!text) {
      return { ...base, status: "skipped", error: "The order has no usable reference number for the message." };
    }

    // ---- Destination ------------------------------------------------------
    // A status change is an instruction to OUR team, so it goes to the
    // company's own WhatsApp order group — the same group the packing and
    // reference-photo messages use — and never to the customer's number. With
    // no group configured there is nowhere honest to send it: the message is
    // recorded as 'skipped' with that reason instead.
    const groupId = await resolveOrderWhatsappGroupId(supabase, order.company_id);
    const recipient = groupId ? groupRecipient(groupId) : null;
    const noRecipientReason =
      "No WhatsApp group is set for this company — set companies.whapi_group_id or WHAPI_GROUP_ID.";

    // ---- Log first, send second ------------------------------------------
    // One insert either way: a message that can't be sent (no usable number)
    // is still recorded — as 'skipped' with the reason — so it appears in the
    // order page and in history instead of vanishing.
    const { data: row, error: insertError } = await supabase
      .from("order_whatsapp_messages")
      .insert({
        company_id: order.company_id,
        order_id: order.id,
        order_reference: order.ref_no,
        message_type: "order_status",
        event_id: statusEventId(order.id, fromStatus, toStatus),
        message_text: text,
        previous_status: fromStatus,
        new_status: toStatus,
        customer_phone: recipient,
        provider: getStatusSender()?.name ?? "none",
        delivery_status: recipient ? "queued" : "skipped",
        error_message: recipient ? null : noRecipientReason,
        created_by_employee_id: params.actorEmployeeId ?? null,
        attachment_photo_ids: [],
        whatsapp_message_ids: [],
        next_attempt_at: recipient ? new Date().toISOString() : null,
      } as never)
      .select("id")
      .single();

    if (insertError || !row) {
      // Most likely the unique (order_id, message_type, event_id) key — i.e.
      // this exact transition was already queued. Either way: no second send.
      return { ...base, status: "skipped", error: insertError?.message ?? "Could not write the message log." };
    }
    if (!recipient) {
      return { status: "skipped", logId: row.id, error: noRecipientReason };
    }

    return deliverQueuedMessage(supabase, {
      id: row.id,
      recipient,
      messageText: text,
      retryCount: 0,
    });
  } catch (error) {
    // Never let WhatsApp break the order save.
    return {
      ...base,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Send one already-logged message and record the outcome. Shared by the
 * immediate send, the retry job and the admin page's manual retry, so all
 * three write the same statuses.
 */
export async function deliverQueuedMessage(
  supabase: ServiceClient,
  params: { id: string; recipient: string; messageText: string; retryCount: number }
): Promise<NotifyResult> {
  const sender = getStatusSender();
  const now = new Date().toISOString();

  // 2026-11-26 — claim the row BEFORE sending. Every caller (this file, the
  // cron sweep, the admin retry, the Orders-page retry) funnels through here,
  // and none of them could see another attempt in flight: a double-click, or
  // the cron and a retry landing together, marked and posted the same row
  // twice, so the same Hold / Cancelled / In Production line reached the group
  // twice. Only an undelivered row can be claimed. A `processing` row is
  // reclaimable once its claim is STALE_CLAIM_MS old, so one crashed attempt
  // cannot block retries for ever.
  const STALE_CLAIM_MS = 5 * 60_000;
  const claimCutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const claim = () =>
    supabase
      .from("order_whatsapp_messages")
      .update({ delivery_status: "processing", last_attempt_at: now } as never)
      .eq("id", params.id);

  const { data: claimed } = await claim()
    .in("delivery_status", ["failed", "skipped", "queued"])
    .select("id")
    .maybeSingle();
  if (!claimed) {
    const { data: reclaimed } = await claim()
      .eq("delivery_status", "processing")
      .lt("last_attempt_at", claimCutoff)
      .select("id")
      .maybeSingle();
    if (!reclaimed) {
      return {
        status: "skipped",
        logId: params.id,
        error: "This message has already been sent, or is being sent right now — it will not be sent again.",
      };
    }
  }

  if (!sender) {
    await supabase
      .from("order_whatsapp_messages")
      .update({
        delivery_status: "failed",
        error_message: "No WhatsApp sender is configured (WHAPI_TOKEN is missing).",
        retry_count: params.retryCount,
        last_attempt_at: now,
        next_attempt_at: null,
      } as never)
      .eq("id", params.id);
    return { status: "failed", logId: params.id, error: "No WhatsApp sender is configured." };
  }

  const target = parseStatusRecipient(params.recipient);
  if (!target) {
    await supabase
      .from("order_whatsapp_messages")
      .update({
        delivery_status: "skipped",
        error_message: "This message has no usable WhatsApp recipient.",
        retry_count: params.retryCount,
        last_attempt_at: now,
        next_attempt_at: null,
      } as never)
      .eq("id", params.id);
    return { status: "skipped", logId: params.id, error: "No usable WhatsApp recipient." };
  }

  const result =
    target.kind === "group"
      ? await sender.sendGroupText(target.groupId, params.messageText)
      : await sender.sendText(target.digits, params.messageText);

  if (result.ok) {
    await supabase
      .from("order_whatsapp_messages")
      .update({
        delivery_status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: result.messageId,
        whatsapp_message_ids: result.messageId ? [result.messageId] : [],
        error_message: null,
        retry_count: params.retryCount,
        next_attempt_at: null,
      } as never)
      .eq("id", params.id);
    return { status: "sent", logId: params.id, error: null };
  }

  const canRetry = result.retryable && params.retryCount < MAX_STATUS_RETRIES;
  await supabase
    .from("order_whatsapp_messages")
    .update({
      delivery_status: "failed",
      error_message: result.error,
      retry_count: params.retryCount + 1,
      next_attempt_at: canRetry ? nextAttemptAt(params.retryCount + 1) : null,
    } as never)
    .eq("id", params.id);
  return { status: "failed", logId: params.id, error: result.error };
}
