"use client";

import { useRouter, usePathname } from "next/navigation";
import { ExportBar } from "@/components/export-bar";
import { EXPENSE_CATEGORIES } from "./categories";

export type ExpenseReportRow = {
  id: string;
  companyName: string;
  date: string;
  category: string;
  amount: number;
  paymentMode: string | null;
  remark: string | null;
};

type Company = { id: string; name: string };

export function ExpenseReportTable({
  companies,
  filters,
  rows,
}: {
  companies: Company[];
  filters: { from: string; to: string; companyId: string; category: string };
  rows: ExpenseReportRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  function applyFilters(formData: FormData) {
    const params = new URLSearchParams();
    params.set("tab", "report");
    for (const key of ["from", "to", "company", "category"]) {
      const v = String(formData.get(key) ?? "").trim();
      if (v) params.set(key, v);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <form
        action={applyFilters}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="er_from">From</label>
          <input id="er_from" name="from" type="date" defaultValue={filters.from} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="er_to">To</label>
          <input id="er_to" name="to" type="date" defaultValue={filters.to} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="er_company">Company</label>
          <select id="er_company" name="company" defaultValue={filters.companyId} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="er_category">Category</label>
          <select id="er_category" name="category" defaultValue={filters.category} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Apply
        </button>
      </form>

      <div id="expense-report-print-area" className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Expenses ({filters.from} to {filters.to}) — Total ₹{total.toFixed(2)}
          </h2>
          <ExportBar
            title="Office/Cash Expenses"
            filenameBase="internal-expenses"
            printAreaId="expense-report-print-area"
            columns={[
              { key: "date", label: "Date", value: (r: ExpenseReportRow) => r.date },
              { key: "company", label: "Company", value: (r: ExpenseReportRow) => r.companyName },
              { key: "category", label: "Category", value: (r: ExpenseReportRow) => r.category },
              { key: "amount", label: "Amount (INR)", value: (r: ExpenseReportRow) => r.amount.toFixed(2) },
              { key: "payment_mode", label: "Payment Mode", value: (r: ExpenseReportRow) => r.paymentMode ?? "" },
              { key: "remark", label: "Remark", value: (r: ExpenseReportRow) => r.remark ?? "" },
            ]}
            rows={rows}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Date</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Company</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Category</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Amount (INR)</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Payment Mode</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No expenses in this range.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.date}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.companyName}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.category}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-slate-900">{r.amount.toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.paymentMode ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{r.remark ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
