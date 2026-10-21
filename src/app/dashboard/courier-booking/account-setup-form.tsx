"use client";

import { useActionState } from "react";
import { saveCourierCredentialsAction, testFedexConnectionAction, type SaveCourierCredentialsState, type TestFedexConnectionState } from "./credentials-actions";
import { COURIERS, COURIER_CREDENTIAL_FIELDS, type CourierKey, type CourierCredentialStatus } from "@/lib/couriers/credentials";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

const saveInitial: SaveCourierCredentialsState = { error: null, success: false };
const testInitial: TestFedexConnectionState = { status: "idle", message: null, keySource: null };

function CourierCredentialCard({ courierKey, label, status }: { courierKey: CourierKey; label: string; status: CourierCredentialStatus }) {
  const [state, formAction, pending] = useActionState(saveCourierCredentialsAction, saveInitial);
  // 2026-09-17 — "Test connection": fires the live FedEx key+account check
  // (a quote-only Rate API call — never creates a shipment) so a mismatch
  // like "account number not found" surfaces HERE, before a real booking
  // fails with it. FedEx-only because it's the only courier with this
  // failure mode so far (see credentials-actions.ts's test action).
  const [testState, testFormAction, testPending] = useActionState(testFedexConnectionAction, testInitial);
  const fields = COURIER_CREDENTIAL_FIELDS[courierKey];

  return (
    <details className="rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold text-slate-800">
        <span>{label}</span>
        {status.configuredInDb ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">✓ Configured</span>
        ) : status.configured ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Using env var (not saved here yet)</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Not set up</span>
        )}
      </summary>
      <form action={formAction} className="space-y-3 border-t border-slate-100 px-4 py-4">
        <input type="hidden" name="courier" value={courierKey} />
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Saved.</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {fields.map((field) => (
            <div key={field.key}>
              <label className={labelClass}>{field.label}</label>
              <input
                name={field.key}
                type={field.secret ? "password" : "text"}
                placeholder={status.configuredInDb && field.secret ? "already saved — leave blank to keep" : field.placeholder}
                autoComplete="off"
                className={inputClass}
              />
            </div>
          ))}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </form>
      {courierKey === "fedex" && (
        <div className="border-t border-slate-100 px-4 py-4">
          {/* 2026-10-21 — "fedex ke teeno companies me account setup kiya hu
              ... vercel me ek ke credentials dalu or baki ke bhi work kare
              properly": the resolver already supports exactly that (see
              resolveCourierCredentials in src/lib/couriers/credentials.ts —
              DB value first, then that field's env var). One developer key
              can serve every company; the ACCOUNT NUMBER cannot, because
              charges post to a per-company FedEx account. Saying it on the
              card stops a second/third company being left on a blank account
              number and failing only at booking time. */}
          <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-[11px] text-sky-900">
            One FedEx developer key (Client ID + Secret) works for ALL companies: put it once in the deployment env
            (<code className="rounded bg-sky-100 px-1">FEDEX_API_CLIENT_ID</code> /{" "}
            <code className="rounded bg-sky-100 px-1">FEDEX_API_CLIENT_SECRET</code>) and leave Client ID/Secret blank here.
            Only the <strong>Account Number</strong> is per company — save each company&apos;s own number once (switch company at
            the top, then return to this tab). Test connection checks the exact key + account pair this company books with.
          </p>
          {/* Separate <form> from the save form above (nested forms are
              invalid HTML) — same data, different action. */}
          <form action={testFormAction} className="flex items-center gap-3">
            <input type="hidden" name="courier" value="fedex" />
            <button
              type="submit"
              disabled={testPending}
              className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {testPending ? "Testing against FedEx..." : "Test connection"}
            </button>
            <span className="text-xs text-slate-500">Live-checks that THIS account number works with THIS API key — no shipment is created.</span>
          </form>
          {testState.message && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                testState.status === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
              }`}
            >
              {testState.message}
            </p>
          )}
        </div>
      )}
    </details>
  );
}

export function AccountSetupForm({
  status,
  canEdit,
  companyName,
}: {
  status: Record<CourierKey, CourierCredentialStatus>;
  canEdit: boolean;
  companyName: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Set up each courier&apos;s own account here — {companyName}&apos;s own credentials, saved encrypted, used only for this
        company&apos;s bookings. Once saved, a field is never shown again (leave it blank on a later save to keep the current value
        unchanged, or type a new value to replace it).
      </p>
      {!canEdit && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You can see which couriers are configured, but only Admin/MD can enter or change credentials.
        </p>
      )}
      {canEdit ? (
        <div className="space-y-2">
          {COURIERS.map((c) => (
            <CourierCredentialCard key={c.key} courierKey={c.key} label={c.label} status={status[c.key]} />
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {COURIERS.map((c) => (
            <div key={c.key} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm">
              <span className="font-medium text-slate-800">{c.label}</span>
              {status[c.key].configuredInDb ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">✓ Configured</span>
              ) : status[c.key].configured ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Using env var</span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Not set up</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
