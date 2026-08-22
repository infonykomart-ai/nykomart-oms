"use server";

// Employee/login admin — implements pending feature item 12: "naye user
// banane ka, user ke password banane ka sabhi kaam add karo." Every action
// here is capability-gated to `employee_admin` (currently MD + Admin roles
// — see db/schema.sql's role_capabilities seed) and uses the Supabase Admin
// API (service-role only, NEVER exposed client-side) to create/manage the
// actual auth.users login alongside the employees row, exactly like
// db/2026-08-05-employee-setup.sql did by hand for the first 15 real
// employees.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

export type EmployeeFormState = {
  error: string | null;
  success: { email: string } | null;
};

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

// 2026-08-07: Employee Master expansion — shared by createEmployee (new
// login) and updateEmployeeDetails (existing employee) below, so the same
// field set/validation applies whether you're filling this in on day one
// or backfilling it later for one of the 15 employees who already existed
// before these columns did.
function profileFields(formData: FormData) {
  return {
    whatsapp_no: strOrNull(formData, "whatsapp_no"),
    gender: strOrNull(formData, "gender") as never,
    marital_status: strOrNull(formData, "marital_status") as never,
    dob: strOrNull(formData, "dob"),
    // anniversary_date only makes sense for Married — dropped even if the
    // client sent one for an Unmarried submission (form hides the field,
    // but never trust the client alone).
    anniversary_date: str(formData, "marital_status") === "Married" ? strOrNull(formData, "anniversary_date") : null,
    photo_url: strOrNull(formData, "photo_url"),
    family_contact_1_name: strOrNull(formData, "family_contact_1_name"),
    family_contact_1_relation: strOrNull(formData, "family_contact_1_relation"),
    family_contact_1_number: strOrNull(formData, "family_contact_1_number"),
    family_contact_2_name: strOrNull(formData, "family_contact_2_name"),
    family_contact_2_relation: strOrNull(formData, "family_contact_2_relation"),
    family_contact_2_number: strOrNull(formData, "family_contact_2_number"),
  };
}

// 2026-08-22 — "URL ki jagah upload ka option kar do": Photo field used to
// be a plain paste-a-link text input (same limitation orders.photo_url had
// before 2026-08-18 — see db/2026-08-18-order-photos-bucket.sql for that
// precedent). This is the employee-photos equivalent: uploads go to the
// 'employee-photos' Storage bucket (db/2026-08-22-employee-photos-bucket.sql,
// public — reads need no auth, writes only ever happen through this
// service-role action, gated the same as every other action in this file)
// and the resulting public URL is what actually gets saved into
// employees.photo_url by createEmployee/updateEmployeeDetails below — the
// column itself didn't change, only how it gets filled in.
const EMPLOYEE_PHOTO_BUCKET = "employee-photos";
const MAX_EMPLOYEE_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB — matches order-photos' cap

export async function uploadEmployeePhoto(formData: FormData): Promise<{ url: string | null; error: string | null }> {
  await requireCapability("employee_admin");
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

/**
 * Creates a brand-new employee login: a Supabase Auth user (email +
 * password) plus the linked `employees` row plus `employee_company_access`
 * grants for every company ticked in the form. All three happen together —
 * if the employees insert fails after the auth user was created, the
 * orphaned auth user is deleted so a retry doesn't hit "email already
 * registered".
 */
export async function createEmployee(_prev: EmployeeFormState, formData: FormData): Promise<EmployeeFormState> {
  await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const name = str(formData, "name");
  const email = str(formData, "email").toLowerCase();
  const password = str(formData, "password");
  const homeCompanyId = str(formData, "home_company_id");
  const roleId = str(formData, "role_id");
  const designation = str(formData, "designation") || null;
  const employeeCode = str(formData, "employee_code") || null;
  const dateOfJoining = str(formData, "date_of_joining") || null;
  const extraCompanyIds = formData.getAll("company_access").map(String).filter(Boolean);
  const storeAccessIds = formData.getAll("store_access").map(String).filter(Boolean);

  if (!name || !email || !password || !homeCompanyId || !roleId) {
    return { error: "Name, email, password, company, and role are all required.", success: null };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters.", success: null };
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { error: "Email is not in a valid format.", success: null };
  }

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !authUser?.user) {
    const msg = authError?.message ?? "";
    if (msg.toLowerCase().includes("already been registered") || msg.toLowerCase().includes("already exists")) {
      return { error: "This email is already in use by another login.", success: null };
    }
    return { error: `Could not create login: ${msg || "unknown error"}`, success: null };
  }

  const { data: employee, error: empError } = await supabase
    .from("employees")
    .insert({
      company_id: homeCompanyId,
      auth_user_id: authUser.user.id,
      name,
      email,
      role_id: roleId,
      designation,
      employee_code: employeeCode,
      date_of_joining: dateOfJoining,
      active: true,
      ...profileFields(formData),
    })
    .select("id")
    .single();

  if (empError || !employee) {
    // Roll back the orphaned auth user so the email is free to retry.
    await supabase.auth.admin.deleteUser(authUser.user.id);
    return { error: `Employee record could not be saved: ${empError?.message ?? "unknown error"}`, success: null };
  }

  const companyIds = Array.from(new Set([homeCompanyId, ...extraCompanyIds]));
  if (companyIds.length > 0) {
    await supabase
      .from("employee_company_access")
      .insert(companyIds.map((company_id) => ({ employee_id: employee.id, company_id })));
  }

  // 2026-08-08: store-scoped Ad Spend — which store(s) this new login is
  // actually assigned to work on. Optional (a role without ad_spend_entry
  // just never uses this), and separate from ad_spend_report_all logins
  // (Finance/MD/Admin/Higher Authority) which see every store regardless.
  const storeIds = Array.from(new Set(storeAccessIds));
  if (storeIds.length > 0) {
    await supabase
      .from("employee_store_access")
      .insert(storeIds.map((store_id) => ({ employee_id: employee.id, store_id })));
  }

  revalidatePath("/dashboard/admin/employees");
  return { error: null, success: { email } };
}

