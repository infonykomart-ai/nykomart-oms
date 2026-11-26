"use client";

import { useActionState, useState, useTransition } from "react";
import { formatIST } from "@/lib/format-ist";
import {
  retryWhatsAppMessageAction,
  saveWhatsAppSettingsAction,
  testWhatsAppConnectionAction,
  testWhatsAppGroupAction,
  type WhatsAppSettingsState,
} from "./actions";

export type WhatsAppSettingsRow = {
  company_id: string;
  auto_status_enabled: boolean;
  hold_enabled: boolean;
  cancel_enabled: boolean;
  process_enabled: boolean;
  hold_template: string;
  cancel_template: string;
  process_template: string;
  updated_at: string | null;
};

export type WhatsAppHistoryRow = {
  id: string;
  orderRef: string;
  newStatus: string;
  previousStatus: string;
  status: string;
  createdAt: string;
  sentAt: string;
  deliveredAt: string;
  readAt: string;
  error: string;
  retryCount: number;
  phoneMasked: string;
};

const initialState: WhatsAppSettingsState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

const STATUS_PILL: Record<string, string> = {
  delivered: "bg-green-100 text-green-800",
  read: "bg-green-100 text-green-800",
  sent: "bg-sky-100 text-sky-800",
  queued: "bg-amber-100 text-amber-800",
  processing: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-slate-100 text-slate-600",
};

