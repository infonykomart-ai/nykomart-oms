"use server";

// Account Setup — saving courier API credentials, per company. Gated on
// 'courier_credentials_admin' (Admin/MD only, deliberately separate from
// 'courier_booking_shipment' — see db/2026-09-03-courier-account-setup.sql
// and capability-info.ts for why), NOT the booking capability itself — an
// employee who can book a shipment isn't automatically trusted to view or
// change which API secrets the company is using.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { COURIER_CREDENTIAL_FIELDS, resolveCourierCredentials, saveCourierCredentialFields, type CourierKey } from "@/lib/couriers/credentials";
import { testFedexConnection } from "@/lib/couriers/fedex-test";

export type SaveCourierCredentialsState = { error: string | null; success: boolean };

const COURIER_KEYS = Object.keys(COURIER_CREDENTIAL_FIELDS) as CourierKey[];

export async function saveCourierCredentialsAction(
  _prev: SaveCourierCredentialsState,
  formData: FormData
): Promise<SaveCourierCredentialsState> {
  const employee = await requireCapability("courier_credentials_admin");
  const supabase = createServiceRoleClient();

  const courier = String(formData.get("courier") ?? "") as CourierKey;
  if (!COURIER_KEYS.includes(courier)) {
    return { error: "Unknown courier.", success: false };
  }

  // Only fields this specific courier actually declares (credentials.ts's
  // COURIER_CREDENTIAL_FIELDS) are ever read from the submitted form —
  // never trust an arbitrary posted field name.
  const updates: Record<string, string> = {};
  for (const field of COURIER_CREDENTIAL_FIELDS[courier]) {
    const raw = formData.get(field.key);
    if (typeof raw === "string" && raw.trim()) updates[field.key] = raw.trim();
  }

  try {
    await saveCourierCredentialFields(supabase, employee.currentCompanyId, courier, updates, employee.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, success: false };
  }

  revalidatePath("/dashboard/courier-booking");
  return { error: null, success: true };
}

// "Test connection" — Account Setup FedEx card ke andar (2026-09-17).
// FedEx-only for now: the ONLY courier with a real key-vs-account mismatch
// failure mode so far (the live 400 that motivated this — "Account number
// not found"), and the only one whose auth helper already takes per-company
// overrides cleanly. Other couriers can follow the same pattern later if
// their vendors misbehave the same way.
//
// WHY an action instead of a plain fetch from the browser: the resolved
// credentials must never leave the server, and the test must use EXACTLY
// what a real booking would use (resolveCourierCredentials — DB first,
// env fallback per field), not whatever a form currently has typed in it.
// Cooldown note for reviewers: this calls FedEx's Rate API once per click;
// FedEx's published rate limits are generous for this, and the UI gates
// double-clicks while pending.
export type TestFedexConnectionState = {
  status: "idle" | "testing" | "ok" | "fail";
  message: string | null;
  keySource: "company" | "shared-env" | "none" | null;
};

export async function testFedexConnectionAction(_prev: TestFedexConnectionState, formData: FormData): Promise<TestFedexConnectionState> {
  const employee = await requireCapability("courier_credentials_admin");
  const supabase = createServiceRoleClient();

  const courier = String(formData.get("courier") ?? "") as CourierKey;
  if (courier !== "fedex") return { status: "fail", message: "Connection test is FedEx-only right now.", keySource: null };

  try {
    const credentials = await resolveCourierCredentials(supabase, employee.currentCompanyId, "fedex");
    const result = await testFedexConnection(credentials);
    if (result.ok) {
      return {
        status: "ok",
        message: `✓ Works — FedEx accepted account ${result.accountMasked} with ${result.keySource === "company" ? "THIS company's own API key" : "the SHARED deployment API key (env var)"}. Bookings will use this same pair.`,
        keySource: result.keySource,
      };
    }
    return { status: "fail", message: result.error, keySource: null };
  } catch (err) {
    return { status: "fail", message: err instanceof Error ? err.message : "Test failed unexpectedly.", keySource: null };
  }
}

export type ClearCourierCredentialFieldState = { error: string | null; success: boolean };

// A single field can be explicitly cleared (e.g. a rotated/revoked secret)
// without touching every other saved field for that courier — separate
// from the main save action above, which treats a blank input as "leave
// unchanged" (see saveCourierCredentialFields's own doc comment for why).
export async function clearCourierCredentialFieldAction(
  _prev: ClearCourierCredentialFieldState,
  formData: FormData
): Promise<ClearCourierCredentialFieldState> {
  const employee = await requireCapability("courier_credentials_admin");
  const supabase = createServiceRoleClient();

  const courier = String(formData.get("courier") ?? "") as CourierKey;
  const fieldKey = String(formData.get("field_key") ?? "");
  if (!COURIER_KEYS.includes(courier)) return { error: "Unknown courier.", success: false };
  if (!COURIER_CREDENTIAL_FIELDS[courier].some((f) => f.key === fieldKey)) {
    return { error: "Unknown field.", success: false };
  }

  try {
    await saveCourierCredentialFields(supabase, employee.currentCompanyId, courier, { [fieldKey]: null }, employee.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, success: false };
  }

  revalidatePath("/dashboard/courier-booking");
  return { error: null, success: true };
}
