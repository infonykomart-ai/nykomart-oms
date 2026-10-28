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
// 2026-10-28b — "office expense bill (party ke saath) ko party ledger / Bill
// Payment me payable ke roop me post karna, lekin party har baar new hoti hai
// or gst bhi nahi hota hai, kabhi kabhi uchanti kharcha hota hai":
//
//   • A bill WITH a party now posts ONE bill_pass_register row
//     (source 'office_expense', source_id = entry_group_id, invoice_type
//     'OFFICE EXPENSE', total_amt = the bill's total, NO GST). That is the
//     same table Bill Payment and the Party Ledger already read, so the bill
//     shows up there as a payable with no extra wiring.
//   • The party may be brand new: the form is a free-text name with
//     suggestions, and an unknown name is created on the spot (no GST, no
//     bank details — just enough to be payable) so nobody has to leave this
//     screen to make a Party Master entry first.
//   • A bill with NO party ("uchanti kharcha" / misc expense) posts nothing
//     to Finance; it stays a plain internal expense in the P&L. If a bill is
//     edited to remove its party, its Finance row is removed again (blocked
//     once payments exist, so payment history is never silently lost).
//   • Editing keeps the payable in sync (total, invoice no/date, company,
//     party) instead of double-posting — the (source, source_id) unique index
//     is the backstop.
//
// Migration tolerance (db/MIGRATIONS.md): on a database where those patches
// have not been run, the writes retry WITHOUT the new columns instead of
// failing — so the screen keeps logging expenses exactly as before, and the
// 'OFFICE EXPENSE' enum value falls back to 'Service', until the SQL is run.
// See src/lib/db/missing-column.ts.

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

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

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
  /** Free-text vendor name — resolved to a party (created if new) on save. */
  partyName: string | null;
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
      partyName: strOrNull(formData, "party_name"),
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
 * Turns the typed vendor name into a party id. An unknown name is created on
 * the spot — the user's own rule: "party har baar new hoti hai". The new party
 * is deliberately minimal (name + party type) because office-expense vendors
 * usually have no GST and no bank details.
 */
async function resolvePartyId(
  supabase: ServiceClient,
  partyName: string | null
): Promise<{ error: string | null; id: string | null; name: string | null }> {
  if (!partyName) return { error: null, id: null, name: null };

  // citext column → this is case-insensitive, so "shree ram plastic" finds
  // the existing "SHREE RAM PLASTIC" instead of creating a near-duplicate.
  const { data: existing, error: findError } = await supabase
    .from("parties")
    .select("id, name")
    .eq("name", partyName)
    .limit(1)
    .maybeSingle();
  if (findError) return { error: `Could not look up the party: ${findError.message}`, id: null, name: null };
  if (existing) return { error: null, id: existing.id, name: existing.name };

  const { data: created, error: createError } = await supabase
    .from("parties")
    .insert({
      name: partyName,
      party_type: "Office Expense",
      invoice_type: "Service",
      payment_type: "AGAINST BILL",
    })
    .select("id, name")
    .single();
  if (created) return { error: null, id: created.id, name: created.name };

  // A simultaneous save (or a name that differs only by case from one created
  // in the last few milliseconds) trips the unique index — re-read instead of
  // failing the whole bill.
  if (createError && /duplicate key/i.test(createError.message)) {
    const { data: again } = await supabase
      .from("parties")
      .select("id, name")
      .eq("name", partyName)
      .limit(1)
      .maybeSingle();
    if (again) return { error: null, id: again.id, name: again.name };
  }
  return { error: `Could not create the party "${partyName}": ${createError?.message ?? "unknown error"}`, id: null, name: null };
}

type FinanceArgs = {
  companyId: string;
  groupId: string;
  partyId: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  expenseDate: string;
  total: number;
  remark: string | null;
};

/**
 * One Finance row per bill (source 'office_expense', source_id = the bill's
 * entry_group_id). Creates it, updates it, or removes it when the bill no
 * longer has a party — see the header note. Never throws: a Finance hiccup is
 * reported to the caller AFTER the expense itself is already saved.
 */
