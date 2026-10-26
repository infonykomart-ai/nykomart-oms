"use client";

// 2026-10-24 — payable AGEING table (0-30 / 31-60 / 61-90 / 90+ days past
// due), party × company wise. Client component for the same reason the Party
// Balance Summary table is one: ExportBar takes column `value` FUNCTIONS,
// which cannot cross the server/client boundary.
import { PrintArea } from "@/components/print-view";
import { ExportBar } from "@/components/export-bar";
import { WhatsappReminderButton } from "@/components/whatsapp-reminder-button";
import type { ExportColumn } from "@/lib/export/export-table";
import type { AgeingRow } from "@/lib/parties/ageing";

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AgeingTable({
  rows,
  scopeLabel,
  today,
  totals,
  showCompany,
}: {
  rows: AgeingRow[];
  scopeLabel: string;
  today: string;
  totals: { notDue: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number; bills: number; parties: number };
  showCompany: boolean;
}) {
  const columns: ExportColumn<AgeingRow>[] = [
    { key: "party", label: "Party", value: (r) => r.partyName },
    ...(showCompany ? [{ key: "company", label: "Company", value: (r: AgeingRow) => r.companyName }] : []),
    { key: "bills", label: "Bills", value: (r) => r.bills },
    { key: "notDue", label: "Not due (₹)", value: (r) => r.notDue.toFixed(2) },
    { key: "d1_30", label: "1-30 days (₹)", value: (r) => r.d1_30.toFixed(2) },
    { key: "d31_60", label: "31-60 days (₹)", value: (r) => r.d31_60.toFixed(2) },
    { key: "d61_90", label: "61-90 days (₹)", value: (r) => r.d61_90.toFixed(2) },
    { key: "d90plus", label: "90+ days (₹)", value: (r) => r.d90plus.toFixed(2) },
    { key: "total", label: "Total payable (₹)", value: (r) => r.total.toFixed(2) },
    { key: "oldest", label: "Oldest (days)", value: (r) => r.oldestDays },
    { key: "oldestDue", label: "Oldest due date", value: (r) => r.oldestDueDate ?? "" },
  ];

  const overdueOf = (r: AgeingRow) => r.d1_30 + r.d31_60 + r.d61_90 + r.d90plus;

  const reminderText = (r: AgeingRow) =>
    `Hello ${r.partyName},\n\n` +
    `As per ${r.companyName}, ₹${money(r.total)} is pending payment` +
    (r.oldestDays > 0 ? ` — the oldest bill is ${r.oldestDays} days old (₹${money(r.d90plus)} is 90+ days).` : ".") +
    `\n\nKindly release the payment.\n— ${r.companyName}`;

  const rowClass = (r: AgeingRow) =>
    r.d90plus > 0 ? "bg-red-50/60" : r.d61_90 > 0 ? "bg-amber-50/60" : r.d31_60 > 0 ? "bg-amber-50/30" : "";

  return (
    <>
      <div className="mb-3 print:hidden">
        <ExportBar
          title={`Payables Ageing — ${scopeLabel}`}
          filenameBase={`payables-ageing-${today}`}
          columns={columns}
          rows={rows}
          printAreaId="payables-ageing-print-area"
        />
      </div>

      <PrintArea id="payables-ageing-print-area">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:overflow-visible print:border-0">
          <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-500 print:border-slate-300">
            <span className="font-semibold text-slate-900">Payables Ageing</span> · {scopeLabel} · as on {today} · days counted
            from each bill&apos;s due date (invoice received + 7 days)
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase text-slate-500">
                <th className="px-3 py-2">Party</th>
                {showCompany && <th className="px-2 py-2">Company</th>}
                <th className="px-2 py-2 text-right">Bills</th>
                <th className="px-2 py-2 text-right">Not due</th>
                <th className="px-2 py-2 text-right">1-30</th>
                <th className="px-2 py-2 text-right">31-60</th>
                <th className="px-2 py-2 text-right">61-90</th>
                <th className="px-2 py-2 text-right">90+</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right">Oldest</th>
                <th className="px-2 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.partyId}-${r.companyId}`} className={`border-b border-slate-100 text-slate-700 ${rowClass(r)}`}>
                  <td className="px-3 py-1.5 font-medium text-slate-900">{r.partyName}</td>
                  {showCompany && <td className="px-2 py-1.5 text-slate-500">{r.companyName}</td>}
                  <td className="px-2 py-1.5 text-right">{r.bills}</td>
                  <td className="px-2 py-1.5 text-right text-slate-500">{r.notDue > 0 ? money(r.notDue) : "—"}</td>
                  <td className="px-2 py-1.5 text-right">{r.d1_30 > 0 ? money(r.d1_30) : "—"}</td>
                  <td className="px-2 py-1.5 text-right">{r.d31_60 > 0 ? money(r.d31_60) : "—"}</td>
                  <td className="px-2 py-1.5 text-right text-amber-800">{r.d61_90 > 0 ? money(r.d61_90) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-red-700">{r.d90plus > 0 ? money(r.d90plus) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{money(r.total)}</td>
                  <td className="px-2 py-1.5 text-right text-slate-500">
                    {r.oldestDays > 0 ? `${r.oldestDays}d` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right print:hidden">
                    {overdueOf(r) > 0 ? (
                      <WhatsappReminderButton phone={r.contactNo} message={reminderText(r)} />
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={showCompany ? 11 : 10} className="px-3 py-6 text-center text-slate-400">
                    Nothing payable in this scope.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-400 font-bold text-slate-900">
                  <td className="px-3 py-2" colSpan={showCompany ? 2 : 1}>
                    TOTAL ({totals.parties})
                  </td>
                  <td className="px-2 py-2 text-right">{totals.bills}</td>
                  <td className="px-2 py-2 text-right">{money(totals.notDue)}</td>
                  <td className="px-2 py-2 text-right">{money(totals.d1_30)}</td>
                  <td className="px-2 py-2 text-right">{money(totals.d31_60)}</td>
                  <td className="px-2 py-2 text-right">{money(totals.d61_90)}</td>
                  <td className="px-2 py-2 text-right">{money(totals.d90plus)}</td>
                  <td className="px-2 py-2 text-right">{money(totals.total)}</td>
                  <td className="px-2 py-2" colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PrintArea>
    </>
  );
}
