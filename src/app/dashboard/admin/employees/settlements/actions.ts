"use server";

// 2026-09-11 (Payroll Phase 4 — final phase) — Full & Final (FnF)
// Settlement. See db/2026-09-11-fnf-settlement.sql for the schema design
// and src/lib/attendance/settlement.ts for the reference math this UI
// shows alongside these actions (notice shortfall, gratuity estimate,
// leave balance). Gated by the SAME employee_admin capability as the rest
// of /dashboard/admin/employees — no new capability added.
//
// Deliberately conservative: every rupee on a settlement is a line item
// the admin explicitly adds via addSettlementLineItem — nothing here
// auto-computes and inserts a final amount. See employee_settlement_line_
// items' own comment for why.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type SettlementActionState = { error: string | null; success: boolean; message?: string };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

/** Opens a new Draft settlement for an employee. Only one in-progress (Draft/Finalized) settlement is allowed per employee at a time — enforced by a partial unique index in the DB. */
export async function initiateSettlement(_prev: SettlementActionState, formData: FormData): Promise<SettlementActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const employeeId = str(formData, "employee_id");
  const separationType = str(formData, "separation_type");
  const resignationDate = str(formData, "resignation_date");
  const lastWorkingDay = str(formData, "last_working_day");
  const reason = strOrNull(formData, "reason");
  const noticeRequired = Number(formData.get("notice_period_required_days") || 0);
  const noticeServed = Number(formData.get("notice_period_served_days") || 0);

  if (!employeeId) return { error: "Employee is required.", success: false };
  if (separationType !== "Resignation" && separationType !== "Termination") return { error: "Separation type is required.", success: false };
  if (!resignationDate || !lastWorkingDay) return { error: "Resignation date and Last Working Day are both required.", success: false };
  if (lastWorkingDay < resignationDate) return { error: "Last Working Day cannot be before the resignation date.", success: false };
  if (noticeRequired < 0 || noticeServed < 0) return { error: "Notice period days can't be negative.", success: false };

  const { data: emp, error: empError } = await supabase.from("employees").select("id, company_id").eq("id", employeeId).single();
  if (empError || !emp) return { error: "Employee not found.", success: false };
  if (!admin.companyIds.includes(emp.company_id)) return { error: "Employee not found.", success: false };

  const { data: settlement, error } = await supabase
    .from("employee_settlements")
    .insert({
      employee_id: employeeId,
      company_id: emp.company_id,
      separation_type: separationType as never,
      resignation_date: resignationDate,
      last_working_day: lastWorkingDay,
      reason,
      notice_period_required_days: noticeRequired,
      notice_period_served_days: noticeServed,
      initiated_by_employee_id: admin.id,
    })
    .select("id")
    .single();
  if (error || !settlement) {
    const msg = error?.code === "23505" ? "This employee already has an in-progress settlement." : error?.message;
    return { error: msg ?? "Failed to start settlement.", success: false };
  }

  revalidatePath("/dashboard/admin/employees/settlements");
  return { error: null, success: true, message: settlement.id };
}

