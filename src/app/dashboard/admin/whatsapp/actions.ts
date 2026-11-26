"use server";

// 2026-11-25 — admin control of the automatic order-status WhatsApp messages.
//
// Everything here is gated on the existing employee_admin capability (the same
// one that owns the Employees roster) — no new role system. The provider token
// itself is NEVER part of these forms: it stays in the deployment environment
// (WHAPI_TOKEN) and this page can only report whether it answers.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit/log-audit";
import { checkStatusProvider, getStatusSender } from "@/lib/whatsapp/status-sender";
import { deliverQueuedMessage } from "@/lib/whatsapp/order-status-notify";
import { resolveOrderWhatsappGroupId } from "@/lib/whatsapp/reference-photos-send";
import { DEFAULT_TEMPLATES } from "@/lib/whatsapp/order-status";

export type WhatsAppSettingsState = { error: string | null; success: boolean; detail?: string };

const PATH = "/dashboard/admin/whatsapp";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function checked(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

/** Keep the three placeholders honest: a template without {po} would send a
 *  message that names no order. */
function templateValue(formData: FormData, key: string, fallback: string): string | null {
  const raw = text(formData, key);
  const value = raw || fallback;
  return value.includes("{po}") ? value : null;
}

export async function saveWhatsAppSettingsAction(
  _prev: WhatsAppSettingsState,
  formData: FormData
): Promise<WhatsAppSettingsState> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const companyId = text(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) {
    return { error: "You do not have access to this company.", success: false };
  }

  const hold = templateValue(formData, "hold_template", DEFAULT_TEMPLATES.hold);
  const cancel = templateValue(formData, "cancel_template", DEFAULT_TEMPLATES.cancel);
  const process = templateValue(formData, "process_template", DEFAULT_TEMPLATES.process);
  if (!hold || !cancel || !process) {
    return {
      error: "Each template must contain {po} — that is where the order's PO number is inserted.",
      success: false,
    };
  }

  const row = {
    company_id: companyId,
    auto_status_enabled: checked(formData, "auto_status_enabled"),
    hold_enabled: checked(formData, "hold_enabled"),
    cancel_enabled: checked(formData, "cancel_enabled"),
    process_enabled: checked(formData, "process_enabled"),
    hold_template: hold,
    cancel_template: cancel,
    process_template: process,
    updated_by_employee_id: employee.id,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("company_whatsapp_settings").upsert(row as never, { onConflict: "company_id" });
  if (error) return { error: `Could not save: ${error.message}`, success: false };

  await logAudit(supabase, {
    companyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "whatsapp.settings_updated",
    entityType: "company_whatsapp_settings",
    entityId: companyId,
    entityLabel: "Automatic order-status messages",
    changes: {
      auto_status_enabled: row.auto_status_enabled,
      hold_enabled: row.hold_enabled,
      cancel_enabled: row.cancel_enabled,
      process_enabled: row.process_enabled,
      hold_template: hold,
      cancel_template: cancel,
      process_template: process,
    },
  });

  revalidatePath(PATH);
  return { error: null, success: true, detail: "Settings saved." };
}

/** "Test connection" — does the configured provider answer? */
export async function testWhatsAppConnectionAction(): Promise<WhatsAppSettingsState> {
  await requireCapability("employee_admin");
  const result = await checkStatusProvider();
  return {
    error: result.ok ? null : result.detail,
    success: result.ok,
    detail: result.ok ? `Connected — ${result.detail}` : result.detail,
  };
}

/**
 * "Send test message to group" — prove the RESOLVED group works, not just the
 * token. `checkStatusProvider` only asks Whapi whether the token answers; a
 * typo'd or wrong `companies.whapi_group_id` passes that check and then turns
 * every status message into a 'skipped'/'failed' row nobody sees. This action
 * takes the exact id the sender resolves (companies.whapi_group_id ||
 * WHAPI_GROUP_ID) and posts one harmless line to it, in the same way the real
 * message is posted — so a wrong id fails HERE, once, while an admin is
 * looking, instead of silently later.
 */
export async function testWhatsAppGroupAction(companyId: string): Promise<WhatsAppSettingsState> {
  const employee = await requireCapability("employee_admin");
  if (!employee.companyIds.includes(companyId)) {
    return { error: "You do not have access to this company.", success: false };
  }

  const supabase = createServiceRoleClient();
  const groupId = await resolveOrderWhatsappGroupId(supabase, companyId);
  if (!groupId) {
    return {
      error: "No order group is set for this company — set companies.whapi_group_id or WHAPI_GROUP_ID.",
      success: false,
    };
  }

  const sender = getStatusSender();
  if (!sender) {
    return { error: "No WhatsApp sender is configured (WHAPI_TOKEN is missing).", success: false };
  }

  const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
  const groupTail = groupId.slice(-4);
  // Deliberately says what it is: a person reading the group must not mistake
  // a test for a real order update.
  const result = await sender.sendGroupText(
    groupId,
    `Test message from the OMS${company?.name ? ` (${company.name})` : ""} — automatic Hold / Cancelled / In Production updates will be posted to this group.`
  );

  await logAudit(supabase, {
    companyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "whatsapp.group_test",
    entityType: "companies",
    entityId: companyId,
    entityLabel: `order group ••••${groupTail}`,
    changes: { group_tail: groupTail, result: result.ok ? "sent" : "failed", error: result.ok ? null : result.error },
  });

  revalidatePath(PATH);
  if (result.ok) {
    return {
      error: null,
      success: true,
      detail: `Test message sent to the order group (••••${groupTail}). Check that it arrived — if it did not, the group id is wrong.`,
    };
  }
  return {
    error: result.error,
    success: false,
    detail: `WhatsApp rejected the test for group ••••${groupTail} — ${result.error}`,
  };
}

/**
 * Manual retry of one failed/skipped message. Uses the same delivery function
 * as the automatic send and the cron, so the recorded states cannot differ.
 */
export async function retryWhatsAppMessageAction(id: string): Promise<WhatsAppSettingsState> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const { data: message } = await supabase
    .from("order_whatsapp_messages")
    .select("id, company_id, order_id, customer_phone, message_text, retry_count, delivery_status")
    .eq("id", id)
    .maybeSingle();
  if (!message) return { error: "Message not found.", success: false };
  if (!message.company_id || !employee.companyIds.includes(message.company_id)) {
    return { error: "You do not have access to this message.", success: false };
  }
  if (message.delivery_status === "delivered" || message.delivery_status === "read" || message.delivery_status === "sent") {
    return { error: "This message already went out — retrying would send it twice.", success: false };
  }
  if (!message.customer_phone) {
    return { error: "This message has no recipient on record.", success: false };
  }

  const result = await deliverQueuedMessage(supabase, {
    id: message.id,
    recipient: message.customer_phone,
    messageText: message.message_text ?? "",
    retryCount: Number(message.retry_count ?? 0),
  });

  await logAudit(supabase, {
    companyId: message.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "whatsapp.manual_retry",
    entityType: "order_whatsapp_messages",
    entityId: message.id,
    entityLabel: `order ${message.order_id}`,
    changes: { result: result.status, error: result.error },
  });

  revalidatePath(PATH);
  if (result.status === "sent") return { error: null, success: true, detail: "Message sent." };
  return { error: result.error ?? "The message could not be sent.", success: false };
}
