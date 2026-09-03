// Per-company courier credential storage — the backend for the Account
// Setup tab on /dashboard/courier-booking (2026-09-03). See
// db/2026-09-03-courier-account-setup.sql for the table + capability, and
// each courier's own *-ship.ts file for how a resolved credentials object
// is actually used.
//
// DESIGN: one row per (company_id, courier) in courier_credentials,
// secrets_enc jsonb mapping field name -> base64(encryptSecret(value)).
// resolveCourierCredentials() decrypts whatever's in the DB and fills any
// GAP from that courier's legacy process.env.* var — so a company that
// hasn't touched Account Setup yet keeps working exactly as before
// (env-var-only, global), and a company that's saved SOME but not all
// fields (e.g. the account number but not yet the API secret) still falls
// back correctly field-by-field, not all-or-nothing.
//
// FedEx's and Aramex's own auth helpers (fedex-auth.ts's
// getFedexAccessToken, aramex-tracking.ts's getAramexClientInfo) are ALSO
// used by the courier-TRACKING cron (poll-fedex-tracking/route.ts) — that
// cron has no per-company concept (it polls across every company's pending
// shipments in one run) and is deliberately NOT touched by this round.
// Those two functions keep reading process.env directly when called with
// no override argument (unchanged existing behavior) — only the BOOKING
// path (courier-booking/actions.ts) supplies an override built from
// resolveCourierCredentials() below.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-box";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type CourierKey = "fedex" | "ups" | "aramex" | "delhivery" | "shiprocket" | "dhl";

export const COURIERS: { key: CourierKey; label: string }[] = [
  { key: "fedex", label: "FedEx" },
  { key: "ups", label: "UPS" },
  { key: "aramex", label: "Aramex" },
  { key: "delhivery", label: "Delhivery" },
  { key: "shiprocket", label: "Shiprocket" },
  { key: "dhl", label: "DHL Express" },
];

export type CredentialFieldDef = {
  key: string;
  label: string;
  // true = rendered as a password input, never re-sent to the browser once
  // saved. false = a semi-static identifier (account number, pickup
  // location) — still encrypted at rest for consistency/simplicity, but
  // shown as plain text and safe to prefill back into a form.
  secret: boolean;
  // The legacy env var this field falls back to when the DB has nothing
  // for it yet. "" for fields that only ever existed as a form input
  // before this round (no env var equivalent).
  envVar: string;
  placeholder?: string;
};

