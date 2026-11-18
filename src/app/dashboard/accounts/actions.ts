"use server";

// 2026-11-18b — Server Actions for Purchase & Accounts (Phase 1).
//
// Every action: capability check FIRST, then company scope, then the pure
// validators (src/lib/accounts/*), then the write. Nothing is trusted from the
// client. Posting to the ledger goes through the database function
// fin_post_expense_voucher() so the journal and the status change happen in one
// transaction (see src/lib/accounts/post.ts).
//
// Form actions that are plain <form action={…}> redirect back to the tab with
// ?ok= / ?error=; the entry form uses useActionState and returns its state.

import { requireAnyCapability, requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { logAudit } from "@/lib/audit/log-audit";
import { validateBusinessDate } from "@/lib/fy-date";
import { calculateVoucher } from "@/lib/accounts/expense-calc";
import { buildExpenseJournalLines } from "@/lib/accounts/journal";
import { resolveJournalAccounts, postVoucherById } from "@/lib/accounts/post";
import { toPaise, fromPaise } from "@/lib/accounts/money";
import { pettyCashBalance, canSpend } from "@/lib/accounts/petty-cash";
import { validateOpeningBalances } from "@/lib/accounts/opening-balances";
import {
  isValidGstin,
  resolveInterstate,
  validateVoucherHeader,
  type PaymentAccountInfo,
} from "@/lib/accounts/validation";
import { emptyExpenseFormState, type ExpenseFormState } from "@/lib/accounts/form-state";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

const PAGE = "/dashboard/accounts";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const value = str(formData, key);
  return value ? value : null;
}
function numOrNull(formData: FormData, key: string): number | null {
  const value = str(formData, key);
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
function bool(formData: FormData, key: string): boolean {
  const value = str(formData, key).toLowerCase();
  return value === "on" || value === "true" || value === "1" || value === "yes";
}

function finish(tab: string, message: string, isError = false): never {
  revalidatePath(PAGE);
  revalidatePath("/dashboard");
  const params = new URLSearchParams({ tab });
  params.set(isError ? "error" : "ok", message);
  redirect(`${PAGE}?${params.toString()}`);
}

/* -------------------------------------------------------------------------- */
/* Reading the entry form                                                      */
/* -------------------------------------------------------------------------- */

type RawItem = {
  description?: string;
  categoryId?: string | null;
  qty?: string | number | null;
  unit?: string | null;
  rate?: string | number | null;
  amount?: string | number | null;
  discount?: string | number | null;
  gstRate?: string | number | null;
  cessRate?: string | number | null;
  gstInclusive?: boolean;
  gstApplicable?: boolean;
  itcEligible?: boolean;
  ledgerAccountId?: string | null;
  costCentre?: string | null;
  remarks?: string | null;
};

type RawCharge = {
  chargeName?: string;
  amount?: string | number | null;
  gstRate?: string | number | null;
  isTaxable?: boolean;
  itcEligible?: boolean;
  ledgerAccountId?: string | null;
  allocationMethod?: "equal" | "quantity" | "weight" | "value" | "manual" | null;
};

function parseList<T>(formData: FormData, key: string): T[] {
  try {
    const parsed = JSON.parse(str(formData, key) || "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Upload                                                                      */
/* -------------------------------------------------------------------------- */

/** Best-effort receipt upload. A storage problem must never lose the voucher. */
async function uploadReceipt(
  supabase: ServiceClient,
  formData: FormData,
  companyId: string
): Promise<{ url: string | null; warning: string | null }> {
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) return { url: null, warning: null };
  if (file.size > 8 * 1024 * 1024) {
    return { url: null, warning: "Receipt is larger than 8 MB — the voucher was saved without it." };
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `${companyId}/${Date.now()}-${safeName}`;
  try {
    const { error } = await supabase.storage.from("expense-receipts").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) {
      return {
        url: null,
        warning: `Receipt could not be uploaded (${error.message}). Run the 2026-11-18b SQL once to create the expense-receipts bucket.`,
      };
    }
    const { data } = supabase.storage.from("expense-receipts").getPublicUrl(path);
    return { url: data.publicUrl, warning: null };
  } catch (e) {
    return { url: null, warning: e instanceof Error ? `Receipt upload failed: ${e.message}` : null };
  }
}

/* -------------------------------------------------------------------------- */
/* 1. Expense voucher entry                                                    */
/* -------------------------------------------------------------------------- */

export async function saveExpenseAction(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const employee = await requireAnyCapability("accounts_expense_entry", "accounts_setup");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  if (!companyId) return { ...emptyExpenseFormState, error: "Select a company." };
  if (!employee.companyIds.includes(companyId)) {
    return { ...emptyExpenseFormState, error: "You do not have access to this company." };
  }

  const voucherDate = str(formData, "voucher_date");
  const dateError = validateBusinessDate(voucherDate, "Voucher date");
  if (dateError) return { ...emptyExpenseFormState, error: dateError };
  const invoiceDate = strOrNull(formData, "invoice_date");
  if (invoiceDate) {
    const invoiceDateError = validateBusinessDate(invoiceDate, "Invoice date");
    if (invoiceDateError) return { ...emptyExpenseFormState, error: invoiceDateError };
  }

  const [{ data: settings }, { data: accountRows }, { data: categoryRows }] = await Promise.all([
    supabase.from("fin_settings").select("*").eq("company_id", companyId).maybeSingle(),
    supabase.from("fin_accounts").select("*").eq("company_id", companyId),
    supabase.from("expense_categories").select("*").or(`company_id.eq.${companyId},company_id.is.null`),
  ]);
  const accounts = accountRows ?? [];
  const categories = categoryRows ?? [];

  const rawItems = parseList<RawItem>(formData, "items");
  const rawCharges = parseList<RawCharge>(formData, "charges");
  if (rawItems.length === 0) {
    return { ...emptyExpenseFormState, error: "Add at least one expense line." };
  }

  const items = rawItems.map((item) => {
    const category = categories.find((c) => c.id === item.categoryId);
    return {
      description: String(item.description ?? ""),
      categoryId: item.categoryId ?? null,
      qty: item.qty ?? null,
      unit: item.unit ?? null,
      rate: item.rate ?? null,
      amount: item.amount ?? null,
      discount: item.discount ?? null,
      gstRate: item.gstRate ?? category?.default_gst_rate ?? 0,
      cessRate: item.cessRate ?? 0,
      gstInclusive: Boolean(item.gstInclusive),
      gstApplicable: item.gstApplicable ?? category?.gst_applicable ?? true,
      itcEligible: item.itcEligible ?? category?.itc_eligible ?? true,
      ledgerAccountId: item.ledgerAccountId ?? category?.ledger_account_id ?? null,
      costCentre: item.costCentre ?? strOrNull(formData, "cost_centre"),
      remarks: item.remarks ?? null,
    };
  });

  const vendorState = strOrNull(formData, "vendor_state");
  const placeOfSupply = strOrNull(formData, "place_of_supply") ?? settings?.home_state ?? null;
  const interstate = resolveInterstate({
    homeState: settings?.home_state,
    vendorState,
    placeOfSupply,
    override: bool(formData, "force_interstate"),
  });

  const calculation = calculateVoucher({
    items,
    charges: rawCharges,
    interstate,
    roundToRupee: settings?.round_to_rupee ?? false,
  });

  const paymentMode = str(formData, "payment_mode") || "Cash";
  const paymentAccountId = strOrNull(formData, "payment_account_id");
  const paymentAccountRow = accounts.find((a) => a.id === paymentAccountId);
  const paymentAccount: PaymentAccountInfo | null = paymentAccountRow
    ? {
        id: paymentAccountRow.id,
        name: paymentAccountRow.name,
        isCash: paymentAccountRow.is_cash,
        isBank: paymentAccountRow.is_bank,
        isPettyCash: paymentAccountRow.is_petty_cash,
        isCreditCard: paymentAccountRow.is_credit_card,
        active: paymentAccountRow.active,
      }
    : null;

  const paid = bool(formData, "paid");
  const header = validateVoucherHeader({
    expenseType: str(formData, "expense_type") || "Office Expense",
    paymentMode,
    voucherDate,
    invoiceDate,
    gstin: strOrNull(formData, "gstin"),
    vendorState,
    placeOfSupply,
    paid,
    paymentAccountId,
    paymentAccount,
    paymentReference: strOrNull(formData, "payment_reference"),
    upiReference: strOrNull(formData, "upi_reference"),
  });

  const fieldErrors = [...header.errors, ...calculation.errors];
  if (!calculation.valid || !header.valid) {
    return { ...emptyExpenseFormState, error: "Please fix the highlighted problems.", fieldErrors };
  }

  const upload = await uploadReceipt(supabase, formData, companyId);
  const intent = str(formData, "intent") === "submit" ? "submitted" : "draft";
  const now = new Date().toISOString();

  const { data: voucher, error: voucherError } = await supabase
    .from("expense_vouchers")
    .insert({
      company_id: companyId,
      voucher_date: voucherDate,
      expense_type: str(formData, "expense_type") || "Office Expense",
      department_id: strOrNull(formData, "department_id"),
      branch: strOrNull(formData, "branch"),
      cost_centre: strOrNull(formData, "cost_centre"),
      paid_to: strOrNull(formData, "paid_to"),
      party_id: strOrNull(formData, "party_id"),
      employee_id: strOrNull(formData, "employee_id"),
      invoice_no: strOrNull(formData, "invoice_no"),
      invoice_date: invoiceDate,
      gstin: strOrNull(formData, "gstin"),
      vendor_state: vendorState,
      place_of_supply: placeOfSupply,
      is_interstate: interstate,
      description: strOrNull(formData, "description"),
      remarks: strOrNull(formData, "remarks"),
      payment_mode: paymentMode,
      payment_account_id: paymentAccountId,
      payment_reference: strOrNull(formData, "payment_reference"),
      upi_reference: strOrNull(formData, "upi_reference"),
      payment_status: paid ? "paid" : "unpaid",
      attachment_url: upload.url ?? strOrNull(formData, "attachment_url"),
      gross_total: fromPaise(calculation.totals.grossPaise),
      discount_total: fromPaise(calculation.totals.discountPaise),
      taxable_total: fromPaise(calculation.totals.taxablePaise),
      cgst_total: fromPaise(calculation.totals.cgstPaise),
      sgst_total: fromPaise(calculation.totals.sgstPaise),
      igst_total: fromPaise(calculation.totals.igstPaise),
      cess_total: fromPaise(calculation.totals.cessPaise),
      charges_total: fromPaise(calculation.totals.chargesPaise),
      non_gst_total: fromPaise(calculation.totals.nonGstPaise),
      itc_total: fromPaise(calculation.totals.itcPaise),
      round_off: fromPaise(calculation.totals.roundOffPaise),
      grand_total: fromPaise(calculation.totals.grandTotalPaise),
      status: intent,
      submitted_at: intent === "submitted" ? now : null,
      submitted_by_employee_id: intent === "submitted" ? employee.id : null,
      created_by_employee_id: employee.id,
    })
    .select("id, voucher_no")
    .single();

  if (voucherError || !voucher) {
    const duplicate = /duplicate key/i.test(voucherError?.message ?? "");
    return {
      ...emptyExpenseFormState,
      error: duplicate
        ? "This vendor invoice number is already entered for this company and vendor — a duplicate bill was prevented."
        : `Could not save the voucher: ${voucherError?.message ?? "unknown error"}`,
    };
  }

  const itemRows = calculation.lines.map((line) => ({
    voucher_id: voucher.id,
    company_id: companyId,
    line_no: line.lineNo,
    description: line.description,
    category_id: line.categoryId,
    qty: line.qty,
    unit: line.unit,
    rate: line.rate,
    gross_amount: fromPaise(line.grossPaise),
    discount: fromPaise(line.discountPaise),
    taxable_value: fromPaise(line.taxablePaise),
    gst_rate: line.gstRate,
    cgst: fromPaise(line.cgstPaise),
    sgst: fromPaise(line.sgstPaise),
    igst: fromPaise(line.igstPaise),
    cess: fromPaise(line.cessPaise),
    gst_inclusive: line.gstInclusive,
    is_gst_applicable: line.gstApplicable,
    non_gst_amount: fromPaise(line.nonGstPaise),
    total_amount: fromPaise(line.totalPaise),
    ledger_account_id: line.ledgerAccountId,
    itc_eligible: line.itcEligible,
    cost_centre: line.costCentre,
    remarks: line.remarks,
  }));

  const { error: itemsError } = await supabase.from("expense_voucher_items").insert(itemRows);
  if (itemsError) {
    await supabase.from("expense_vouchers").delete().eq("id", voucher.id);
    return { ...emptyExpenseFormState, error: `Could not save the expense lines: ${itemsError.message}` };
  }

  if (calculation.charges.length > 0) {
    const chargeRows = calculation.charges.map((charge) => ({
      voucher_id: voucher.id,
      company_id: companyId,
      charge_name: charge.chargeName,
      amount: fromPaise(charge.amountPaise),
      gst_rate: charge.gstRate,
      cgst: fromPaise(charge.cgstPaise),
      sgst: fromPaise(charge.sgstPaise),
      igst: fromPaise(charge.igstPaise),
      is_taxable: charge.isTaxable,
      itc_eligible: charge.itcEligible,
      ledger_account_id: charge.ledgerAccountId,
      allocation_method: charge.allocationMethod,
      total_amount: fromPaise(charge.totalPaise),
    }));
    const { error: chargesError } = await supabase.from("expense_voucher_charges").insert(chargeRows);
    if (chargesError) {
      return {
        ...emptyExpenseFormState,
        error: `The voucher ${voucher.voucher_no ?? ""} was saved, but its additional charges failed: ${chargesError.message}`,
        voucherId: voucher.id,
      };
    }
  }

  await supabase.from("expense_voucher_events").insert({
    voucher_id: voucher.id,
    company_id: companyId,
    action: intent === "submitted" ? "submitted" : "created",
    from_status: null,
    to_status: intent,
    actor_employee_id: employee.id,
    actor_name: employee.name,
    reason: null,
  });

  await logAudit(supabase, {
    companyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: intent === "submitted" ? "expense_voucher.submitted" : "expense_voucher.created",
    entityType: "expense_voucher",
    entityId: voucher.id,
    entityLabel: `${voucher.voucher_no ?? "Expense voucher"} — ₹${fromPaise(calculation.totals.grandTotalPaise).toFixed(2)}`,
  });

  revalidatePath(PAGE);
  revalidatePath("/dashboard");

  return {
    error: upload.warning,
    fieldErrors: [],
    success: true,
    voucherId: voucher.id,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Workflow: submit → approve/reject → post → pay → reverse                  */
/* -------------------------------------------------------------------------- */

async function loadVoucherForAction(supabase: ServiceClient, voucherId: string) {
  const { data: voucher } = await supabase.from("expense_vouchers").select("*").eq("id", voucherId).maybeSingle();
  return voucher ?? null;
}

export async function submitExpenseAction(formData: FormData): Promise<void> {
  const employee = await requireAnyCapability("accounts_expense_entry", "accounts_setup");
  const supabase = createServiceRoleClient();
  const voucherId = str(formData, "voucher_id");
  const voucher = await loadVoucherForAction(supabase, voucherId);
  if (!voucher) finish("expenses", "Voucher not found.", true);
  if (!employee.companyIds.includes(voucher.company_id)) finish("expenses", "You do not have access to this voucher.", true);
  if (!["draft", "rejected"].includes(voucher.status)) {
    finish("expenses", `Only a draft or rejected voucher can be submitted (this one is ${voucher.status}).`, true);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("expense_vouchers")
    .update({
      status: "submitted",
      submitted_at: now,
      submitted_by_employee_id: employee.id,
      rejection_reason: null,
      updated_at: now,
    })
    .eq("id", voucherId);
  if (error) finish("expenses", error.message, true);

  await supabase.from("expense_voucher_events").insert({
    voucher_id: voucherId,
    company_id: voucher.company_id,
    action: "submitted",
    from_status: voucher.status,
    to_status: "submitted",
    actor_employee_id: employee.id,
    actor_name: employee.name,
  });

  finish("expenses", `${voucher.voucher_no ?? "Voucher"} sent for admin approval.`);
}

export async function reviewExpenseAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_expense_approve");
  const supabase = createServiceRoleClient();
  const voucherId = str(formData, "voucher_id");
  const decision = str(formData, "decision") === "reject" ? "reject" : "approve";
  const reason = strOrNull(formData, "reason");

  const voucher = await loadVoucherForAction(supabase, voucherId);
  if (!voucher) finish("approvals", "Voucher not found.", true);
  if (!employee.companyIds.includes(voucher.company_id)) finish("approvals", "You do not have access to this voucher.", true);
  if (voucher.status !== "submitted") {
    finish("approvals", `Only a submitted voucher can be reviewed (this one is ${voucher.status}).`, true);
  }

  const { data: limits } = await supabase.from("fin_approval_limits").select("*").eq("company_id", voucher.company_id);
  const limit = (limits ?? []).find((l) => l.role_id === employee.roleId);
  if (voucher.created_by_employee_id === employee.id && !limit?.can_self_approve) {
    finish("approvals", "You cannot approve your own voucher. Another approver must review it.", true);
  }
  if (limit && Number(voucher.grand_total) > Number(limit.max_amount)) {
    finish(
      "approvals",
      `This voucher is ₹${Number(voucher.grand_total).toFixed(2)} and your approval limit is ₹${Number(limit.max_amount).toFixed(2)}.`,
      true
    );
  }

  const now = new Date().toISOString();
  if (decision === "reject") {
    if (!reason) finish("approvals", "Give a reason when rejecting a voucher.", true);
    const { error } = await supabase
      .from("expense_vouchers")
      .update({ status: "rejected", rejection_reason: reason, updated_at: now })
      .eq("id", voucherId);
    if (error) finish("approvals", error.message, true);
    await supabase.from("expense_voucher_events").insert({
      voucher_id: voucherId,
      company_id: voucher.company_id,
      action: "rejected",
      from_status: voucher.status,
      to_status: "rejected",
      actor_employee_id: employee.id,
      actor_name: employee.name,
      reason,
    });
    finish("approvals", `${voucher.voucher_no ?? "Voucher"} rejected.`);
  }

  const { error } = await supabase
    .from("expense_vouchers")
    .update({ status: "approved", approved_at: now, approved_by_employee_id: employee.id, updated_at: now })
    .eq("id", voucherId);
  if (error) finish("approvals", error.message, true);

  await supabase.from("expense_voucher_events").insert({
    voucher_id: voucherId,
    company_id: voucher.company_id,
    action: "approved",
    from_status: voucher.status,
    to_status: "approved",
    actor_employee_id: employee.id,
    actor_name: employee.name,
  });

  await logAudit(supabase, {
    companyId: voucher.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "expense_voucher.approved",
    entityType: "expense_voucher",
    entityId: voucherId,
    entityLabel: voucher.voucher_no ?? "Expense voucher",
  });

  finish("approvals", `${voucher.voucher_no ?? "Voucher"} approved — it can now be posted.`);
}

export async function postExpenseAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_expense_approve");
  const supabase = createServiceRoleClient();
  const voucherId = str(formData, "voucher_id");

  const voucher = await loadVoucherForAction(supabase, voucherId);
  if (!voucher) finish("expenses", "Voucher not found.", true);
  if (!employee.companyIds.includes(voucher.company_id)) finish("expenses", "You do not have access to this voucher.", true);
  if (voucher.status !== "approved") {
    finish("expenses", `Only an approved voucher can be posted (this one is ${voucher.status}).`, true);
  }

  const [{ data: items }, { data: charges }, { data: accounts }] = await Promise.all([
    supabase.from("expense_voucher_items").select("*").eq("voucher_id", voucherId).order("line_no"),
    supabase.from("expense_voucher_charges").select("*").eq("voucher_id", voucherId),
    supabase.from("fin_accounts").select("*").eq("company_id", voucher.company_id),
  ]);

  const result = await postVoucherById(
    supabase,
    employee.id,
    voucher,
    items ?? [],
    charges ?? [],
    accounts ?? []
  );
  if (result.error) finish("expenses", result.error, true);

  await logAudit(supabase, {
    companyId: voucher.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "expense_voucher.posted",
    entityType: "expense_voucher",
    entityId: voucherId,
    entityLabel: voucher.voucher_no ?? "Expense voucher",
  });

  finish(
    "expenses",
    `${voucher.voucher_no ?? "Voucher"} posted — ${result.entries ?? 0} ledger entries, ₹${((result.totalPaise ?? 0) / 100).toFixed(2)}.`
  );
}

export async function markExpensePaidAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_expense_approve");
  const supabase = createServiceRoleClient();
  const voucherId = str(formData, "voucher_id");
  const accountId = strOrNull(formData, "payment_account_id");
  const reference = strOrNull(formData, "payment_reference");

  const voucher = await loadVoucherForAction(supabase, voucherId);
  if (!voucher) finish("expenses", "Voucher not found.", true);
  if (!employee.companyIds.includes(voucher.company_id)) finish("expenses", "You do not have access to this voucher.", true);
  if (!["posted", "approved"].includes(voucher.status)) {
    finish("expenses", "Only a posted (or approved) voucher can be marked paid.", true);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("expense_vouchers")
    .update({
      payment_status: "paid",
      status: "paid",
      paid_at: now,
      payment_account_id: accountId ?? voucher.payment_account_id,
      payment_reference: reference ?? voucher.payment_reference,
      updated_at: now,
    })
    .eq("id", voucherId);
  if (error) finish("expenses", error.message, true);

  finish("expenses", `${voucher.voucher_no ?? "Voucher"} marked paid.`);
}

export async function reverseExpenseAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_setup");
  const supabase = createServiceRoleClient();
  const voucherId = str(formData, "voucher_id");
  const reason = str(formData, "reason");

  const voucher = await loadVoucherForAction(supabase, voucherId);
  if (!voucher) finish("expenses", "Voucher not found.", true);
  if (!employee.companyIds.includes(voucher.company_id)) finish("expenses", "You do not have access to this voucher.", true);
  if (reason.trim().length < 3) finish("expenses", "Write the reason for the reversal.", true);

  const { error } = await supabase.rpc("fin_reverse_expense_voucher", {
    p_voucher_id: voucherId,
    p_employee_id: employee.id,
    p_reason: reason.trim(),
  });
  if (error) finish("expenses", error.message, true);

  revalidatePath(PAGE);
  finish("expenses", `${voucher.voucher_no ?? "Voucher"} reversed — correction entries posted.`);
}

export async function deleteExpenseDraftAction(formData: FormData): Promise<void> {
  const employee = await requireAnyCapability("accounts_expense_entry", "accounts_setup");
  const supabase = createServiceRoleClient();
  const voucherId = str(formData, "voucher_id");

  const voucher = await loadVoucherForAction(supabase, voucherId);
  if (!voucher) finish("expenses", "Voucher not found.", true);
  if (!employee.companyIds.includes(voucher.company_id)) finish("expenses", "You do not have access to this voucher.", true);
  if (!["draft", "rejected"].includes(voucher.status)) {
    finish("expenses", "Only a draft or rejected voucher can be deleted — a posted voucher is corrected by reversal.", true);
  }

  const { error } = await supabase.from("expense_vouchers").delete().eq("id", voucherId);
  if (error) finish("expenses", error.message, true);

  await logAudit(supabase, {
    companyId: voucher.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "expense_voucher.deleted_draft",
    entityType: "expense_voucher",
    entityId: voucherId,
    entityLabel: voucher.voucher_no ?? "Draft voucher",
  });

  finish("expenses", "Draft voucher deleted.");
}

/* -------------------------------------------------------------------------- */
/* 3. Petty cash                                                               */
/* -------------------------------------------------------------------------- */

export async function savePettyCashAccountAction(formData: FormData): Promise<void> {
  const employee = await requireAnyCapability("accounts_expense_entry", "accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) finish("petty-cash", "You do not have access to this company.", true);

  const name = str(formData, "name");
  const ledgerAccountId = str(formData, "ledger_account_id");
  const opening = toPaise(str(formData, "opening_balance"));
  if (!name) finish("petty-cash", "Give the petty cash account a name.", true);
  if (!ledgerAccountId) finish("petty-cash", "Choose the ledger account this petty cash sits in.", true);
  if (!Number.isFinite(opening) || opening < 0) finish("petty-cash", "Opening balance must be zero or more.", true);

  const { error } = await supabase.from("petty_cash_accounts").insert({
    company_id: companyId,
    name,
    custodian_employee_id: strOrNull(formData, "custodian_employee_id"),
    ledger_account_id: ledgerAccountId,
    opening_balance: fromPaise(opening),
    float_limit: numOrNull(formData, "float_limit"),
  });
  if (error) finish("petty-cash", error.message, true);
  finish("petty-cash", `Petty cash account "${name}" created.`);
}

export async function addPettyCashTxnAction(formData: FormData): Promise<void> {
  const employee = await requireAnyCapability("accounts_expense_entry", "accounts_setup");
  const supabase = createServiceRoleClient();
  const accountId = str(formData, "petty_cash_account_id");
  const txnType = str(formData, "txn_type");
  const amount = toPaise(str(formData, "amount"));
  const txnDate = str(formData, "txn_date");

  const dateError = validateBusinessDate(txnDate, "Date");
  if (dateError) finish("petty-cash", dateError, true);
  if (!["allocation", "replenishment", "expense", "return", "verification"].includes(txnType)) {
    finish("petty-cash", "Choose a valid transaction type.", true);
  }
  if (!Number.isFinite(amount) || amount <= 0) finish("petty-cash", "Amount must be greater than zero.", true);

  const { data: account } = await supabase
    .from("petty_cash_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) finish("petty-cash", "Petty cash account not found.", true);
  if (!employee.companyIds.includes(account.company_id)) finish("petty-cash", "You do not have access to this account.", true);

  if (txnType === "expense") {
    const { data: txns } = await supabase
      .from("petty_cash_transactions")
      .select("txn_type, amount")
      .eq("petty_cash_account_id", accountId);
    const balance = pettyCashBalance(
      toPaise(account.opening_balance),
      (txns ?? []).map((t) => ({ txnType: t.txn_type as never, amountPaise: toPaise(t.amount) }))
    );
    if (!canSpend(balance.closingPaise, amount)) {
      finish(
        "petty-cash",
        `Not enough cash: closing balance is ₹${(balance.closingPaise / 100).toFixed(2)} and this expense is ₹${(amount / 100).toFixed(2)}.`,
        true
      );
    }
  }

  const { error } = await supabase.from("petty_cash_transactions").insert({
    company_id: account.company_id,
    petty_cash_account_id: accountId,
    txn_date: txnDate,
    txn_type: txnType,
    amount: fromPaise(amount),
    narration: strOrNull(formData, "narration"),
    created_by_employee_id: employee.id,
  });
  if (error) finish("petty-cash", error.message, true);
  finish("petty-cash", "Petty cash entry saved.");
}

/* -------------------------------------------------------------------------- */
/* 4. Categories                                                               */
/* -------------------------------------------------------------------------- */

export async function saveCategoryAction(formData: FormData): Promise<void> {
  const employee = await requireAnyCapability("accounts_expense_entry", "accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) finish("categories", "You do not have access to this company.", true);

  const name = str(formData, "name");
  if (!name) finish("categories", "Category name is required.", true);

  const { error } = await supabase.from("expense_categories").insert({
    company_id: companyId,
    name,
    group_name: str(formData, "group_name") || "Other",
    parent_id: strOrNull(formData, "parent_id"),
    ledger_account_id: strOrNull(formData, "ledger_account_id"),
    default_gst_rate: numOrNull(formData, "default_gst_rate") ?? 0,
    gst_applicable: bool(formData, "gst_applicable"),
    itc_eligible: bool(formData, "itc_eligible"),
    sort_order: numOrNull(formData, "sort_order") ?? 500,
  });
  if (error) {
    finish(
      "categories",
      /duplicate key/i.test(error.message) ? `"${name}" already exists in that group.` : error.message,
      true
    );
  }
  finish("categories", `Category "${name}" added.`);
}

export async function toggleCategoryAction(formData: FormData): Promise<void> {
  const employee = await requireAnyCapability("accounts_expense_entry", "accounts_setup");
  const supabase = createServiceRoleClient();
  const categoryId = str(formData, "category_id");
  const { data: category } = await supabase.from("expense_categories").select("*").eq("id", categoryId).maybeSingle();
  if (!category) finish("categories", "Category not found.", true);
  if (!category.company_id) {
    finish(
      "categories",
      "This is a shared default category. Add your own category with the same name to override it instead of disabling the shared one.",
      true
    );
  }
  if (!employee.companyIds.includes(category.company_id!)) {
    finish("categories", "You do not have access to this category.", true);
  }

  const { error } = await supabase
    .from("expense_categories")
    .update({ active: !category.active })
    .eq("id", categoryId);
  if (error) finish("categories", error.message, true);
  finish("categories", `"${category.name}" ${category.active ? "disabled" : "enabled"}.`);
}

/* -------------------------------------------------------------------------- */
/* 5. Employee reimbursement claims                                            */
/* -------------------------------------------------------------------------- */

export async function submitClaimAction(formData: FormData): Promise<void> {
  const employee = await requireAnyCapability("accounts_expense_entry", "accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) finish("claims", "You do not have access to this company.", true);

  const claimDate = str(formData, "claim_date");
  const dateError = validateBusinessDate(claimDate, "Claim date");
  if (dateError) finish("claims", dateError, true);
  const amount = toPaise(str(formData, "amount"));
  if (!Number.isFinite(amount) || amount <= 0) finish("claims", "Claim amount must be greater than zero.", true);
  const description = str(formData, "description");
  if (!description) finish("claims", "Describe what the claim is for.", true);

  const targetEmployeeId = strOrNull(formData, "employee_id") ?? employee.id;
  if (targetEmployeeId !== employee.id && !employee.capabilities.includes("accounts_setup")) {
    finish("claims", "Only an accounts admin can raise a claim for another employee.", true);
  }

  const fingerprint = createHash("sha256")
    .update(`${claimDate}|${amount}|${description.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);

  const { error } = await supabase.from("employee_expense_claims").insert({
    company_id: companyId,
    employee_id: targetEmployeeId,
    claim_date: claimDate,
    category_id: strOrNull(formData, "category_id"),
    description,
    amount: fromPaise(amount),
    receipt_url: strOrNull(formData, "receipt_url"),
    claim_fingerprint: fingerprint,
  });
  if (error) {
    finish(
      "claims",
      /duplicate key/i.test(error.message)
        ? "This claim looks like a duplicate — the same employee already claimed this date, amount and description."
        : error.message,
      true
    );
  }
  finish("claims", "Reimbursement claim submitted for review.");
}

export async function reviewClaimAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_expense_approve");
  const supabase = createServiceRoleClient();
  const claimId = str(formData, "claim_id");
  const decision = str(formData, "decision") === "reject" ? "reject" : "approve";
  const reason = strOrNull(formData, "reason");

  const { data: claim } = await supabase.from("employee_expense_claims").select("*").eq("id", claimId).maybeSingle();
  if (!claim) finish("claims", "Claim not found.", true);
  if (!employee.companyIds.includes(claim.company_id)) finish("claims", "You do not have access to this claim.", true);
  if (claim.status !== "submitted") finish("claims", `This claim is already ${claim.status}.`, true);
  if (decision === "reject" && !reason) finish("claims", "Give a reason when rejecting a claim.", true);

  const now = new Date().toISOString();
  if (decision === "reject") {
    const { error } = await supabase
      .from("employee_expense_claims")
      .update({ status: "rejected", reviewer_employee_id: employee.id, reviewed_at: now, rejection_reason: reason })
      .eq("id", claimId);
    if (error) finish("claims", error.message, true);
    finish("claims", "Claim rejected.");
  }

  // Approved → becomes payable: one APPROVED voucher of type Employee
  // Reimbursement, posted straight to the employee payable account so the
  // claim and the ledger cannot disagree.
  const { data: settings } = await supabase
    .from("fin_settings")
    .select("home_state")
    .eq("company_id", claim.company_id)
    .maybeSingle();
  const { data: accounts } = await supabase.from("fin_accounts").select("*").eq("company_id", claim.company_id);
  const mapping = resolveJournalAccounts(accounts ?? []);
  if (!mapping.accounts) {
    finish(
      "claims",
      `The chart of accounts is incomplete (${mapping.missing.join(", ")}). Open Accounts Setup first.`,
      true
    );
  }

  const { data: voucher, error: voucherError } = await supabase
    .from("expense_vouchers")
    .insert({
      company_id: claim.company_id,
      voucher_date: claim.claim_date,
      expense_type: "Employee Reimbursement",
      employee_id: claim.employee_id,
      paid_to: null,
      description: claim.description,
      payment_mode: "Other",
      payment_status: "unpaid",
      place_of_supply: settings?.home_state ?? null,
      is_interstate: false,
      gross_total: claim.amount,
      taxable_total: claim.amount,
      non_gst_total: claim.amount,
      grand_total: claim.amount,
      status: "approved",
      approved_at: now,
      approved_by_employee_id: employee.id,
      created_by_employee_id: employee.id,
    })
    .select("*")
    .single();
  if (voucherError || !voucher) finish("claims", voucherError?.message ?? "Could not create the payable.", true);

  const { data: item, error: itemError } = await supabase
    .from("expense_voucher_items")
    .insert({
      voucher_id: voucher.id,
      company_id: claim.company_id,
      line_no: 1,
      description: claim.description,
      category_id: claim.category_id,
      qty: null,
      unit: null,
      rate: null,
      gross_amount: claim.amount,
      taxable_value: claim.amount,
      total_amount: claim.amount,
      non_gst_amount: claim.amount,
      is_gst_applicable: false,
      ledger_account_id: null,
    })
    .select("*")
    .single();
  if (itemError || !item) finish("claims", itemError?.message ?? "Could not create the payable line.", true);

  const posted = await postVoucherById(supabase, employee.id, voucher, [item], [], accounts ?? []);
  if (posted.error) {
    // Keep the approved voucher so nothing is lost; the admin can post it from
    // the Expenses tab once the problem is fixed.
    await supabase
      .from("employee_expense_claims")
      .update({ status: "approved", reviewer_employee_id: employee.id, reviewed_at: now, approved_amount: claim.amount, voucher_id: voucher.id })
      .eq("id", claimId);
    finish(
      "claims",
      `Claim approved and its payable voucher created, but posting failed: ${posted.error}`,
      true
    );
  }

  await supabase
    .from("employee_expense_claims")
    .update({
      status: "approved",
      reviewer_employee_id: employee.id,
      reviewed_at: now,
      approved_amount: claim.amount,
      voucher_id: voucher.id,
    })
    .eq("id", claimId);

  await logAudit(supabase, {
    companyId: claim.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "employee_expense_claim.approved",
    entityType: "employee_expense_claim",
    entityId: claimId,
    entityLabel: `₹${Number(claim.amount).toFixed(2)} — ${claim.description}`,
  });

  finish("claims", `Claim approved — ₹${Number(claim.amount).toFixed(2)} now payable to the employee.`);
}

export async function markClaimPaidAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_expense_approve");
  const supabase = createServiceRoleClient();
  const claimId = str(formData, "claim_id");

  const { data: claim } = await supabase.from("employee_expense_claims").select("*").eq("id", claimId).maybeSingle();
  if (!claim) finish("claims", "Claim not found.", true);
  if (!employee.companyIds.includes(claim.company_id)) finish("claims", "You do not have access to this claim.", true);
  if (claim.status !== "approved") finish("claims", "Only an approved claim can be paid.", true);

  if (claim.voucher_id) {
    const { error: voucherError } = await supabase
      .from("expense_vouchers")
      .update({ payment_status: "paid", status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", claim.voucher_id);
    if (voucherError) finish("claims", voucherError.message, true);
  }

  const { error } = await supabase.from("employee_expense_claims").update({ status: "paid" }).eq("id", claimId);
  if (error) finish("claims", error.message, true);
  finish("claims", "Claim marked paid.");
}

/* -------------------------------------------------------------------------- */
/* 6. Setup: settings, financial years, accounts, opening balances, limits     */
/* -------------------------------------------------------------------------- */

export async function saveSettingsAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) finish("setup", "You do not have access to this company.", true);

  const gstin = strOrNull(formData, "gstin");
  if (gstin && !isValidGstin(gstin)) finish("setup", "That GSTIN is not valid (15 characters).", true);

  const { error } = await supabase.from("fin_settings").upsert(
    {
      company_id: companyId,
      legal_name: strOrNull(formData, "legal_name"),
      gstin,
      home_state: strOrNull(formData, "home_state"),
      round_to_rupee: bool(formData, "round_to_rupee"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );
  if (error) finish("setup", error.message, true);
  finish("setup", "Accounts settings saved.");
}

export async function saveFinancialYearAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) finish("setup", "You do not have access to this company.", true);

  const label = str(formData, "label");
  const start = str(formData, "start_date");
  const end = str(formData, "end_date");
  if (!/^\d{4}-\d{2}$/.test(label)) finish("setup", "Financial year label must look like 2026-27.", true);
  const startError = validateBusinessDate(start, "Start date");
  if (startError) finish("setup", startError, true);
  const endError = validateBusinessDate(end, "End date");
  if (endError) finish("setup", endError, true);
  if (end <= start) finish("setup", "End date must be after the start date.", true);

  const makeCurrent = bool(formData, "is_current");
  if (makeCurrent) {
    await supabase.from("fin_financial_years").update({ is_current: false }).eq("company_id", companyId);
  }

  const { error } = await supabase.from("fin_financial_years").upsert(
    {
      company_id: companyId,
      label,
      start_date: start,
      end_date: end,
      is_current: makeCurrent,
      is_locked: bool(formData, "is_locked"),
    },
    { onConflict: "company_id,label" }
  );
  if (error) finish("setup", error.message, true);
  finish("setup", `Financial year ${label} saved.`);
}

export async function saveAccountAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) finish("setup", "You do not have access to this company.", true);

  const name = str(formData, "name");
  const kind = str(formData, "kind");
  if (!name) finish("setup", "Account name is required.", true);
  if (!["cash", "bank", "petty", "card", "expense", "liability", "asset", "income", "equity"].includes(kind)) {
    finish("setup", "Choose what kind of account this is.", true);
  }

  const { data: existing } = await supabase.from("fin_accounts").select("code").eq("company_id", companyId);
  const code = str(formData, "code") || `9${String((existing?.length ?? 0) + 1).padStart(3, "0")}`;

  const isPaymentKind = ["cash", "bank", "petty", "card"].includes(kind);
  const accountType = (isPaymentKind ? "asset" : kind) as
    | "asset"
    | "liability"
    | "equity"
    | "income"
    | "expense";

  const { error } = await supabase.from("fin_accounts").insert({
    company_id: companyId,
    code,
    name,
    account_type: accountType,
    account_group: strOrNull(formData, "account_group") ?? (isPaymentKind ? "Cash & Bank" : null),
    is_cash: kind === "cash",
    is_bank: kind === "bank",
    is_petty_cash: kind === "petty",
    is_credit_card: kind === "card",
    bank_recon_account_id: strOrNull(formData, "bank_recon_account_id"),
    upi_handle: strOrNull(formData, "upi_handle"),
  });
  if (error) {
    finish("setup", /duplicate key/i.test(error.message) ? "That code or name is already used." : error.message, true);
  }
  finish("setup", `Account "${name}" added.`);
}

export async function seedDefaultAccountsAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) finish("setup", "You do not have access to this company.", true);

  const { data, error } = await supabase.rpc("fin_seed_default_accounts", { p_company_id: companyId });
  if (error) finish("setup", error.message, true);
  finish("setup", `Default chart of accounts ensured (${data ?? 0} new accounts).`);
}

export async function saveOpeningBalancesAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  const financialYearId = str(formData, "financial_year_id");
  if (!employee.companyIds.includes(companyId)) finish("setup", "You do not have access to this company.", true);
  if (!financialYearId) finish("setup", "Choose the financial year these opening balances belong to.", true);

  const { data: year } = await supabase
    .from("fin_financial_years")
    .select("*")
    .eq("id", financialYearId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!year) finish("setup", "Financial year not found for this company.", true);

  const accountIds = formData.getAll("account_id[]").map((v) => String(v));
  const debits = formData.getAll("debit[]").map((v) => toPaise(String(v)));
  const credits = formData.getAll("credit[]").map((v) => toPaise(String(v)));

  const rows = accountIds
    .map((accountId, index) => ({
      accountId,
      debitPaise: Number.isFinite(debits[index]) ? debits[index] : 0,
      creditPaise: Number.isFinite(credits[index]) ? credits[index] : 0,
    }))
    .filter((row) => row.accountId && (row.debitPaise > 0 || row.creditPaise > 0));

  const validation = validateOpeningBalances(rows, year.is_locked);
  if (!validation.valid) finish("setup", validation.errors.join(" "), true);

  // Replace this FY's opening balances in one go — setup is editable until it
  // is posted, and the post function refuses a second posting.
  const { error: deleteError } = await supabase
    .from("fin_opening_balances")
    .delete()
    .eq("company_id", companyId)
    .eq("financial_year_id", financialYearId);
  if (deleteError) finish("setup", deleteError.message, true);

  const { error } = await supabase.from("fin_opening_balances").insert(
    validation.rows.map((row) => ({
      company_id: companyId,
      financial_year_id: financialYearId,
      account_id: row.accountId,
      debit: fromPaise(row.debitPaise),
      credit: fromPaise(row.creditPaise),
      created_by_employee_id: employee.id,
    }))
  );
  if (error) finish("setup", error.message, true);

  finish(
    "setup",
    `Opening balances saved — debit ₹${(validation.debitTotalPaise / 100).toFixed(2)} = credit ₹${(validation.creditTotalPaise / 100).toFixed(2)}.`
  );
}

export async function postOpeningBalancesAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  const financialYearId = str(formData, "financial_year_id");
  if (!employee.companyIds.includes(companyId)) finish("setup", "You do not have access to this company.", true);

  const { error } = await supabase.rpc("fin_post_opening_balances", {
    p_company_id: companyId,
    p_financial_year_id: financialYearId,
    p_employee_id: employee.id,
  });
  if (error) finish("setup", error.message, true);

  await logAudit(supabase, {
    companyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "opening_balances.posted",
    entityType: "fin_opening_balances",
    entityId: financialYearId,
    entityLabel: "Opening balances posted to the ledger",
  });

  finish("setup", "Opening balances posted to the ledger.");
}

export async function saveApprovalLimitAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) finish("setup", "You do not have access to this company.", true);

  const roleId = str(formData, "role_id");
  const maxAmount = toPaise(str(formData, "max_amount"));
  if (!roleId) finish("setup", "Choose a role.", true);
  if (!Number.isFinite(maxAmount) || maxAmount < 0) finish("setup", "Approval limit must be zero or more.", true);

  const { error } = await supabase.from("fin_approval_limits").upsert(
    {
      company_id: companyId,
      role_id: roleId,
      max_amount: fromPaise(maxAmount),
      can_self_approve: bool(formData, "can_self_approve"),
    },
    { onConflict: "company_id,role_id" }
  );
  if (error) finish("setup", error.message, true);
  finish("setup", "Approval limit saved.");
}

/* -------------------------------------------------------------------------- */
/* 7. Posting preview (read-only, used by the entry form's accounting tab)     */
/* -------------------------------------------------------------------------- */

export async function previewExpensePostingAction(formData: FormData): Promise<{
  error: string | null;
  lines: Array<{ account: string; debit: number; credit: number; narration: string }>;
  balanced: boolean;
  total: number;
}> {
  const employee = await requireAnyCapability("accounts_view", "accounts_expense_entry", "accounts_setup");
  const supabase = createServiceRoleClient();
  const companyId = str(formData, "company_id");
  if (!companyId || !employee.companyIds.includes(companyId)) {
    return { error: "You do not have access to this company.", lines: [], balanced: false, total: 0 };
  }

  const [{ data: accounts }, { data: categories }, { data: settings }] = await Promise.all([
    supabase.from("fin_accounts").select("*").eq("company_id", companyId),
    supabase.from("expense_categories").select("*").or(`company_id.eq.${companyId},company_id.is.null`),
    supabase.from("fin_settings").select("*").eq("company_id", companyId).maybeSingle(),
  ]);

  const mapping = resolveJournalAccounts(accounts ?? []);
  if (!mapping.accounts) {
    return { error: `Chart of accounts incomplete: ${mapping.missing.join(", ")}`, lines: [], balanced: false, total: 0 };
  }

  const rawItems = parseList<RawItem>(formData, "items");
  const rawCharges = parseList<RawCharge>(formData, "charges");
  const items = rawItems.map((item) => {
    const category = (categories ?? []).find((c) => c.id === item.categoryId);
    return {
      description: String(item.description ?? ""),
      categoryId: item.categoryId ?? null,
      qty: item.qty ?? null,
      unit: item.unit ?? null,
      rate: item.rate ?? null,
      amount: item.amount ?? null,
      discount: item.discount ?? null,
      gstRate: item.gstRate ?? category?.default_gst_rate ?? 0,
      gstInclusive: Boolean(item.gstInclusive),
      gstApplicable: item.gstApplicable ?? category?.gst_applicable ?? true,
      itcEligible: item.itcEligible ?? category?.itc_eligible ?? true,
      ledgerAccountId: item.ledgerAccountId ?? category?.ledger_account_id ?? null,
    };
  });

  const interstate = resolveInterstate({
    homeState: settings?.home_state,
    vendorState: strOrNull(formData, "vendor_state"),
    placeOfSupply: strOrNull(formData, "place_of_supply") ?? settings?.home_state,
    override: bool(formData, "force_interstate"),
  });
  const calculation = calculateVoucher({
    items,
    charges: rawCharges,
    interstate,
    roundToRupee: settings?.round_to_rupee ?? false,
  });
  if (!calculation.valid) {
    return { error: calculation.errors.join(" "), lines: [], balanced: false, total: 0 };
  }

  const journal = buildExpenseJournalLines({
    calculation,
    accounts: mapping.accounts,
    paymentAccountId: strOrNull(formData, "payment_account_id"),
    paid: bool(formData, "paid"),
    employeePayable: str(formData, "expense_type") === "Employee Reimbursement",
  });

  const nameById = new Map((accounts ?? []).map((a) => [a.id, `${a.code} · ${a.name}`]));
  return {
    error: journal.errors.length ? journal.errors.join(" ") : null,
    balanced: journal.balanced,
    total: journal.totalDebitPaise / 100,
    lines: journal.lines.map((line) => ({
      account: nameById.get(line.accountId) ?? line.accountId,
      debit: line.debitPaise / 100,
      credit: line.creditPaise / 100,
      narration: line.narration,
    })),
  };
}
