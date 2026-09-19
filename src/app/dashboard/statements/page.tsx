import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { StatementEntryForms } from "./statement-entry-forms";

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
    supabase
      .from("etsy_monthly_tax_invoices")
      .select("id, company_id, invoice_no, invoice_date, subtotal_inr, gst_amount_inr, total_inr")
      .eq("company_id", employee.currentCompanyId)
      .order("invoice_date", { ascending: false })
      .limit(20),
    finSupabase
      .from("ebay_financial_summary_computed_view")
      .select("id, company_id, period_from, period_to, net_cash_movement_check")
      .eq("company_id", employee.currentCompanyId)
      .order("period_from", { ascending: false })
      .limit(20),
    supabase
      .from("ebay_monthly_financial_statement")
      .select("id, company_id, period_from, period_to, closing_funds_stated, closing_funds_computed")
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

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
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

      <StatementEntryForms companies={companies ?? []} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Recent Etsy Monthly Tax Invoices</h2>
          <p className="mb-3 text-xs font-medium text-slate-500">
            Total: {etsyTotal.count} invoice{etsyTotal.count === 1 ? "" : "s"} · ₹{etsyTotal.amount.toFixed(2)} (all-time)
          </p>
          <div className="space-y-1 text-xs">
            {(etsyInvoices ?? []).length === 0 && <p className="text-slate-400">None entered yet.</p>}
            {(etsyInvoices ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
                <span className="text-slate-600">{companyName.get(r.company_id)} — {r.invoice_no} ({r.invoice_date ?? "—"})</span>
                <span className="font-medium text-slate-800">₹{Number(r.total_inr ?? 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Recent eBay Financial Summaries</h2>
          <p className="mb-3 text-xs font-medium text-slate-500">
            Total: {ebaySummaryTotal.count} summar{ebaySummaryTotal.count === 1 ? "y" : "ies"} · ₹{ebaySummaryTotal.amount.toFixed(2)} (all-time)
          </p>
          <div className="space-y-1 text-xs">
            {(ebaySummaries ?? []).length === 0 && <p className="text-slate-400">None entered yet.</p>}
            {(ebaySummaries ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
                <span className="text-slate-600">{companyName.get(r.company_id ?? "")} — {r.period_from} to {r.period_to}</span>
                <span className="font-medium text-slate-800">₹{Number(r.net_cash_movement_check ?? 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Recent eBay Financial Statements (Monthly)</h2>
          <p className="mb-3 text-xs font-medium text-slate-500">
            Total: {ebayMonthlyTotal.count} statement{ebayMonthlyTotal.count === 1 ? "" : "s"} · ${ebayMonthlyTotal.amount.toFixed(2)} closing funds stated (all-time)
          </p>
          <div className="space-y-1 text-xs">
            {(ebayMonthlyStatements ?? []).length === 0 && <p className="text-slate-400">None entered yet.</p>}
            {(ebayMonthlyStatements ?? []).map((r) => {
              const mismatch = Math.abs(Number(r.closing_funds_stated ?? 0) - Number(r.closing_funds_computed ?? 0)) > 0.01;
              return (
                <div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
                  <span className="text-slate-600">{companyName.get(r.company_id)} — {r.period_from} to {r.period_to}</span>
                  <span className={`font-medium ${mismatch ? "text-red-600" : "text-slate-800"}`}>
                    ${Number(r.closing_funds_stated ?? 0).toFixed(2)}{mismatch ? " ⚠️ mismatch" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
