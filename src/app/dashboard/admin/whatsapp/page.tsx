// 2026-11-25 — Admin → WhatsApp: the switchboard for automatic order-status
// messages (Hold / Cancelled / In Production).
//
// Admin-controlled (employee_admin), one row per company, and deliberately no
// token field: the Whapi token lives only in the deployment environment.

import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { checkStatusProvider } from "@/lib/whatsapp/status-sender";
import { DEFAULT_TEMPLATES } from "@/lib/whatsapp/order-status";
import { WhatsAppSettingsClient, type WhatsAppSettingsRow } from "./client";

export default async function WhatsAppSettingsPage() {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const [{ data: companies }, settingsRes] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("company_whatsapp_settings").select("*").in("company_id", employee.companyIds),
  ]);

  const settings = (settingsRes.data ?? []) as unknown as WhatsAppSettingsRow[];
  const settingsMissing = Boolean(settingsRes.error);

  // The query is already limited to the login's companies; the WhatsApp page
  // has no store-level scope of its own.
  const visibleCompanies = companies ?? [];

  const { data: messages } = await supabase
    .from("order_whatsapp_messages")
    .select("id, order_id, order_reference, new_status, previous_status, delivery_status, created_at, sent_at, delivered_at, read_at, error_message, retry_count, customer_phone")
    .eq("message_type", "order_status")
    .in("company_id", employee.companyIds)
    .order("created_at", { ascending: false })
    .limit(60);

  const provider = await checkStatusProvider();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">WhatsApp — order status messages</h1>
          <p className="text-xs text-slate-500">
            When an order changes to Hold, Cancelled or In Production, the message goes to the company&apos;s
            WhatsApp order group automatically (the customer&apos;s number only when no group is set).
            Sending runs in the background; the order save never waits for it.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-slate-500 hover:underline">
          ← Dashboard
        </Link>
      </div>

      {settingsMissing && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The settings table is missing. Run <code>db/2026-11-25-whatsapp-order-status.sql</code> in Supabase,
          then reload this page. Built-in defaults (all triggers on) are used until then.
        </p>
      )}

      <WhatsAppSettingsClient
        companies={visibleCompanies}
        settings={settings}
        messages={(messages ?? []).map((m) => ({
          id: m.id as string,
          orderRef: (m.order_reference as string | null) ?? "",
          newStatus: (m.new_status as string | null) ?? "",
          previousStatus: (m.previous_status as string | null) ?? "",
          status: (m.delivery_status as string | null) ?? "",
          createdAt: (m.created_at as string | null) ?? "",
          sentAt: (m.sent_at as string | null) ?? "",
          deliveredAt: (m.delivered_at as string | null) ?? "",
          readAt: (m.read_at as string | null) ?? "",
          error: (m.error_message as string | null) ?? "",
          retryCount: Number(m.retry_count ?? 0),
          phoneMasked: m.customer_phone
            ? String(m.customer_phone).startsWith("group:")
              ? `Group ••${String(m.customer_phone).slice(-4)}`
              : `••••${String(m.customer_phone).slice(-4)}`
            : "",
        }))}
        provider={provider}
        // The panel labels the three triggers the way the order statuses are
        // spelled in the UI; the stored template defaults are keyed by trigger.
        defaults={{
          Hold: DEFAULT_TEMPLATES.hold,
          Cancelled: DEFAULT_TEMPLATES.cancel,
          InProduction: DEFAULT_TEMPLATES.process,
        }}
      />
    </div>
  );
}
