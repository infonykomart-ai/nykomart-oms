"use client";

// 2026-09-23 — presentational half of the Monthly Report page: an on-screen
// table plus the app's existing Universal Export/Send toolbar (ExportBar —
// CSV/Excel/Word/Print-PDF/Email/WhatsApp for free from { columns, rows },
// see src/lib/export/export-table.ts) wrapping the exact same printable
// area PrintArea already uses everywhere else in the app.
import { ExportBar } from "@/components/export-bar";
import { PrintArea } from "@/components/print-view";
import type { ReportColumnDef, ReportRow } from "@/lib/attendance/monthly-report";

export function MonthlyReportResults({ title, columns, rows }: { title: string; columns: ReportColumnDef[]; rows: ReportRow[] }) {
  const exportColumns = columns.map((c) => ({ key: c.key, label: c.label, value: (row: ReportRow) => row[c.key] }));
  const filenameBase = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <div className="space-y-3">
      <ExportBar title={title} filenameBase={filenameBase} columns={exportColumns} rows={rows} printAreaId="monthly-report-print-area" />
      <PrintArea id="monthly-report-print-area">
        <div className="mb-3 hidden text-sm font-semibold text-slate-900 print:block">{title}</div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-400">
                    No data for this selection.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {columns.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2">
                        {r[c.key] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PrintArea>
    </div>
  );
}
