"use server";

// Bank & Card Reconciliation (2026-09-17) — server actions.
//
// WHAT THIS ADDS: /dashboard/bank-recon — the multi-account statement
// reconciliation screen the user asked for:
//   * "bank ka agar uske alava bhi koi dusra account ho jisme pese aate
//     ho to kese hoyega" → recon_accounts: add ANY number of bank
//     accounts AND credit cards (bank/card dropdown while adding).
//   * "us bank statement upload karne ka option ho" → importStatement,
//     with flexible column mapping (heuristic + per-account learned
//     bank_recon_columns) so ANY bank/card statement shape imports.
//   * "vo automatic ye clear kar de ki itna paisa is store se aaya" →
//     autoMatch (below) matches credits to marketplace orders (store name
//     shown), and debits to bill payments/salary/card expenses.
//   * "agar koi payment utr se refance no se invoce no se party name se
//     match kar rahi hia to vo bhi mark ho jaye or link ho jaye lekin
//     purane payment ko distrub nahi kare" → matching ONLY writes
//     bank_recon_links + stamps the statement line itself. No
//     bill_pass_register row, no payment row, no internal_expenses row is
//     ever modified by this module.
//   * "har mahine statement dalae ya daily duplicate entry nhi hoye" →
//     per-line import_fingerprint + imported_batch_id: same fingerprint
//     re-uploading = skipped (already-imported), not double-counted.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  buildMapping,
  parseStatementRows,
  readStatementWorkbook,
  statementFingerprint,
  type ReconField,
} from "@/lib/bank-recon/parse";
import { matchStatementLine, type MatchCandidate, type MatchIndex } from "@/lib/bank-recon/match";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function numOrNull(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Accounts (bank + credit card master)
// ---------------------------------------------------------------------------

export type AccountFormState = { error: string | null; success: boolean };

export async function saveReconAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const employee = await requireCapability("bank_recon");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id"); // present = edit
  const companyId = str(formData, "company_id");
  // Narrowed to the column's CHECK union (bank_recon_accounts.account_type) so
  // the generated insert/update types accept it.
  const accountType: "bank" | "card" = str(formData, "account_type") === "card" ? "card" : "bank";
  const accountName = str(formData, "account_name");
  if (!companyId || !accountName) {
    return { error: "Company and Account Name are required.", success: false };
  }
  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to that company.", success: false };
  }

  const values = {
    company_id: companyId,
    account_type: accountType,
    account_name: accountName,
    bank_name: str(formData, "bank_name") || null,
    account_number: str(formData, "account_number") || null,
    card_label: str(formData, "card_label") || null,
    statement_kind: str(formData, "statement_kind") || "upload",
    company_share_pct: numOrNull(formData, "company_share_pct"),
    opening_balance: numOrNull(formData, "opening_balance"),
    active: str(formData, "active") !== "false",
    notes: str(formData, "notes") || null,
  };

  if (id) {
    const { data: existing } = await supabase.from("bank_recon_accounts").select("company_id").eq("id", id).single();
    if (!existing || !employee.companyIds.includes(existing.company_id)) {
      return { error: "Account not found or no access.", success: false };
    }
    const { error } = await supabase.from("bank_recon_accounts").update(values).eq("id", id);
    if (error) return { error: error.message, success: false };
  } else {
    const { error } = await supabase.from("bank_recon_accounts").insert({ ...values, created_by_employee_id: employee.id });
    if (error) return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/bank-recon");
  return { error: null, success: true };
}

export async function deactivateReconAccount(formData: FormData): Promise<void> {
  const employee = await requireCapability("bank_recon");
  const supabase = createServiceRoleClient();
  const id = str(formData, "id");
  const { data: existing } = await supabase.from("bank_recon_accounts").select("company_id").eq("id", id).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) return;
  await supabase.from("bank_recon_accounts").update({ active: false }).eq("id", id);
  revalidatePath("/dashboard/bank-recon");
}

// ---------------------------------------------------------------------------
// Statement import (flexible columns + dedupe)
// ---------------------------------------------------------------------------

