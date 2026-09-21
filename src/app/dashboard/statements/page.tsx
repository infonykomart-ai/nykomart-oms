import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  EbayMonthlyStatementList,
  EbaySummaryList,
  EtsyInvoiceList,
  StatementEntryForms,
  type EbayMonthlyStatementRecord,
  type EbaySummaryRecord,
  type EtsyInvoiceRecord,
} from "./statement-entry-forms";

// Statement Entry (round 11) — see actions.ts header comment.
// 2026-08-17 fix — same bug/fix as Party Ledger / Bill Payment: the 3
// "Recent …" recap lists used to scope to `employee.companyIds` (every
// company this login can access) instead of the currently selected
// company, so switching the top-nav company selector had no effect on
// what showed here. The `companies` dropdown below (line 12) is left on
// `companyIds` deliberately — that one populates the entry FORM's own
// company picker (which company a *new* statement row is being saved
// into), and an employee should be able to enter a statement for any
// company they have access to, not just whichever one happens to be
// selected up top.
export default async function StatementsPage() {
  const employee = await requireCapability("statement_entry");
  const supabase = await createClient();
  // 2026-09-19 (audit fix, Phase 4 / D) — ebay_financial_summary_computed_view
  // is one of the 16 SECURITY DEFINER views whose anon/authenticated REST
  // grant was revoked
  // (db/2026-09-19-security-definer-views-revoke-authenticated.sql), since
  // SECURITY DEFINER bypasses RLS entirely — any authenticated employee
  // could otherwise query it directly via REST and see every company's
  // eBay financial summary, not just the one this page's own
  // "statement_entry"-capability gate + .eq("company_id", ...) filter below
  // intends. Same finSupabase pattern already used by crm/page.tsx and
  // reports/sale-profit/page.tsx for their own SECURITY DEFINER view reads.
  const finSupabase = createServiceRoleClient();

  const [
    { data: companies },
    { data: etsyInvoices },
    { data: ebaySummaries },
    { data: ebayMonthlyStatements },
    { data: allEtsyForTotal },
    { data: allEbaySummariesForTotal },
    { data: allEbayMonthlyForTotal },
  ] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    // 2026-09-19 — switched from a partial column select to "*" so the full
    // row is available to pre-fill the inline Edit form (see
    // statement-entry-forms.tsx's EtsyInvoiceList / EbaySummaryList /
    // EbayMonthlyStatementList). The generated columns (subtotal_inr etc.)
    // just come along for the ride — they're display-only, never sent back
    // in an update payload (actions.ts never includes them in `payload`).
    supabase
      .from("etsy_monthly_tax_invoices")
      .select("*")
      .eq("company_id", employee.currentCompanyId)
      .order("invoice_date", { ascending: false })
      .limit(20),
    finSupabase
      .from("ebay_financial_summary_computed_view")
      .select("*")
      .eq("company_id", employee.currentCompanyId)
      .order("period_from", { ascending: false })
      .limit(20),
    supabase
      .from("ebay_monthly_financial_statement")
      .select("*")
      .eq("company_id", employee.currentCompanyId)
      .order("period_from", { ascending: false })
      .limit(20),
    // 2026-09-17 (evening) — "jitni bhi report hai un sabhi me total aana
    // chahiye": the 3 lists above are all capped to "recent 20", so a
    // total computed from just those wouldn't be the real total once a
    // company has more than 20 entries. 3 separate unlimited, single-column
    // queries (cheap — one numeric column each) so the "Total" line under
    // each list is accurate regardless of the cap.
    supabase.from("etsy_monthly_tax_invoices").select("total_inr").eq("company_id", employee.currentCompanyId),
    finSupabase.from("ebay_financial_summary_computed_view").select("net_cash_movement_check").eq("company_id", employee.currentCompanyId),
    supabase.from("ebay_monthly_financial_statement").select("closing_funds_stated").eq("company_id", employee.currentCompanyId),
  ]);

  // 2026-09-19 — a Map isn't JSON-serializable and can't cross the
  // Server->Client component boundary, so the 3 list components (now
  // client components, since they hold `editingId` state) take this plain
  // array of [id, name] pairs instead and build their own Map from it.
  const companyNamePairs: [string, string][] = (companies ?? []).map((c) => [c.id, c.name]);
  const etsyTotal = {
    count: (allEtsyForTotal ?? []).length,
    amount: (allEtsyForTotal ?? []).reduce((s, r) => s + Number(r.total_inr ?? 0), 0),
  };
  const ebaySummaryTotal = {
    count: (allEbaySummariesForTotal ?? []).length,
    amount: (allEbaySummariesForTotal ?? []).reduce((s, r) => s + Number(r.net_cash_movement_check ?? 0), 0),
  };
  const ebayMonthlyTotal = {
    count: (allEbayMonthlyForTotal ?? []).length,
    amount: (allEbayMonthlyForTotal ?? []).reduce((s, r) => s + Number(r.closing_funds_stated ?? 0), 0),
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📄 Statement Entry</h1>
        </div>
        <Link
          href="/dashboard/csv-upload"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          📤 CSV Upload (other statements)
        </Link>
      </div>

      {/* 2026-09-19 — defaultCompanyId defaults a *new* entry's Company
          dropdown to whichever company is currently selected up top,
          instead of a blank placeholder. See the header comment in
          statement-entry-forms.tsx for why this — not true per-order
          detection — is the fix: a monthly aggregate statement isn't tied
          to any single order, so there's no order to read a company off
          of. The dropdown is still fully editable either way. */}
      <StatementEntryForms companies={companies ?? []} defaultCompanyId={employee.currentCompanyId} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <EtsyInvoiceList
          companies={companies ?? []}
          companyNamePairs={companyNamePairs}
          invoices={(etsyInvoices ?? []) as EtsyInvoiceRecord[]}
          total={etsyTotal}
        />
        <EbaySummaryList
          companies={companies ?? []}
          companyNamePairs={companyNamePairs}
          summaries={(ebaySummaries ?? []) as EbaySummaryRecord[]}
          total={ebaySummaryTotal}
        />
        <EbayMonthlyStatementList
          companies={companies ?? []}
          companyNamePairs={companyNamePairs}
          statements={(ebayMonthlyStatements ?? []) as EbayMonthlyStatementRecord[]}
          total={ebayMonthlyTotal}
        />
      </div>
    </div>
  );
}
