// 2026-11-18b — data access for the Purchase & Accounts module.
//
// Plain selects (no embedded joins): the hand-annotated Database type only
// carries Relationships for older tables, and plain queries are just as
// correct here — the page builds small lookup maps in JS from the same
// company-scoped reads.
//
// Migration tolerance: the module is new, so on a database where
// db/2026-11-18b-purchase-accounts-phase1.sql has not been run, every read
// here fails with "table does not exist". `accountsSchemaState()` detects that
// once and the page renders a "run this SQL" card instead of an error.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  EmployeeExpenseClaimRow,
  ExpenseCategoryRow,
  ExpenseVoucherChargeRow,
  ExpenseVoucherEventRow,
  ExpenseVoucherItemRow,
  ExpenseVoucherRow,
  FinAccountRow,
  FinApprovalLimitRow,
  FinFinancialYearRow,
  FinJournalEntryRow,
  FinOpeningBalanceRow,
  FinSettingsRow,
  PettyCashAccountRow,
  PettyCashTransactionRow,
} from "@/types/database";

type Client = SupabaseClient<Database>;

export const ACCOUNTS_MIGRATION_FILE = "2026-11-18b-purchase-accounts-phase1.sql";

export type SchemaState = "ready" | "missing" | "unverified";

function isMissingObjectError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("could not find the") ||
    m.includes("schema cache") ||
    m.includes("undefined table") ||
    m.includes("undefined column")
  );
}

export async function accountsSchemaState(supabase: Client): Promise<{ state: SchemaState; error: string | null }> {
  try {
    const { error } = await supabase.from("expense_vouchers").select("id").limit(1);
    if (!error) return { state: "ready", error: null };
    return { state: isMissingObjectError(error.message) ? "missing" : "unverified", error: error.message };
  } catch (e) {
    return { state: "unverified", error: e instanceof Error ? e.message : String(e) };
  }
}

/** One read per list; all company-scoped, newest first. */
export const ACCOUNTS_DEFAULT_LIMIT = 200;

export async function loadFinancialYears(supabase: Client, companyId: string): Promise<FinFinancialYearRow[]> {
  const { data } = await supabase
    .from("fin_financial_years")
    .select("*")
    .eq("company_id", companyId)
    .order("start_date", { ascending: false });
  return data ?? [];
}

export async function loadAccounts(supabase: Client, companyId: string): Promise<FinAccountRow[]> {
  const { data } = await supabase
    .from("fin_accounts")
    .select("*")
    .eq("company_id", companyId)
    .order("code", { ascending: true });
  return data ?? [];
}

export async function loadSettings(supabase: Client, companyId: string): Promise<FinSettingsRow | null> {
  const { data } = await supabase.from("fin_settings").select("*").eq("company_id", companyId).maybeSingle();
  return data ?? null;
}

export async function loadCategories(supabase: Client, companyId: string): Promise<ExpenseCategoryRow[]> {
  // Shared rows (company_id NULL) plus this company's own overrides.
  const { data } = await supabase
    .from("expense_categories")
    .select("*")
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return data ?? [];
}

