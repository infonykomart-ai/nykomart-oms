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
import { COURIER_CREDENTIAL_FIELDS, saveCourierCredentialFields, type CourierKey } from "@/lib/couriers/credentials";

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
