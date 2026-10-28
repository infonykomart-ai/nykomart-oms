"use server";

// Office/cash expenses (Gap 4 of the 2026-08-20 five-gaps plan — see
// claude/five-gaps-implementation-plan-2026-08-20.md and
// db/2026-08-20-internal-expenses.sql). Rent, electricity, fuel, and any
// other cost not tied to a purchase order or AWB. Category is a plain
// text column validated against EXPENSE_CATEGORIES below rather than a DB
// enum — matches how parties.party_type is handled elsewhere in this
// codebase, cheaper to extend later without a migration.
//
// 2026-10-28 — "office expense vale section ko jese purchase ki entry karte
// hai vese banao: multiple item, party ka naam, invoice no (if applicable),
// invoice date, edit / preview / delete option". One entry is now a BILL: a
// header (company, party, invoice no/date, payment mode, remark) plus any
// number of line items (category + description + amount), stored as one
// internal_expenses row per line sharing an entry_group_id — see
// db/2026-10-28-internal-expense-bills.sql for why one table, not two.
//
// Migration tolerance (db/MIGRATIONS.md): on a database where that patch has
// not been run, the writes retry WITHOUT the new columns instead of failing —
// so the screen keeps logging expenses one line at a time, exactly as before,
// until the SQL is run. See src/lib/db/missing-column.ts.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit/log-audit";
import { EXPENSE_CATEGORIES } from "./categories";
import { validateBusinessDate } from "@/lib/fy-date";
import { isMissingSchemaPiece } from "@/lib/db/missing-column";
import { randomUUID } from "node:crypto";

// NOTE: EXPENSE_CATEGORIES itself now lives in ./categories.ts, not here —
// see that file's header note (a "use server" file may only export async
// functions; this was a hard crash on every /dashboard/expenses load until
// fixed 2026-08-22). Imported here for the validation check below.

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export type ExpenseFormState = { error: string | null; success: boolean };
const ok: ExpenseFormState = { error: null, success: true };
const fail = (error: string): ExpenseFormState => ({ error, success: false });

/** One line of the bill, as the client sends it (`items` JSON field). */
type ExpenseItemInput = {
  id?: string | null;
  category?: string;
  description?: string | null;
  amount?: number | string | null;
};

type ParsedHeader = {
  companyId: string;
  expenseDate: string;
  partyId: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  paymentMode: string | null;
  remark: string | null;
};

function parseHeader(formData: FormData): { error: string | null; header: ParsedHeader | null } {
  const companyId = str(formData, "company_id");
  const expenseDate = str(formData, "expense_date");
  if (!companyId) return { error: "Select a company.", header: null };
  if (!expenseDate) return { error: "Date is required.", header: null };
  const dateError = validateBusinessDate(expenseDate, "Date");
  if (dateError) return { error: dateError, header: null };
  const invoiceDate = strOrNull(formData, "invoice_date");
  if (invoiceDate) {
    const invError = validateBusinessDate(invoiceDate, "Invoice date");
    if (invError) return { error: invError, header: null };
  }
  return {
    error: null,
    header: {
      companyId,
      expenseDate,
      partyId: strOrNull(formData, "party_id"),
      invoiceNo: strOrNull(formData, "invoice_no"),
      invoiceDate,
      paymentMode: strOrNull(formData, "payment_mode"),
      remark: strOrNull(formData, "remark"),
    },
  };
}