export type ImportState = {
  error: string | null;
  success: boolean;
  imported: number | null;
  duplicates: number | null;
  skipped: { row: number; reason: string }[] | null;
  // echo back for the "save this mapping" step + auto-match bar
  accountEcho: string | null;
  newMappings: string | null; // JSON array of {file_header, maps_to} not previously saved
  matchedExact: number | null;
  suggestions: number | null;
  batchId: string | null;
};

const initialState: ImportState = {
  error: null, success: false, imported: null, duplicates: null, skipped: null,
  accountEcho: null, newMappings: null, matchedExact: null, suggestions: null, batchId: null,
};

export async function importStatement(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const employee = await requireCapability("bank_recon");
  const supabase = createServiceRoleClient();

  const accountId = str(formData, "account_id");
  if (!accountId) return { ...initialState, error: "Select an account first." };
  const { data: account, error: accErr } = await supabase
    .from("bank_recon_accounts")
    .select("id, company_id, account_name, account_type")
    .eq("id", accountId)
    .single();
  if (accErr || !account) return { ...initialState, error: "Account not found." };
  if (!employee.companyIds.includes(account.company_id)) {
    return { ...initialState, error: "You don't have access to that account's company." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...initialState, error: "Choose the statement CSV/Excel file first." };
  }

  // Load any per-account learned column mapping.
  const { data: learnedRows } = await supabase
    .from("bank_statement_columns")
    .select("file_header, maps_to")
    .eq("account_id", accountId);

  const buf = await file.arrayBuffer();
  const parsed = await readStatementWorkbook(buf);
  if ("error" in parsed) return { ...initialState, error: parsed.error };
  const { headerRow, rows, headerLineNo } = parsed;
  if (!rows.length) return { ...initialState, error: "No data rows found below the header in that file." };

  const { mapping } = buildMapping(headerRow, learnedRows ?? []);
  const hasAnyDate = mapping && Object.values(mapping).includes("txn_date");
  if (!hasAnyDate) {
    return {
      ...initialState,
      error: `Could not find a transaction-date column in this file (headers seen: ${headerRow.filter(Boolean).join(", ") || "none"}). Save a column mapping for this account once and every future upload parses automatically.`,
    };
  }

  const { parsed: parsedRows, skipped } = parseStatementRows(rows, headerRow, mapping, headerLineNo);
  if (!parsedRows.length) {
    return { ...initialState, error: "No importable rows found.", skipped };
  }

  const batchId = crypto.randomUUID();
  const direction = str(formData, "amount_direction"); // 'withdrawal' | 'deposit' | 'auto'
  const insertRows: Record<string, unknown>[] = [];
  const newMappings: { file_header: string; maps_to: string }[] = [];
  // Key on lower(file_header) ONLY — the same shape as the DB's unique
  // index uq_bank_statement_columns_header (account_id, lower(file_header)).
  // Including the field in the key (the old code did) would re-insert a
  // header that's already learned for a DIFFERENT field, violate the index
  // and silently drop every new mapping in the batch.
  const learnedSet = new Set((learnedRows ?? []).map((l) => l.file_header.toLowerCase()));
  for (const [header, field] of Object.entries(mapping)) {
    if (!learnedSet.has(header.toLowerCase())) newMappings.push({ file_header: header, maps_to: field });
  }

  for (const r of parsedRows) {
    let cr = r.deposit;
    let dr = r.withdrawal;
    // Single-amount-column statements: user says which side this file's
    // Amount column means (card statements are usually all-debits).
    if ((cr == null && dr == null) && direction === "deposit") cr = 0;
    if (direction === "withdrawal" && dr == null && cr != null) {
      dr = cr;
      cr = null;
    }
    if (cr == null && dr == null) {
      skipped.push({ row: r.rowNumber, reason: "No amount found in this row." });
      continue;
    }
    const fingerprint = statementFingerprint({
      recon_account_id: accountId,
      txn_date: r.txn_date,
      cr_amount: cr,
      dr_amount: dr,
      description: r.description,
      ref_no: r.ref_no,
    });
    insertRows.push({
      company_id: account.company_id,
      recon_account_id: accountId,
      txn_no: r.ref_no,
      txn_date: r.txn_date,
      description: r.description,
      branch_name: null,
      cheque_no: r.cheque_no,
      dr_amount: dr,
      cr_amount: cr,
      balance: r.balance,
      import_fingerprint: fingerprint,
      imported_batch_id: batchId,
    });
  }

  if (!insertRows.length) {
    return { ...initialState, error: "Every data row was skipped.", skipped };
  }

  // Dedupe: fetch this account's existing fingerprints in one go
  // (fingerprints are cheap text; count is bounded by statement size).
  const { data: existingFps } = await supabase
    .from("bank_statement_lines")
    .select("import_fingerprint")
    .eq("recon_account_id", accountId)
    .not("import_fingerprint", "is", null);
  const existingSet = new Set((existingFps ?? []).map((e) => e.import_fingerprint));

  const toInsert: Record<string, unknown>[] = [];
  let duplicates = 0;
  const seenInBatch = new Set<string>();
  for (const row of insertRows) {
    const fp = row.import_fingerprint as string;
    if (existingSet.has(fp) || seenInBatch.has(fp)) {
      duplicates++;
      continue;
    }
    seenInBatch.add(fp);
    toInsert.push(row);
  }

  if (!toInsert.length) {
    return {
      ...initialState,
      success: true,
      imported: 0,
      duplicates,
      skipped,
      accountEcho: account.account_name,
      batchId: null,
      matchedExact: 0,
      suggestions: 0,
    };
  }

  // Chunked insert (statements can exceed Supabase's row caps).
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { error } = await supabase
      .from("bank_statement_lines")
      .insert(toInsert.slice(i, i + CHUNK) as never);
    if (error) return { ...initialState, error: error.message, skipped };
  }

  // Persist any newly-learned header mappings for THIS account so the
  // next upload of the same bank parses silently (the "auto adjust
  // collom vagera" ask).
  if (newMappings.length) {
    // Failure here must not fail the import (data is already in) — just log.
    const { error: mappingError } = await supabase.from("bank_statement_columns").insert(
      newMappings.map((m) => ({ account_id: accountId, file_header: m.file_header, maps_to: m.maps_to })) as never
    );
    if (mappingError) console.error("bank_statement_columns save failed:", mappingError.message);
  }

  // Auto-match right after import (money-first ladder; only 'exact'
  // candidates are auto-linked, the rest become suggestions).
  const matchStats = await runAutoMatch(supabase, accountId, employee.companyIds);

  revalidatePath("/dashboard/bank-recon");
  return {
    error: null,
    success: true,
    imported: toInsert.length,
    duplicates,
    skipped,
    accountEcho: account.account_name,
    newMappings: JSON.stringify(newMappings),
    matchedExact: matchStats.autoLinked,
    suggestions: matchStats.pending,
    batchId,
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

// Builds the MatchIndex once per run. IMPORTANT (standing rule 4): the
// only source tables READ here are existing money records; the only
// tables WRITTEN by matching are bank_recon_links + the statement line's
// own link columns. Nothing else changes — old payments stay untouched.
async function buildMatchIndex(supabase: ServiceClient, companyIds: string[]): Promise<MatchIndex> {
  const [bpPayments, salaryBills, expenses, sales, parties] = await Promise.all([
    supabase
      .from("bill_pass_register_payments")
      .select("id, amount, payment_date, payment_mode, reference_no, bill_pass_register_id, bill_pass_register!inner(company_id, vendor_invoice_no, invoice_type, parties(name))")
      .order("payment_date", { ascending: false })
      .limit(3000),
    supabase
      .from("bill_pass_register")
      .select("id, company_id, total_amt, employee_id, invoice_type, source, employees(name)")
      .eq("source", "salary_payment")
      .order("invoice_date", { ascending: false })
      .limit(1000),
    supabase
      .from("internal_expenses")
      .select("id, company_id, expense_date, amount_inr, category, remark, recurring_debit_id, recurring_card_debits(vendor_name)")
      .order("expense_date", { ascending: false })
      .limit(3000),
    supabase
      .from("sale_profit_ledger")
      .select("id, order_id, marketplace_order_no, total_value_inr, buyer_name, company_id, stores(name)")
      .order("order_date", { ascending: false })
      .limit(3000),
    supabase.from("parties").select("id, name"),
  ]);

  const known = new Set(companyIds);
  return {
    billPayments: (bpPayments?.data ?? []).flatMap((p) => {
      const bill = p.bill_pass_register as Record<string, unknown> | null;
      if (!bill || !known.has(String(bill.company_id))) return [];
      const party = bill.parties as { name: string } | null;
      return [{
        payment_id: String(p.id),
        bill_id: String(p.bill_pass_register_id),
        reference_no: (p.reference_no as string | null) ?? null,
        amount: Number(p.amount),
        payment_date: (p.payment_date as string | null) ?? null,
        payment_mode: (p.payment_mode as string | null) ?? null,
        company_id: String(bill.company_id),
        party_name: party?.name ?? null,
        vendor_invoice_no: (bill.vendor_invoice_no as string | null) ?? null,
        invoice_type: (bill.invoice_type as string | null) ?? null,
      }];
    }),
    salaryBills: (salaryBills?.data ?? []).flatMap((s) => {
      if (!known.has(String(s.company_id))) return [];
      const emp = s.employees as unknown as { name: string } | null;
      return [{
        bill_id: String(s.id),
        employee_name: emp?.name ?? null,
        net_amount: Number(s.total_amt ?? 0),
        period_label: (s.invoice_type as string | null) ?? null,
        company_id: String(s.company_id),
      }];
    }),
    internalExpenses: (expenses?.data ?? []).flatMap((e) => {
      if (!known.has(String(e.company_id))) return [];
      const rec = e.recurring_card_debits as unknown as { vendor_name: string } | null;
      return [{
        id: String(e.id),
        expense_date: String(e.expense_date),
        amount_inr: Number(e.amount_inr),
        category: String(e.category),
        remark: (e.remark as string | null) ?? null,
        recurring_vendor: rec?.vendor_name ?? null,
        company_id: String(e.company_id),
      }];
    }),
    orderSales: (sales?.data ?? []).flatMap((s) => {
      if (!s.marketplace_order_no || !known.has(String(s.company_id))) return [];
      const store = s.stores as { name: string } | null;
      return [{
        order_id: String(s.order_id ?? s.id),
        marketplace_order_no: String(s.marketplace_order_no),
        total_value_inr: s.total_value_inr != null ? Number(s.total_value_inr) : null,
        buyer_name: (s.buyer_name as string | null) ?? null,
        store_name: store?.name ?? null,
        company_id: String(s.company_id),
      }];
    }),
    // parties are global (UNIQUE(name), no company_id column) — duplicate
    // each across every accessible company so the per-company narration-
    // name matching still finds them.
    parties: (parties?.data ?? []).flatMap((p) => companyIds.map((c) => ({ id: String(p.id), name: String(p.name), company_id: c }))),
  };
}

// Runs the auto-matching pass over one account's UNLINKED lines. Only
// 'exact' confidence auto-links; everything else is stored as a suggestion
// (recon_status='suggested', match_method/method+score kept for the UI).
export async function runAutoMatchForAccount(supabase: ServiceClient, accountId: string, companyIds: string[]) {
  return runAutoMatch(supabase, accountId, companyIds);
}

async function runAutoMatch(supabase: ServiceClient, accountId: string, companyIds: string[]): Promise<{ autoLinked: number; pending: number }> {
  const { data: linesRes, error: linesErr } = await supabase
    .from("bank_statement_lines")
    .select("id, txn_date, description, txn_no, cheque_no, dr_amount, cr_amount, company_id")
    .eq("recon_account_id", accountId)
    .eq("recon_status", "unmatched")
    .order("txn_date", { ascending: true })
    .limit(2000);
  if (linesErr || !linesRes?.length) return { autoLinked: 0, pending: 0 };
  const lines = linesRes as unknown as Record<string, unknown>[];

  const index = await buildMatchIndex(supabase, companyIds);
  let autoLinked = 0;
  let pending = 0;

  for (const line of lines) {
    const amount = Number(line.cr_amount ?? line.dr_amount ?? 0);
    if (!amount) continue;
    const candidates = matchStatementLine(
      {
        line_id: String(line.id),
        txn_date: (line.txn_date as string | null) ?? null,
        description: (line.description as string | null) ?? null,
        ref_no: (line.txn_no as string | null) ?? null,
        cheque_no: (line.cheque_no as string | null) ?? null,
        amount,
        is_credit: line.cr_amount != null,
        company_id: String(line.company_id),
      },
      index
    );
    if (!candidates.length) continue;
    const best = candidates[0];
    if (best.confidence === "exact") {
      await linkLine(supabase, line, best, employeelessLink());
      autoLinked++;
    } else {
      await supabase
        .from("bank_statement_lines")
        .update({
          recon_status: "suggested",
          match_method: `${best.match_method}:${best.match_score}`,
          linked_reference: best.target_label.slice(0, 500),
        })
        .eq("id", String(line.id))
        .eq("recon_status", "unmatched");
      pending++;
    }
  }
  return { autoLinked, pending };
}

function employeelessLink() {
  // match-run links are system actions — verified_by_employee_id is only
  // stamped on human Verify clicks (verifySuggestion/manualLink).
  return null as string | null;
}

async function linkLine(supabase: ServiceClient, line: Record<string, unknown>, best: MatchCandidate, employeeId: string | null) {
  await supabase.from("bank_recon_links").insert({
    statement_line_id: line.id,
    target_type: best.target_type,
    target_id: best.target_id,
    target_label: best.target_label,
    target_company_id: best.target_company_id,
    matched_amount: best.matched_amount,
    match_method: best.match_method,
    match_score: best.match_score,
    verified_by_employee_id: employeeId,
  } as never);
  await supabase
    .from("bank_statement_lines")
    .update({
      recon_status: "linked",
      match_method: best.match_method,
      linked_reference: best.target_label.slice(0, 500),
      linked_party_id: null,
      linked_store_id: null,
      linked_bill_id: best.target_type === "bill_payment" || best.target_type === "salary_payment" ? best.target_id : null,
      linked_order_id: best.target_type === "order_sale" ? best.target_id : null,
      linked_at: new Date().toISOString(),
      linked_by_employee_id: employeeId,
    })
    .eq("id", String(line.id))
    .eq("recon_status", "unmatched");
}

// Re-run matching on demand (button) — same invariants as the import-time run.
export async function rerunAutoMatch(accountId: string): Promise<{ autoLinked: number; pending: number; error: string | null }> {
  const employee = await requireCapability("bank_recon");
  const supabase = createServiceRoleClient();
  const { data: account } = await supabase.from("bank_recon_accounts").select("company_id").eq("id", accountId).single();
  if (!account || !employee.companyIds.includes(account.company_id)) {
    return { autoLinked: 0, pending: 0, error: "No access to that account." };
  }
  const stats = await runAutoMatch(supabase, accountId, employee.companyIds);
  revalidatePath("/dashboard/bank-recon");
  return { ...stats, error: null };
}

// Human "Verify" click on a pending suggestion row — links THAT row to the
// target the UI shows. target_id may be "party:<uuid>" for party-only
// suggestions (no bill exists yet) — stored as a link row with that label
// so it still shows in the linked list, without inventing a bill.
export async function verifySuggestion(formData: FormData): Promise<void> {
  const employee = await requireCapability("bank_recon");
  const supabase = createServiceRoleClient();
  const lineId = str(formData, "line_id");
  const targetType = str(formData, "target_type");
  const targetId = str(formData, "target_id");
  const targetLabel = str(formData, "target_label");
  const matchedAmount = str(formData, "matched_amount");

  const { data: line, error: lineErr } = await supabase
    .from("bank_statement_lines")
    .select("id, company_id, recon_status, cr_amount, dr_amount")
    .eq("id", lineId)
    .single();
  if (lineErr || !line || !employee.companyIds.includes(line.company_id)) return;

  await supabase.from("bank_recon_links").insert({
    statement_line_id: lineId,
    target_type: targetType,
    target_id: targetId,
    target_label: targetLabel,
    target_company_id: line.company_id,
    matched_amount: matchedAmount ? Number(matchedAmount) : Number(line.cr_amount ?? line.dr_amount ?? 0),
    match_method: "verified",
    match_score: null,
    verified_by_employee_id: employee.id,
  } as never);

  const isPartyOnly = targetId.startsWith("party:");
  await supabase
    .from("bank_statement_lines")
    .update({
      recon_status: "linked",
      match_method: "verified",
      linked_reference: targetLabel.slice(0, 500),
      linked_party_id: isPartyOnly ? targetId.slice("party:".length) : null,
      linked_bill_id: targetType === "bill_payment" || targetType === "salary_payment" ? targetId : null,
      linked_order_id: targetType === "order_sale" ? targetId : null,
      linked_at: new Date().toISOString(),
      linked_by_employee_id: employee.id,
    })
    .eq("id", lineId);

  revalidatePath("/dashboard/bank-recon");
}

// Manual link from the dialog: any party / order / expense id the user
// picked (the dialog's "Link to" picker) — same write shape as Verify.
export async function manualLink(formData: FormData): Promise<void> {
  await verifySuggestion(formData);
}

// Undo ONLY the reconciliation link (never the underlying payment/expense):
// "purane payment ko distrub nahi kare" cuts both ways — unlinking also
// touches nothing outside the statement line + its link rows.
export async function unlinkLine(formData: FormData): Promise<void> {
  const employee = await requireCapability("bank_recon");
  const supabase = createServiceRoleClient();
  const lineId = str(formData, "line_id");
  const { data: line } = await supabase.from("bank_statement_lines").select("company_id").eq("id", lineId).single();
  if (!line || !employee.companyIds.includes(line.company_id)) return;
  await supabase.from("bank_recon_links").delete().eq("statement_line_id", lineId);
  await supabase
    .from("bank_statement_lines")
    .update({
      recon_status: "unmatched",
      match_method: null,
      linked_reference: null,
      linked_party_id: null,
      linked_store_id: null,
      linked_bill_id: null,
      linked_order_id: null,
      linked_at: null,
      linked_by_employee_id: null,
    })
    .eq("id", lineId);
  revalidatePath("/dashboard/bank-recon");
}

// ---------------------------------------------------------------------------
// Read helpers (page)
// ---------------------------------------------------------------------------

export async function fetchReconPageData(accountId: string | null) {
  const employee = await requireCapability("bank_recon");
  // page.tsx does the actual reads inline (Server Component) — this action
  // exists only for the client-side account switcher refresh path.
  void accountId;
  return { companyIds: employee.companyIds, currentCompanyId: employee.currentCompanyId };
}

// Card summary for one card account: total spend, total payments,
// outstanding (spend - payments) — "kitna payment pada hai card me kitna
// nhi. konsa payment hua hai card se sab clear ho jaye".
export async function cardOutstanding(accountId: string): Promise<{ spent: number; paid: number; outstanding: number; error: string | null }> {
  const employee = await requireCapability("bank_recon");
  const supabase = createServiceRoleClient();
  const { data: account } = await supabase.from("bank_recon_accounts").select("company_id").eq("id", accountId).single();
  if (!account || !employee.companyIds.includes(account.company_id)) {
    return { spent: 0, paid: 0, outstanding: 0, error: "No access to that account." };
  }
  const { data } = await supabase
    .from("bank_statement_lines")
    .select("dr_amount, cr_amount")
    .eq("recon_account_id", accountId)
    .gte("txn_date", "1900-01-01");
  let spent = 0;
  let paid = 0;
  for (const r of data ?? []) {
    spent += Number(r.dr_amount ?? 0);
    paid += Number(r.cr_amount ?? 0);
  }
  return { spent, paid, outstanding: spent - paid, error: null };
}

export type { ReconField };
