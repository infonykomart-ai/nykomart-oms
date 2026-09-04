import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { getOrderStatusSummaries } from "@/lib/orders/order-status-summary";
import { OrdersReportTable } from "./orders-report-table";

// First real report built on the Universal Reports/Export/Send system
// (item 6, 2026-08-06) — an Orders report with date/company/status filters,
// demonstrating the pattern (columns + rows -> <ExportBar />) that every
// future report (Credit Note, Debit Note, Salary Slip, etc.) should reuse
// instead of hand-rolling its own export code.
//
// 2026-08-22 — Reports hub extended: 3 more report pages (Purchase Bill,
// Freight/Duty Bill, Party Ledger/Bill Payment Outstanding) added below,
// each following this exact page's pattern, plus a generic column/section
// picker (see src/lib/export/use-column-visibility.ts) now available to
// every report on this pattern, wired into the Orders report here as the
// first consumer. Returns/Refunds (linked below, unchanged capability)
// was also ported onto searchParams filters + <ExportBar /> — see
// returns/page.tsx's header comment.
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
      "id, ref_no, order_date, company_id, status, buyer_name_address, contact_no, item_category_id, size_label, qty, order_value_original, order_currency, order_value_usd, order_value_inr, dispatch_date, entry_timestamp, vendor_party_id, advance_tracking, final_tracking"
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

  // 2026-09-04 — the same "purchased-from vendor / Purchase Bill entry /
  // delivered status / tracking no. / freight" 5-fields-per-order summary
  // the Orders list and order detail page use (see
  // src/lib/orders/order-status-summary.ts) — one batch query per source
  // table for every order on this report, never one query per row.
  const statusByOrder = await getOrderStatusSummaries(
    supabase,
    (orders ?? []).map((o) => ({
      id: o.id,
      vendor_party_id: o.vendor_party_id,
      advance_tracking: o.advance_tracking,
      final_tracking: o.final_tracking,
    }))
  );

  const rows = (orders ?? []).map((o) => {
    const s = statusByOrder[o.id];
    return {
      ...o,
      company_name: companyName.get(o.company_id) ?? "",
      item_category_name: categoryName.get(o.item_category_id) ?? "",
      purchased_from: s?.purchasedFromName
        ? `${s.purchasedFromName}${s.purchasedFromIsPlanned ? " (planned)" : ""}`
        : "",
      pb_entry: s && s.purchaseBillCount > 0 ? s.purchaseBillLabel ?? "Yes" : "No PB yet",
      delivered_status: s?.deliveredStatus ?? "",
      delivered_date: s?.deliveredDate ?? null,
      tracking_no: s?.trackingNo ? (s.courierName ? `${s.trackingNo} (${s.courierName})` : s.trackingNo) : "",
      freight_amt: s?.freightAmt ?? null,
      freight_currency: s?.freightCurrency ?? null,
    };
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📈 Reports</h1>
          <p className="mt-1 text-sm text-slate-500">
            Orders report — apply filters, then download as CSV/Excel/Word/PDF or send via Email/WhatsApp.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {/* 2026-08-20 — "top order vali report ke jese ek report or banni
              chahiye SKU Country Size ke according" — sibling report, same
              `reports` capability. */}
          <Link
            href="/dashboard/reports/sku-country-size"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            📊 SKU × Country × Size
          </Link>
          {/* 2026-08-17 — Returns/Refunds report, new. Linked from here since
              it's conceptually part of the Reports suite (reuses the same
              `reports` capability rather than a new one).
              2026-08-22 — 3 more report pages added the same way. */}
          <Link
            href="/dashboard/returns"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            ↩️ Returns / Refunds
          </Link>
          <Link
            href="/dashboard/reports/purchase-bills"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            🧾 Purchase Bill Report
          </Link>
          <Link
            href="/dashboard/reports/freight-duty"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            🚚 Freight / Duty Bill Report
          </Link>
          <Link
            href="/dashboard/reports/outstanding"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            💳 Outstanding Balances Report
          </Link>
          {/* 2026-08-22 — 3 more reports added after "Reports hub —
              remaining scope": Party/Vendor Ledger, Sale & Profit,
              Salary/Attendance (see each page's own header comment). */}
          <Link
            href="/dashboard/reports/party-ledger"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            📒 Party / Vendor Ledger Report
          </Link>
          <Link
            href="/dashboard/reports/sale-profit"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            💹 Sale & Profit Report
          </Link>
          <Link
            href="/dashboard/reports/salary"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            🧑‍💼 Salary / Attendance Report
          </Link>
        </div>
      </div>

      <OrdersReportTable
        rows={rows}
        companies={companies ?? []}
        filters={{ companyId, status, fromDate, toDate }}
      />
    </div>
  );
}
