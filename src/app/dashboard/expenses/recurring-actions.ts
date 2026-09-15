"use server";

// 2026-09-15 — "kuch payment auto debit hote hai credit card se — erank,
// etsy bill, ebay & other": registry actions for recurring card
// auto-debits. The registry (recurring_card_debits) records WHAT renews;
// logDueRecurringDebits turns every due subscription into a real
// internal_expenses row (stamped recurring_debit_id + recurring_month) so
// the P&L views pick it up unchanged. Idempotent per month via both the
// app cursor (last_logged_month) and the DB unique index
// uq_internal_expenses_recurring_month.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit/log-audit";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export type RecurringDebitState = { error: string | null; success: boolean };

export async function saveRecurringDebit(_prev: RecurringDebitState, formData: FormData): Promise<RecurringDebitState> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const vendorName = str(formData, "vendor_name");
  const category = str(formData, "category") || "Bank/Card Charges";
  const amountStr = str(formData, "amount");
  const dayOfMonth = Number(str(formData, "day_of_month"));

  if (!employee.companyIds.includes(companyId)) {
    return { error: "You do not have access to this company.", success: false };
  }
  if (!vendorName) return { error: "Vendor name is required (e.g. eRank, Etsy, eBay).", success: false };
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return { error: "Debit day must be 1–31.", success: false };
  }
  // amount optional (variable bills like Etsy) but if given must be > 0.
  const amount = amountStr ? Number(amountStr) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    return { error: "Amount must be a positive number (or leave blank for variable).", success: false };
  }

  // Duplicate vendor within the same company → update instead of fail
  // (editing the amount/day is the common case; UNIQUE(company_id,
  // lower(vendor_name)) would otherwise 23505).
  const { data: existing } = await supabase
    .from("recurring_card_debits")
    .select("id")
    .eq("company_id", companyId)
    .ilike("vendor_name", vendorName)
    .maybeSingle();

  const payload = {
    company_id: companyId,
    vendor_name: vendorName,
    category,
    amount,
    card_label: strOrNull(formData, "card_label"),
    day_of_month: dayOfMonth,
    active: str(formData, "active") !== "false",
    remark: strOrNull(formData, "remark"),
  };

  if (existing) {
    const { error } = await supabase.from("recurring_card_debits").update(payload).eq("id", existing.id);
    if (error) return { error: error.message, success: false };
  } else {
    const { error } = await supabase.from("recurring_card_debits").insert({ ...payload, created_by_employee_id: employee.id });
    if (error) return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/expenses");
  return { error: null, success: true };
}

export async function deleteRecurringDebit(id: string): Promise<{ error: string | null }> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase.from("recurring_card_debits").select("id, company_id, vendor_name").eq("id", id).maybeSingle();
  if (!row) return { error: "Not found." };
  if (!employee.companyIds.includes(row.company_id)) {
    return { error: "You do not have access to this entry." };
  }

  const { error } = await supabase.from("recurring_card_debits").delete().eq("id", id);
  if (error) return { error: error.message };

  await logAudit(supabase, {
    companyId: row.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "recurring_debit.deleted",
    entityType: "recurring_card_debit",
    entityId: id,
    entityLabel: row.vendor_name,
  });

  revalidatePath("/dashboard/expenses");
  return { error: null };
}

export async function toggleRecurringDebitActive(id: string, active: boolean): Promise<{ error: string | null }> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase.from("recurring_card_debits").select("id, company_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Not found." };
  if (!employee.companyIds.includes(row.company_id)) {
    return { error: "You do not have access to this entry." };
  }

  const { error } = await supabase.from("recurring_card_debits").update({ active }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/expenses");
  return { error: null };
}

export type LogDueResult = {
  error: string | null;
  logged: { vendor: string; month: string; amount: number }[] | null;
};

// Day-of-month clamp: months without day 31/30/29 debit on the LAST day.
function effectiveDueDay(year: number, month0: number, day: number): number {
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return Math.min(day, lastDay);
}

export async function logDueRecurringDebits(companyId: string): Promise<LogDueResult> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  if (!employee.companyIds.includes(companyId)) {
    return { error: "You do not have access to this company.", logged: null };
  }

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const todayDay = now.getDate();

  const { data: registry, error } = await supabase
    .from("recurring_card_debits")
    .select("id, vendor_name, category, amount, day_of_month, last_logged_month")
    .eq("company_id", companyId)
    .eq("active", true);
  if (error) return { error: error.message, logged: null };

  const logged: { vendor: string; month: string; amount: number }[] = [];
  const skippedAlready = 0;
  const notYetDue = 0;

  for (const r of registry ?? []) {
    if (r.last_logged_month === month) {
      // already logged this month
      void skippedAlready;
      continue;
    }
    const dueDay = effectiveDueDay(now.getFullYear(), now.getMonth(), r.day_of_month);
    if (todayDay < dueDay) {
      void notYetDue;
      continue;
    }
    // Amount: expected amount; variable (NULL) rows log at 0 and the user
    // edits the internal_expenses row — better than silently skipping.
    const amount = r.amount ?? 0;

    const { data: expense, error: insertError } = await supabase
      .from("internal_expenses")
      .insert({
        company_id: companyId,
        expense_date: `${month}-${String(dueDay).padStart(2, "0")}`,
        category: r.category,
        amount_inr: amount,
        payment_mode: "Credit Card (auto-debit)",
        remark: `Auto-debit — ${r.vendor_name} (${month})`,
        recurring_debit_id: r.id,
        recurring_month: month,
        created_by_employee_id: employee.id,
      })
      .select("id")
      .single();
    if (insertError) {
      // Unique index hit (another tab already logged it) → not an error.
      if (insertError.code === "23505") continue;
      return { error: insertError.message, logged: logged.length ? logged : null };
    }

    await supabase.from("recurring_card_debits").update({ last_logged_month: month }).eq("id", r.id);
    if (expense) logged.push({ vendor: r.vendor_name, month, amount });
  }

  if (logged.length > 0) {
    await logAudit(supabase, {
      companyId,
      employeeId: employee.id,
      employeeName: employee.name,
      action: "recurring_debit.logged",
      entityType: "internal_expense",
      entityId: null,
      entityLabel: logged.map((l) => `${l.vendor} ₹${l.amount}`).join(", "),
    });
  }

  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/crm");
  return { error: null, logged };
}
