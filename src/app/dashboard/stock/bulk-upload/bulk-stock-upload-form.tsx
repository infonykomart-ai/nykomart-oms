"use client";

import { useActionState, useState } from "react";
import { DownloadTemplateButton } from "@/components/download-template-button";
import { bulkSaveStockIn, bulkSaveStockOut, type BulkStockState } from "../actions";
import { STOCK_IN_COLUMNS, STOCK_OUT_COLUMNS } from "./columns";

const initialState: BulkStockState = { error: null, results: null };

export function BulkStockUploadForm() {
  const [mode, setMode] = useState<"in" | "out">("in");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setMode("in")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            mode === "in" ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Stock In
        </button>
        <button
          type="button"
          onClick={() => setMode("out")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            mode === "out" ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Stock Out
        </button>
      </div>

      {mode === "in" ? <StockInBulkPanel /> : <StockOutBulkPanel />}
    </div>
  );
}

function StockInBulkPanel() {
  const [state, formAction, pending] = useActionState(bulkSaveStockIn, initialState);
  const okCount = state.results?.filter((r) => r.action === "created").length ?? 0;
  const failCount = state.results ? state.results.length - okCount : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DownloadTemplateButton filenameBase="bulk-stock-in" columns={STOCK_IN_COLUMNS} />
        <p className="text-xs text-slate-400">Fields marked * are required. Every row is a new Stock In movement — re-uploading the same file twice logs it twice.</p>
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
            {pending ? "Uploading..." : "Upload & Save Stock In"}
          </button>
        </div>
      </form>

      {state.results && <BulkResultsTable results={state.results} okCount={okCount} failCount={failCount} />}
    </div>
  );
}

function StockOutBulkPanel() {
  const [state, formAction, pending] = useActionState(bulkSaveStockOut, initialState);
  const okCount = state.results?.filter((r) => r.action === "created").length ?? 0;
  const failCount = state.results ? state.results.length - okCount : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DownloadTemplateButton filenameBase="bulk-stock-out" columns={STOCK_OUT_COLUMNS} />
        <p className="text-xs text-slate-400">Fields marked * are required. Every row is a new Stock Out movement — re-uploading the same file twice logs it twice.</p>
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
            {pending ? "Uploading..." : "Upload & Save Stock Out"}
          </button>
        </div>
      </form>

      {state.results && <BulkResultsTable results={state.results} okCount={okCount} failCount={failCount} />}
    </div>
  );
}

function BulkResultsTable({
  results,
  okCount,
  failCount,
}: {
  results: { row: number; sku: string; action: "created" | null; error: string | null }[];
  okCount: number;
  failCount: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-slate-700">
        {okCount} saved
        {failCount > 0 && <span className="text-red-600"> · {failCount} row{failCount === 1 ? "" : "s"} failed</span>}
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Row</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">SKU Code</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {results.map((r) => (
              <tr key={r.row} className={r.error ? "bg-red-50" : ""}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.row}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.sku || "—"}</td>
                <td className="px-3 py-2">
                  {r.error ? <span className="text-red-700">{r.error}</span> : <span className="text-green-700">✓ saved</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
