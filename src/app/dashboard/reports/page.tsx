import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { OrdersReportTable } from "./orders-report-table";

// First real report built on the Universal Reports/Export/Send system
// (item 6, 2026-08-06) — an Orders report with date/company/status filters,
// demonstrating the pattern (columns + rows -> <ExportBar />) that every
// future report (Credit Note, Debit Note, Salary Slip, etc.) should reuse
// instead of hand-rolling its own export code.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const status = typeof sp.status === "string" && sp.status ? sp.status : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";

  const [{ data: companies }, { data: itemCategories }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("item_categories").select("id, name"),
  ]);

  let query = supabase
    .from("orders")
    .select(
      "id, ref_no, order_date, company_id, status, buyer_name_address, contact_no, item_category_id, size_label, qty, order_value_original, order_currency, order_value_usd, order_value_inr, dispatch_date, entry_timestamp"
    )
    .in("company_id", companyId ? [companyId] : employee.companyIds)
    .order("entry_timestamp", { ascending: false })
    .limit(1000);

  if (status) query = query.eq("status", status as never);
  if (fromDate) query = query.gte("order_date", fromDate);
  if (toDate) query = query.lte("order_date", toDate);

  const { data: orders } = await query;

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const categoryName = new Map((itemCategories ?? []).map((c) => [c.id, c.name]));

  const rows = (orders ?? []).map((o) => ({
    ...o,
    company_name: companyName.get(o.company_id) ?? "",
    item_category_name: categoryName.get(o.item_category_id) ?? "",
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">📈 Reports</h1>
        <p className="mt-1 text-sm text-slate-500">
          Orders report — filter karo, phir CSV/Excel/Word/PDF me download ya Email/WhatsApp se bhejo.
        </p>
      </div>

      <OrdersReportTable
        rows={rows}
        companies={companies ?? []}
        filters={{ companyId, status, fromDate, toDate }}
      />
    </div>
  );
}