/** Adds one line item (Addition or Deduction) to a Draft settlement. */
export async function addSettlementLineItem(_prev: SettlementActionState, formData: FormData): Promise<SettlementActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const settlementId = str(formData, "settlement_id");
  const kind = str(formData, "kind");
  const category = str(formData, "category");
  const description = strOrNull(formData, "description");
  const amount = Number(formData.get("amount"));

  if (!settlementId) return { error: "Settlement missing.", success: false };
  if (kind !== "Addition" && kind !== "Deduction") return { error: "Invalid line item kind.", success: false };
  if (!category) return { error: "Category is required.", success: false };
  if (!amount || amount <= 0) return { error: "Amount must be a positive number.", success: false };

  const { data: settlement, error: settlementError } = await supabase
    .from("employee_settlements")
    .select("id, company_id, status")
    .eq("id", settlementId)
    .maybeSingle();
  if (settlementError || !settlement) return { error: "Settlement not found.", success: false };
  if (!admin.companyIds.includes(settlement.company_id)) return { error: "Settlement not found.", success: false };
  if (settlement.status !== "Draft") return { error: "Line items can only be added while the settlement is still a Draft.", success: false };

  const { error } = await supabase.from("employee_settlement_line_items").insert({
    settlement_id: settlementId,
    kind: kind as never,
    category,
    description,
    amount,
    added_by_employee_id: admin.id,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath(`/dashboard/admin/employees/settlements/${settlementId}`);
  return { error: null, success: true };
}

export async function deleteSettlementLineItem(lineItemId: string): Promise<SettlementActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  // Plain queries rather than an embedded join — same convention as
  // require-capability.ts / leave/actions.ts's removeCoverage: the
  // hand-rolled Database type doesn't emit full Relationships metadata for
  // every join shape.
  const { data: item, error: itemError } = await supabase
    .from("employee_settlement_line_items")
    .select("id, settlement_id")
    .eq("id", lineItemId)
    .maybeSingle();
  if (itemError || !item) return { error: "Line item not found.", success: false };

  const { data: settlement } = await supabase.from("employee_settlements").select("company_id, status").eq("id", item.settlement_id).single();
  if (!settlement || !admin.companyIds.includes(settlement.company_id)) return { error: "Line item not found.", success: false };
  if (settlement.status !== "Draft") return { error: "Line items can only be removed while the settlement is still a Draft.", success: false };

  const { error } = await supabase.from("employee_settlement_line_items").delete().eq("id", lineItemId);
  if (error) return { error: error.message, success: false };

  revalidatePath(`/dashboard/admin/employees/settlements/${item.settlement_id}`);
  return { error: null, success: true };
}

/** Locks in the settlement — no more line items can be added/removed after this. Optionally also deactivates the employee's login. */
export async function finalizeSettlement(_prev: SettlementActionState, formData: FormData): Promise<SettlementActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const settlementId = str(formData, "settlement_id");
  const deactivateEmployee = str(formData, "deactivate_employee") === "true";
  if (!settlementId) return { error: "Settlement missing.", success: false };

  const { data: settlement, error: settlementError } = await supabase
    .from("employee_settlements")
    .select("id, employee_id, company_id, status")
    .eq("id", settlementId)
    .maybeSingle();
  if (settlementError || !settlement) return { error: "Settlement not found.", success: false };
  if (!admin.companyIds.includes(settlement.company_id)) return { error: "Settlement not found.", success: false };
  if (settlement.status !== "Draft") return { error: "Only a Draft settlement can be finalized.", success: false };

  const { data: lineItems } = await supabase.from("employee_settlement_line_items").select("id").eq("settlement_id", settlementId);
  if (!lineItems || lineItems.length === 0) {
    return { error: "Add at least one line item before finalizing.", success: false };
  }

  const { error } = await supabase
    .from("employee_settlements")
    .update({ status: "Finalized" as never, finalized_by_employee_id: admin.id, finalized_at: new Date().toISOString() })
    .eq("id", settlementId)
    .eq("status", "Draft"); // compare-and-swap, same double-decision guard as decideLeaveRequest
  if (error) return { error: error.message, success: false };

  if (deactivateEmployee) {
    await supabase.from("employees").update({ active: false }).eq("id", settlement.employee_id);
    revalidatePath("/dashboard/admin/employees");
  }

  revalidatePath(`/dashboard/admin/employees/settlements/${settlementId}`);
  revalidatePath("/dashboard/admin/employees/settlements");
  return { error: null, success: true, message: "Settlement finalized — no more line items can be added." };
}

/**
 * Records the settlement as actually PAID — the final, irreversible step.
 * Auto-mirrors into the Finance ledger (bill_pass_register), same pattern
 * every other real payment in this app (salary, advances) already follows.
 */
