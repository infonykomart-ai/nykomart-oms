"use client";

import { useActionState } from "react";
import { bulkGenerateInvoices, type BulkInvoiceState } from "../actions";
import { DownloadTemplateButton } from "@/components/download-template-button";
import type { BulkInvoiceColumn } from "./columns";

const initialState: BulkInvoiceState = { error: null, results: null };

export function BulkInvoiceUploadForm({ columns }: { columns: BulkInvoiceColumn[] }) {
  const [state, formAction, pending] = useActionState(bulkGenerateInvoices, initialState);

  const okCount = state.results?.filter((r) => !r.error).length ?? 0;
  const failCount = state.results ? state.results.length - okCount : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DownloadTemplateButton filenameBase="bulk-invoice-upload" columns={columns} />
        <p className="text-xs text-slate-400">
          Fields marked * are required. One row = one order — rows sharing the same PO/RF/RG base number (e.g.
          -1/2, -2/2) automatically combine into one invoice.
        </p>
      </div>

      <form action={formAction} className="rounded-xl border border-slate-200 bg-white p-4">
        {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,.xls"
            required
            className="text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Uploading..." : "Upload & Generate Invoices"}
          </button>
        </div>
      </form>

      {state.results && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-700">
            {okCount} order{okCount === 1 ? "" : "s"} invoiced
            {failCount > 0 && <span className="text-red-600"> · {failCount} row{failCount === 1 ? "" : "s"} failed</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Row</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">PO/RF/RG No.</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.results.map((r) => (
                  <tr key={r.row} className={r.error ? "bg-red-50" : ""}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.row}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.refNo || "—"}</td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-red-700">{r.error}</span>
                      ) : (
                        <span className="text-green-700">✓ {r.invoiceNo}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
