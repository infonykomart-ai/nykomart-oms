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
import { logAudit } from "@/lib/audit/log-audit";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
// 2026-09-30 — one-click Telegram Test per employee row (see
// testEmployeeTelegram at the bottom of this file). The connection badge
// on the page reflects employees.telegram_chat_id directly (this file is
// "use server" — only async actions may be exported from it). Punch
// notifications moved WhatsApp → Telegram this same day (user choice:
// "WhatsApp: Band — sirf Telegram").
import { sendTestTelegram } from "@/lib/attendance/telegram-notify";

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
// field set/validation applies whether you're filling this in on day one or
// backfilling it later for one of the 15 employees who already existed
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
    // 2026-09-11 (Payroll Phase 1) — statutory identity + bank details for
    // disbursement/payslips (see db/2026-09-11-payroll-ctc-structure-and-
    // statutory-fields.sql). Same shared/backfill pattern as the rest of
    // this function — optional, fill in per employee whenever it's known.
    pan_number: strOrNull(formData, "pan_number"),
    uan_number: strOrNull(formData, "uan_number"),
    pf_number: strOrNull(formData, "pf_number"),
    esi_number: strOrNull(formData, "esi_number"),
    bank_account_holder_name: strOrNull(formData, "bank_account_holder_name"),
    bank_account_no: strOrNull(formData, "bank_account_no"),
    bank_ifsc: strOrNull(formData, "bank_ifsc"),
    bank_name: strOrNull(formData, "bank_name"),
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