// The authoritative field list per courier — the ONE place this app
// declares what each courier's booking flow needs. Drives the Account
// Setup form (account-setup-form.tsx) AND resolveCourierCredentials()
// below. Matches exactly what each *-ship.ts file's own auth getter reads
// today (see each file's own header comment for the exact env var names)
// plus the semi-static account numbers/pickup-location names that
// create-shipment-form.tsx currently makes the employee retype on every
// single booking (found during this round's investigation) — captured here
// too so Account Setup can prefill them.
export const COURIER_CREDENTIAL_FIELDS: Record<CourierKey, CredentialFieldDef[]> = {
  fedex: [
    { key: "client_id", label: "API Client ID", secret: true, envVar: "FEDEX_API_CLIENT_ID" },
    { key: "client_secret", label: "API Client Secret", secret: true, envVar: "FEDEX_API_CLIENT_SECRET" },
    { key: "account_number", label: "FedEx Account Number", secret: false, envVar: "" },
  ],
  ups: [
    { key: "client_id", label: "API Client ID", secret: true, envVar: "UPS_CLIENT_ID" },
    { key: "client_secret", label: "API Client Secret", secret: true, envVar: "UPS_CLIENT_SECRET" },
    { key: "shipper_number", label: "UPS Shipper Number", secret: false, envVar: "" },
  ],
  aramex: [
    { key: "username", label: "Username", secret: true, envVar: "ARAMEX_USERNAME" },
    { key: "password", label: "Password", secret: true, envVar: "ARAMEX_PASSWORD" },
    { key: "account_number", label: "Account Number", secret: false, envVar: "ARAMEX_ACCOUNT_NUMBER" },
    { key: "account_pin", label: "Account PIN", secret: true, envVar: "ARAMEX_ACCOUNT_PIN" },
    { key: "account_entity", label: "Account Entity", secret: false, envVar: "ARAMEX_ACCOUNT_ENTITY" },
    { key: "account_country_code", label: "Account Country Code", secret: false, envVar: "ARAMEX_ACCOUNT_COUNTRY_CODE" },
  ],
  delhivery: [
    { key: "api_token", label: "API Token", secret: true, envVar: "DELHIVERY_API_TOKEN" },
    { key: "pickup_location_name", label: "Pickup Location Name", secret: false, envVar: "", placeholder: "must match a location registered on Delhivery's dashboard" },
  ],
  shiprocket: [
    { key: "email", label: "Account Email", secret: true, envVar: "SHIPROCKET_EMAIL" },
    { key: "password", label: "Account Password", secret: true, envVar: "SHIPROCKET_PASSWORD" },
    { key: "pickup_location_name", label: "Pickup Location Name", secret: false, envVar: "", placeholder: "must match a location registered on Shiprocket's dashboard" },
  ],
  dhl: [
    { key: "username", label: "MyDHL API Username", secret: true, envVar: "DHL_EXPRESS_USERNAME" },
    { key: "password", label: "MyDHL API Password", secret: true, envVar: "DHL_EXPRESS_PASSWORD" },
    { key: "account_number", label: "DHL Account Number", secret: false, envVar: "" },
  ],
};

// The subset of each courier's fields that must ALL be present (DB or env)
// before a booking could plausibly succeed — drives the Account Setup
// tab's "configured ✓ / not set up" badge. The semi-static account-number/
// pickup-location fields don't count on their own toward "configured".
const REQUIRED_FOR_CONFIGURED: Record<CourierKey, string[]> = {
  fedex: ["client_id", "client_secret"],
  ups: ["client_id", "client_secret"],
  aramex: ["username", "password", "account_number", "account_pin", "account_entity", "account_country_code"],
  delhivery: ["api_token"],
  shiprocket: ["email", "password"],
  dhl: ["username", "password"],
};

async function readEncRow(supabase: ServiceClient, companyId: string, courier: CourierKey): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("courier_credentials")
    .select("secrets_enc")
    .eq("company_id", companyId)
    .eq("courier", courier)
    .maybeSingle();
  return (data?.secrets_enc as Record<string, string> | null) ?? {};
}

/**
 * Resolves every field this courier's booking flow needs for one company:
 * DB (decrypted) first, falling back field-by-field to the legacy env var
 * for anything not saved in the DB yet. Never throws for a missing field —
 * callers (each *-ship.ts's own auth getter) still do their own final
 * "is this actually set" check and throw their own clear error, same as
 * before this round; this function's job is only to gather what's
 * available from either source.
 */
export async function resolveCourierCredentials(
  supabase: ServiceClient,
  companyId: string,
  courier: CourierKey
): Promise<Record<string, string>> {
  const enc = await readEncRow(supabase, companyId, courier);
  const result: Record<string, string> = {};
  for (const field of COURIER_CREDENTIAL_FIELDS[courier]) {
    const stored = enc[field.key];
    if (stored) {
      try {
        result[field.key] = decryptSecret(Buffer.from(stored, "base64"));
        continue;
      } catch {
        // A corrupted/undecryptable value (e.g. ENCRYPTION_KEY rotated
        // since this was saved) should not crash a booking — fall through
        // to the env var below, same as if the DB had nothing for this
        // field.
      }
    }
    if (field.envVar) {
      const fromEnv = process.env[field.envVar];
      if (fromEnv) result[field.key] = fromEnv;
    }
  }
  return result;
}

