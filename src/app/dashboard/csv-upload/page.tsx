import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "./csv-upload-form";

// CSV Upload hub (round 11) — see actions.ts / lib/statement-import/tables.ts
// header comments. Covers every statement-family table that's genuinely
// CSV-shaped (the 2 PDF-only ones live on Statement Entry instead).
export default async function CsvUploadPage() {
  const employee = await requireCapability("csv_upload");
  const supabase = await createClient();
  const { data: companies } = await supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name");

  // 2026-09-17 (evening) — "jitni bhi report hai un sabhi me total aana
  // chahiye": this page had no summary at all of what's already been
  // imported — the CRM P&L's "Old CSV History (pre-orders)" expense line
  // links here, but a user landing here from that link had no way to see
  // how many historical rows / how much value that number is made of.
  // Same source the P&L view's historical_agg CTE uses
  // (db/2026-09-17-pl-cn-allocation-and-portal-real.sql): sale_profit_ledger
  // rows with order_id IS NULL are the pre-orders-system CSV imports.
  const { data: historicalRows } = await supabase
    .from("sale_profit_ledger")
    .select("company_id, total_value_inr, total_expenses_inr")
    .eq("company_id", employee.currentCompanyId)
    .is("order_id", null);
  const historicalTotal = {
    count: (historicalRows ?? []).length,
    saleInr: (historicalRows ?? []).reduce((s, r) => s + Number(r.total_value_inr ?? 0), 0),
    expenseInr: (historicalRows ?? []).reduce((s, r) => s + Number(r.total_expenses_inr ?? 0), 0),
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">📤 CSV Upload</h1>
      </div>

      {historicalTotal.count > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Historical Data Already Imported (current company)</h2>
          <p className="text-xs text-slate-500">
            {historicalTotal.count} pre-orders row{historicalTotal.count === 1 ? "" : "s"} — Sale Value ₹{historicalTotal.saleInr.toFixed(2)}
            {" · "}Expenses ₹{historicalTotal.expenseInr.toFixed(2)} (this Expenses figure is the CRM P&amp;L&apos;s &quot;Old CSV History&quot; line).
          </p>
        </div>
      )}

      <CsvUploadForm companies={companies ?? []} />
    </div>
  );
}