async function syncFinanceEntry(supabase: ServiceClient, args: FinanceArgs): Promise<{ error: string | null }> {
  const { data: existing, error: readError } = await supabase
    .from("bill_pass_register")
    .select("id, total_paid, total_amt")
    .eq("source", "office_expense")
    .eq("source_id", args.groupId)
    .maybeSingle();
  if (readError && !isMissingSchemaPiece(readError)) {
    return { error: readError.message };
  }

  // No party → this is a plain (misc/uchanti) expense: nothing is payable.
  if (!args.partyId) {
    if (!existing) return { error: null };
    if (Number(existing.total_paid ?? 0) > 0) {
      return {
        error: "This bill already has payments recorded in Bill Payment, so its party cannot be removed. Remove the payments first.",
      };
    }
    const { error } = await supabase.from("bill_pass_register").delete().eq("id", existing.id);
    return { error: error ? error.message : null };
  }

  const fields = {
    company_id: args.companyId,
    // The VENDOR's number only — invoice_no is the system's own reserved
    // number and stays untouched, same as Purchase Bill posting does.
    vendor_invoice_no: args.invoiceNo,
    invoice_date: args.invoiceDate ?? args.expenseDate,
    invoice_recv_date: args.invoiceDate ?? args.expenseDate,
    total_amt: Math.round(args.total * 100) / 100,
    party_id: args.partyId,
    party_type: "Office Expense",
    remark: args.remark,
  };

  if (existing) {
    const { error } = await supabase.from("bill_pass_register").update(fields).eq("id", existing.id);
    return { error: error ? error.message : null };
  }

  const insert = async (invoiceType: "OFFICE EXPENSE" | "Service") =>
    supabase.from("bill_pass_register").insert({
      ...fields,
      invoice_type: invoiceType,
      source: "office_expense",
      source_id: args.groupId,
    });

  let { error } = await insert("OFFICE EXPENSE");
  // The enum value arrives with db/2026-10-28b-…; before that file is run the
  // insert is rejected outright ("invalid input value for enum"), so fall back
  // to the pre-existing 'Service' bucket instead of losing the payable.
  if (error && /invalid input value for enum/i.test(error.message)) {
    ({ error } = await insert("Service"));
  }
  if (error && /duplicate key/i.test(error.message)) {
    // Raced with a second save of the same bill — the row exists, so update it.
    const { error: updateError } = await supabase
      .from("bill_pass_register")
      .update(fields)
      .eq("source", "office_expense")
      .eq("source_id", args.groupId);
    return { error: updateError ? updateError.message : null };
  }
  return { error: error ? error.message : null };
}

