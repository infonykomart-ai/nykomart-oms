import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";

// 2026-08-17 — dedicated Returns/Refunds report. Gap identified in a
// system-wide OMS-features audit: "Refunds/order_refunds tables hain
// (returns track hote hain), lekin ek dedicated Returns/Exchange dashboard
// page nahi hai (abhi order edit ke andar hi hota hai)". The data already
// existed in two places — this just surfaces it:
//
//  - `order_refunds`: the LIVE, actively-written table — one row per
//    refund entered against a cancelled order (see
//    src/app/dashboard/orders/actions.ts's saveOrderRefund, used from the
//    order-hold-cancel-actions.tsx mini-form). Company-scoped via its
//    order's company_id.
//  - `refunds`: HISTORICAL only — the old FBA Refund / Dispatch & Refund /
//    No Dispatch & Refund sheets, imported once; nothing in the current
//    app code inserts into it (confirmed via grep — only
//    documents/actions.ts's deleteCreditNote reads it, to block deleting a
//    Credit Note a historical refund still points at). Company-scoped via
//    store_id -> stores.company_id (it has no company_id of its own).
//
// Both shown here, clearly labeled, rather than merged into one table —
// they have different shapes (order_refunds is currency-flexible per row;
// refunds is USD-only, per the old sheets) and merging would lose that
// distinction silently.
//
// Reuses the `reports` capability (no new capability/role-assignment SQL
// needed) since this is conceptually part of the Reports suite — linked
// from there.
export default async function ReturnsPage() {
  const employee = await requireCapability("reports");
  const supabase = await createClient();

  const [{ data: orderRefundsRaw }, { data: stores }] = await Promise.all([
    supabase
      .from("order_refunds")
      .select(
        "id, order_id, refund_amount, refund_currency, refund_date, reason, credit_note_id, entry_by_employee_id, created_at, orders(ref_no, company_id, buyer_name_address, status)"
      )
      .order("refund_date", { ascending: false })
      .limit(300),
    supabase.from("stores").select("id, name, company_id").in("company_id", employee.companyIds),
  ]);

  const storeIds = (stores ?? []).map((s) => s.id);
  const storeName = new Map((stores ?? []).map((s) => [s.id, s.name]));

  const { data: historicalRefundsRaw } = storeIds.length
    ? await supabase
        .from("refunds")
        .select(
          "id, source, marketplace_order_no, item_id, buyer_name, store_id, invoice_no, status, order_amt_usd, refund_amt_usd, refund_amt_pct, refund_type, refund_date, reason, remark"
        )
        .in("store_id", storeIds)
        .order("refund_date", { ascending: false, nullsFirst: false })
        .limit(300)
    : { data: [] as never[] };

  // order_refunds has no company_id of its own — scope via the joined
  // order's company_id, same pattern as every other "no direct column"
  // scoping in this codebase (e.g. purchase_bills before its own
  // company_id was added).
  const orderRefunds = (orderRefundsRaw ?? []).filter(
    (r) => r.orders && employee.companyIds.includes((r.orders as { company_id: string }).company_id)
  ) as {
    id: string;
    order_id: string;
    refund_amount: number;
    refund_currency: string;
    refund_date: string;
    reason: string | null;
    credit_note_id: string | null;
    orders: { ref_no: string; company_id: string; buyer_name_address: string | null; status: string } | null;
  }[];

  const historicalRefunds = historicalRefundsRaw ?? [];

  const totalOrderRefundsUsd = orderRefunds
    .filter((r) => r.refund_currency === "USD")
    .reduce((sum, r) => sum + Number(r.refund_amount), 0);
  const totalHistoricalRefundsUsd = historicalRefunds.reduce((sum, r) => sum + Number(r.refund_amt_usd ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">↩️ Returns / Refunds</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live order refunds (cancelled orders) + historical marketplace refunds (FBA / Dispatch / No-Dispatch), for
            your accessible companies.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Live Order Refunds</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{orderRefunds.length}</div>
          <div className="text-xs text-slate-400">${totalOrderRefundsUsd.toFixed(2)} (USD rows only — shown below with currency)</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Historical Marketplace Refunds</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{historicalRefunds.length}</div>
          <div className="text-xs text-slate-400">${totalHistoricalRefundsUsd.toFixed(2)} total</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">With a Credit Note</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{orderRefunds.filter((r) => r.credit_note_id).length}</div>
          <div className="text-xs text-slate-400">of {orderRefunds.length} live order refunds</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Order Refunds (live — most recent 300)</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">PO/RF/RG</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Buyer</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Order Status</th>
                <th className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold text-slate-500">Refund Amount</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Refund Date</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Reason</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Credit Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orderRefunds.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{r.orders?.ref_no ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.orders?.buyer_name_address ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.orders?.status ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-red-700">
                    {r.refund_currency} {Number(r.refund_amount).toFixed(2)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.refund_date}</td>
                  <td className="px-3 py-2 text-slate-500">{r.reason || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{r.credit_note_id ? "✅" : "—"}</td>
                </tr>
              ))}
              {orderRefunds.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    No order refunds yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Historical Marketplace Refunds (most recent 300)</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Source</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Store</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Marketplace Order No.</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Buyer</th>
                <th className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold text-slate-500">Order $</th>
                <th className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold text-slate-500">Refund $</th>
                <th className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold text-slate-500">Refund %</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Type</th>
                <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {historicalRefunds.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{r.source}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.store_id ? storeName.get(r.store_id) ?? "—" : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.marketplace_order_no ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.buyer_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">
                    {r.order_amt_usd != null ? Number(r.order_amt_usd).toFixed(2) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-red-700">
                    {r.refund_amt_usd != null ? Number(r.refund_amt_usd).toFixed(2) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">
                    {r.refund_amt_pct != null ? `${(Number(r.refund_amt_pct) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.refund_type ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.refund_date ?? "—"}</td>
                </tr>
              ))}
              {historicalRefunds.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    No historical refund rows for your accessible companies.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