/** Parses + validates the `items` JSON field. Returns only valid lines. */
function parseItems(formData: FormData): ExpenseItemInput[] {
  let raw: unknown;
  try {
    raw = JSON.parse(str(formData, "items") || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: ExpenseItemInput[] = [];
  for (const r of raw as ExpenseItemInput[]) {
    const category = String(r?.category ?? "").trim();
    const amount = Number(r?.amount ?? 0);
    if (!category || !Number.isFinite(amount) || amount <= 0) continue;
    if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) continue;
    out.push({
      id: r?.id ? String(r.id) : null,
      category,
      description: String(r?.description ?? "").trim() || null,
      amount: Math.round(amount * 100) / 100,
    });
  }
  return out;
}

const NEW_COLUMNS_MESSAGE =
  "Office expense bills need the 2026-10-28 migration — run db/2026-10-28-internal-expense-bills.sql, then save again.";

/**
 * Creates one expense bill: every line inserted in ONE statement sharing a
 * fresh entry_group_id. If the database doesn't have the new columns yet, the
 * same lines are inserted through the legacy payload (one row each, no bill
 * header) so nothing the user typed is lost.
 */
export async function saveExpenseAction(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  const { error: headerError, header } = parseHeader(formData);
  if (headerError || !header) return fail(headerError ?? "Could not read the form.");
  const items = parseItems(formData);
  if (items.length === 0) return fail("Add at least one item with a category and an amount greater than 0.");

  // Defense-in-depth — the Company dropdown is already scoped to
  // employee.companyIds client-side, but the client can be tampered with, so
  // re-check server-side too (same pattern as every other module's action).
  if (!employee.companyIds.includes(header.companyId)) {
    return fail("You do not have access to this company.");
  }

  const entryGroupId = randomUUID();
  const payload = items.map((item) => ({
    company_id: header.companyId,
    expense_date: header.expenseDate,
    category: item.category!,
    amount_inr: Number(item.amount),
    payment_mode: header.paymentMode,
    remark: header.remark,
    created_by_employee_id: employee.id,
    party_id: header.partyId,
    invoice_no: header.invoiceNo,
    invoice_date: header.invoiceDate,
    description: item.description ?? null,
    entry_group_id: entryGroupId,
  }));

  const { error } = await supabase.from("internal_expenses").insert(payload);
  if (!error) {
    await logAudit(supabase, {
      companyId: header.companyId,
      employeeId: employee.id,
      employeeName: employee.name,
      action: "internal_expense.created",
      entityType: "internal_expense",
      entityId: entryGroupId,
      entityLabel: `${header.invoiceNo ?? "Office expense"} — ₹${items.reduce((s, i) => s + Number(i.amount), 0).toFixed(2)}`,
    });
    revalidatePath("/dashboard/expenses");
    revalidatePath("/dashboard/crm");
    return ok;
  }

  if (isMissingSchemaPiece(error)) {
    // Legacy fallback: this database predates the bill columns. Keep the
    // expense itself (that's the user's real data), just without the header.
    const legacy = items.map((item) => ({
      company_id: header.companyId,
      expense_date: header.expenseDate,
      category: item.category!,
      amount_inr: Number(item.amount),
      payment_mode: header.paymentMode,
      remark: [header.invoiceNo ? `Invoice ${header.invoiceNo}` : null, item.description, header.remark]
        .filter(Boolean)
        .join(" · ") || null,
      created_by_employee_id: employee.id,
    }));
    const { error: legacyError } = await supabase.from("internal_expenses").insert(legacy);
    if (legacyError) return fail(`Failed to save: ${legacyError.message}`);
    revalidatePath("/dashboard/expenses");
    revalidatePath("/dashboard/crm");
    return fail(
      `Saved as plain expense lines. ${NEW_COLUMNS_MESSAGE}`
    );
  }

  return fail(`Failed to save: ${error.message}`);
}

/**
 * Edits one expense bill in place: header fields are updated on every line of
 * the group, lines carrying an id are updated, new lines are inserted and
 * removed lines are deleted. Falls back with a clear message (never a silent
 * half-save) when the bill columns aren't there.
 */
export async function updateExpenseAction(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  const groupId = str(formData, "entry_group_id");
  if (!groupId) return fail("Missing entry.");

  const { error: headerError, header } = parseHeader(formData);
  if (headerError || !header) return fail(headerError ?? "Could not read the form.");
  const items = parseItems(formData);
  if (items.length === 0) return fail("Add at least one item with a category and an amount greater than 0.");
  if (!employee.companyIds.includes(header.companyId)) return fail("You do not have access to this company.");

  // The group is addressed by entry_group_id, and legacy rows have none —
  // the client sends their ids explicitly so old single rows stay editable.
  const idList = str(formData, "row_ids")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const { data: existing, error: readError } = await supabase
    .from("internal_expenses")
    .select("id, company_id, entry_group_id")
    .in("id", idList.length ? idList : [groupId]);
  if (readError) return fail(readError.message);
  if (!existing || existing.length === 0) return fail("Entry not found.");
  if (existing.some((r) => !employee.companyIds.includes(r.company_id))) {
    return fail("You do not have access to this entry.");
  }

  // `entry_group_id` is written on EVERY line of the edit: an older row has
  // none, and without stamping it a newly added line would show up as a
  // separate bill instead of joining this one.
  const headerFields = {
    company_id: header.companyId,
    expense_date: header.expenseDate,
    payment_mode: header.paymentMode,
    remark: header.remark,
    party_id: header.partyId,
    invoice_no: header.invoiceNo,
    invoice_date: header.invoiceDate,
    entry_group_id: groupId,
    updated_at: new Date().toISOString(),
  };
  // What the same edit can still write on a database without the 2026-10-28
  // columns — an old row stays editable instead of the screen locking up
  // until the SQL is run.
  const legacyHeaderFields = {
    company_id: header.companyId,
    expense_date: header.expenseDate,
    payment_mode: header.paymentMode,
    remark: [header.invoiceNo ? `Invoice ${header.invoiceNo}` : null, header.remark]
      .filter(Boolean)
      .join(" · ") || null,
  };

  const keptIds: string[] = [];
  for (const item of items) {
    const lineFields = {
      ...headerFields,
      category: item.category!,
      amount_inr: Number(item.amount),
      description: item.description ?? null,
    };
    const legacyLineFields = {
      ...legacyHeaderFields,
      category: item.category!,
      amount_inr: Number(item.amount),
    };
    if (item.id && existing.some((r) => r.id === item.id)) {
      let { error } = await supabase.from("internal_expenses").update(lineFields).eq("id", item.id);
      if (error && isMissingSchemaPiece(error)) {
        ({ error } = await supabase.from("internal_expenses").update(legacyLineFields).eq("id", item.id));
      }
      if (error) return fail(error.message);
      keptIds.push(item.id);
    } else {
      let { error } = await supabase
        .from("internal_expenses")
        .insert({ ...lineFields, created_by_employee_id: employee.id });
      if (error && isMissingSchemaPiece(error)) {
        ({ error } = await supabase
          .from("internal_expenses")
          .insert({ ...legacyLineFields, created_by_employee_id: employee.id }));
      }
      if (error) return fail(error.message);
    }
  }

  const removed = existing.map((r) => r.id).filter((id) => !keptIds.includes(id));
  if (removed.length) {
    const { error } = await supabase.from("internal_expenses").delete().in("id", removed);
    if (error) return fail(error.message);
  }

  await logAudit(supabase, {
    companyId: header.companyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "internal_expense.updated",
    entityType: "internal_expense",
    entityId: groupId,
    entityLabel: header.invoiceNo ?? "Office expense",
  });

  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/crm");
  return ok;
}

export type SimpleResult = { error: string | null };

/** Deletes every line of one expense bill (or a single legacy row). */
export async function deleteExpenseAction(ids: string[] | string): Promise<SimpleResult> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (idList.length === 0) return { error: "Entry not found." };

  const { data: rows } = await supabase
    .from("internal_expenses")
    .select("id, company_id, category, amount_inr")
    .in("id", idList);
  if (!rows || rows.length === 0) return { error: "Entry not found." };
  if (rows.some((r) => !employee.companyIds.includes(r.company_id))) {
    return { error: "You do not have access to this entry." };
  }

  const { error } = await supabase.from("internal_expenses").delete().in("id", idList);
  if (error) return { error: error.message };

  const total = rows.reduce((s, r) => s + Number(r.amount_inr ?? 0), 0);
  await logAudit(supabase, {
    companyId: rows[0].company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "internal_expense.deleted",
    entityType: "internal_expense",
    entityId: idList[0],
    entityLabel: `${rows.length > 1 ? `${rows.length} lines` : rows[0].category} — ₹${total}`,
  });

  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/crm");
  return { error: null };
}