export async function recordSettlementPayment(_prev: SettlementActionState, formData: FormData): Promise<SettlementActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const settlementId = str(formData, "settlement_id");
  const paymentDate = str(formData, "payment_date");
  const remark = strOrNull(formData, "remark");
  if (!settlementId) return { error: "Settlement missing.", success: false };
  if (!paymentDate) return { error: "Payment date is required.", success: false };

  const { data: settlement, error: settlementError } = await supabase
    .from("employee_settlements")
    .select("id, employee_id, company_id, status")
    .eq("id", settlementId)
    .maybeSingle();
  if (settlementError || !settlement) return { error: "Settlement not found.", success: false };
  if (!admin.companyIds.includes(settlement.company_id)) return { error: "Settlement not found.", success: false };
  if (settlement.status !== "Finalized") return { error: "Only a Finalized settlement can be marked as paid.", success: false };

  const { data: emp } = await supabase.from("employees").select("name").eq("id", settlement.employee_id).single();
  const { data: lineItems } = await supabase.from("employee_settlement_line_items").select("kind, amount").eq("settlement_id", settlementId);
  const additions = (lineItems ?? []).filter((l) => l.kind === "Addition").reduce((sum, l) => sum + Number(l.amount), 0);
  const deductions = (lineItems ?? []).filter((l) => l.kind === "Deduction").reduce((sum, l) => sum + Number(l.amount), 0);
  const netAmount = Math.max(0, Math.round((additions - deductions) * 100) / 100);

  const { error } = await supabase
    .from("employee_settlements")
    .update({ status: "Paid" as never, payment_date: paymentDate, paid_by_employee_id: admin.id, remark })
    .eq("id", settlementId)
    .eq("status", "Finalized");
  if (error) return { error: error.message, success: false };

  // Auto-mirror into the Finance ledger — same "the payment IS the event"
  // pattern submitSalaryPayment/giveAdvance already use. Only recorded if
  // there's a real net amount to show (a settlement that nets to ₹0, e.g.
  // deductions fully offsetting additions, still gets marked Paid above,
  // but there's nothing meaningful to mirror as a ledger payment).
  if (netAmount > 0) {
    const { error: bprError } = await supabase.from("bill_pass_register").insert({
      company_id: settlement.company_id,
      invoice_type: "Salary", // no dedicated FnF invoice_type exists on bill_pass_register yet — "Salary" is the closest existing category for a payroll-adjacent payout to an employee
      invoice_date: paymentDate,
      invoice_recv_date: paymentDate,
      total_amt: netAmount,
      total_paid: netAmount,
      employee_id: settlement.employee_id,
      source: "employee_settlement",
      source_id: settlementId,
      remark: `Full & Final Settlement — ${emp?.name ?? "employee"}${remark ? ` — ${remark}` : ""}`,
    });
    if (bprError) {
      return { error: `Settlement marked Paid, but Finance ledger entry failed: ${bprError.message}`, success: true };
    }
  }

  revalidatePath(`/dashboard/admin/employees/settlements/${settlementId}`);
  revalidatePath("/dashboard/admin/employees/settlements");
  return { error: null, success: true, message: `Settlement for ${emp?.name ?? "employee"} marked as paid.` };
}

/** Abandons a Draft settlement (and its line items) — e.g. started by mistake, or the employee withdrew their resignation. */
export async function cancelSettlement(settlementId: string): Promise<SettlementActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const { data: settlement, error: settlementError } = await supabase
    .from("employee_settlements")
    .select("id, company_id, status")
    .eq("id", settlementId)
    .maybeSingle();
  if (settlementError || !settlement) return { error: "Settlement not found.", success: false };
  if (!admin.companyIds.includes(settlement.company_id)) return { error: "Settlement not found.", success: false };
  if (settlement.status !== "Draft") return { error: "Only a Draft settlement can be cancelled.", success: false };

  await supabase.from("employee_settlement_line_items").delete().eq("settlement_id", settlementId);
  const { error } = await supabase.from("employee_settlements").delete().eq("id", settlementId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/admin/employees/settlements");
  return { error: null, success: true };
}