export async function loadVouchers(
  supabase: Client,
  companyId: string,
  options: { statuses?: string[]; from?: string; to?: string; limit?: number } = {}
): Promise<ExpenseVoucherRow[]> {
  let query = supabase
    .from("expense_vouchers")
    .select("*")
    .eq("company_id", companyId)
    .order("voucher_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(options.limit ?? ACCOUNTS_DEFAULT_LIMIT);
  if (options.statuses?.length) {
    query = query.in("status", options.statuses as Array<ExpenseVoucherRow["status"]>);
  }
  if (options.from) query = query.gte("voucher_date", options.from);
  if (options.to) query = query.lte("voucher_date", options.to);
  const { data } = await query;
  return data ?? [];
}

export type VoucherDetail = {
  voucher: ExpenseVoucherRow;
  items: ExpenseVoucherItemRow[];
  charges: ExpenseVoucherChargeRow[];
  events: ExpenseVoucherEventRow[];
};

export async function loadVoucherDetail(supabase: Client, voucherId: string): Promise<VoucherDetail | null> {
  const { data: voucher } = await supabase.from("expense_vouchers").select("*").eq("id", voucherId).maybeSingle();
  if (!voucher) return null;
  const [{ data: items }, { data: charges }, { data: events }] = await Promise.all([
    supabase.from("expense_voucher_items").select("*").eq("voucher_id", voucherId).order("line_no"),
    supabase.from("expense_voucher_charges").select("*").eq("voucher_id", voucherId).order("created_at"),
    supabase
      .from("expense_voucher_events")
      .select("*")
      .eq("voucher_id", voucherId)
      .order("created_at", { ascending: false }),
  ]);
  return { voucher, items: items ?? [], charges: charges ?? [], events: events ?? [] };
}

export type PettyCashData = {
  accounts: PettyCashAccountRow[];
  transactions: PettyCashTransactionRow[];
};

export async function loadPettyCash(supabase: Client, companyId: string): Promise<PettyCashData> {
  const [{ data: accounts }, { data: transactions }] = await Promise.all([
    supabase
      .from("petty_cash_accounts")
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    supabase
      .from("petty_cash_transactions")
      .select("*")
      .eq("company_id", companyId)
      .order("txn_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  return { accounts: accounts ?? [], transactions: transactions ?? [] };
}

export async function loadClaims(supabase: Client, companyId: string): Promise<EmployeeExpenseClaimRow[]> {
  const { data } = await supabase
    .from("employee_expense_claims")
    .select("*")
    .eq("company_id", companyId)
    .order("claim_date", { ascending: false })
    .limit(200);
  return data ?? [];
}

export async function loadApprovalLimits(supabase: Client, companyId: string): Promise<FinApprovalLimitRow[]> {
  const { data } = await supabase.from("fin_approval_limits").select("*").eq("company_id", companyId);
  return data ?? [];
}

export async function loadOpeningBalances(
  supabase: Client,
  companyId: string,
  financialYearId: string
): Promise<FinOpeningBalanceRow[]> {
  const { data } = await supabase
    .from("fin_opening_balances")
    .select("*")
    .eq("company_id", companyId)
    .eq("financial_year_id", financialYearId);
  return data ?? [];
}

export type LedgerFilters = { from?: string; to?: string; accountIds?: string[] };

export async function loadJournalEntries(
  supabase: Client,
  companyId: string,
  filters: LedgerFilters = {}
): Promise<FinJournalEntryRow[]> {
  let query = supabase
    .from("fin_journal_entries")
    .select("*")
    .eq("company_id", companyId)
    .order("entry_date", { ascending: true })
    .order("posted_at", { ascending: true })
    .limit(2000);
  if (filters.from) query = query.gte("entry_date", filters.from);
  if (filters.to) query = query.lte("entry_date", filters.to);
  if (filters.accountIds?.length) query = query.in("account_id", filters.accountIds);
  const { data } = await query;
  return data ?? [];
}

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
};

/** Trial balance from actual journal rows — never a stored total. */
export function buildTrialBalance(accounts: FinAccountRow[], entries: FinJournalEntryRow[]): TrialBalanceRow[] {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const entry of entries) {
    const current = byAccount.get(entry.account_id) ?? { debit: 0, credit: 0 };
    current.debit += Math.round(Number(entry.debit) * 100);
    current.credit += Math.round(Number(entry.credit) * 100);
    byAccount.set(entry.account_id, current);
  }
  const rows: TrialBalanceRow[] = [];
  for (const account of accounts) {
    const totals = byAccount.get(account.id);
    if (!totals) continue;
    rows.push({
      accountId: account.id,
      code: account.code,
      name: account.name,
      accountType: account.account_type,
      debitPaise: totals.debit,
      creditPaise: totals.credit,
      balancePaise: totals.debit - totals.credit,
    });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

/** Cash / Bank / UPI book: journal movements on payment accounts. */
export function buildPaymentBook(
  accounts: FinAccountRow[],
  entries: FinJournalEntryRow[],
  kind: "cash" | "bank"
): Array<{ entry: FinJournalEntryRow; account: FinAccountRow | null }> {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  return entries
    .filter((entry) => {
      const account = accountMap.get(entry.account_id);
      if (!account) return false;
      return kind === "cash" ? account.is_cash || account.is_petty_cash : account.is_bank || account.is_credit_card;
    })
    .map((entry) => ({ entry, account: accountMap.get(entry.account_id) ?? null }));
}