/**
 * Creates one expense bill: every line inserted in ONE statement sharing a
 * fresh entry_group_id, then (when a party is named) its Finance payable. If
 * the database doesn't have the new columns yet, the same lines are inserted
 * through the legacy payload (one row each, no bill header) so nothing the
 * user typed is lost.
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

  const party = await resolvePartyId(supabase, header.partyName);
  if (party.error) return fail(party.error);

  const entryGroupId = randomUUID();
  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  const payload = items.map((item) => ({
    company_id: header.companyId,
    expense_date: header.expenseDate,
    category: item.category!,
    amount_inr: Number(item.amount),
    payment_mode: header.paymentMode,
    remark: header.remark,
    created_by_employee_id: employee.id,
    party_id: party.id,
    invoice_no: header.invoiceNo,
    invoice_date: header.invoiceDate,
    description: item.description ?? null,
    entry_group_id: entryGroupId,
  }));

  const { error } = await supabase.from("internal_expenses").insert(payload);
  if (!error) {
    // 2026-10-28b — the payable. The bill itself is already saved, so a
    // Finance failure is reported (never rolled back) exactly like Purchase
    // Bill's "saved, but Finance ledger entry failed" path.
    const finance = await syncFinanceEntry(supabase, {
      companyId: header.companyId,
      groupId: entryGroupId,
      partyId: party.id,
      invoiceNo: header.invoiceNo,
      invoiceDate: header.invoiceDate,
      expenseDate: header.expenseDate,
      total,
      remark: header.remark,
    });

    await logAudit(supabase, {
      companyId: header.companyId,
      employeeId: employee.id,
      employeeName: employee.name,
      action: "internal_expense.created",
      entityType: "internal_expense",
      entityId: entryGroupId,
      entityLabel: `${header.invoiceNo ?? "Office expense"} — ₹${total.toFixed(2)}`,
    });
    revalidatePath("/dashboard/expenses");
    revalidatePath("/dashboard/crm");
    revalidatePath("/dashboard/bill-payment");
    if (party.id) revalidatePath(`/dashboard/parties/${party.id}/ledger`);
    if (finance.error) {
      return fail(`Expense bill saved, but its Finance entry failed: ${finance.error} — add it in Bill Payment manually.`);
    }
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
      remark: [party.name ? `Party ${party.name}` : null, header.invoiceNo ? `Invoice ${header.invoiceNo}` : null, item.description, header.remark]
        .filter(Boolean)
        .join(" · ") || null,
      created_by_employee_id: employee.id,
    }));
    const { error: legacyError } = await supabase.from("internal_expenses").insert(legacy);
    if (legacyError) return fail(`Failed to save: ${legacyError.message}`);
    revalidatePath("/dashboard/expenses");
    revalidatePath("/dashboard/crm");
    return fail(`Saved as plain expense lines. ${NEW_COLUMNS_MESSAGE}`);
  }

  return fail(`Failed to save: ${error.message}`);
}

/**
 * Edits one expense bill in place: header fields are updated on every line of
 * the group, lines carrying an id are updated, new lines are inserted and
 * removed lines are deleted, and the Finance payable is brought in line with
 * the new total/party.
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

  // The group is addressed by entry_group_id, and legacy rows have none — the
  // client sends their ids explicitly so old single rows stay editable.
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

  const party = await resolvePartyId(supabase, header.partyName);
  if (party.error) return fail(party.error);

  const total = items.reduce((s, i) => s + Number(i.amount), 0);

  // `entry_group_id` is written on EVERY line of the edit: an older row has
  // none, and without stamping it a newly added line would show up as a
  // separate bill instead of joining this one.
  const headerFields = {
    company_id: header.companyId,
    expense_date: header.expenseDate,
    payment_mode: header.paymentMode,
    remark: header.remark,
    party_id: party.id,
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
    remark: [party.name ? `Party ${party.name}` : null, header.invoiceNo ? `Invoice ${header.invoiceNo}` : null, header.remark]
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

  // 2026-10-28b — the payable follows the edited bill (total / party /
  // invoice). Removing the party removes the payable again, unless it has
  // payments.
  const finance = await syncFinanceEntry(supabase, {
    companyId: header.companyId,
    groupId,
    partyId: party.id,
    invoiceNo: header.invoiceNo,
    invoiceDate: header.invoiceDate,
    expenseDate: header.expenseDate,
    total,
    remark: header.remark,
  });

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
  revalidatePath("/dashboard/bill-payment");
  if (party.id) revalidatePath(`/dashboard/parties/${party.id}/ledger`);
  if (finance.error) return fail(`Bill saved, but its Finance entry could not be updated: ${finance.error}`);
  return ok;
}

export type SimpleResult = { error: string | null };

/**
 * Deletes every line of one expense bill (or a single legacy row) AND its
 * Finance payable — refused when Bill Payment already holds payments against
 * it, the same protection purchase bills have.
 */
export async function deleteExpenseAction(ids: string[] | string): Promise<SimpleResult> {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (idList.length === 0) return { error: "Entry not found." };

  const { data: rows } = await supabase
    .from("internal_expenses")
    .select("id, company_id, category, amount_inr, party_id, entry_group_id")
    .in("id", idList);
  if (!rows || rows.length === 0) return { error: "Entry not found." };
  if (rows.some((r) => !employee.companyIds.includes(r.company_id))) {
    return { error: "You do not have access to this entry." };
  }

  const groupIds = Array.from(new Set(rows.map((r) => r.entry_group_id ?? r.id)));
  const { data: ledgerRows } = await supabase
    .from("bill_pass_register")
    .select("id, total_paid")
    .eq("source", "office_expense")
    .in("source_id", groupIds);
  if ((ledgerRows ?? []).some((l) => Number(l.total_paid ?? 0) > 0)) {
    return {
      error:
        "Payments are already recorded against this bill in Bill Payment — it can't be deleted without losing that payment history. Remove/adjust the payments first.",
    };
  }

  const { error } = await supabase.from("internal_expenses").delete().in("id", idList);
  if (error) return { error: error.message };

  if ((ledgerRows ?? []).length) {
    const { error: ledgerError } = await supabase
      .from("bill_pass_register")
      .delete()
      .in("id", (ledgerRows ?? []).map((l) => l.id));
    if (ledgerError) return { error: `Bill deleted, but its Finance entry could not be removed: ${ledgerError.message}` };
  }

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
  revalidatePath("/dashboard/bill-payment");
  const partyId = rows[0].party_id;
  if (partyId) revalidatePath(`/dashboard/parties/${partyId}/ledger`);
  return { error: null };
}
