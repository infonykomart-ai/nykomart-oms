"use server";

// 2026-08-12: "sabhi ko apni profile update karne ka option ho" — every
// employee should be able to edit their OWN profile. Immediately clarified
// by the user: "acess change nahi kar skae bs persional informaiton" —
// access must stay locked; only the personal-info fields (the same
// Employee Master fieldset from 2026-08-07 — ProfileFields, shared with the
// admin "Edit Details" screen) are self-editable. Deliberately does NOT use
// requireCapability() — this page has no capability gate, any signed-in
// employee with an active row may reach it — but the DB write below is
// still hard-scoped `.eq("id", employee.id)` (the ID the SERVER read back
// from the session, never a client-supplied value) so there is no way for
// this action to ever touch a row other than the caller's own, let alone
// role_id/company_id/active/password_hash/employee_code/designation/
// date_of_joining/email/name, which this action never even lists.
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type MyProfileFormState = {
  error: string | null;
  success: boolean;
};

function strOrNull(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v ? v : null;
}

export async function updateMyProfile(_prev: MyProfileFormState, formData: FormData): Promise<MyProfileFormState> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const maritalStatus = strOrNull(formData, "marital_status");

  const { error } = await supabase
    .from("employees")
    .update({
      whatsapp_no: strOrNull(formData, "whatsapp_no"),
      gender: strOrNull(formData, "gender") as never,
      marital_status: maritalStatus as never,
      dob: strOrNull(formData, "dob"),
      // Same server-side belt-and-braces as the admin form: only keep
      // anniversary_date if Married was actually submitted, regardless of
      // what the (hidden-when-Unmarried) field on the client happened to
      // still hold.
      anniversary_date: maritalStatus === "Married" ? strOrNull(formData, "anniversary_date") : null,
      photo_url: strOrNull(formData, "photo_url"),
      family_contact_1_name: strOrNull(formData, "family_contact_1_name"),
      family_contact_1_relation: strOrNull(formData, "family_contact_1_relation"),
      family_contact_1_number: strOrNull(formData, "family_contact_1_number"),
      family_contact_2_name: strOrNull(formData, "family_contact_2_name"),
      family_contact_2_relation: strOrNull(formData, "family_contact_2_relation"),
      family_contact_2_number: strOrNull(formData, "family_contact_2_number"),
    })
    .eq("id", employee.id);

  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/profile");
  // 2026-08-22 — "photo upload horahi lekin profile/messaging/header me
  // preview nahi aa raha": same fix as updateEmployeeDetails (admin/
  // employees/actions.ts) — this can change photo_url, which two other
  // places read independently: the shared dashboard layout's header avatar
  // (dashboard/layout.tsx, only refreshed by revalidating "/dashboard"
  // itself in "layout" mode — same pattern switch-company.ts already uses)
  // and the Messages page's own separate employee query
  // (messages/page.tsx). Without these, Next's client router cache keeps
  // showing the pre-edit photo everywhere except the page just saved from.
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/messages");
  return { error: null, success: true };
}
