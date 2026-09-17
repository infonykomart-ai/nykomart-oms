import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { BankReconClient, type ReconAccount, type StatementRow, type PartyOption, type ExpenseOption } from "./bank-recon-client";

// Bank & Card Reconciliation (2026-09-17) — the multi-account statement
// reconciliation screen. See ./actions.ts header for the full behaviour
// contract (multi bank + card accounts, flexible statement upload, auto
// UTR/order/party matching, verify dialog, dedupe) and
// db/2026-09-17-bank-recon.sql for the schema.
export default async function BankReconPage() {
  const employee = await requireCapability("bank_recon");
  const supabase = createServiceRoleClient();

  const [{ data: companies }, { data: accounts }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase
      .from("bank_recon_accounts")
      .select("id, company_id, account_type, account_name, bank_name, account_number, card_label, statement_kind, company_share_pct, opening_balance, active, notes")
      .in("company_id", employee.companyIds)
      .order("active", { ascending: false })
      .order("account_name"),
  ]);

  const activeAccounts = (accounts ?? []).filter((a) => a.active);
  const selected = activeAccounts.find((a) => a.id === employee.currentCompanyId) ?? activeAccounts[0] ?? null;

  // Statement lines for the selected account (latest first, capped for
  // render) + the pickers the verify dialog needs.
  let rows: StatementRow[] = [];
  const totals = { total: 0, linked: 0, suggested: 0, unmatched: 0, creditSum: 0, debitSum: 0 };
  let parties: PartyOption[] = [];
  let expenses: ExpenseOption[] = [];

  if (selected) {
    const [linesRes, linkedRes, suggestedRes, partiesRes, expensesRes] = await Promise.all([
      supabase
        .from("bank_statement_lines")
        .select("id, txn_date, description, txn_no, cheque_no, dr_amount, cr_amount, balance, recon_status, match_method, linked_reference, linked_at")
        .eq("recon_account_id", selected.id)
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(600),
      supabase
        .from("bank_statement_lines")
        .select("dr_amount, cr_amount", { count: "exact", head: false })
        .eq("recon_account_id", selected.id)
        .eq("recon_status", "linked"),
      supabase
        .from("bank_statement_lines")
        .select("id", { count: "exact", head: true })
        .eq("recon_account_id", selected.id)
        .eq("recon_status", "suggested"),
      supabase.from("parties").select("id, name").in("company_id", employee.companyIds).order("name"),
      supabase
        .from("internal_expenses")
        .select("id, expense_date, category, amount_inr, company_id")
        .in("company_id", employee.companyIds)
        .order("expense_date", { ascending: false })
        .limit(500),
    ]);

    rows = (linesRes.data ?? []) as unknown as StatementRow[];
    const all = (linesRes.data ?? []) as unknown as { cr_amount: number | null; dr_amount: number | null }[];
    for (const r of all) {
      if (r.cr_amount != null) totals.creditSum += Number(r.cr_amount);
      if (r.dr_amount != null) totals.debitSum += Number(r.dr_amount);
    }
    totals.linked = linkedRes.data?.length ?? 0;
    totals.suggested = suggestedRes.count ?? 0;
    totals.total = all.length;
    totals.unmatched = Math.max(0, totals.total - totals.linked - totals.suggested);
    parties = (partiesRes.data ?? []).map((p) => ({ id: p.id, name: p.name }));
    expenses = (expensesRes.data ?? []).map((e) => ({
      id: e.id,
      label: `${e.category} — ₹${Number(e.amount_inr).toFixed(0)} (${e.expense_date})`,
      company_id: e.company_id,
    }));
  }

  const accountList: ReconAccount[] = (accounts ?? []).map((a) => ({
    id: a.id,
    company_id: a.company_id,
    company_name: companies?.find((c) => c.id === a.company_id)?.name ?? "",
    account_type: a.account_type,
    account_name: a.account_name,
    bank_name: a.bank_name,
    account_number: a.account_number,
    card_label: a.card_label,
    statement_kind: a.statement_kind,
    company_share_pct: a.company_share_pct,
    opening_balance: a.opening_balance,
    active: a.active,
    notes: a.notes,
  }));

  return (
    <BankReconClient
      companies={(companies ?? []).map((c) => ({ id: c.id, name: c.name }))}
      accounts={accountList}
      selectedAccountId={selected?.id ?? null}
      rows={rows}
      totals={totals}
      parties={parties}
      expenses={expenses}
    />
  );
}