export type SimpleActionState = { error: string | null; success: boolean };

/** Toggles an employee between active and inactive — never a hard delete, so history (orders, documents, etc. tied to this employee) stays intact. Matches the existing `employees.active` column that login already checks. */
export async function setEmployeeActive(employeeId: string, active: boolean): Promise<SimpleActionState> {
  await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("employees").update({ active }).eq("id", employeeId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/admin/employees");
  return { error: null, success: true };
}

/** Sets a brand-new password for an existing employee's login — the in-app equivalent of resetting a forgotten password, previously only possible from the Supabase dashboard. */
export async function resetEmployeePassword(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const employeeId = str(formData, "employee_id");
  const password = str(formData, "password");
  if (!employeeId || !password) return { error: "Employee and new password are required.", success: false };
  if (password.length < 8) return { error: "Password must be at least 8 characters.", success: false };

  const { data: employee, error: lookupError } = await supabase
    .from("employees")
    .select("auth_user_id")
    .eq("id", employeeId)
    .single();
  if (lookupError || !employee?.auth_user_id) {
    return { error: "No login found for this employee.", success: false };
  }

  const { error } = await supabase.auth.admin.updateUserById(employee.auth_user_id, { password });
  if (error) return { error: error.message, success: false };

  return { error: null, success: true };
}

export type EmployeeDetailsFormState = { error: string | null; success: boolean };

/**
 * Backfills/edits the Employee Master profile fields (2026-08-07 round) on
 * an EXISTING employee — the 15 real employees created before these
 * columns existed all need this, not just brand-new logins going through
 * createEmployee above. Designation/employee code/date of joining are also
 * editable here since there was previously no way to fix a typo in those
 * without going into Supabase directly.
 */
export async function updateEmployeeDetails(_prev: EmployeeDetailsFormState, formData: FormData): Promise<EmployeeDetailsFormState> {
  await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const employeeId = str(formData, "employee_id");
  if (!employeeId) return { error: "Employee missing.", success: false };

  const { error } = await supabase
    .from("employees")
    .update({
      designation: strOrNull(formData, "designation"),
      employee_code: strOrNull(formData, "employee_code"),
      date_of_joining: strOrNull(formData, "date_of_joining"),
      ...profileFields(formData),
    })
    .eq("id", employeeId);

  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/admin/employees");
  return { error: null, success: true };
}

/**
 * Replaces an existing employee's store-scoping (employee_store_access) —
 * the "which store does this person work at" assignment behind the
 * 2026-08-08 Ad Spend scoping ask. Simple delete-then-insert of the
 * submitted set (never large — a handful of stores per employee at most),
 * same pattern as every other capability/permissions grid in this app.
 */
export async function updateEmployeeStoreAccess(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const employeeId = str(formData, "employee_id");
  if (!employeeId) return { error: "Employee missing.", success: false };
  const storeIds = Array.from(new Set(formData.getAll("store_access").map(String).filter(Boolean)));

  const { error: delError } = await supabase.from("employee_store_access").delete().eq("employee_id", employeeId);
  if (delError) return { error: delError.message, success: false };

  if (storeIds.length > 0) {
    const { error: insError } = await supabase
      .from("employee_store_access")
      .insert(storeIds.map((store_id) => ({ employee_id: employeeId, store_id })));
    if (insError) return { error: insError.message, success: false };
  }

  revalidatePath("/dashboard/admin/employees");
  revalidatePath("/dashboard/ad-spend");
  return { error: null, success: true };
}
