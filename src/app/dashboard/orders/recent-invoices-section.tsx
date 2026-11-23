import Link from "next/link";

// 2026-11-23 — the separate Invoices list was removed and invoice generation
// moved onto the Orders page. That left no way back to an invoice generated
// last week except knowing its order, so this list lives here: the newest 100
// invoices of the company/companies currently filtered on, each one linking
// straight to the real invoice document (/dashboard/invoices/[id] — print,
// edit, recalculate, delete all live there).
//
// Server-rendered and read-only on purpose: this is a shortcut list, not a
// second invoice screen. Delete/recalculate stay on the invoice itself.
export type RecentInvoiceRow = {
  id: string;
  invoice_no: string;
  master_invoice_no: string;
  invoice_date: string;
  buyer_name_address: string;
  csb_type: string;
  courier_company: string;
  storeLabel: string;
  invoice_currency: string | null;
  invoice_value_usd: number | null;
};

export function RecentInvoicesSection({ invoices }: { invoices: RecentInvoiceRow[] }) {
  if (invoices.length === 0) return null;

  return (
    <details className="mt-8 rounded-xl border border-slate-200 bg-white p-4" open>
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">
        🧾 Recent invoices ({invoices.length})
      </summary>
      <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-amber-100 text-left text-amber-900">
            <tr>
              <th className="px-2 py-1.5 font-semibold">Invoice No.</th>
              <th className="px-2 py-1.5 font-semibold">Date</th>
              <th className="px-2 py-1.5 font-semibold">Buyer</th>
              <th className="px-2 py-1.5 font-semibold">Store</th>
              <th className="px-2 py-1.5 font-semibold">CSB</th>
              <th className="px-2 py-1.5 text-right font-semibold">Value</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-t border-slate-100 hover:bg-amber-50/60">
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <Link href={`/dashboard/invoices/${inv.id}`} className="font-medium text-amber-700 underline">
                    {inv.invoice_no}
                  </Link>
                  <span className="ml-1 text-[10px] text-slate-400">({inv.master_invoice_no})</span>
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{inv.invoice_date}</td>
                <td className="max-w-[260px] truncate px-2 py-1.5 text-slate-600" title={inv.buyer_name_address}>
                  {inv.buyer_name_address || "—"}
                </td>
                <td className="px-2 py-1.5 text-slate-500">
                  {inv.storeLabel || "—"}
                  {inv.courier_company ? ` · ${inv.courier_company}` : ""}
                </td>
                <td className="px-2 py-1.5 text-slate-500">{inv.csb_type}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap text-slate-700">
                  {inv.invoice_value_usd != null ? inv.invoice_value_usd.toFixed(2) : "—"}{" "}
                  {inv.invoice_currency ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
