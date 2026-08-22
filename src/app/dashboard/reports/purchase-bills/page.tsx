import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { PurchaseBillReportTable, type PurchaseBillRow } from "./purchase-bill-report-table";

// Purchase Bill report (2026-08-22) — one of the 3 new report pages added
// alongside the generic column picker, following the Orders report's
// exact pattern (see reports/orders-report-table.tsx's header comment).
// Source: purchase_bills, company-scoped (purchase_bills.company_id is a
// real column — see db/schema.sql's comment on it: derived from the
// linked order, or the entering employee's company for orderless
// general-stock purchases). Filterable by date range (vendor_invoice_date
// — the bill's own date, not order_date), company, and vendor party.
//
// Payment status/balance_due comes from bill_pass_register — Purchase
// Bill always auto-mirrors into it on save (see documents/actions.ts's
// savePurchaseBillCore, unlike Freight/Duty Bill which are an explicit
// opt-in "Send to Finance" step) — joined here by (source='purchase_bill',
// source_id=purchase_bills.id) rather than re-deriving the total/GST math,
// which purchase_bills already computes as generated columns.
export default async function PurchaseBillReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const vendorId = typeof sp.vendor === "string" && sp.vendor ? sp.vendor : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";

  const [{ data: companies }, { data: vendors }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name").order("name"),
  ]);

  let query = supabase
    .from("purchase_bills")
    .select(
      "id, company_id, vendor_party_id, vendor_invoice_no, vendor_invoice_date, work_description, qty, sq_feet, qty_unit, unit_rate, total_amount, round_off_amt, g_total_plus_gst"
    )
    .in("company_id", companyId ? [companyId] : employee.companyIds)
    .order("vendor_invoice_date", { ascending: false, nullsFirst: false })
    .limit(1000);

  if (vendorId) query = query.eq("vendor_party_id", vendorId);
  if (fromDate) query = query.gte("vendor_invoice_date", fromDate);
  if (toDate) query = query.lte("vendor_invoice_date", toDate);

  const { data: bills } = await query;

  const billIds = (bills ?? []).map((b) => b.id);
  const { data: bprRows } = billIds.length
    ? await supabase
        .from("bill_pass_register")
        .select("source_id, total_paid, balance_due")
        .eq("source", "purchase_bill")
        .in("source_id", billIds)
    : { data: [] as never[] };

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const bprBySourceId = new Map((bprRows ?? []).map((b) => [b.source_id as string, b]));

  const rows: PurchaseBillRow[] = (bills ?? []).map((b) => {
    const totalAmount = Number(b.total_amount);
    const roundOff = Number(b.round_off_amt ?? 0);
    const grandTotal = Number(b.g_total_plus_gst ?? totalAmount);
    const gstAmt = grandTotal - totalAmount - roundOff;
    const bpr = bprBySourceId.get(b.id);
    const balanceDue = bpr ? Number(bpr.balance_due) : null;
    const paymentStatus = !bpr ? "Not in Finance ledger" : balanceDue! > 0 ? "Outstanding" : "Paid";

    return {
      id: b.id,
      vendor_invoice_no: b.vendor_invoice_no,
      vendor_name: b.vendor_party_id ? vendorName.get(b.vendor_party_id) ?? "—" : "—",
      company_name: b.company_id ? companyName.get(b.company_id) ?? "—" : "—",
      vendor_invoice_date: b.vendor_invoice_date,
      work_description: b.work_description,
      qty: b.qty,
      sq_feet: Number(b.sq_feet),
      qty_unit: b.qty_unit,
      unit_rate: Number(b.unit_rate),
      total_amount: totalAmount,
      gst_amt: gstAmt,
      round_off_amt: roundOff,
      g_total_plus_gst: grandTotal,
      payment_status: paymentStatus,
      balance_due: balanceDue,
    };
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Purchase Bill Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every Purchase Bill (raw-material/vendor purchases) — apply filters, then download or send.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <PurchaseBillReportTable
        rows={rows}
        companies={companies ?? []}
        vendors={vendors ?? []}
        filters={{ companyId, vendorId, fromDate, toDate }}
      />
    </div>
  );
}
