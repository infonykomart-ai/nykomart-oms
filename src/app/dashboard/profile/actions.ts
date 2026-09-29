"use server";

// 2026-09-12 — FedEx-style "My Profile" redesign, round 2. History:
// 2026-08-12: "sabhi ko apni profile update karne ka option ho" — every
// employee should be able to edit their OWN profile. Immediately clarified
// by the user: "acess change nahi kar skae bs persional informaiton" —
// access must stay locked; only personal-info fields are self-editable.
// Deliberately does NOT use requireCapability() — this page has no
// capability gate, any signed-in employee with an active row may reach it —
// but every DB write below is still hard-scoped `.eq("id", employee.id)`
// (the ID the SERVER read back from the session, never a client-supplied
// value), and role_id/company_id/active/employee_code/designation/
// date_of_joining/email/name are never in any scope's field list.
//
// The redesign splits the one long always-editable form into per-section
// EDIT modes (like FedEx's own profile sections). Each edit form posts a
// `scope` hidden field and the action ONLY writes that scope's columns —
// so a partial form can never blank out columns it doesn't render (the old
// always-all-fields action would have zeroed everything not in the DOM).
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit/log-audit";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

export type MyProfileFormState = {
  error: string | null;
  success: boolean;
};

export type ProfileScope = "personal" | "family" | "statutory" | "photo";

function strOrNull(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v ? v : null;
}

export async function updateMyProfile(_prev: MyProfileFormState, formData: FormData): Promise<MyProfileFormState> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const scope = (strOrNull(formData, "scope") ?? "personal") as ProfileScope;
  const maritalStatus = strOrNull(formData, "marital_status");

  // Only the submitted scope's columns land in the update — every other
  // column is untouched, exactly as if that section were the whole form.
  // (A union of object literals, no widening annotation — the typed
  // Supabase .update() below needs the exact column shape per branch.)
  const updates =
    scope === "personal"
      ? {
          whatsapp_no: strOrNull(formData, "whatsapp_no"),
          gender: strOrNull(formData, "gender") as never,
          marital_status: maritalStatus as never,
          dob: strOrNull(formData, "dob"),
          // Same server-side belt-and-braces as the admin form: only keep
          // anniversary_date if Married was actually submitted, regardless
          // of what the (hidden-when-Unmarried) field still held.
          anniversary_date: maritalStatus === "Married" ? strOrNull(formData, "anniversary_date") : null,
          photo_url: strOrNull(formData, "photo_url"),
        }
      : scope === "family"
        ? {
            family_contact_1_name: strOrNull(formData, "family_contact_1_name"),
            family_contact_1_relation: strOrNull(formData, "family_contact_1_relation"),
            family_contact_1_number: strOrNull(formData, "family_contact_1_number"),
            family_contact_2_name: strOrNull(formData, "family_contact_2_name"),
            family_contact_2_relation: strOrNull(formData, "family_contact_2_relation"),
            family_contact_2_number: strOrNull(formData, "family_contact_2_number"),
          }
        : scope === "statutory"
          ? {
              // 2026-09-11 payroll phase 1 columns — self-service from the
              // profile page so employees can fill their own PAN/bank
              // details for payslips (still self-scoped only).
              pan_number: strOrNull(formData, "pan_number"),
              uan_number: strOrNull(formData, "uan_number"),
              pf_number: strOrNull(formData, "pf_number"),
              esi_number: strOrNull(formData, "esi_number"),
              bank_account_holder_name: strOrNull(formData, "bank_account_holder_name"),
              bank_account_no: strOrNull(formData, "bank_account_no"),
              bank_ifsc: strOrNull(formData, "bank_ifsc"),
              bank_name: strOrNull(formData, "bank_name"),
            }
          : // "photo" — quick header camera-button save: photo_url only.
            { photo_url: strOrNull(formData, "photo_url") };

  const { error } = await supabase.from("employees").update(updates).eq("id", employee.id);

  if (error) return { error: error.message, success: false };

  await logAudit(supabase, {
    companyId: employee.homeCompanyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "profile.updated",
    entityType: "employee",
    entityId: employee.id,
    entityLabel: employee.name,
    changes: { scope },
  });

  revalidatePath("/dashboard/profile");
  // 2026-08-22 — "photo upload horahi lekin profile/messaging/header me
  // preview nahi aa raha": same fix as updateEmployeeDetails (admin/
  // employees/actions.ts) — photo_url is read independently by the shared
  // dashboard layout's header avatar (dashboard/layout.tsx, only refreshed
  // by revalidating "/dashboard" itself in "layout" mode — same pattern
  // switch-company.ts already uses) and the Messages page's own separate
  // employee query (messages/page.tsx). Without these, Next's client
  // router cache keeps showing the pre-edit photo everywhere except the
  // page just saved from.
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/messages");
  return { error: null, success: true };
}

// Same bucket + cap as the admin action (admin/employees/actions.ts) —
// reads need no auth (public bucket), writes only ever happen through a
// verified server action, exactly the same trust model.
const EMPLOYEE_PHOTO_BUCKET = "employee-photos";
const MAX_EMPLOYEE_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB — matches the admin cap

export async function uploadMyPhoto(formData: FormData): Promise<{ url: string | null; error: string | null }> {
  // Any signed-in employee may upload THEIR OWN photo — no employee_admin
  // gate here (that's the whole point vs uploadEmployeePhoto, which is
  // admin-only). The URL only lands on the row when Save runs, which is
  // hard-scoped to self.
  await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { url: null, error: "No file selected." };
  if (file.size > MAX_EMPLOYEE_PHOTO_BYTES) return { url: null, error: "File is too large — max 10MB." };
  if (!file.type.startsWith("image/")) return { url: null, error: "Please upload an image file." };

  const safeName = file.name.replace(/[^\w.\- ]/g, "_").slice(0, 150);
  const path = `${randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(path, buffer, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) return { url: null, error: `Upload failed: ${uploadError.message}` };

  const { data } = supabase.storage.from(EMPLOYEE_PHOTO_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export type ChangePasswordState = {
  error: string | null;
  success: boolean;
};

export async function changeMyPassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const sessionClient = await createClient();

  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!currentPassword || !newPassword) {
    return { error: "Enter your current and new password.", success: false };
  }
  if (newPassword.length < 8) {
    return { error: "New password must be at least 8 characters.", success: false };
  }
  if (newPassword !== confirmPassword) {
    return { error: "New password and confirmation do not match.", success: false };
  }
  if (newPassword === currentPassword) {
    return { error: "New password must be different from the current one.", success: false };
  }

  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  const email = user?.email;
  if (!email) return { error: "Could not confirm your login — please reload the page and try again.", success: false };

  // Verify the CURRENT password on a throwaway client (see the note above
  // changeMyPassword's peers in this file's history: must NOT touch the
  // session cookies, or AAL2 is lost and a 2FA user gets bounced to
  // /login/verify-2fa mid-save).
  const throwaway = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: verifyError } = await throwaway.auth.signInWithPassword({ email, password: currentPassword });
  if (verifyError) return { error: "Current password is incorrect.", success: false };

  const { error: updateError } = await sessionClient.auth.updateUser({ password: newPassword });
  if (updateError) return { error: updateError.message, success: false };

  await logAudit(supabase, {
    companyId: employee.homeCompanyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "auth.password_changed",
    entityType: "employee",
    entityId: employee.id,
    entityLabel: employee.name,
    changes: null,
  });

  return { error: null, success: true };
}