export function WhatsAppSettingsClient({
  companies,
  settings,
  messages,
  provider,
  defaults,
}: {
  companies: {
    id: string;
    name: string;
    /** Where the status messages actually go — resolved server-side. */
    group: { source: "company" | "env" | "none"; masked: string };
  }[];
  settings: WhatsAppSettingsRow[];
  messages: WhatsAppHistoryRow[];
  provider: { ok: boolean; detail: string };
  defaults: Record<string, string>;
}) {
  const [saveState, saveAction, savePending] = useActionState(saveWhatsAppSettingsAction, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [testState, setTestState] = useState<WhatsAppSettingsState | null>(null);
  const [testPending, startTest] = useTransition();
  // 2026-11-26 — "Send test message to group": proves the resolved group id
  // really receives messages, which the token health check cannot.
  const [groupTestState, setGroupTestState] = useState<WhatsAppSettingsState | null>(null);
  const [groupTestPending, startGroupTest] = useTransition();

  const row = settings.find((s) => s.company_id === companyId);
  const selectedCompany = companies.find((c) => c.id === companyId);
  const group = selectedCompany?.group;
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retried, setRetried] = useState<Set<string>>(new Set());
  const [retryPending, startRetry] = useTransition();

  function handleRetry(id: string) {
    setRetryError(null);
    startRetry(async () => {
      const result = await retryWhatsAppMessageAction(id);
      if (result.error) setRetryError(result.error);
      else setRetried((prev) => new Set(prev).add(id));
    });
  }

  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border px-4 py-3 text-xs ${
          provider.ok ? "border-green-300 bg-green-50 text-green-900" : "border-red-300 bg-red-50 text-red-900"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold">Connection:</span> {provider.ok ? "Connected" : "Not connected"} —{" "}
            {provider.detail}
          </div>
          <button
            type="button"
            disabled={testPending}
            onClick={() =>
              startTest(async () => {
                const result = await testWhatsAppConnectionAction();
                setTestState(result);
              })
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {testPending ? "Testing…" : "Test connection"}
          </button>
        </div>
        {testState && (
          <p className="mt-1.5 font-medium">{testState.detail ?? (testState.error || "Okay.")}</p>
        )}
        <p className="mt-1 text-[11px] opacity-70">
          The provider token is set on the server (WHAPI_TOKEN) and is never shown or editable on this page.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Automatic messages</h2>
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              // The previous company's test result says nothing about this one.
              setGroupTestState(null);
            }}
            className={`${inputClass} ml-auto max-w-xs`}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* 2026-11-26 — the destination, stated before the toggles: a message
            that was skipped for "no group" must be explainable right here. */}
        {group && (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
              group.source === "none"
                ? "border-red-300 bg-red-50 text-red-900"
                : "border-green-300 bg-green-50 text-green-900"
            }`}
          >
            {group.source === "none" ? (
              <>
                <p className="font-semibold">No order group set — automatic messages are skipped.</p>
                <p className="mt-0.5">
                  Set <code>companies.whapi_group_id</code> for {selectedCompany?.name} (or the deployment&apos;s{" "}
                  <code>WHAPI_GROUP_ID</code>). Nothing is sent to the customer&apos;s number instead.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">Order group: {group.masked}</p>
                <p className="mt-0.5">
                  {group.source === "company"
                    ? `Set on ${selectedCompany?.name}.`
                    : `From the deployment environment (WHAPI_GROUP_ID) — ${selectedCompany?.name} has no group of its own.`}
                </p>
              </>
            )}
            <p className="mt-1 opacity-70">
              Hold, Cancelled and In Production messages all go here — not to the customer.
            </p>
            {group.source !== "none" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={groupTestPending}
                  onClick={() => {
                    setGroupTestState(null);
                    startGroupTest(async () => {
                      setGroupTestState(await testWhatsAppGroupAction(companyId));
                    });
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {groupTestPending ? "Sending…" : "Send test message to group"}
                </button>
                {groupTestState && (
                  <span className={`font-medium ${groupTestState.error ? "text-red-700" : "text-green-800"}`}>
                    {groupTestState.error ?? groupTestState.detail}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {saveState.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{saveState.error}</p>}
        {saveState.success && <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">Settings saved.</p>}

        {/* key={companyId} so switching company reloads that company's values */}
        <form key={companyId} action={saveAction} className="space-y-3">
          <input type="hidden" name="company_id" value={companyId} />

          <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <input type="checkbox" name="auto_status_enabled" defaultChecked={row?.auto_status_enabled ?? true} />
            <span className="text-sm font-medium text-slate-800">Send automatic order-status messages</span>
          </label>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {(
              [
                ["hold", "Hold", row?.hold_enabled ?? true, row?.hold_template ?? defaults.Hold ?? "Hold this order {po}"],
                ["cancel", "Cancelled", row?.cancel_enabled ?? true, row?.cancel_template ?? defaults.Cancelled ?? "Cancel This Order {po}"],
                ["process", "In Production", row?.process_enabled ?? true, row?.process_template ?? defaults.InProduction ?? "Process This Order {po}"],
              ] as const
            ).map(([key, label, enabled, template]) => (
              <div key={key} className="rounded-lg border border-slate-200 p-3">
                <label className="mb-2 flex items-center gap-2">
                  <input type="checkbox" name={`${key}_enabled`} defaultChecked={enabled} />
                  <span className="text-sm font-medium text-slate-800">{label}</span>
                </label>
                <label className={labelClass} htmlFor={`wa_${key}_template`}>Message template</label>
                <input
                  id={`wa_${key}_template`}
                  name={`${key}_template`}
                  defaultValue={template}
                  className={inputClass}
                />
                <p className="mt-1 text-[10px] text-slate-400">{"{po}"} is replaced with the order&apos;s PO number.</p>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={savePending}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {savePending ? "Saving…" : "Save settings"}
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Message history</h2>
        <p className="mb-2 text-[11px] text-slate-400">
          “Sent” means WhatsApp accepted the message. “Delivered” and “Read” come only from WhatsApp&apos;s own
          delivery webhook — never from the send response.
        </p>
        {retryError && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{retryError}</p>}
        <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1.5">Order</th>
                <th className="px-2 py-1.5">Change</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">To</th>
                <th className="px-2 py-1.5">Created</th>
                <th className="px-2 py-1.5">Detail</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => {
                const done = m.status === "sent" || m.status === "delivered" || m.status === "read";
                return (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-medium text-slate-800">{m.orderRef || "—"}</td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {m.previousStatus || "—"} → {m.newStatus || "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full px-1.5 py-0.5 font-medium ${STATUS_PILL[m.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{m.phoneMasked || "—"}</td>
                    <td className="px-2 py-1.5 text-slate-500">{m.createdAt ? formatIST(m.createdAt) : "—"}</td>
                    <td className="px-2 py-1.5 text-slate-500">
                      {m.error ? <span className="text-red-600">{m.error}</span> : m.readAt ? "Read" : m.deliveredAt ? "Delivered" : m.sentAt ? "Sent" : "—"}
                      {m.retryCount > 0 && <span className="ml-1 text-slate-400">· {m.retryCount} retr{m.retryCount === 1 ? "y" : "ies"}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {!done && (m.status === "failed" || m.status === "queued") && (
                        <button
                          type="button"
                          disabled={retryPending || retried.has(m.id)}
                          onClick={() => handleRetry(m.id)}
                          className="rounded border border-slate-300 px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {retried.has(m.id) ? "Retried" : "Retry"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {messages.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-center text-slate-400">
                    No status messages yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
