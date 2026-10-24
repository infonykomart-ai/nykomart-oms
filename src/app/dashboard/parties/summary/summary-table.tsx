"use client";

// 2026-10-24 (b) — "BALANCE SUMMERY ME YE AARA HAI" (the page-error screen).
//
// ROOT CAUSE: the summary page is a Server Component, but it handed ExportBar
// — a Client Component — an array of columns whose `value` was a FUNCTION
// (`value: (r) => r.partyName`). Functions are not serializable across the
// server/client boundary, so React threw and the whole route fell into the
// dashboard error screen instead of rendering. Every other ExportBar caller
// in the app passes its columns from a "use client" file, which is why only
// this page broke.
//
// Fix: the table + export toolbar live here, in a client component that
// receives plain, serializable rows; the column `value` functions are built
// in this file, on the client, where they are allowed.
//
// 2026-10-24 (c) — FY view ("PARTY BALANCE SUMMERY FY KE HISAB SE NIKL KE
// AAYE OR SELECT KARNE KA OPTION HO"): when the page passes `fy`, the columns
// switch from an open-balance snapshot to a proper FY statement —
// Opening | Bills | Credit Notes | Paid | Closing — while the all-time view is
// byte-for-byte what it was before. Same rows, same export buttons.
import Link from "next/link";
import { PrintArea } from "@/components/print-view";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";

export type SummaryRow = {
  partyId: string;
  partyName: string;
  companyId: string;
  companyName: string;
  bills: number;
  billed: number;
  paid: number;
  balance: number;
  overdue: number;
  oldestDue: string | null;
  advance: number;
  /** FY view only — balance carried into the FY (as on 1 April). */
  opening?: number;
  /** FY view only — credit notes / debit-note adjustments dated inside the FY. */
  credited?: number;
  /** FY view only — opening + billed − credited − paid (before the payable/advance split). */
  closing?: number;
};