// ── 2026-09-15 — Role change (new) ─────────────────────────────────────────
// "agar kisi employe ka role change karenge to kaha se karenge abhi to koi
// option nahi hai" — until now a role could only be picked while CREATING a
// login (createEmployee's role_id select); there was no way to move an
// existing employee to a different role without editing the row by hand in
// Supabase. This action powers the inline "Role" dropdown in each row of
// the Employees page (employee-row-actions.tsx). Guards mirror the
// permissions page's lockout protection (toggleRoleCapability):
//   • you cannot demote yourself (you'd instantly lose employee_admin and
//     be locked out of this very screen), and
//   • you cannot move the last remaining employee_admin-capable employee
//     off an admin-capable role.
export async function changeEmployeeRole(employeeId: string, newRoleId: string): Promise<{ error: string | null }> {
  const me = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  if (employeeId === me.id) {
    return { error: "You cannot change your own role — ask another Admin/MD to do it (prevents accidental lockout)." };
  }

  const [{ data: target }, { data: newRole }] = await Promise.all([
    supabase.from("employees").select("id, name, role_id").eq("id", employeeId).maybeSingle(),
    supabase.from("roles").select("id, name").eq("id", newRoleId).maybeSingle(),
  ]);
  if (!target) return { error: "Employee not found." };
  if (!newRole) return { error: "Selected role does not exist." };
  if (target.role_id === newRoleId) return { error: null }; // no-op, treat as success

  // Would the OLD role lose its last employee_admin holder?
  const { data: oldRoleCaps } = await supabase
    .from("role_capabilities")
    .select("capability_code")
    .eq("role_id", target.role_id)
    .eq("capability_code", "employee_admin");
  const oldRoleIsAdmin = (oldRoleCaps?.length ?? 0) > 0;

  const { data: newRoleCaps } = await supabase
    .from("role_capabilities")
    .select("capability_code")
    .eq("role_id", newRoleId)
    .eq("capability_code", "employee_admin");
  const newRoleIsAdmin = (newRoleCaps?.length ?? 0) > 0;

  if (oldRoleIsAdmin && !newRoleIsAdmin) {
    // Exclude the one being moved — after this change they can no longer
    // administer. countOtherActiveAdmins (defined with deleteEmployee
    // below) is shared between the two actions with this lockout concern.
    const remaining = await countOtherActiveAdmins(supabase, employeeId);
    if (remaining === 0) {
      return { error: `${newRole.name} has no Permissions access — this is the last Admin/MD employee, so the role cannot be changed (prevents lockout).` };
    }
  }

  const { error } = await supabase.from("employees").update({ role_id: newRoleId }).eq("id", employeeId);
  if (error) return { error: error.message };

  await logAudit(supabase, {
    employeeId: me.id,
    employeeName: me.name,
    action: "employee.role_changed",
    entityType: "employee",
    entityId: employeeId,
    entityLabel: target.name,
    changes: { role_id: { from: target.role_id, to: newRoleId } },
  });

  revalidatePath("/dashboard/admin/employees");
  return { error: null };
}

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
  const departmentId = str(formData, "department_id") || null;
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
  // 2026-10-02b — departments are per-company: reject a department id that
  // belongs to some other company before creating the auth user (the form
  // only offers the right ones; this guards a crafted submission).
  if (departmentId) {
    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("company_id", homeCompanyId)
      .maybeSingle();
    if (!dept) return { error: "Selected department doesn't belong to the home company.", success: null };
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
      department_id: departmentId,
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

/**
 * How many OTHER active employees still carry employee_admin (via their
 * role). Shared by changeEmployeeRole and deleteEmployee — moving the
 * last Admin/MD off an admin role or deleting them is a lockout either
 * way, so both ask this one question.
 */
async function countOtherActiveAdmins(
  supabase: ReturnType<typeof createServiceRoleClient>,
  excludeEmployeeId: string
): Promise<number> {
  const { data: adminRoleIds } = await supabase
    .from("role_capabilities")
    .select("role_id")
    .eq("capability_code", "employee_admin");
  const adminIds = new Set((adminRoleIds ?? []).map((r) => r.role_id));
  if (adminIds.size === 0) return 0;
  const { data: adminEmployees } = await supabase
    .from("employees")
    .select("id")
    .in("role_id", [...adminIds])
    .eq("active", true);
  return (adminEmployees ?? []).filter((e) => e.id !== excludeEmployeeId).length;
}

// ── 2026-10-13 — 🗑 Full DELETE of an employee entry ───────────────────────
// "uski entry ko delet or puri trah se edit karne ka option nahi hai" —
// the Deactivate/Activate toggle above only flips employees.active; this
// removes the row and its login outright. Deliberately guarded rather
// than free-for-all:
//
//   • employee_admin capability, and never yourself (instant lockout);
//   • never the last active Admin/MD (same rule as changeEmployeeRole);
//   • anyone still listing this person as their manager blocks it — the
//     employees.reports_to_employee_id FK is NO ACTION, so Postgres would
//     reject the delete anyway; we just say it in human words first;
//   • ~96 OTHER columns reference employees(id) — orders, attendance,
//     salary, tasks, audit trail… (db/schema.sql). NONE cascade from
//     employees (only employee_company_access / employee_store_access /
//     companion_events do), so the database REFUSES a delete that would
//     detach business history from the person who entered/approved it.
//     We map that FK violation back to the tables actually holding rows
//     (EMPLOYEE_REFERENCE_PROBES) so the admin is told WHERE the history
//     is instead of getting a raw constraint name. An employee with no
//     such history — a mis-created entry — deletes cleanly in one click.
//
// Order matters: the employees-row delete goes FIRST because it is what
// proves the FK guards passed — destroying the auth login before it would
// lock a still-existing employee out if the delete then failed.

/** Tables (and the exact column) that block an employees delete, with a human label. */
type EmployeeRefTable =
  | "attendance"
  | "orders"
  | "tasks"
  | "daily_work_logs"
  | "employee_salary"
  | "salary_payments"
  | "employee_advances"
  | "employee_settlements"
  | "leave_requests"
  | "leave_balance_adjustments"
  | "employee_documents"
  | "employee_onboarding_progress"
  | "audit_log"
  | "exchange_rates"
  | "bill_pass_register"
  | "bill_pass_register_payments"
  | "bill_pass_register_adjustments"
  | "sales_invoices"
  | "order_refunds"
  | "hr_letters"
  | "entry_errors"
  | "work_plan_templates"
  | "store_ad_spend"
  | "finished_stock_movements"
  | "order_shipments"
  | "dispatch_invoices"
  | "internal_invoices"
  | "credit_notes"
  | "journal_vouchers"
  | "internal_expenses"
  | "recurring_card_debits"
  | "holidays"
  | "automation_rules"
  | "refunds";

const EMPLOYEE_REFERENCE_PROBES: { table: EmployeeRefTable; column: string; label: string }[] = [
  { table: "attendance", column: "employee_id", label: "Attendance" },
  { table: "orders", column: "entry_by_employee_id", label: "Orders entered" },
  { table: "tasks", column: "assigned_to_employee_id", label: "Tasks assigned to them" },
  { table: "tasks", column: "assigned_by_employee_id", label: "Tasks they assigned" },
  { table: "daily_work_logs", column: "employee_id", label: "Daily Work Reports" },
  { table: "employee_salary", column: "employee_id", label: "Salary structure" },
  { table: "salary_payments", column: "employee_id", label: "Salary payments" },
  { table: "employee_advances", column: "employee_id", label: "Advances" },
  { table: "employee_settlements", column: "employee_id", label: "Settlements" },
  { table: "leave_requests", column: "employee_id", label: "Leave requests" },
  { table: "leave_balance_adjustments", column: "employee_id", label: "Leave balance adjustments" },
  { table: "employee_documents", column: "employee_id", label: "Documents" },
  { table: "employee_onboarding_progress", column: "employee_id", label: "Onboarding progress" },
  { table: "audit_log", column: "employee_id", label: "Audit trail entries" },
  { table: "exchange_rates", column: "entered_by", label: "Exchange-rate entries" },
  { table: "bill_pass_register", column: "employee_id", label: "Bills on their name" },
  { table: "bill_pass_register", column: "payment_by_employee_id", label: "Bill payments made" },
  { table: "bill_pass_register_payments", column: "entered_by", label: "Bill payment entries" },
  { table: "bill_pass_register_adjustments", column: "created_by_employee_id", label: "Bill adjustments" },
  { table: "sales_invoices", column: "created_by_employee_id", label: "Sales invoices" },
  { table: "order_refunds", column: "entry_by_employee_id", label: "Order refunds" },
  { table: "hr_letters", column: "for_employee_id", label: "HR letters" },
  { table: "entry_errors", column: "raised_by_employee_id", label: "Entry-error reports" },
  { table: "work_plan_templates", column: "created_by", label: "Work plans" },
  { table: "store_ad_spend", column: "entry_by_employee_id", label: "Ad-spend entries" },
  { table: "finished_stock_movements", column: "entry_by_employee_id", label: "Stock movements" },
  { table: "order_shipments", column: "created_by_employee_id", label: "Shipments created" },
  { table: "dispatch_invoices", column: "case_handler_employee_id", label: "Dispatch invoices" },
  { table: "internal_invoices", column: "prepared_by_employee_id", label: "Internal invoices" },
  { table: "credit_notes", column: "created_by_employee_id", label: "Credit notes" },
  { table: "journal_vouchers", column: "created_by_employee_id", label: "Journal vouchers" },
  { table: "internal_expenses", column: "created_by_employee_id", label: "Internal expenses" },
  { table: "recurring_card_debits", column: "created_by_employee_id", label: "Recurring card debits" },
  { table: "holidays", column: "created_by_employee_id", label: "Holidays added" },
  { table: "automation_rules", column: "created_by_employee_id", label: "Automation rules" },
  { table: "refunds", column: "pass_by_employee_id", label: "Refunds passed" },
];

/**
 * Which curated references actually hold rows for this employee — only
 * ever called AFTER a 23503, so the happy path pays nothing. A blocking
 * table outside this list simply produces the generic message in
 * deleteEmployee (still accurate: something blocks it).
 */
async function findEmployeeReferenceBlocks(
  supabase: ReturnType<typeof createServiceRoleClient>,
  employeeId: string
): Promise<string[]> {
  const hits = await Promise.all(
    EMPLOYEE_REFERENCE_PROBES.map(async (p) => {
      const { count } = await supabase
        .from(p.table)
        .select("id", { count: "exact", head: true })
        .eq(p.column, employeeId);
      return (count ?? 0) > 0 ? `${p.label} (${count})` : null;
    })
  );
  return hits.filter((h): h is string => h !== null);
}

export async function deleteEmployee(employeeId: string): Promise<SimpleActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  if (!employeeId) return { error: "Employee missing.", success: false };
  if (employeeId === admin.id) {
    return { error: "You cannot delete your own entry — ask another Admin/MD to do it (prevents accidental lockout).", success: false };
  }

  const { data: target } = await supabase
    .from("employees")
    .select("id, name, email, role_id, auth_user_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (!target) return { error: "Employee not found — it may already be deleted.", success: false };

  // Last active Admin/MD?
  const { data: targetRoleCaps } = await supabase
    .from("role_capabilities")
    .select("capability_code")
    .eq("role_id", target.role_id)
    .eq("capability_code", "employee_admin");
  if ((targetRoleCaps?.length ?? 0) > 0 && (await countOtherActiveAdmins(supabase, employeeId)) === 0) {
    return {
      error: "This is the last active Admin/MD — Deactivate the entry instead (deleting would lock everyone out of this screen).",
      success: false,
    };
  }

  // Anyone still reporting to them? (NO ACTION FK — the delete below
  // would fail anyway; better to say why in human words up front.)
  const { count: reporterCount } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("reports_to_employee_id", employeeId);
  if ((reporterCount ?? 0) > 0) {
    return {
      error: `${reporterCount} employee(s) list this person as their manager — reassign them first (their Edit Details → Reports To).`,
      success: false,
    };
  }

  const { error: delError } = await supabase.from("employees").delete().eq("id", employeeId);
  if (delError) {
    if (delError.code === "23503") {
      const blockers = await findEmployeeReferenceBlocks(supabase, employeeId);
      return {
        error:
          blockers.length > 0
            ? `Cannot delete — this employee's history is linked to: ${blockers.join(", ")}. Keep the entry Deactivated instead (that is exactly what it is for).`
            : "Cannot delete — other records still reference this employee (orders / attendance / salary / audit history). Keep the entry Deactivated instead.",
        success: false,
      };
    }
    return { error: delError.message, success: false };
  }

  // Login SECOND — see header comment. Best-effort: without the employees
  // row the login can't reach any screen anymore (getAuthedEmployee
  // throws), so a failure here only ever leaves an orphaned auth user —
  // same reasoning as deleteEmployeeDocument's orphaned-Storage note.
  if (target.auth_user_id) {
    await supabase.auth.admin.deleteUser(target.auth_user_id);
  }

  // audit_log.entity_id is a plain uuid (no FK — see db/schema.sql), so
  // the record of THIS delete survives the row it describes.
  await logAudit(supabase, {
    employeeId: admin.id,
    employeeName: admin.name,
    action: "employee.deleted",
    entityType: "employee",
    entityId: employeeId,
    entityLabel: target.name,
    changes: { deleted: { email: target.email } },
  });

  revalidatePath("/dashboard/admin/employees");
  revalidatePath("/dashboard/admin/employees/org-chart");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/messages");
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
 *
 * 2026-10-13 — "uski entry ko delet or puri trah se edit karne ka option
 * nahi hai": the form now carries the IDENTITY block too — name, login
 * email, home company and company access — everything that until today
 * could only be changed by hand in Supabase. Same rules as
 * createEmployee: every value is re-validated server-side (nothing the
 * client sends is trusted), the denormalized employees.email stays in
 * sync with the auth login, and identity changes are audit-logged.
 */
export async function updateEmployeeDetails(_prev: EmployeeDetailsFormState, formData: FormData): Promise<EmployeeDetailsFormState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const employeeId = str(formData, "employee_id");
  if (!employeeId) return { error: "Employee missing.", success: false };

  // ── Identity block (2026-10-13) ──────────────────────────────────
  const name = str(formData, "name");
  const emailRaw = str(formData, "email").toLowerCase();
  const email = emailRaw ? emailRaw : null;
  const homeCompanyId = str(formData, "home_company_id");
  const accessCompanyIds = Array.from(new Set(formData.getAll("company_access").map(String).filter(Boolean)));

  if (!name) return { error: "Name is required.", success: false };
  if (!homeCompanyId) return { error: "Choose the home company.", success: false };
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return { error: "Email is not in a valid format.", success: false };

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("name, email, company_id, auth_user_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (!employeeRow) return { error: "Employee missing.", success: false };

  // A login NEEDS an address to keep working — a blank email is only
  // allowed for rows that never had one (the column is nullable by
  // design, see its comment in db/schema.sql).
  if (!email && employeeRow.auth_user_id) {
    return { error: "Email is required — this employee signs in with it.", success: false };
  }

  const finalCompanyIds = Array.from(new Set([homeCompanyId, ...accessCompanyIds]));
  const { data: realCompanies } = await supabase.from("companies").select("id").in("id", finalCompanyIds);
  if ((realCompanies ?? []).length !== finalCompanyIds.length) {
    return { error: "One of the selected companies doesn't exist.", success: false };
  }

  // ── Department + Reports To, validated against the NEW home company ──
  // (both selects are company-scoped in the form — re-checked here
  // because the submission could carry another company's values.)
  const departmentId = strOrNull(formData, "department_id");
  if (departmentId) {
    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("company_id", homeCompanyId)
      .maybeSingle();
    if (!dept) return { error: "Selected department doesn't belong to the chosen home company — re-pick it.", success: false };
  }

  // 2026-09-11 (Payroll Phase 3) — org chart. An employee can't report to
  // themselves (the form's own dropdown already excludes their own row,
  // but a crafted submission could still try it) — a self-reference would
  // otherwise render as an infinite loop on the Org Chart tree.
  const reportsToRaw = strOrNull(formData, "reports_to_employee_id");
  const reportsToEmployeeId = reportsToRaw === employeeId ? null : reportsToRaw;
  if (reportsToEmployeeId) {
    const { data: manager } = await supabase
      .from("employees")
      .select("id, company_id")
      .eq("id", reportsToEmployeeId)
      .maybeSingle();
    if (!manager || manager.company_id !== homeCompanyId) {
      return { error: "\"Reports To\" must be an employee in the same home company.", success: false };
    }
  }

  const { error } = await supabase
    .from("employees")
    .update({
      name,
      email,
      company_id: homeCompanyId,
      designation: strOrNull(formData, "designation"),
      // 2026-10-02b — structured department entity (validated above).
      department_id: departmentId,
      employee_code: strOrNull(formData, "employee_code"),
      date_of_joining: strOrNull(formData, "date_of_joining"),
      reports_to_employee_id: reportsToEmployeeId as never,
      ...profileFields(formData),
    })
    .eq("id", employeeId);

  if (error) {
    // Both uniques employees carries: email (global) and (company, name).
    if (error.code === "23505") {
      return {
        error: error.message.toLowerCase().includes("email")
          ? "That email already belongs to another employee."
          : "Another employee in this company already has this name.",
        success: false,
      };
    }
    return { error: error.message, success: false };
  }

  // ── Login email follows the displayed one ─────────────────────────
  // employees.email is a denormalized copy of the auth login (column
  // comment) — if they drift, everyone sees the new address but the
  // employee still signs in with the old one. The row is already saved
  // at this point, so a failure here is reported as exactly that state.
  const emailChanged = email !== (employeeRow.email ? employeeRow.email.toLowerCase() : null);
  if (emailChanged && email && employeeRow.auth_user_id) {
    const { error: authErr } = await supabase.auth.admin.updateUserById(employeeRow.auth_user_id, { email });
    if (authErr) {
      const msg = authErr.message.toLowerCase();
      if (msg.includes("already") || msg.includes("exist")) {
        return {
          error: "That email is already used by another login — the profile WAS saved, but the login still signs in with the old address. Pick a different email and save again.",
          success: false,
        };
      }
      return { error: `Profile saved, but the login email could not be updated (${authErr.message}) — try saving again.`, success: false };
    }
  }

  // ── Company access = replace with the ticked set ──────────────────
  // Home company is always included (server-derived, never trusted from
  // the client) — same delete-then-insert pattern as
  // updateEmployeeStoreAccess below.
  const { error: delAccessError } = await supabase
    .from("employee_company_access")
    .delete()
    .eq("employee_id", employeeId);
  if (delAccessError) return { error: `Company access could not be updated: ${delAccessError.message}`, success: false };
  const { error: insAccessError } = await supabase
    .from("employee_company_access")
    .insert(finalCompanyIds.map((company_id) => ({ employee_id: employeeId, company_id })));
  if (insAccessError) return { error: `Company access could not be updated: ${insAccessError.message}`, success: false };

  const identityChanges: Record<string, unknown> = {};
  if (name !== employeeRow.name) identityChanges.name = { from: employeeRow.name, to: name };
  if (emailChanged) identityChanges.email = { from: employeeRow.email, to: email };
  if (homeCompanyId !== employeeRow.company_id) identityChanges.home_company = { from: employeeRow.company_id, to: homeCompanyId };
  await logAudit(supabase, {
    employeeId: admin.id,
    employeeName: admin.name,
    action: "employee.updated",
    entityType: "employee",
    entityId: employeeId,
    entityLabel: name,
    changes: Object.keys(identityChanges).length > 0 ? identityChanges : null,
  });

  revalidatePath("/dashboard/admin/employees");
  revalidatePath("/dashboard/admin/employees/org-chart");
  // 2026-08-22 — "photo upload horahi lekin profile/messaging/header me
  // preview nahi aa raha": this update can change photo_url (or any other
  // profile field) for an employee OTHER than the admin submitting the
  // form. Two more places read employee photo_url independently of this
  // page: the shared dashboard layout's header avatar + its messaging
  // employee list (dashboard/layout.tsx — only refreshed by revalidating
  // "/dashboard" itself, "layout" mode, same pattern switch-company.ts
  // already uses for this exact reason), and the Messages page's own
  // separate employee query (messages/page.tsx). Without revalidating
  // those too, Next's client router cache keeps showing the pre-edit photo
  // on every page except the one just saved from, until an unrelated hard
  // reload happens to flush it.
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/messages");
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

// =============================================================================
// 2026-09-11 (Payroll Phase 3) — Employee Documents. ID proofs, signed
// letters, certificates, etc. per employee, stored in the PRIVATE
// "employee-documents" Storage bucket (see db/2026-09-11-core-hr-
// onboarding-orgchart-documents.sql) — unlike employee-photos, these can
// be sensitive, so unlike uploadEmployeePhoto's public bucket + direct
// public URL, downloads only ever go through the gated proxy route
// (/api/employee-document/[id]/route.ts), never a public/signed URL handed
// to the browser.
// =============================================================================

export type DocumentActionState = { error: string | null; success: boolean; message?: string };

const EMPLOYEE_DOCUMENTS_BUCKET = "employee-documents";
const MAX_EMPLOYEE_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15MB — a scanned certificate/ID can be a bit bigger than a photo

export async function uploadEmployeeDocument(_prev: DocumentActionState, formData: FormData): Promise<DocumentActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const employeeId = str(formData, "employee_id");
  const docType = str(formData, "doc_type");
  const notes = strOrNull(formData, "notes");
  const file = formData.get("file");

  if (!employeeId) return { error: "Employee missing.", success: false };
  if (!docType) return { error: "Document type is required (e.g. Aadhaar Card, PAN Card, Offer Letter).", success: false };
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose a file.", success: false };
  if (file.size > MAX_EMPLOYEE_DOCUMENT_BYTES) return { error: "File is too large — max 15MB.", success: false };

  const { data: emp, error: empError } = await supabase.from("employees").select("id, company_id").eq("id", employeeId).single();
  if (empError || !emp) return { error: "Employee not found.", success: false };
  // company_id is always derived from the employee row itself, never
  // trusted from the client — same guard as every other write in this app.
  if (!admin.companyIds.includes(emp.company_id)) return { error: "Employee not found.", success: false };

  const safeName = file.name.replace(/[^\w.\- ]/g, "_").slice(0, 150);
  const path = `${employeeId}/${randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from(EMPLOYEE_DOCUMENTS_BUCKET).upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadError) return { error: `Upload failed: ${uploadError.message}`, success: false };

  const { error } = await supabase.from("employee_documents").insert({
    employee_id: employeeId,
    company_id: emp.company_id,
    doc_type: docType,
    file_name: file.name,
    storage_path: path,
    mime_type: file.type || null,
    file_size: file.size,
    notes,
    uploaded_by_employee_id: admin.id,
  });
  if (error) {
    // The file itself already landed in Storage — clean it up rather than
    // leaving an orphaned object with no matching row (which would be
    // invisible everywhere but still counted in bucket storage).
    await supabase.storage.from(EMPLOYEE_DOCUMENTS_BUCKET).remove([path]);
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/admin/employees");
  return { error: null, success: true, message: `"${docType}" uploaded.` };
}

export async function deleteEmployeeDocument(documentId: string): Promise<DocumentActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const { data: doc, error: docError } = await supabase
    .from("employee_documents")
    .select("id, company_id, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (docError || !doc) return { error: "Document not found.", success: false };
  if (!admin.companyIds.includes(doc.company_id)) return { error: "Document not found.", success: false };

  const { error } = await supabase.from("employee_documents").delete().eq("id", documentId);
  if (error) return { error: error.message, success: false };

  // Best-effort — the DB row (the part every other read/permission check
  // actually relies on) is already gone even if this fails, so a failure
  // here is a harmless orphaned Storage object, not a data-integrity issue.
  await supabase.storage.from(EMPLOYEE_DOCUMENTS_BUCKET).remove([doc.storage_path]);

  revalidatePath("/dashboard/admin/employees");
  return { error: null, success: true };
}

// ── 2026-09-30 — Telegram reachability, made VISIBLE ───────────────────────
// "sabhi employe ke msg ... kisi ke msg gaya hai kisi ke nahi esa kyu check
// karo" — the punch-notification sender skips silently when an employee
// hasn't connected Telegram, so nobody could tell why a particular
// employee never got their message. Now on this page:
//   • a Telegram column with a per-row Connected / Not connected badge
//     (straight off employees.telegram_chat_id), and
//   • a one-click 🧪 Test button that fires a REAL Telegram DM to the chat
//     id as stored right now and returns what happened, verbatim.
// (Earlier the SAME day this cell was WhatsApp/Whapi — replaced wholesale
// when the punch channel switched: user's explicit "WhatsApp: Band — sirf
// Telegram".)
export type TelegramTestState = {
  ok: boolean;
  error?: string;
  to?: string;
};

export async function testEmployeeTelegram(employeeId: string): Promise<TelegramTestState> {
  await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();
  return sendTestTelegram({ supabase, employeeId });
}
