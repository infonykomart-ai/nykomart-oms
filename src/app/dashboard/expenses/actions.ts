"use server";

// Office/cash expenses (Gap 4 of the 2026-08-20 five-gaps plan — see
// claude/five-gaps-implementation-plan-2026-08-20.md and
// db/2026-08-20-internal-expenses.sql). Rent, electricity, fuel, and any
// other cost not tied to a purchase order or AWB. Category is a plain
// text column validated against EXPENSE_CATEGORIES below rather than a DB
// enum — matches how parties.party_type is handled elsewhere in this
// codebase, cheaper to extend later without a migration.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Fuel",
  "Internet/Phone",
  "Office Supplies",
  "Repairs & Maintenance",
  "Salary/Wages (Cash)",
  "Travel/Conveyance",
  "Bank/Card Charges",
  // 2026-08-20 — added per user request: P&L formula is
  // "sale value - (purchase + freight + duty + washing + store expense)
  // = net amount". Washing (rug/product washing before dispatch) and
  // Store Expense (day-to-day store/office running costs) had no home
  // anywhere in the schema — purchase_bills has zero rows for either,
  // and this internal_expenses table (the obvious fit — company-wide,
  // already subtracted in pl_dashboard_by_company_view/
  // pl_dashboard_by_month_view as total_internal_expenses_inr) was
  // completely empty. User confirmed: log both here going forward: no
  // SQL/view change needed, the P&L views already fold this table in.
  "Washing",
  "Store Expense",
  "Other",
] as const;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function numOrZero(formData: FormData, key: string): number {
  const v = str(formData, key);
  return v ? Number(v) : 0;
}

export type ExpenseFormState = { error: string | null; success: boolean };
const ok: ExpenseFormState = { error: null, success: true };
const fail = (error: string): ExpenseFormState => ({ error, success: false });

export async function saveExpenseAction(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const expenseDate = str(formData, "expense_date");
  const category = str(formData, "category");
  const amountInr = numOrZero(formData, "amount_inr");
  const paymentMode = str(formData, "payment_mode") || null;
  const remark = str(formData, "remark") || null;

  if (!companyId) return fail("Select a company.");
  if (!expenseDate) return fail("Date is required.");
  if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
    return fail("Select a valid category.");
  }
  if (amountInr <= 0) return fail("Amount must be greater than 0.");

  // Defense-in-depth — the Company dropdown is already scoped to
  // employee.companyIds client-side, but the client can be tampered with,
  // so re-check server-side too (same pattern as every other module's
  // server action in this codebase, e.g. ad-spend's store ownership check).
  if (!employee.companyIds.includes(companyId)) {
    return fail("You do not have access to this company.");
  }

  const { error } = await supabase.from("internal_expenses").insert({
    company_id: companyId,
    expense_date: expenseDate,
    category,
    amount_inr: amountInr,
    payment_mode: paymentMode,
    remark,
    created_by_employee_id: employee.id,
  });

  if (error) return fail(`Failed to save: ${error.message}`);
  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/crm");
  return ok;
}

export type SimpleResult = { error: string | null };

export async function deleteExpenseAction(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase.from("internal_expenses").select("id, company_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Entry not found." };
  if (!employee.companyIds.includes(row.company_id)) {
    return { error: "You do not have access to this entry." };
  }

  const { error } = await supabase.from("internal_expenses").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/crm");
  return { error: null };
}