type FyContext = {
  label: string;
  start: string;
  end: string;
  asOn: string;
  /** True for the FY that is still running — the only one where "overdue" means anything. */
  running: boolean;
};

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PartyBalanceSummaryTable({
  rows,
  scopeLabel,
  today,
  showCompany,
  combined,
  totals,
  fy,
}: {
  rows: SummaryRow[];
  scopeLabel: string;
  today: string;
  /** Company column shown — either "all companies" or the combined party view. */
  showCompany: boolean;
  /** True when one row per party already sums every company (see page.tsx). */
  combined: boolean;
  totals: {
    bills: number;
    billed: number;
    paid: number;
    payable: number;
    overdue: number;
    advance: number;
    /** FY view only. */
    opening?: number;
    credited?: number;
  };
  /** Non-null turns the table into an FY statement (opening / bills / paid / closing). */
  fy: FyContext | null;
}) {
  const columns: ExportColumn<SummaryRow>[] = fy
    ? [
        { key: "party", label: "Party", value: (r) => r.partyName },
        ...(showCompany ? [{ key: "company", label: combined ? "Companies" : "Company", value: (r: SummaryRow) => r.companyName }] : []),
        { key: "bills", label: `Bills in FY ${fy.label}`, value: (r) => r.bills },
        { key: "opening", label: `Opening ${fy.start} (₹)`, value: (r) => (r.opening ?? 0).toFixed(2) },
        { key: "billed", label: "Billed in FY (₹)", value: (r) => r.billed.toFixed(2) },
        { key: "credited", label: "Credit Notes (₹)", value: (r) => (r.credited ?? 0).toFixed(2) },
        { key: "paid", label: "Paid in FY (₹)", value: (r) => r.paid.toFixed(2) },
        { key: "closing", label: `Closing ${fy.asOn} (₹)`, value: (r) => (r.closing ?? 0).toFixed(2) },
        { key: "balance", label: "Payable (₹)", value: (r) => r.balance.toFixed(2) },
        { key: "advance", label: "Advance (₹)", value: (r) => r.advance.toFixed(2) },
        { key: "overdue", label: "Overdue (₹)", value: (r) => r.overdue.toFixed(2) },
        { key: "oldestDue", label: "Oldest Due Date", value: (r) => r.oldestDue ?? "" },
      ]
    : [
        { key: "party", label: "Party", value: (r) => r.partyName },
        ...(showCompany ? [{ key: "company", label: combined ? "Companies" : "Company", value: (r: SummaryRow) => r.companyName }] : []),
        { key: "bills", label: "Bills", value: (r) => r.bills },
        { key: "billed", label: "Billed (₹)", value: (r) => r.billed.toFixed(2) },
        { key: "paid", label: "Paid (₹)", value: (r) => r.paid.toFixed(2) },
        { key: "balance", label: "Balance Payable (₹)", value: (r) => r.balance.toFixed(2) },
        { key: "overdue", label: "Overdue (₹)", value: (r) => r.overdue.toFixed(2) },
        { key: "advance", label: "Advance (₹)", value: (r) => r.advance.toFixed(2) },
        { key: "oldestDue", label: "Oldest Due Date", value: (r) => r.oldestDue ?? "" },
      ];

  return (
    <>
      <div className="mb-3 print:hidden">
        <ExportBar
          title={`Party Balance Summary — ${scopeLabel}${fy ? ` — FY ${fy.label}` : ""}`}
          filenameBase={`party-balance-summary${fy ? `-fy-${fy.label}` : ""}`}
          columns={columns}
          rows={rows}
          printAreaId="party-balance-summary-print-area"
        />
      </div>

      <PrintArea id="party-balance-summary-print-area">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:overflow-visible print:border-0">
          <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-500 print:border-slate-300">
            <span className="font-semibold text-slate-900">Party Balance Summary</span> · {scopeLabel} ·{" "}
            {fy ? (
              <>
                FY {fy.label} ({fy.start} → {fy.end}) · closing as on {fy.asOn}
                {fy.running ? " (running FY, today)" : ""}
              </>
            ) : (
              <>as on {today}</>
            )}
            {combined && <span className="ml-1">· all companies combined, one row per party</span>}
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase text-slate-500">
                <th className="px-3 py-2">Party</th>
                {showCompany && <th className="px-2 py-2">{combined ? "Companies" : "Company"}</th>}
                <th className="px-2 py-2 text-right">Bills</th>
                {fy && <th className="px-2 py-2 text-right">Opening</th>}
                <th className="px-2 py-2 text-right">Billed</th>
                {fy && <th className="px-2 py-2 text-right">Credit Notes</th>}
                <th className="px-2 py-2 text-right">Paid</th>
                {fy ? (
                  <th className="px-2 py-2 text-right">Closing</th>
                ) : (
                  <th className="px-2 py-2 text-right">Balance Payable</th>
                )}
                <th className="px-2 py-2 text-right">Overdue</th>
                <th className="px-2 py-2 text-right">Advance</th>
                <th className="px-2 py-2">Oldest Due</th>
                <th className="px-2 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.partyId}-${r.companyId}`} className="border-b border-slate-100 text-slate-700">
                  <td className="px-3 py-1.5 font-medium text-slate-900">{r.partyName}</td>
                  {showCompany && <td className="px-2 py-1.5 text-slate-500">{r.companyName}</td>}
                  <td className="px-2 py-1.5 text-right">{r.bills}</td>
                  {fy && (
                    <td className="px-2 py-1.5 text-right text-slate-500">{(r.opening ?? 0) === 0 ? "—" : money(r.opening ?? 0)}</td>
                  )}
                  <td className="px-2 py-1.5 text-right">{money(r.billed)}</td>
                  {fy && (
                    <td className={`px-2 py-1.5 text-right ${(r.credited ?? 0) > 0 ? "text-purple-700" : "text-slate-400"}`}>
                      {(r.credited ?? 0) > 0 ? `−${money(r.credited ?? 0)}` : "—"}
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-right">{money(r.paid)}</td>
                  <td
                    className={`px-2 py-1.5 text-right font-semibold ${
                      (fy ? r.closing ?? 0 : r.balance) > 0 ? "text-amber-800" : "text-slate-400"
                    }`}
                  >
                    {fy
                      ? (r.closing ?? 0) === 0
                        ? "—"
                        : money(r.closing ?? 0)
                      : r.balance > 0
                        ? money(r.balance)
                        : "—"}
                  </td>
                  <td className={`px-2 py-1.5 text-right ${r.overdue > 0 ? "font-medium text-red-700" : "text-slate-400"}`}>
                    {r.overdue > 0 ? money(r.overdue) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right text-emerald-700">{r.advance > 0 ? money(r.advance) : "—"}</td>
                  <td className="px-2 py-1.5 text-slate-500">{r.oldestDue ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right print:hidden">
                    <Link href={`/dashboard/parties/${r.partyId}/ledger`} className="text-amber-700 hover:underline">
                      Ledger →
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={showCompany ? (fy ? 13 : 10) : fy ? 12 : 9} className="px-3 py-6 text-center text-slate-400">
                    {fy ? "No party had bills, payments or a balance in this financial year." : "No party has an outstanding balance in this scope."}
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-400 font-bold text-slate-900">
                  <td className="px-3 py-2" colSpan={showCompany ? 2 : 1}>
                    TOTAL ({rows.length})
                  </td>
                  <td className="px-2 py-2 text-right">{totals.bills}</td>
                  {fy && <td className="px-2 py-2 text-right">{money(totals.opening ?? 0)}</td>}
                  <td className="px-2 py-2 text-right">{money(totals.billed)}</td>
                  {fy && <td className="px-2 py-2 text-right">−{money(totals.credited ?? 0)}</td>}
                  <td className="px-2 py-2 text-right">{money(totals.paid)}</td>
                  <td className="px-2 py-2 text-right">{money(totals.payable)}</td>
                  <td className="px-2 py-2 text-right">{money(totals.overdue)}</td>
                  <td className="px-2 py-2 text-right">{money(totals.advance)}</td>
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