/**
 * Saves one courier's credential fields for a company. Only keys PRESENT
 * (and non-empty) in `updates` are touched — every other already-saved
 * field is left exactly as it was. An empty string in `updates` is treated
 * the same as "not present" (leave unchanged) — the Account Setup form
 * never re-displays a saved secret, so a blank secret input on a re-save
 * must not be misread as "clear this field". To actually clear a saved
 * field, pass an explicit `null` for that key.
 */
export async function saveCourierCredentialFields(
  supabase: ServiceClient,
  companyId: string,
  courier: CourierKey,
  updates: Record<string, string | null | undefined>,
  employeeId: string
): Promise<void> {
  const existing = await readEncRow(supabase, companyId, courier);
  const merged: Record<string, string> = { ...existing };

  const validKeys = new Set(COURIER_CREDENTIAL_FIELDS[courier].map((f) => f.key));
  for (const [key, value] of Object.entries(updates)) {
    if (!validKeys.has(key)) continue;
    if (value === null) {
      delete merged[key];
    } else if (!value) {
      continue; // empty/undefined = leave unchanged
    } else {
      merged[key] = encryptSecret(value).toString("base64");
    }
  }

  const { error } = await supabase.from("courier_credentials").upsert(
    { company_id: companyId, courier, secrets_enc: merged, updated_at: new Date().toISOString(), updated_by: employeeId },
    { onConflict: "company_id,courier" }
  );
  if (error) throw new Error(error.message);
}

export type CourierCredentialStatus = { configuredInDb: boolean; configured: boolean };

/**
 * Which couriers have enough saved (DB OR env var — same "either source
 * counts" logic resolveCourierCredentials uses) to actually attempt a
 * booking, for the Account Setup tab's status badges. `configuredInDb`
 * distinguishes "saved through this UI" from "still riding on a global env
 * var" so the badge can say which. Never returns secret VALUES, only
 * booleans — safe to pass straight to a client component.
 */
export async function getCourierCredentialStatus(
  supabase: ServiceClient,
  companyId: string
): Promise<Record<CourierKey, CourierCredentialStatus>> {
  const { data } = await supabase.from("courier_credentials").select("courier, secrets_enc").eq("company_id", companyId);
  const byCourier = new Map<string, Record<string, string>>();
  for (const row of data ?? []) {
    byCourier.set(row.courier as string, (row.secrets_enc as Record<string, string> | null) ?? {});
  }

  const result = {} as Record<CourierKey, CourierCredentialStatus>;
  for (const key of Object.keys(COURIER_CREDENTIAL_FIELDS) as CourierKey[]) {
    const enc = byCourier.get(key) ?? {};
    const fieldDefs = COURIER_CREDENTIAL_FIELDS[key];
    const required = REQUIRED_FOR_CONFIGURED[key];
    const configuredInDb = required.every((f) => !!enc[f]);
    const configured =
      configuredInDb ||
      required.every((f) => {
        const def = fieldDefs.find((d) => d.key === f);
        return !!(def?.envVar && process.env[def.envVar]);
      });
    result[key] = { configuredInDb, configured };
  }
  return result;
}

/**
 * The saved non-secret field values for one courier (account numbers,
 * pickup location names) — used to prefill the booking form so an employee
 * doesn't have to retype them on every single booking. Deliberately
 * excludes every `secret: true` field, even decrypted — this return value
 * is safe to pass into a client component's defaultValue prop.
 */
export async function getNonSecretCredentialValues(
  supabase: ServiceClient,
  companyId: string,
  courier: CourierKey
): Promise<Record<string, string>> {
  const all = await resolveCourierCredentials(supabase, companyId, courier);
  const result: Record<string, string> = {};
  for (const field of COURIER_CREDENTIAL_FIELDS[courier]) {
    if (!field.secret && all[field.key]) result[field.key] = all[field.key];
  }
  return result;
}
